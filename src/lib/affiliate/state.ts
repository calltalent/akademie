/**
 * Affiliate-System, Block B1 — Action-State-Typen und ihre Anfangswerte.
 *
 * Eigene Datei aus demselben Grund wie `courses/state.ts`, `quiz/state.ts`,
 * `submissions/state.ts` und `marketplace/state.ts`: eine `"use server"`-Datei
 * darf in Next.js 16 ausschließlich async Funktionen exportieren, also weder
 * eine Konstante wie `initial…ActionState` noch ein Schema. Der Bugfix dazu
 * steht in PHASENSTATUS.md (Phase 1, Block 3) und ist seither dreimal
 * wiederholt worden — hier von Anfang an getrennt.
 *
 * Zusätzlich gilt der zweite dort dokumentierte Fund: ein `export type { X }
 * from "andere-datei"` (Typ-RE-Export eines importierten Typs) bricht in einer
 * `"use server"`-Datei zur Laufzeit unter Turbopack. `affiliate/actions.ts`
 * darf diese Typen deshalb NICHT weiterreichen; die Formularkomponenten
 * importieren sie direkt aus dieser Datei.
 *
 * Form überall gleich wie im Bestand: `{ error: string | null; success?: boolean }`,
 * ergänzt um die eine ID, die eine Weiterleitung nach dem Anlegen braucht.
 * `error` trägt eine bereits übersetzte, für den Nutzer bestimmte Meldung —
 * niemals `error.message` eines SDK (CLAUDE.md §2.11/§2.15).
 */

// --- Mandanten-Oberfläche (Block B6) ------------------------------------

/** Programm-Einstellungen (`/admin/affiliate/einstellungen`). */
export type AffiliateProgramActionState = { error: string | null; success?: boolean };

export const initialAffiliateProgramActionState: AffiliateProgramActionState = { error: null };

/**
 * Partneranlage, Statuswechsel und Manager-Felder. `partnerId` wird nur beim
 * Anlegen gesetzt — für die Weiterleitung auf die neue Partnerseite, gleiches
 * Muster wie `courseId` in `CourseActionState`.
 */
export type AffiliatePartnerActionState = {
  error: string | null;
  success?: boolean;
  partnerId?: string;
};

export const initialAffiliatePartnerActionState: AffiliatePartnerActionState = { error: null };

/** Kondition anlegen oder ändern (`/admin/affiliate/konditionen`). */
export type AffiliateConditionActionState = { error: string | null; success?: boolean };

export const initialAffiliateConditionActionState: AffiliateConditionActionState = { error: null };

/** Partnergruppe. `groupId` für die Auswahl direkt nach dem Anlegen. */
export type AffiliateGroupActionState = {
  error: string | null;
  success?: boolean;
  groupId?: string;
};

export const initialAffiliateGroupActionState: AffiliateGroupActionState = { error: null };

/**
 * Handbuchung, Umbuchung, Markierung und Entscheidung über eine Zeile in
 * Prüfung — alle vier Vorgänge betreffen das Provisionsbuch und teilen sich
 * einen Zustand. `commissionId` steht nur, wenn eine NEUE Zeile entstanden ist
 * (Handbuchung, Umbuchung); ein Statuswechsel erzeugt keine neue Zeile.
 */
export type AffiliateCommissionActionState = {
  error: string | null;
  success?: boolean;
  commissionId?: string;
};

export const initialAffiliateCommissionActionState: AffiliateCommissionActionState = {
  error: null,
};

// --- Partnerbereich und öffentliche Bewerbung (Block B7) ----------------

/**
 * Öffentliches Bewerbungsformular unter `/partnerprogramm`.
 *
 * Honeypot und Zeitfalle quittieren mit demselben `{ error: null, success: true }`
 * wie eine echte Bewerbung (Muster `contact/actions.ts`): eine sichtbare
 * Ablehnung wäre die Rückmeldung, mit der ein Bot-Betreiber sein Muster
 * anpasst. Der Zustand darf deshalb nie unterscheidbar machen, welche Schicht
 * gegriffen hat.
 */
