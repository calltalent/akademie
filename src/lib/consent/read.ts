import "server-only";
import { cookies } from "next/headers";
import { LEGAL_LAST_UPDATED } from "@/lib/legal/updated";
import {
  consentCookieSchema,
  TRACKING_CONSENT_COOKIE,
  type ConsentCategory,
  type ConsentDecision,
  type TrackingConsentRow,
} from "@/lib/consent/schema";

/**
 * Affiliate-Modul, Block B2 (PLAN_Affiliate-System.md Abschnitt 10/B2,
 * 10.09.2026): die Leseseite der Tracking-Einwilligung.
 *
 * Zwei Träger, eine Wahrheit:
 *   - `public.tracking_consents` ist der Nachweis nach Art. 7 Abs. 1 DSGVO.
 *     Er ist append-only; ein Widerruf ist eine neue Zeile, keine Änderung
 *     der alten (Migration 20260910120100). Die Regel „jüngste Zeile je
 *     Subjekt und Kategorie gewinnt" steht als reine Funktion in
 *     `resolveConsentRows()` und ist in read.test.ts geprüft.
 *   - Das Cookie `ct_consent` trägt denselben Zustand mit, damit jeder
 *     Seitenaufruf ihn ohne Datenbank-Rundlauf kennt. Das ist keine zweite
 *     Wahrheit, sondern eine Kopie der letzten Entscheidung; beim nächsten
 *     Schreiben (actions.ts) entstehen Zeile und Cookie gemeinsam.
 *
 * Das Einwilligungs-Cookie selbst ist nicht einwilligungspflichtig: es
 * speichert ausschließlich die Entscheidung des Nutzers und ist damit
 * unbedingt erforderlich im Sinne von § 25 Abs. 2 Nr. 2 TDDDG. Ohne es
 * müsste bei jedem Seitenaufruf erneut gefragt werden — auch den, der gerade
 * abgelehnt hat.
 *
 * Jede Unklarheit endet hier bei „keine Einwilligung": kein Cookie, kaputtes
 * Cookie, unbekanntes Format, veralteter Stand der Rechtstexte. Ein
 * Attributions-Cookie darf nur bei einer nachweisbaren, aktuellen Zustimmung
 * gesetzt werden (Plan 4.2, Schritt 8).
 */

export type TrackingConsentState = {
  /** Opake Consent-ID aus dem Cookie; `null`, wenn es keine gültige gibt. */
  consentId: string | null;
  /** Stand der Rechtstexte, auf den sich die Entscheidung bezieht. */
  policyVersion: string | null;
  /** Zeitpunkt der Entscheidung (ISO-8601). */
  decidedAt: string | null;
  /** Entscheidung je Kategorie; fehlender Eintrag = noch nicht entschieden. */
  decisions: Partial<Record<ConsentCategory, ConsentDecision>>;
};

/** Der Zustand ohne jede Einwilligung — auch das Ergebnis jedes Fehlerfalls. */
export const NO_TRACKING_CONSENT: TrackingConsentState = Object.freeze({
  consentId: null,
  policyVersion: null,
  decidedAt: null,
  decisions: Object.freeze({}),
});

/**
 * Liest den Zustand aus dem rohen Cookie-Wert. Rein (kein `cookies()`), damit
 * genau die Fälle testbar sind, die im Betrieb wehtun: fehlendes Cookie,
 * abgeschnittener Wert, fremde Nutzlast, veraltete Formatversion.
 *
 * `JSON.parse` liegt in einem eigenen try/catch: ein manipulierter oder von
 * einem Proxy verstümmelter Cookie-Wert darf keine Seite zum Absturz bringen,
 * er darf nur keine Einwilligung ergeben.
 */
export function parseConsentCookie(raw: string | null | undefined): TrackingConsentState {
  if (typeof raw !== "string" || raw.length === 0) return NO_TRACKING_CONSENT;

  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    return NO_TRACKING_CONSENT;
  }

  const parsed = consentCookieSchema.safeParse(candidate);
  if (!parsed.success) return NO_TRACKING_CONSENT;

  const { cid, pol, at, dec } = parsed.data;
  return {
    consentId: cid,
    policyVersion: pol,
    decidedAt: at,
    decisions: dec.affiliate ? { affiliate: dec.affiliate } : {},
  };
}

