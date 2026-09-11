import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getServerEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { CSRF_REJECT_MESSAGE, verifySameOrigin } from "@/lib/security/origin";
import { AFFILIATE_EVENT_MAX_ATTEMPTS } from "@/lib/affiliate/process";

/**
 * Affiliate-System, Block B4 — REPARATURLAUF
 * (PLAN_Affiliate-System.md 6.6, Sicherheitsprüfliste 11.3/11.9/11.10).
 *
 * Setzt liegengebliebene Ereignisse der Outbox `affiliate_events` auf
 * `status='pending'` mit `attempts = 0` zurück, damit der Verarbeiter sie im
 * nächsten Cron-Tick erneut aufgreift. Mehr tut dieser Endpunkt nicht: er
 * rechnet nichts, er bucht nichts, er löscht nichts.
 *
 * ## Warum das gefahrlos ist
 *
 * Jede Buchung ist über `unique (tenant_id, dedup_key)` idempotent (G3) —
 * auch Gegenbuchungen und Wiedergutschriften, deren Schlüssel den kumulativen
 * Erstattungsstand bzw. die Dispute-Kennung enthält. Ein zweiter Durchlauf
 * desselben Ereignisses schreibt deshalb nichts Neues, sondern liefert
 * dieselben Kennungen zurück (`book_affiliate_commissions()` löst einen
 * Konflikt auf die BESTEHENDE Zeile auf). Genau darauf beruht dieser
 * Endpunkt; ohne diese Eigenschaft wäre er ein Werkzeug zum Doppelbuchen.
 *
 * ## Welche Zeilen zurückgesetzt werden
 *
 * Zwei Fälle, beide nur über die Warteschlangen-Spalten erkennbar:
 *
 *  1. `status='error'` — der Regelfall aus 6.6: fünf Versuche verbraucht, die
 *     Zeile ist in der Admin-Oberfläche als „Nicht verarbeitetes
 *     Zahlungsereignis" sichtbar und wartet auf eine Ursachenbehebung
 *     (fehlende Bindung, pausiertes Programm, Datenfehler).
 *  2. `status='pending'` MIT aufgebrauchten Versuchen — die stille Variante:
 *     der Verarbeiter setzt `attempts` VOR der Arbeit hoch (Giftzeilen-Schutz)
 *     und schreibt den Endzustand danach. Scheitert genau dieser zweite
 *     Schreibvorgang, bleibt die Zeile `pending` mit `attempts = 5` liegen und
 *     fällt damit dauerhaft aus dem Auswahlfilter des Verarbeiters
 *     (`attempts < 5`). Ohne diesen zweiten Zweig gäbe es für solche Zeilen
 *     keinen Weg zurück in die Warteschlange.
 *
 * `done` und `skipped` werden ausdrücklich NICHT angefasst: `done` ist
 * gebucht, `skipped` ist eine fachliche Entscheidung („kein Affiliate-Bezug",
 * „Hausverkauf"). Ein Endzustand, den dieser Endpunkt aufbrechen könnte, wäre
 * eine zweite Buchungsgelegenheit ohne fachlichen Anlass.
 *
 * ## Autorisierung und CSRF
 *
 * Geteiltes Geheimnis `x-cron-secret` mit ZEITKONSTANTEM Vergleich, exakt nach
 * dem Muster von `src/app/api/admin/ki/process/route.ts` (dort ebenfalls lokal
 * dupliziert, wie auch in `/api/admin/webhooks/retry` — dieses Projekt hat
 * bewusst keinen gemeinsamen Helfer dafür). Ein Vergleich mit `===` leckt über
 * die Laufzeit, weil er beim ersten abweichenden Zeichen abbricht: ein
 * Angreifer könnte das Geheimnis zeichenweise erraten. Der SHA-256-Umweg
 * sorgt zusätzlich für gleich lange Eingaben, sonst wirft `timingSafeEqual()`.
 * Das erwartete Geheimnis erscheint nie in einer Antwort oder einem Log.
 *
 * Zusätzlich der Origin-Check aus CLAUDE.md §2.9 / Plan 11.9 — siehe
 * `rejectsAsCrossOrigin()` weiter unten.
 *
 * Kein `requireAdminTenant()`: dieser Endpunkt hat keinen Mandanten und keine
 * Sitzung. Er ist ein Betriebswerkzeug für Josip (manueller Aufruf wie bei
 * den anderen Cron-Ersatz-Endpunkten) und wird mit dem Admin-Client
 * ausgeführt; die vorgelagerte Prüfung ist das Geheimnis (Plan 11.10).
 */
