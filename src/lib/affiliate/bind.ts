import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthUser } from "@/lib/auth/context";
import { checkAffiliateProgramAccess } from "@/lib/affiliate/access";
import { affiliateReferralTokenSchema } from "@/lib/affiliate/schema";

/**
 * Affiliate-System, Block B3 — `bindReferral()`
 * (PLAN_Affiliate-System.md 4.3, 3.7, 3.8, 4.1).
 *
 * Die eine Stelle, an der aus einer anonymen Klickspur eine Zuordnung zu
 * einem Konto wird. Aufgerufen an genau drei Orten (4.3): nach der
 * Registrierung, nach dem Login und beim Rendern von
 * `/kaufen/[productSlug]`.
 *
 * ## Wozu das überhaupt nötig ist
 *
 * Cookie und URL-Parameter sind Träger, die am Gerät hängen. Wer auf dem
 * Handy klickt und am Rechner kauft, wer das Cookie löscht, wer den Kauf drei
 * Wochen später abschließt — in all diesen Fällen ist der Träger weg, und der
 * Partner hätte die Provision verloren, obwohl er den Kunden gebracht hat.
 * Die Kontobindung überlebt das: ab hier hängt die Zuordnung am Konto
 * (Regel R7 in 4.4) und, wenn das Programm es vorsieht, dauerhaft in
 * `affiliate_customer_bindings` (R4/R8).
 *
 * ## Warum das der einzige I/O-Teil dieses Arbeitsschritts ist
 *
 * Die Regelentscheidung steht in `attribution.ts` und ist rein. Hier gibt es
 * nichts zu entscheiden — nur zu schreiben, und zwar so, dass ein zweiter
 * Aufruf nichts kaputt macht: alle drei Aufrufstellen können denselben Token
 * mehrfach sehen (Login und `/kaufen` in derselben Sitzung), und der Aufruf
 * beim Rendern einer Seite wiederholt sich bei jedem Neuladen. Jeder Schritt
 * ist deshalb idempotent.
 *
 * ## Warum `createAdminClient()`
 *
 * `affiliate_referrals` und `affiliate_customer_bindings` haben für
 * `authenticated` eine Deny-Policy auf JEDEN Schreibzugriff und nur ein
 * eingeschränktes SELECT-Recht (Migration 20260911120000, Abschnitte 2, 3 und
 * 6). Das ist Absicht: wer diese Zeilen schreiben könnte, könnte sich fremde
 * Bestellungen zuordnen. Die Autorisierung passiert deshalb hier im Code und
 * VOR jeder Abfrage (CLAUDE.md §2.10): Mandant aus dem Gate, angemeldeter
 * Nutzer aus `getAuthUser()`, und jede Abfrage zusätzlich auf `tenant_id`
 * gefiltert. Ein Token aus einem fremden Mandanten findet damit nichts — und
 * bekommt dieselbe stille Antwort wie ein abgelaufenes (CLAUDE.md §2.15).
 *
 * ## Warum KEINE `"use server"`-Datei
 *
 * Eine Server Action wäre ein vom Browser aufrufbarer Endpunkt. Diese
 * Funktion braucht das nicht — sie läuft innerhalb von Server Components und
 * bestehenden Server Actions —, und ein zusätzlicher öffentlicher Eingang,
 * über den sich mit geratenen Token um sich werfen lässt, ist genau das, was
 * ein Attributionssystem nicht gebrauchen kann.
 *
 * ## Was hier NICHT passiert
 *
 * Kein Überschreiben einer bestehenden Bindung (4.3: „referral.user_id <>
 * auth.uid() -> NICHTS tun"). Das ist der Fall „geteiltes Gerät": der Partner
 * klickt seinen eigenen Link auf dem Familienrechner, danach kauft jemand
 * anderes. Die Zuordnung dem zweiten Nutzer zu überschreiben wäre nicht
 * Korrektur, sondern Diebstahl — und umgekehrt genauso. Die Datenbank hält
 * dasselbe noch einmal fest (`affiliate_referrals_guard()`); hier steht es,
 * damit der Aufrufer nicht in einen Fehler läuft.
 *
 * Und kein Prüfprotokoll-Eintrag: der Beleg IST die Zeile. `bound_at` setzt
 * der Guard-Trigger selbst auf `now()`, und `affiliate_customer_bindings`
 * trägt ihren eigenen Zeitstempel. Ein zusätzlicher Eintrag je Seitenaufruf
 * von `/kaufen` würde das Protokoll fluten, in dem später die Vorgänge
 * stehen sollen, auf die es ankommt.
 */

