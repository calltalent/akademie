import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import type Stripe from "stripe";
import { z } from "zod";
import { getServerEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createStripeClient } from "@/lib/stripe/client";
import { CSRF_REJECT_MESSAGE, verifySameOrigin } from "@/lib/security/origin";
import { checkoutMetadataSchema, marketplaceCheckoutMetadataSchema } from "@/lib/stripe/schema";
import {
  AFFILIATE_EVENT_TYPES,
  recordAffiliateEvent,
  type RecordAffiliateEventContext,
} from "@/lib/affiliate/intake";

/**
 * Affiliate-System, Block B4 — NACHHOL-LAUF
 * (PLAN_Affiliate-System.md 6.6, Sicherheitsprüfliste 11.3/11.9/11.10).
 *
 * Holt Stripe-Ereignisse über `stripe.events.list()` nach und legt fehlende
 * Zeilen in der Outbox `affiliate_events` an. Der Ausweg für den einen Fall,
 * für den es sonst keinen gibt: die Aufnahme im Webhook ist über einen
 * längeren Ausfall hinweg gescheitert (Tabelle fehlte, Datenbank nicht
 * erreichbar, Endpunkt nicht deployt) und Stripes Wiederholfenster von rund
 * drei Tagen ist verstrichen. Danach stellt Stripe nicht mehr zu — das
 * Geldereignis ist ohne diesen Endpunkt endgültig weg.
 *
 * ## Abgrenzung zum Reparaturlauf
 *
 * `/api/admin/affiliate/reprocess` reiht AUFGENOMMENE Zeilen wieder ein. Hier
 * geht es um Ereignisse, die nie aufgenommen wurden. Beide sind gefahrlos
 * wiederholbar, aber aus unterschiedlichen Gründen: dort greift
 * `unique (tenant_id, dedup_key)` auf der Buchung, hier
 * `unique (stripe_event_id)` auf der Aufnahme (G3). Ein zweiter Nachhol-Lauf
 * über denselben Zeitraum legt deshalb keine einzige Zeile doppelt an; er
 * zählt sie als `duplicate`.
 *
 * ## Die Ereignisse kommen von Stripe, nicht vom Aufrufer
 *
 * Sicherheitlich der Kern dieses Endpunkts: der eingehende Request trägt
 * KEINE Ereignisdaten, sondern nur einen Zeitraum und eine Obergrenze. Die
 * Ereignisse selbst werden mit dem serverseitigen `STRIPE_SECRET_KEY` bei
 * Stripe abgeholt. Damit ist die Echtheit genauso gesichert wie im Webhook
 * (dort über die Signaturprüfung, CLAUDE.md §2.4) — nur eben über eine
 * authentifizierte TLS-Verbindung zu Stripe statt über eine HMAC-Prüfung.
 * Ein Aufrufer kann sich hier kein Ereignis ausdenken; das wäre der einzige
 * Weg, eine Provision zu erfinden.
 *
 * Zerlegt wird über `buildAffiliateEventRow()` in
 * `src/lib/affiliate/intake.ts` — dieselbe Funktion wie im Webhook, damit eine
 * nachgeholte Zeile mit einer regulär aufgenommenen identisch ist und nicht
 * nur ähnlich.
 *
 * ## Grenze, die nicht im Code steht
 *
 * `stripe.events.list()` reicht rund 30 Tage zurück (Stripe-API). Ein Ausfall,
 * der länger her ist, lässt sich damit nicht mehr reparieren. Deshalb gehört
 * der Lauf zur Störungsbehebung und nicht in einen Zeitplan.
 *
 * ## Autorisierung und CSRF
 *
 * Dasselbe geteilte Geheimnis `x-cron-secret` mit zeitkonstantem Vergleich
 * wie in `/api/admin/ki/process` und `/api/admin/affiliate/reprocess`; ein
 * Vergleich mit `===` leckt über die Laufzeit. Dazu der Origin-Check nach
 * CLAUDE.md §2.9 (Begründung an `rejectsAsCrossOrigin()`). Kein
 * `requireAdminTenant()`: der Endpunkt hat weder Sitzung noch Mandanten, er
 * ist ein Betriebswerkzeug (Plan 11.10).
 */
function timingSafeSecretEqual(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a).digest();
  const hashB = createHash("sha256").update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

/**
 * CSRF-Schutz für einen state-ändernden Route Handler (CLAUDE.md §2.9, Plan
 * 11.9). Gleiche Form und gleiche Begründung wie in
 * `src/app/api/admin/affiliate/reprocess/route.ts`: ist ein `Origin`-Kopf
 * vorhanden — der Aufruf kommt also aus einem Browser —, muss er zum eigenen
 * Host passen; fehlt er (Skript- oder Konsolenaufruf, der vorgesehene
 * Betrieb), trägt das Geheimnis die Autorisierung allein. Ein fremder
 * Browserkontext kann `x-cron-secret` ohnehin nicht setzen, ohne an einem
 * CORS-Preflight zu scheitern, den dieser Endpunkt nicht beantwortet.
 */
