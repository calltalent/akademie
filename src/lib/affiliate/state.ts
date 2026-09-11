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