function timingSafeSecretEqual(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a).digest();
  const hashB = createHash("sha256").update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

/**
 * CSRF-Schutz für einen state-ändernden Route Handler (CLAUDE.md §2.9): der
 * eingebaute Origin-Check von Next.js gilt nur für Server Actions, nicht für
 * `route.ts`. Plan 11.9 verlangt deshalb `verifySameOrigin()` auch hier.
 *
 * ABWEICHUNG MIT GRUND: `verifySameOrigin()` ist fail-closed und weist einen
 * Aufruf OHNE `Origin`-Kopf ab. Das ist für sitzungsbasierte Routen richtig
 * (ein Browser sendet den Kopf bei jedem POST), würde hier aber genau den
 * vorgesehenen Betrieb abweisen: dieser Endpunkt wird von einem Skript bzw.
 * von Hand gerufen (`curl`/`Invoke-RestMethod`), und solche Aufrufe haben
 * keinen `Origin`. Deshalb gilt: IST ein `Origin` vorhanden — also stammt der
 * Aufruf aus einem Browser —, muss er zum eigenen Host passen; fehlt er, trägt
 * das Geheimnis die Autorisierung allein.
 *
 * Das ist kein Loch, sondern die für Header-authentifizierte Endpunkte
 * passende Form desselben Schutzes: ein fremder Browserkontext kann
 * `x-cron-secret` gar nicht erst setzen (ein benutzerdefinierter Kopf erzwingt
 * einen CORS-Preflight, den dieser Endpunkt nicht beantwortet), und ein
 * gleich-origin Browseraufruf bleibt trotzdem an den Host gebunden. Der
 * Vergleich selbst bleibt in `src/lib/security/origin.ts` — diese Datei
 * entscheidet nur über den Fall „kein Kopf".
 */
function rejectsAsCrossOrigin(request: Request): boolean {
  if (request.headers.get("origin") === null) return false;
  return !verifySameOrigin(request);
}

/**
 * Der Rumpf ist optional; `{}` ist der übliche Aufruf. zod an der Grenze
 * (CLAUDE.md §2.3, Plan 11.3).
 */
const reprocessBodySchema = z.object({
  /** Auf einen Mandanten begrenzen (Reparatur eines einzelnen Programms). */
  tenant_id: z.string().uuid().optional(),
  /** Obergrenze je Aufruf; der Verarbeiter nimmt danach 20 Zeilen je Tick. */
  limit: z.number().int().min(1).max(1000).optional(),
});

const DEFAULT_LIMIT = 200;

type StuckEventRow = { id: string };