/**
 * Ergebnis. Gemeldet wird, WARUM nichts passiert ist — aber ausschließlich an
 * den Aufrufer im Server, nie an den Browser: alle Nicht-Treffer sind für den
 * Besucher ununterscheidbar, es gibt keine Meldung und keine andere Seite.
 * Der Wert ist für Tests und für ein späteres, bewusst sparsames Logging da.
 */
export type BindReferralResult =
  | {
      bound: true;
      referralId: string;
      partnerId: string;
      /** Die Zeile trug den Nutzer schon — zweiter Aufruf, kein Fehler. */
      alreadyBound: boolean;
      /** Eine Lifetime-Bindung besteht jetzt (neu oder schon vorher). */
      lifetimeBinding: boolean;
    }
  | {
      bound: false;
      reason:
        | "invalid-token"
        | "no-tenant"
        | "feature-disabled"
        | "not-authenticated"
        | "not-found"
        | "other-user"
        | "error";
    };

/** Spalten der Referral-Zeile, die hier gebraucht werden — nie `select("*")`. */
const REFERRAL_COLUMNS = "id, tenant_id, program_id, partner_id, user_id, status, expires_at";

type ReferralRow = {
  id: string;
  tenant_id: string;
  program_id: string;
  partner_id: string;
  user_id: string | null;
  status: string;
  expires_at: string;
};

type ProgramRow = { id: string; lifetime_binding: boolean };

/**
 * Hängt die Klickspur `token` an das angemeldete Konto.
 *
 * Wirft nie. Jeder Fehlerweg endet in „es ist nichts passiert": diese
 * Funktion läuft mitten im Rendern einer Kaufseite und in der Weiterleitung
 * nach dem Login. Eine geplatzte Zuordnung darf einen Kauf nicht verhindern —
 * sie kostet im schlimmsten Fall eine Provision, ein abgebrochener Login
 * kostet den Kunden.
 */