export type AffiliateApplicationActionState = { error: string | null; success?: boolean };

export const initialAffiliateApplicationActionState: AffiliateApplicationActionState = {
  error: null,
};

/** Selbstpflege des Partners: Name, Firma, Benachrichtigungen. */
export type AffiliatePartnerSelfActionState = { error: string | null; success?: boolean };

export const initialAffiliatePartnerSelfActionState: AffiliatePartnerSelfActionState = {
  error: null,
};

/** Zustimmung zu einer neuen Fassung der Partnerbedingungen. */
export type AffiliateTermsActionState = { error: string | null; success?: boolean };

export const initialAffiliateTermsActionState: AffiliateTermsActionState = { error: null };

/** Abrechnungsprofil (Anschrift, Steuerstatus, Zahlungsverbindung). */
export type AffiliateBillingProfileActionState = { error: string | null; success?: boolean };

export const initialAffiliateBillingProfileActionState: AffiliateBillingProfileActionState = {
  error: null,
};

// --- Auszahlung (Block B8) ----------------------------------------------

/**
 * Auszahlungslauf, Freigabe, „überwiesen" und „fehlgeschlagen". `payoutId`
 * steht nach dem Entwurf für die Weiterleitung auf den einzelnen Satz.
 */
export type AffiliatePayoutActionState = {
  error: string | null;
  success?: boolean;
  payoutId?: string;
};

export const initialAffiliatePayoutActionState: AffiliatePayoutActionState = { error: null };

/**
 * DIE BESTÄTIGUNGSSUMME DER FREIGABE — Erzeuger und Prüfer an EINER Stelle
 * (Plan 7.2, 11.17; Abnahme, Befund N1).
 *
 * Die Bestätigungskarte in `lauf-form.tsx` baut je Währung einen Wert
 * `<waehrung>:<cent>`, und die Server Action in `page.tsx` prüft ihn gegen ein
 * Muster und rechnet ihn nach. Beides stand getrennt und in verschiedenen
 * Dateien — und lief auseinander: das Muster verbot ein Minuszeichen, während
 * eine STORNOGUTSCHRIFT eine negative Summe hat. Der Manager las daraufhin
 * „Bitte zuerst mindestens eine Auszahlung auswählen", obwohl er eine
 * ausgewählt hatte, und der Korrekturweg nach § 14c UStG war über die
 * Oberfläche nicht begehbar. Kein Test sah es, weil die Testsuite
 * `approveAffiliatePayout()` direkt aufruft und die Server Action mit ihrem
 * zod-Schema nie anfasst.
 *
 * Seither gibt es nur noch diese eine Definition. Wer das Format ändert,
 * ändert Erzeuger und Prüfer zwangsläufig gemeinsam.
 */

/**
 * Das Muster des Bestätigungswerts. Das Vorzeichen ist Pflichtbestandteil und
 * keine Nachlässigkeit — siehe oben.
 */
export const AFFILIATE_PAYOUT_EXPECTED_PATTERN = /^[a-z]{3}:-?\d{1,12}$/;

/** Erzeugt den Bestätigungswert, den die Karte anzeigt und mitschickt. */
export function formatAffiliatePayoutExpected(currency: string, cents: number): string {
  return `${currency}:${cents}`;
}

/**
 * Liest ihn zurück. `null` heißt „nicht lesbar" und führt in der Server Action
 * zum Abbruch — nie zu einem stillen Standardwert, denn der Wert entscheidet
 * darüber, ob die angezeigte Summe der tatsächlichen entspricht.
 */
export function parseAffiliatePayoutExpected(
  raw: string,
): { currency: string; cents: number } | null {
  if (!AFFILIATE_PAYOUT_EXPECTED_PATTERN.test(raw)) return null;
  const separator = raw.indexOf(":");
  const cents = Number(raw.slice(separator + 1));
  if (!Number.isSafeInteger(cents)) return null;
  return { currency: raw.slice(0, separator), cents };
}