function rejectsAsCrossOrigin(request: Request): boolean {
  if (request.headers.get("origin") === null) return false;
  return !verifySameOrigin(request);
}

/** zod an der Eingabegrenze (CLAUDE.md §2.3, Plan 11.3). */
const backfillBodySchema = z.object({
  /**
   * Wie weit zurück gesucht wird. Voreinstellung 72 Stunden — das
   * Wiederholfenster von Stripe; wer länger ausgefallen war, setzt den Wert
   * hoch. Obergrenze 720 Stunden (30 Tage), weil die Stripe-API nicht weiter
   * zurückreicht und ein größerer Wert nur eine falsche Erwartung erzeugt.
   */
  since_hours: z.number().int().min(1).max(720).optional(),
  /** Obergrenze der geprüften Ereignisse je Aufruf (Zeitbudget des Workers). */
  limit: z.number().int().min(1).max(1000).optional(),
  /**
   * Auf einzelne Ereignisarten begrenzen. Erlaubnisliste statt Sperrliste:
   * `AFFILIATE_EVENT_TYPES` ist die einzige Quelle, eine unbekannte Art wird
   * abgelehnt statt still mitgeschleppt.
   */
  types: z.array(z.enum(AFFILIATE_EVENT_TYPES)).min(1).optional(),
});

const DEFAULT_SINCE_HOURS = 72;
const DEFAULT_LIMIT = 200;
/** Stripe liefert höchstens 100 Objekte je Seite. */
const STRIPE_PAGE_SIZE = 100;

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Was der Webhook aus seinem Ablauf beisteuern konnte und hier fehlt:
 * Mandant und Bestellung. Ohne beides bliebe ein nachgeholtes
 * `checkout.session.completed` im Verarbeiter hängen — er verschiebt eine
 * Zeile ohne `order_id` so lange, bis die Versuche aufgebraucht sind (6.5).
 * Die Auflösung über `orders.stripe_payment_intent`, die der Verarbeiter
 * selbst beherrscht, greift bei einem Abo-Checkout nicht: dort ist
 * `payment_intent` leer.
 *
 * Der Mandant kommt aus derselben, von Stripe zurückgelieferten Metadata, aus
 * der ihn auch der Webhook liest, und wird über dieselben beiden Schemata
 * geprüft — das strengere (Marketplace) zuerst, weil es eine echte Obermenge
 * ist (`schema.ts`); die umgekehrte Reihenfolge ließe Marketplace-Käufe als
 * Direktkäufe durchgehen. Die Bestellung wird zusätzlich gegen diesen
 * Mandanten gefiltert (Plan 11.15): eine Kennung aus einer Fremdquelle wird
 * nie ungeprüft übernommen.
 */
async function checkoutContext(
  admin: Admin,
  event: Stripe.Event,
): Promise<RecordAffiliateEventContext> {
  const session = event.data.object as Stripe.Checkout.Session;
  const rawMetadata = session.metadata ?? {};

  const marketplaceMeta = marketplaceCheckoutMetadataSchema.safeParse(rawMetadata);
  const baseMeta = marketplaceMeta.success ? null : checkoutMetadataSchema.safeParse(rawMetadata);
  const metaTenantId = marketplaceMeta.success
    ? marketplaceMeta.data.tenant_id
    : baseMeta?.success
      ? baseMeta.data.tenant_id
      : null;

  if (typeof session.id !== "string" || session.id.length === 0) {
    return { tenantId: metaTenantId };
  }

  let orderQuery = admin
    .from("orders")
    .select("id, tenant_id")
    .eq("stripe_checkout_id", session.id);
  if (metaTenantId !== null) orderQuery = orderQuery.eq("tenant_id", metaTenantId);

  const { data, error } = await orderQuery.maybeSingle<{ id: string; tenant_id: string }>();
  if (error) {
    // Nur der Code, nie die Rohmeldung (CLAUDE.md §2.11, Plan 11.11).
    console.error(
      `[affiliate/backfill] Bestellung nachschlagen fehlgeschlagen (Code ${error.code ?? "unbekannt"}).`,
    );
    return { tenantId: metaTenantId };
  }

  return { tenantId: metaTenantId ?? data?.tenant_id ?? null, orderId: data?.id ?? null };
}