export async function POST(request: Request) {
  if (rejectsAsCrossOrigin(request)) {
    return NextResponse.json({ error: CSRF_REJECT_MESSAGE }, { status: 403 });
  }

  const expectedSecret = getServerEnv().CRON_PROCESS_SECRET;
  if (!expectedSecret) {
    console.error("[affiliate/reprocess] CRON_PROCESS_SECRET ist nicht gesetzt - Endpunkt deaktiviert.");
    return NextResponse.json({ error: "Nicht konfiguriert." }, { status: 500 });
  }

  const providedSecret = request.headers.get("x-cron-secret");
  if (!providedSecret || !timingSafeSecretEqual(providedSecret, expectedSecret)) {
    console.error("[affiliate/reprocess] Ungültiges oder fehlendes Secret.");
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
  const parsed = reprocessBodySchema.safeParse(parsedJson);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }
  const limit = parsed.data.limit ?? DEFAULT_LIMIT;
  const tenantId = parsed.data.tenant_id;

  try {
    const admin = createAdminClient();

    // Zuerst LESEN, dann gezielt schreiben: PostgREST kennt für ein UPDATE
    // keine verlässliche Mengenbegrenzung, und ein Update ohne Deckel über
    // eine unbekannt große Menge ist in einem Worker mit Zeitlimit keine gute
    // Idee. Der Umweg über die Kennungen macht zusätzlich sichtbar, wie viele
    // Zeilen überhaupt in Frage kamen.
    //
    // Die `or()`-Bedingung ist AUSSCHLIESSLICH aus eigenen Konstanten gebaut
    // (CLAUDE.md §2.12): `AFFILIATE_EVENT_MAX_ATTEMPTS` ist die Zahl aus
    // `process.ts`, damit Auswahlfilter des Verarbeiters und Reparaturlauf
    // nicht auseinanderdriften. Keine Nutzereingabe wird je in einen
    // Filterausdruck geschrieben; `tenant_id` geht als parametrisiertes
    // `.eq()` daneben.
    let selectQuery = admin
      .from("affiliate_events")
      .select("id")
      .or(
        `status.eq.error,and(status.eq.pending,attempts.gte.${AFFILIATE_EVENT_MAX_ATTEMPTS})`,
      )
      .order("created_at", { ascending: true })
      .limit(limit);
    if (tenantId !== undefined) selectQuery = selectQuery.eq("tenant_id", tenantId);

    const { data, error } = await selectQuery;
    if (error) {
      // Nur der Code, nie die Rohmeldung: eine PostgREST-Meldung trägt bei
      // einer Constraint-Verletzung den Schlüsselwert im Klartext, hier also
      // Stripe-Kennungen und Referral-Token (CLAUDE.md §2.11, Plan 11.11).
      console.error(
        `[affiliate/reprocess] Auswahl fehlgeschlagen (Code ${error.code ?? "unbekannt"}).`,
      );
      return NextResponse.json({ error: "Verarbeitung fehlgeschlagen." }, { status: 500 });
    }

    const ids = ((data ?? []) as StuckEventRow[]).map((row) => row.id);
    if (ids.length === 0) {
      return NextResponse.json({ candidates: 0, reset: 0 });
    }

    // `attempts = 0` ist der eigentliche Zweck: der Auswahlfilter des
    // Verarbeiters ist `attempts < AFFILIATE_EVENT_MAX_ATTEMPTS`. `last_error`
    // wird geleert, damit die Admin-Oberfläche nicht einen Grund anzeigt, der
    // gerade neu geprüft wird. `processed_at` bleibt unberührt — es steht bei
    // diesen Zeilen ohnehin auf `null` (gesetzt wird es nur bei
    // `done`/`skipped`).
    let updateQuery = admin
      .from("affiliate_events")
      .update({ status: "pending", attempts: 0, last_error: null })
      .in("id", ids);
    if (tenantId !== undefined) updateQuery = updateQuery.eq("tenant_id", tenantId);

    const { data: updated, error: updateError } = await updateQuery.select("id");
    if (updateError) {
      console.error(
        `[affiliate/reprocess] Zurücksetzen fehlgeschlagen (Code ${updateError.code ?? "unbekannt"}).`,
      );
      return NextResponse.json({ error: "Verarbeitung fehlgeschlagen." }, { status: 500 });
    }

    return NextResponse.json({
      candidates: ids.length,
      reset: ((updated ?? []) as StuckEventRow[]).length,
      // Der Hinweis gehört in die Antwort, weil der Aufrufer sonst auf eine
      // sofortige Wirkung wartet: zurückgesetzt heißt eingereiht, nicht
      // verarbeitet. Der Verarbeiter nimmt 20 Zeilen je Zwei-Minuten-Tick.
      note: "Zurückgesetzte Ereignisse werden vom Cron-Verarbeiter erneut aufgegriffen.",
    });
  } catch (e) {
    console.error(
      "[affiliate/reprocess] Unerwarteter Fehler:",
      e instanceof Error ? e.message : "unbekannt",
    );
    return NextResponse.json({ error: "Verarbeitung fehlgeschlagen." }, { status: 500 });
  }
}