/**
 * Gilt die Einwilligung für diese Kategorie gerade?
 *
 * Zwei Bedingungen, beide notwendig: die letzte Entscheidung ist `granted`,
 * UND sie bezieht sich auf den aktuellen Stand der Rechtstexte. Ändert sich
 * der Datenschutztext inhaltlich (`LEGAL_LAST_UPDATED` wird hochgesetzt), ist
 * die alte Zustimmung nicht mehr die, die erteilt wurde — dann wird erneut
 * gefragt. Der Vergleich ist absichtlich streng (Gleichheit, kein „neuer
 * als"): eine Sortierung von Datumszeichenketten wäre eine stille Annahme
 * über das Format der Konstante.
 */
export function isConsentGranted(
  state: TrackingConsentState,
  category: ConsentCategory = "affiliate",
  policyVersion: string = LEGAL_LAST_UPDATED,
): boolean {
  return state.decisions[category] === "granted" && state.policyVersion === policyVersion;
}

/**
 * Muss der Einwilligungsdialog erscheinen? Ja, solange für diese Kategorie
 * keine Entscheidung zum aktuellen Textstand vorliegt — eine Ablehnung ist
 * eine Entscheidung und wird respektiert, nicht erneut abgefragt.
 */
export function needsConsentDecision(
  state: TrackingConsentState,
  category: ConsentCategory = "affiliate",
  policyVersion: string = LEGAL_LAST_UPDATED,
): boolean {
  if (state.policyVersion !== policyVersion) return true;
  return state.decisions[category] === undefined;
}

/**
 * Zeitstempel einer Nachweiszeile als Zahl. Ein unlesbares Datum zählt als
 * ältestmöglich statt als „jetzt": eine kaputte Zeile darf eine gültige
 * jüngere Entscheidung nicht verdrängen.
 */
function timestampOf(row: TrackingConsentRow): number {
  const parsed = Date.parse(row.created_at);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/**
 * Zustandsauflösung über die Nachweiszeilen: die jüngste Zeile der Kategorie
 * gewinnt, unabhängig von der Reihenfolge, in der die Zeilen geladen wurden.
 * Gibt `null` zurück, wenn es für die Kategorie keine Zeile gibt.
 *
 * Gleichstand auf die Millisekunde: die einschränkende Entscheidung gewinnt.
 * Das ist kein theoretischer Fall — ein doppelt abgeschickter Klick oder zwei
 * Geräte in derselben Sekunde erzeugen gleiche Zeitstempel, und wenn eine
 * Zustimmung und ein Widerruf ununterscheidbar gleich alt sind, ist der
 * Widerruf die einzige Auflösung, die dem Nutzer nicht schadet.
 */
export function resolveConsentRows(
  rows: readonly TrackingConsentRow[],
  category: ConsentCategory = "affiliate",
): ConsentDecision | null {
  let best: { at: number; decision: ConsentDecision } | null = null;

  for (const row of rows) {
    if (row.category !== category) continue;
    const at = timestampOf(row);

    if (best === null || at > best.at) {
      best = { at, decision: row.decision };
      continue;
    }
    if (at === best.at && best.decision === "granted" && row.decision !== "granted") {
      best = { at, decision: row.decision };
    }
  }

  return best === null ? null : best.decision;
}

/**
 * Der Zustand für die laufende Anfrage, aus dem `ct_consent`-Cookie.
 * Server Components und Route Handler rufen das direkt auf; das Cookie ist
 * `httpOnly`, es gibt also keinen Weg, denselben Wert im Browser zu lesen
 * (CLAUDE.md §2.13).
 */
export async function readTrackingConsent(): Promise<TrackingConsentState> {
  const cookieStore = await cookies();
  return parseConsentCookie(cookieStore.get(TRACKING_CONSENT_COOKIE)?.value);
}

/**
 * Die eine Frage, die der Klick-Endpunkt aus Block B3 stellt, bevor er ein
 * Attributions-Cookie setzt: Darf ich? Alles andere — fehlendes Cookie,
 * Ablehnung, Widerruf, veralteter Textstand — ergibt `false`.
 */
export async function hasTrackingConsent(
  category: ConsentCategory = "affiliate",
): Promise<boolean> {
  return isConsentGranted(await readTrackingConsent(), category);
}