export async function bindReferral(
  token: string | null | undefined,
): Promise<BindReferralResult> {
  // 1. zod auf die Eingabe (CLAUDE.md §2.3). Der Token kommt aus einem
  //    Query-Parameter oder einem Cookie, also aus der Hand des Besuchers.
  //    Das Muster (64 Hex-Zeichen) ist zugleich die zweite Linie gegen
  //    eingeschleuste Filtersyntax in der Abfrage unten (CLAUDE.md §2.12).
  const parsed = affiliateReferralTokenSchema.safeParse(token);
  if (!parsed.success) return { bound: false, reason: "invalid-token" };
  const referralToken = parsed.data;

  // 2. Mandant und Feature-Schalter aus dem Gate — nie aus der Anfrage.
  const access = await checkAffiliateProgramAccess();
  if (!access.ok) {
    return { bound: false, reason: access.reason === "no-tenant" ? "no-tenant" : "feature-disabled" };
  }
  const tenantId = access.tenant.id;

  // 3. Angemeldeter Nutzer. `getAuthUser()` validiert das JWT serverseitig
  //    (kein `getSession()`-Cookie-Vertrauen) und ist innerhalb einer Anfrage
  //    zwischengespeichert — der Aufruf beim Rendern kostet also keinen
  //    zusätzlichen Rundlauf.
  const user = await getAuthUser();
  if (!user) return { bound: false, reason: "not-authenticated" };

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  // 4. Die Zeile suchen: gleicher Mandant, aktiv, nicht abgelaufen (4.3).
  //    `maybeSingle()` statt `single()`, weil „nicht gefunden" der
  //    Normalfall ist (abgelaufenes oder erfundenes Token) und kein Fehler.
  const { data: referralData, error: referralError } = await admin
    .from("affiliate_referrals")
    .select(REFERRAL_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("token", referralToken)
    .eq("status", "active")
    .gt("expires_at", nowIso)
    .maybeSingle();

  if (referralError) {
    // Nur SQLSTATE, nie die rohe Meldung (CLAUDE.md §2.11) — und niemals der
    // Token selbst: er ist ein Inhabergeheimnis, wer ihn kennt, hängt eigene
    // Bestellungen an diesen Partner.
    console.error("[affiliate-bind] Zuordnung nicht gelesen", { code: referralError.code });
    return { bound: false, reason: "error" };
  }

  const referral = referralData as ReferralRow | null;
  if (!referral) return { bound: false, reason: "not-found" };

  // 5. Geteiltes Gerät: gehört die Zeile bereits einem anderen Konto, bleibt
  //    alles, wie es ist (4.3).
  if (referral.user_id !== null && referral.user_id !== user.id) {
    return { bound: false, reason: "other-user" };
  }

  const alreadyBound = referral.user_id === user.id;

  // 6. Binden. `is("user_id", null)` im Filter, nicht nur im Gedächtnis:
  //    zwischen Lesen und Schreiben kann ein zweiter Aufruf (zweiter Tab,
  //    doppelter Login) dieselbe Zeile gebunden haben. Ohne diese Bedingung
  //    wäre das ein Wettlauf um Geld; mit ihr gewinnt schlicht der erste, und
  //    der zweite Aufruf trifft keine Zeile — was hier kein Fehler ist.
  if (!alreadyBound) {
    const { error: updateError } = await admin
      .from("affiliate_referrals")
      .update({ user_id: user.id, bound_at: nowIso })
      .eq("id", referral.id)
      .eq("tenant_id", tenantId)
      .is("user_id", null);

    if (updateError) {
      console.error("[affiliate-bind] Zuordnung nicht gebunden", { code: updateError.code });
      return { bound: false, reason: "error" };
    }
  }

  // 7. Lifetime-Bindung, nur wenn das Programm sie vorsieht (4.3). Gelesen
  //    wird mit ausdrücklicher Spaltenliste und mandantengebunden — die
  //    `program_id` stammt zwar aus der eben gelesenen Zeile und ist über den
  //    zusammengesetzten Fremdschlüssel ohnehin an den Mandanten gebunden,
  //    aber ein Filter, der zweimal dasselbe sagt, kostet nichts und hält
  //    auch dann, wenn sich an der Tabelle etwas ändert.
  const { data: programData, error: programError } = await admin
    .from("affiliate_programs")
    .select("id, lifetime_binding")
    .eq("tenant_id", tenantId)
    .eq("id", referral.program_id)
    .maybeSingle();

  if (programError) {
    console.error("[affiliate-bind] Programm nicht gelesen", { code: programError.code });
    // Die Kontobindung aus Schritt 6 steht bereits und bleibt gültig: sie ist
    // der Teil, an dem Regel R7 hängt. Gemeldet wird trotzdem der Fehler,
    // damit kein Aufrufer eine Lifetime-Bindung annimmt, die es nicht gibt.
    return { bound: false, reason: "error" };
  }

  const program = programData as ProgramRow | null;
  if (!program?.lifetime_binding) {
    return {
      bound: true,
      referralId: referral.id,
      partnerId: referral.partner_id,
      alreadyBound,
      lifetimeBinding: false,
    };
  }

  // `on conflict (tenant_id, program_id, user_id) do nothing` (3.8): die
  // ERSTE Bindung gewinnt, immer. Ein `upsert` mit Aktualisierung wäre das
  // stille Umhängen einer dauerhaften Zusage — dafür gibt es ausschließlich
  // die Umbuchung mit Prüfpfad (4.6).
  const { error: bindingError } = await admin
    .from("affiliate_customer_bindings")
    .upsert(
      {
        tenant_id: tenantId,
        program_id: referral.program_id,
        user_id: user.id,
        partner_id: referral.partner_id,
        source: "click",
      },
      { onConflict: "tenant_id,program_id,user_id", ignoreDuplicates: true },
    );

  if (bindingError) {
    console.error("[affiliate-bind] Lifetime-Bindung nicht geschrieben", {
      code: bindingError.code,
    });
    return { bound: false, reason: "error" };
  }

  return {
    bound: true,
    referralId: referral.id,
    partnerId: referral.partner_id,
    alreadyBound,
    lifetimeBinding: true,
  };
}