export async function POST(request: Request) {
  if (rejectsAsCrossOrigin(request)) {
    return NextResponse.json({ error: CSRF_REJECT_MESSAGE }, { status: 403 });
  }

  const expectedSecret = getServerEnv().CRON_PROCESS_SECRET;
  if (!expectedSecret) {
    console.error("[affiliate/backfill] CRON_PROCESS_SECRET ist nicht gesetzt - Endpunkt deaktiviert.");
    return NextResponse.json({ error: "Nicht konfiguriert." }, { status: 500 });
  }

  const providedSecret = request.headers.get("x-cron-secret");
  if (!providedSecret || !timingSafeSecretEqual(providedSecret, expectedSecret)) {
    console.error("[affiliate/backfill] Ungültiges oder fehlendes Secret.");
    return NextResponse.json({ error: "Nicht autorisiert." }, { status: 401 });
  }

  const rawBody = await request.text();
  let parsedJson: unknown = {};
  if (rawBody.trim().length > 0) {
    try {
      parsedJson = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Ungültige Eingabe." }, { status: 400 });
    }
  }
  const parsed = backfillBodySchema.safeParse(parsedJson);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }

  const sinceHours = parsed.data.since_hours ?? DEFAULT_SINCE_HOURS;
  const limit = parsed.data.limit ?? DEFAULT_LIMIT;
  const types: string[] = [...(parsed.data.types ?? AFFILIATE_EVENT_TYPES)];
  const gte = Math.floor(Date.now() / 1000) - sinceHours * 3600;

  let inspected = 0;
  let created = 0;
  let duplicate = 0;
  let pages = 0;

  try {
    const admin = createAdminClient();
    const stripe = createStripeClient();

    // Seitenweise und gedeckelt statt `autoPagingEach()`: der Worker hat ein
    // Zeitlimit, und ein unbegrenzter Durchlauf über einen weit
    // zurückreichenden Zeitraum liefe hinein. Wer mehr braucht, ruft erneut
    // auf — der Lauf ist idempotent.
    let startingAfter: string | undefined;
    while (inspected < limit) {
      const page = await stripe.events.list({
        created: { gte },
        types,
        limit: Math.min(STRIPE_PAGE_SIZE, limit - inspected),
        ...(startingAfter === undefined ? {} : { starting_after: startingAfter }),
      });
      pages += 1;

      for (const event of page.data) {
        inspected += 1;
        const context =
          event.type === "checkout.session.completed"
            ? await checkoutContext(admin, event)
            : {};

        // WIRFT bei jedem Datenbankfehler außer `23505` (G2). Hier ist der Wurf
        // keine Retry-Mechanik wie im Webhook, sondern ein Abbruch mit Ansage:
        // ein Nachhol-Lauf, der stumm über Fehler hinwegläuft, hinterlässt
        // genau die Lücke, die er schließen soll. Die bereits geschriebenen
        // Zeilen bleiben stehen, der Aufruf wird nach der Ursachenbehebung
        // wiederholt.
        const result = await recordAffiliateEvent(admin, event, context);
        if (result === "inserted") created += 1;
        else duplicate += 1;
      }

      if (!page.has_more || page.data.length === 0) break;
      const lastEvent = page.data[page.data.length - 1];
      if (lastEvent === undefined) break;
      startingAfter = lastEvent.id;
    }

    return NextResponse.json({
      since: new Date(gte * 1000).toISOString(),
      types,
      pages,
      inspected,
      created,
      // `duplicate` ist der Normalfall und kein Fehler: die Ereignisse waren
      // bereits aufgenommen. Nur `created` bedeutet „Lücke geschlossen".
      duplicate,
      note: "Neu angelegte Ereignisse werden vom Cron-Verarbeiter aufgegriffen.",
    });
  } catch (e) {
    // NUR stabile Kennungen ins Log, nie `error.message` (CLAUDE.md §2.11:
    // ausdrücklich auch nicht indirekt über die Meldung eines Zahlungs-SDK).
    // Es geht dabei nichts verloren: `recordAffiliateEvent()` schreibt den
    // PostgREST-Fehlercode vor dem Wurf selbst ins Log, und ein Stripe-Fehler
    // ist über `name`/`type` eindeutig genug, um ihn im Stripe-Dashboard
    // wiederzufinden. Die Zählung bis zum Abbruch geht in die Antwort, damit
    // sichtbar ist, wie weit der Lauf gekommen ist.
    const failureKind = e instanceof Error ? e.name : "unbekannt";
    const stripeType = (e as { type?: unknown } | null)?.type;
    console.error(
      `[affiliate/backfill] Lauf abgebrochen (${failureKind}${typeof stripeType === "string" ? `/${stripeType}` : ""}).`,
    );
    return NextResponse.json(
      { error: "Nachhol-Lauf fehlgeschlagen.", inspected, created, duplicate },
      { status: 500 },
    );
  }
}
