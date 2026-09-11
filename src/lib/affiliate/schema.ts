import { z } from "zod";
import { containsLink, containsMarkup } from "@/lib/contact/patterns";
import {
  AFFILIATE_APPLICATION_FIELD_TYPES,
  AFFILIATE_APPROVAL_MODES,
  AFFILIATE_ATTRIBUTION_MODELS,
  AFFILIATE_BASIS_KINDS,
  AFFILIATE_CANCEL_REASONS,
  AFFILIATE_ENTITY_KINDS,
  AFFILIATE_OVERWRITE_POLICIES,
  AFFILIATE_PARTNER_STATUSES,
  AFFILIATE_PAYOUT_METHODS,
  AFFILIATE_PAYOUT_SCHEDULES,
  AFFILIATE_PROGRAM_STATUSES,
  AFFILIATE_PROGRAM_VISIBILITIES,
  AFFILIATE_RATE_KINDS,
  AFFILIATE_RECURRING_MODES,
  AFFILIATE_SELF_REFERRAL_MODES,
  AFFILIATE_TIER2_BASES,
} from "@/lib/affiliate/types";

/**
 * Affiliate-System, Block B1 — alle Eingabeschemata des Moduls
 * (PLAN_Affiliate-System.md 3.2–3.5, 3.13, 4.2, 4.6, 5, 6).
 *
 * Trennung `schema.ts`/`actions.ts` wie `calendar/`, `customer-area/`,
 * `platform/`: eine `"use server"`-Datei darf in Next.js 16 ausschließlich
 * async Funktionen exportieren — zod-Schemata und Konstanten leben deshalb
 * hier und sind damit zugleich aus Vitest heraus prüfbar, ohne eine Server
 * Action zu laden.
 *
 * Die Aufzählungen kommen aus `types.ts`, damit zod und TypeScript dieselbe
 * Quelle haben. Fehlermeldungen deutsch, Bezeichner englisch (CLAUDE.md).
 * Die Server Actions rufen diese Schemata mit typisierten Objekten auf; die
 * Umwandlung aus `FormData` passiert an der Aufrufstelle.
 */

/** Größte Zahl, die eine Postgres-`int`-Spalte trägt — alle Cent-Felder des Moduls sind `int`. */
const INT4_MAX = 2147483647;

// --- Muster für alles, was in eine URL oder eine Query wandert -----------

/**
 * Partnercode, exakt der DB-CHECK aus 3.3
 * (`code ~ '^[a-z0-9][a-z0-9-]{2,31}$'`). Der Code kommt aus dem
 * Query-String des Klick-Endpunkts (`/api/aff/k?c=…`) und geht danach in
 * eine Abfrage. Vorbild `TENANT_SLUG_PATTERN` (`tenant/resolve.ts`): das
 * Muster ist enger als die Trennzeichen der PostgREST-Filtersyntax, ein
 * gültiger Wert kann dort also keine zusätzliche Bedingung einschleusen.
 * (CLAUDE.md §2.12 — Nutzereingaben werden nie in Query-Bausteine
 * konkateniert; das Muster ist die zweite Linie hinter dem Query-Builder.)
 */
export const AFFILIATE_PARTNER_CODE_PATTERN = /^[a-z0-9][a-z0-9-]{2,31}$/;

/** Kampagnenschlüssel (4.2 Schritt 1): frei wählbar, aber ohne Trenn- und Steuerzeichen. */
export const AFFILIATE_CAMPAIGN_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

/**
 * Zielschlüssel (4.2 Schritt 1). KEINE URL, sondern ein Schlüssel gegen ein
 * festes Muster, aus dem der Endpunkt einen relativen Pfad baut (G11) — eine
 * URL aus dem Query-String wäre eine offene Weiterleitung und würde außerdem
 * das host-only-Cookie auf einem anderen Origin wirkungslos machen.
 */
export const AFFILIATE_TARGET_PATTERN = /^(kurs|kaufen)\/[a-z0-9][a-z0-9-]{1,60}$/;

/** Referral-Token: 32 Zufallsbytes als Hex (4.2 Schritt 7b), kommt als `?aff=` zurück. */
export const AFFILIATE_REFERRAL_TOKEN_PATTERN = /^[a-f0-9]{64}$/;

/**
 * Hostname für die Referrer-Sperrliste (4.2 Schritt 5). Eigenes Muster statt
 * `TENANT_HOSTNAME_PATTERN`: dieses liegt in `tenant/resolve.ts`, und die
 * Datei trägt `import "server-only"` — ein Import von dort zöge dieses Schema
 * aus jedem Client-Bundle heraus.
 */
const HOSTNAME_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** IBAN nach Entfernen aller Leerzeichen; die Prüfziffer selbst prüft `sepa.ts` (Block B8). */
const IBAN_PATTERN = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/;

/** BIC/SWIFT, 8 oder 11 Zeichen. */
const BIC_PATTERN = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/;

/** USt-IdNr.: Länderkürzel plus 2–13 alphanumerische Zeichen (VIES-Format, 7.5). */
const VAT_ID_PATTERN = /^[A-Z]{2}[A-Z0-9]{2,13}$/;

/** ISO-3166-1 alpha-2, exakt der DB-CHECK aus 3.13. */
const COUNTRY_PATTERN = /^[A-Z]{2}$/;

/** Währung als ISO-4217-Kleinbuchstaben — so schreibt Stripe sie, so steht sie in `orders`. */
const CURRENCY_PATTERN = /^[a-z]{3}$/;

/** Schlüssel eines Bewerbungsfelds; zugleich Schlüssel der Antwort in `affiliate_partners.application`. */
const APPLICATION_FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

// --- Bausteine ----------------------------------------------------------

/**
 * Ganzzahlfeld mit deutschen Meldungen. `z.coerce`, weil die Werte aus
 * `FormData` als String ankommen (Muster `tenantBrandingSchema`,
 * `platform/schema.ts`); ein nicht zahlenartiger Wert wird zu `NaN` und
 * fällt in `invalid_type_error`.
 */
const intField = (label: string, min: number, max: number) =>
  z.coerce
    .number({ invalid_type_error: `${label}: bitte eine Zahl angeben.` })
    .int(`${label}: nur ganze Zahlen.`)
    .min(min, `${label}: mindestens ${min}.`)
    .max(max, `${label}: höchstens ${max}.`);

/** Satz in Basispunkten (1 bp = 0,01 %), 0–10000 wie jeder `_bp`-CHECK im Datenmodell. */
const bpField = (label: string) => intField(label, 0, 10000);

/** Cent-Betrag ≥ 0. */
const centsField = (label: string) => intField(label, 0, INT4_MAX);

/** Cent-Feld, das leer bleiben darf (`null` = keine Grenze gesetzt). */
const optionalCentsField = (label: string) =>
  z.preprocess(
    (v) => (v == null || (typeof v === "string" && v.trim() === "") ? null : v),
    z.union([z.null(), centsField(label)]),
  );

/** Pflichttext mit Länge. */
const requiredText = (label: string, max: number) =>
  z.string().trim().min(1, `${label} erforderlich.`).max(max, `${label}: höchstens ${max} Zeichen.`);

/** Freitext, leer erlaubt (leer -> `null`, damit die Spalte nicht mit "" belegt wird). */
const optionalText = (label: string, max: number) =>
  z.preprocess(
    (v) => (v == null || (typeof v === "string" && v.trim() === "") ? null : v),
    z.union([z.null(), z.string().trim().max(max, `${label}: höchstens ${max} Zeichen.`)]),
  );

/** Optionale UUID (leeres Auswahlfeld -> `null`). */
const optionalUuid = (message: string) =>
  z.preprocess(
    (v) => (v == null || (typeof v === "string" && v.trim() === "") ? null : v),
    z.union([z.null(), z.string().uuid(message)]),
  );

/**
 * Checkbox, die angehakt sein MUSS. `FormData` liefert für eine angehakte
 * Checkbox `"on"` und für eine nicht angehakte gar nichts — deshalb zuerst
 * normalisieren statt `z.coerce.boolean()` (das machte aus jedem nichtleeren
 * String `true`, auch aus `"false"`).
 */
const requiredCheckbox = (message: string) =>
  z.preprocess(
    (v) => v === true || v === "on" || v === "true" || v === "1",
    z.boolean().refine((v) => v === true, message),
  );

/** Schalter, der beides sein darf; gleiche Normalisierung wie oben. */
const switchField = z.preprocess(
  (v) => v === true || v === "on" || v === "true" || v === "1",
  z.boolean(),
);

/**
 * Zeitpunkt aus einem `<input type="datetime-local">` oder ISO-String,
 * normalisiert auf ISO-8601 in UTC. `z.string().datetime()` scheitert an
 * `"2026-09-10T14:00"` (ohne Sekunden und Zone), genau der Form, die ein
 * Browser liefert.
 */
const dateTimeField = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} erforderlich.`)
    .refine((v) => !Number.isNaN(Date.parse(v)), `${label}: ungültiges Datum.`)
    .transform((v) => new Date(v).toISOString());

/**
 * Euro-Eingabe -> Cent. `Math.round` ist hier KEINE Abweichung von G12
 * (`Math.floor` überall): gerundet wird nicht ein Geldbetrag, sondern die
 * Fließkomma-Ungenauigkeit des Parsens (`12,34 * 100 = 1233.9999…`). Gleiches
 * Vorgehen wie `eurosToCents()` in `marketplace/schema.ts`.
 */
function euroStringToCents(value: string): number {
  return Math.round(parseFloat(value.replace(",", ".")) * 100);
}

/** Für `defaultValue` in Formularen (Cent -> Euro-String), Gegenstück zu oben. */
export function centsToEuroInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

// --- Partnercode, Kampagne, Ziel, Token, Klick-Query --------------------

export const affiliatePartnerCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    AFFILIATE_PARTNER_CODE_PATTERN,
    "Partnercode: 3–32 Zeichen, nur Kleinbuchstaben, Ziffern und Bindestriche, beginnt mit Buchstabe oder Ziffer.",
  );

export const affiliateCampaignSchema = z
  .string()
  .trim()
  .regex(
    AFFILIATE_CAMPAIGN_PATTERN,
    "Kampagne: höchstens 64 Zeichen, nur Buchstaben, Ziffern, Punkt, Bindestrich und Unterstrich.",
  );

export const affiliateTargetSchema = z
  .string()
  .trim()
  .regex(AFFILIATE_TARGET_PATTERN, "Ziel muss kurs/<slug> oder kaufen/<slug> sein.");

export const affiliateReferralTokenSchema = z
  .string()
  .trim()
  .regex(AFFILIATE_REFERRAL_TOKEN_PATTERN, "Ungültiges Empfehlungs-Token.");

/**
 * Query des Klick-Endpunkts `GET /api/aff/k?c=…&z=…&cam=…` (4.2 Schritt 1).
 * `z` und `cam` dürfen fehlen oder leer sein; ein UNGÜLTIGER Wert ist dagegen
 * ein Fehler und führt dort zum Redirect auf „/" ohne Zuordnung — nie zu
 * einer Fehlerseite, damit der Besucher nie im Leeren landet.
 */
export const affiliateClickQuerySchema = z.object({
  c: affiliatePartnerCodeSchema,
  z: z.preprocess(
    (v) => (v == null || (typeof v === "string" && v.trim() === "") ? undefined : v),
    affiliateTargetSchema.optional(),
  ),
  cam: z.preprocess(
    (v) => (v == null || (typeof v === "string" && v.trim() === "") ? undefined : v),
    affiliateCampaignSchema.optional(),
  ),
});
export type AffiliateClickQuery = z.infer<typeof affiliateClickQuerySchema>;

// --- Programm-Einstellungen (3.2) ---------------------------------------

/**
 * Ein Feld des Bewerbungsformulars. Höchstens zwölf Felder — ein längeres
 * Formular senkt die Bewerbungsquote messbar und ist über `application_note`
 * ohnehin abbildbar.
 */
export const affiliateApplicationFieldSchema = z.object({
  key: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      APPLICATION_FIELD_KEY_PATTERN,
      "Feldschlüssel: Kleinbuchstaben, Ziffern und Unterstrich, beginnt mit einem Buchstaben.",
    ),
  label: requiredText("Feldbeschriftung", 80),
  type: z.enum(AFFILIATE_APPLICATION_FIELD_TYPES, { message: "Unbekannte Feldart." }),
  required: switchField,
});

export const affiliateApplicationFieldsSchema = z
  .array(affiliateApplicationFieldSchema)
  .max(12, "Höchstens 12 Felder im Bewerbungsformular.")
  .superRefine((fields, ctx) => {
    const seen = new Set<string>();
    fields.forEach((field, index) => {
      if (seen.has(field.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "key"],
          message: "Feldschlüssel doppelt vergeben.",
        });
      }
      seen.add(field.key);
    });
  });

/**
 * Sperrliste als Hostnamen. Nimmt zusätzlich einen mehrzeiligen Text an
 * (ein Hostname je Zeile oder komma-getrennt) — so kann die Oberfläche ein
 * einfaches `<textarea>` benutzen, ohne dass jede Aufrufstelle ihre eigene
 * Zerlegung schreibt.
 */
export const affiliateReferrerBlocklistSchema = z.preprocess(
  (v) => {
    if (typeof v === "string") {
      return v
        .split(/[\n,]/)
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => entry !== "");
    }
    if (Array.isArray(v)) {
      return v
        .map((entry) => (typeof entry === "string" ? entry.trim().toLowerCase() : entry))
        .filter((entry) => entry !== "");
    }
    return v ?? [];
  },
  z
    .array(z.string().regex(HOSTNAME_PATTERN, "Sperrliste: nur Hostnamen, z. B. gutschein.beispiel.de."))
    .max(200, "Höchstens 200 Einträge in der Sperrliste."),
);

/**
 * Alle Einstellungen, die ein Manager am Programm ändern darf.
 *
 * NICHT enthalten und das mit Absicht:
 *  - `books_closed_until` — schreibt nur `service_role` beim Erzeugen einer
 *    Gutschrift (G14); über ein Formular änderbar hieße, einen
 *    abgeschlossenen Zeitraum wieder öffnen zu können.
 *  - `terms_version` — steigt serverseitig, wenn sich `terms_text` ändert,
 *    und löst damit die Neuzustimmung der Partner aus. Ein Feld im Formular
 *    ließe eine Änderung der Bedingungen ohne neue Zustimmung zu.
 */
export const affiliateProgramSettingsSchema = z
  .object({
    status: z.enum(AFFILIATE_PROGRAM_STATUSES, { message: "Unbekannter Programmstatus." }),
    visibility: z.enum(AFFILIATE_PROGRAM_VISIBILITIES, { message: "Unbekannte Sichtbarkeit." }),
    approvalMode: z.enum(AFFILIATE_APPROVAL_MODES, { message: "Unbekannter Freigabemodus." }),

    rateKind: z.enum(AFFILIATE_RATE_KINDS, { message: "Unbekannte Satzart." }),
    rateBp: bpField("Provisionssatz"),
    fixedCents: centsField("Fester Betrag"),
    minCommissionCents: optionalCentsField("Mindestprovision"),
    maxCommissionCents: optionalCentsField("Höchstprovision"),

    basisKind: z.enum(AFFILIATE_BASIS_KINDS, { message: "Unbekannte Bemessungsgrundlage." }),
    feeDeductionBp: bpField("Gebührenabzug"),
    currency: z
      .string()
      .trim()
      .toLowerCase()
      .regex(CURRENCY_PATTERN, "Währung als dreistelliges Kürzel angeben, z. B. eur."),

    attributionModel: z.enum(AFFILIATE_ATTRIBUTION_MODELS, { message: "Unbekanntes Attributionsmodell." }),
    cookieTtlDays: intField("Gültigkeit der Zuordnung", 1, 365),
    overwritePolicy: z.enum(AFFILIATE_OVERWRITE_POLICIES, { message: "Unbekannte Überschreibungsregel." }),
    lifetimeBinding: switchField,
    selfReferral: z.enum(AFFILIATE_SELF_REFERRAL_MODES, { message: "Unbekannte Regel für Selbst-Empfehlung." }),
    referrerBlocklist: affiliateReferrerBlocklistSchema,

    recurringMode: z.enum(AFFILIATE_RECURRING_MODES, { message: "Unbekannter Abo-Modus." }),
    recurringMaxPeriods: intField("Anzahl Abo-Raten", 1, 120),

    tier2Enabled: switchField,
    tier2Basis: z.enum(AFFILIATE_TIER2_BASES, { message: "Unbekannte Bezugsgröße der zweiten Stufe." }),
    tier2RateBp: bpField("Satz der zweiten Stufe"),

    holdDays: intField("Sperrfrist", 0, 365),
    reserveBp: bpField("Sicherheitseinbehalt"),
    reserveDays: intField("Frist des Sicherheitseinbehalts", 0, 365),
    minPayoutCents: centsField("Mindestauszahlung"),
    payoutSchedule: z.enum(AFFILIATE_PAYOUT_SCHEDULES, { message: "Unbekannter Auszahlungsrhythmus." }),

    descriptionMd: z.string().trim().max(20000, "Beschreibung: höchstens 20000 Zeichen.").default(""),
    termsText: z.string().trim().max(50000, "Bedingungen: höchstens 50000 Zeichen.").default(""),
    applicationNote: z.string().trim().max(2000, "Hinweis: höchstens 2000 Zeichen.").default(""),
    applicationFields: affiliateApplicationFieldsSchema.default([]),

    testMode: switchField,
  })
  .superRefine((data, ctx) => {
    // Spiegelt die CHECK-Constraints aus 3.2, damit der Manager eine
    // verständliche Meldung sieht statt eines rohen Constraint-Fehlers.
    if (data.reserveDays < data.holdDays) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reserveDays"],
        message: "Die Frist des Sicherheitseinbehalts darf nicht vor der Sperrfrist enden.",
      });
    }
    if (
      data.minCommissionCents !== null &&
      data.maxCommissionCents !== null &&
      data.maxCommissionCents < data.minCommissionCents
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxCommissionCents"],
        message: "Die Höchstprovision darf nicht unter der Mindestprovision liegen.",
      });
    }
    // Kein DB-CHECK, aber eine Einstellung, die sonst still zu einer
    // Nullprovision führt: „fester Betrag" mit 0 Cent bucht bei jedem
    // Verkauf 0 und sieht in der Oberfläche wie ein gültiges Programm aus.
    if (data.rateKind === "fixed" && data.fixedCents <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fixedCents"],
        message: "Bei fester Provision muss ein Betrag über 0 stehen.",
      });
    }
  });
export type AffiliateProgramSettingsInput = z.infer<typeof affiliateProgramSettingsSchema>;

// --- Partner: Anlage, Bewerbung, Pflege ---------------------------------

/**
 * Namensfelder tragen dieselbe Härtung wie das Kontaktformular
 * (`contact/schema.ts`): kein Link, kein Markup. Der Partnername steht später
 * in Admin-Listen und in Benachrichtigungsmails — genau der Ort, an dem ein
 * Bot seine Ziel-URL als klickbaren Link unterbringen will.
 */
const partnerNameSchema = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} erforderlich.`)
    .max(max, `${label}: höchstens ${max} Zeichen.`)
    .refine((value) => !containsLink(value), `${label} darf keine Links enthalten.`)
    .refine((value) => !containsMarkup(value), `${label} enthält unzulässige Zeichen.`);

/** Gleiche Prüfung, aber leer erlaubt (`null`). */
const optionalPartnerNameSchema = (label: string, max: number) =>
  z.preprocess(
    (v) => (v == null || (typeof v === "string" && v.trim() === "") ? null : v),
    z.union([z.null(), partnerNameSchema(label, max)]),
  );

/**
 * E-Mail des Bewerbers/Partners. `lower(trim(...))` wie in 3.3; das Entfernen
 * eines `+`-Suffixes gehört NICHT hierher, sondern in die Normalisierung der
 * Server Action — es ist eine Regel gegen Mehrfachbewerbungen, keine
 * Formatprüfung, und ein Schema, das die Adresse verändert, würde dem
 * Bewerber eine andere Adresse bestätigen, als er eingegeben hat.
 */
export const affiliateEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Ungültige E-Mail-Adresse.")
  .max(200, "E-Mail-Adresse ist zu lang.");

/** Partneranlage durch einen Manager (owner/admin). */
export const affiliatePartnerCreateSchema = z.object({
  applicantEmail: affiliateEmailSchema,
  displayName: partnerNameSchema("Name", 120),
  company: optionalPartnerNameSchema("Firma", 200),
  code: affiliatePartnerCodeSchema,
  groupId: optionalUuid("Ungültige Gruppe."),
  referredBy: optionalUuid("Ungültiger Werber."),
  internalNote: optionalText("Interne Notiz", 2000),
});
export type AffiliatePartnerCreateInput = z.infer<typeof affiliatePartnerCreateSchema>;

/**
 * Öffentliche Bewerbung unter `/partnerprogramm` (8.3). Honeypot, Zeitfalle,
 * Rate-Limits und Turnstile liegen bewusst NICHT in diesem Schema, sondern
 * davor in `apply.ts` — sie sind billiger als eine zod-Auswertung und sollen
 * greifen, bevor überhaupt geparst wird (Muster `contact/actions.ts`).
 *
 * `code` ist ein WUNSCH: der Plan legt nicht fest, wer den Partnercode
 * vergibt. Einfachste Lösung (CLAUDE.md §4.5): der Bewerber darf einen
 * vorschlagen, der Server nimmt ihn nur, wenn er im Mandanten frei ist, und
 * leitet sonst einen aus dem Namen ab. Damit ist das Feld nie ein Grund, eine
 * Bewerbung abzulehnen.
 */
export const affiliatePartnerApplicationSchema = z.object({
  displayName: partnerNameSchema("Name", 120),
  email: affiliateEmailSchema,
  company: optionalPartnerNameSchema("Firma", 200),
  code: z.preprocess(
    (v) => (v == null || (typeof v === "string" && v.trim() === "") ? null : v),
    z.union([z.null(), affiliatePartnerCodeSchema]),
  ),
  /** Antworten auf `program.application_fields`, Schlüssel = Feldschlüssel. */
  answers: z
    .record(z.string().trim().max(2000, "Antwort: höchstens 2000 Zeichen."))
    .default({})
    .superRefine((answers, ctx) => {
      const keys = Object.keys(answers);
      if (keys.length > 12) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Zu viele Antwortfelder." });
      }
      for (const key of keys) {
        if (!APPLICATION_FIELD_KEY_PATTERN.test(key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: "Unbekanntes Antwortfeld.",
          });
        }
      }
    }),
  acceptTerms: requiredCheckbox("Bitte die Partnerbedingungen bestätigen."),
  /** Fassung, die dem Bewerber angezeigt wurde — der Nachweis nach Art. 7 Abs. 1 DSGVO hängt daran. */
  termsVersion: intField("Fassung der Bedingungen", 1, INT4_MAX),
});
export type AffiliatePartnerApplicationInput = z.infer<typeof affiliatePartnerApplicationSchema>;

/**
 * Selbstpflege des Partners. Genau die Felder, die der Guard-Trigger aus 3.3
 * dem Partner offen lässt — alles andere (Code, Status, Gruppe, Werber,
 * Auszahlungssperre) setzt der Trigger auf `old` zurück, ein zusätzliches Feld
 * hier erzeugte also nur eine stille Wirkungslosigkeit.
 */
export const affiliatePartnerSelfSchema = z.object({
  displayName: partnerNameSchema("Name", 120),
  company: optionalPartnerNameSchema("Firma", 200),
  notifySale: switchField,
  notifyReversal: switchField,
  notifyPayout: switchField,
});
export type AffiliatePartnerSelfInput = z.infer<typeof affiliatePartnerSelfSchema>;

/** Neuzustimmung zu einer geänderten Fassung der Bedingungen (B7-Dialog). */
export const affiliateTermsAcceptanceSchema = z.object({
  termsVersion: intField("Fassung der Bedingungen", 1, INT4_MAX),
  acceptTerms: requiredCheckbox("Bitte die Partnerbedingungen bestätigen."),
});
export type AffiliateTermsAcceptanceInput = z.infer<typeof affiliateTermsAcceptanceSchema>;

/**
 * Statuswechsel eines Partners durch den Manager. Begründung ist bei
 * Ablehnung und Sperre Pflicht: sie steht in `status_reason` und geht in die
 * Benachrichtigung an den Partner — eine Ablehnung ohne Grund erzeugt
 * garantiert eine Rückfrage.
 */
export const affiliatePartnerStatusSchema = z
  .object({
    partnerId: z.string().uuid("Ungültiger Partner."),
    status: z.enum(AFFILIATE_PARTNER_STATUSES, { message: "Unbekannter Partnerstatus." }),
    reason: optionalText("Begründung", 1000),
  })
  .superRefine((data, ctx) => {
    if ((data.status === "rejected" || data.status === "suspended") && !data.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message: "Bitte eine Begründung angeben.",
      });
    }
  });
export type AffiliatePartnerStatusInput = z.infer<typeof affiliatePartnerStatusSchema>;

/**
 * Die Felder eines Partners, die nur ein Manager setzt. `payoutHoldReason` ist
 * Pflicht, sobald die Auszahlung gesperrt wird — ein Partner, dessen Geld
 * ohne sichtbaren Grund liegen bleibt, ist ein Supportfall.
 */
export const affiliatePartnerAdminSchema = z
  .object({
    partnerId: z.string().uuid("Ungültiger Partner."),
    groupId: optionalUuid("Ungültige Gruppe."),
    referredBy: optionalUuid("Ungültiger Werber."),
    payoutHold: switchField,
    payoutHoldReason: optionalText("Grund der Auszahlungssperre", 1000),
    internalNote: optionalText("Interne Notiz", 2000),
  })
  .superRefine((data, ctx) => {
    if (data.payoutHold && !data.payoutHoldReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payoutHoldReason"],
        message: "Bitte einen Grund für die Auszahlungssperre angeben.",
      });
    }
    if (data.referredBy !== null && data.referredBy === data.partnerId) {
      // Spiegelt `check (referred_by is null or referred_by <> id)` aus 3.3.
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["referredBy"],
        message: "Ein Partner kann nicht sein eigener Werber sein.",
      });
    }
  });
export type AffiliatePartnerAdminInput = z.infer<typeof affiliatePartnerAdminSchema>;

// --- Gruppe (3.4) -------------------------------------------------------

export const affiliateGroupSchema = z.object({
  name: requiredText("Gruppenname", 100),
});
export type AffiliateGroupInput = z.infer<typeof affiliateGroupSchema>;

// --- Kondition (3.5) ----------------------------------------------------

/**
 * Eine Zeile der Vorrangkette. Die drei Geltungsbereiche spiegeln die
 * CHECK-Constraints aus 3.5: Partner UND Gruppe zugleich ist unzulässig
 * (die Spezifität wäre nicht mehr eindeutig), und mindestens einer der drei
 * Bereiche muss gesetzt sein — der Fall „gilt für alles" ist der
 * Programmstandard und braucht keine Konditionszeile.
 *
 * Die Überschneidungsfreiheit prüft der GiST-Ausschluss in der Datenbank; sie
 * hier nachzubauen hieße, alle bestehenden Zeilen zu laden und trotzdem eine
 * Wettlaufsituation zu haben.
 */
export const affiliateConditionSchema = z
  .object({
    partnerId: optionalUuid("Ungültiger Partner."),
    groupId: optionalUuid("Ungültige Gruppe."),
    productId: optionalUuid("Ungültiges Produkt."),
    rateKind: z.enum(AFFILIATE_RATE_KINDS, { message: "Unbekannte Satzart." }),
    rateBp: bpField("Provisionssatz"),
    fixedCents: centsField("Fester Betrag"),
    validFrom: dateTimeField("Gültig ab"),
    validTo: z.preprocess(
      (v) => (v == null || (typeof v === "string" && v.trim() === "") ? null : v),
      z.union([z.null(), dateTimeField("Gültig bis")]),
    ),
    note: optionalText("Notiz", 500),
  })
  .superRefine((data, ctx) => {
    if (data.partnerId !== null && data.groupId !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["groupId"],
        message: "Entweder ein Partner oder eine Gruppe, nicht beides.",
      });
    }
    if (data.partnerId === null && data.groupId === null && data.productId === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["partnerId"],
        message: "Bitte Partner, Gruppe oder Produkt wählen — ohne Auswahl gilt der Programmstandard.",
      });
    }
    if (data.validTo !== null && Date.parse(data.validTo) <= Date.parse(data.validFrom)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["validTo"],
        message: "Das Ende der Gültigkeit muss nach ihrem Beginn liegen.",
      });
    }
    if (data.rateKind === "fixed" && data.fixedCents <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fixedCents"],
        message: "Bei fester Provision muss ein Betrag über 0 stehen.",
      });
    }
  });
export type AffiliateConditionInput = z.infer<typeof affiliateConditionSchema>;

// --- Handbuchung und Umbuchung ------------------------------------------

/**
 * Vorzeichenbehafteter Euro-Betrag. Eine Handbuchung darf negativ sein: sie
 * ist der Weg, eine Korrektur oder eine vereinbarte Kürzung zu buchen, ohne
 * eine bestehende Zeile anzufassen (G4 — Zeilen sind unveränderlich).
 */
const signedEuroSchema = z
  .string()
  .trim()
  .regex(/^-?\d{1,9}([.,]\d{1,2})?$/, "Betrag als Euro-Wert angeben, z. B. 25,00 oder -25,00.");

export const affiliateManualBookingSchema = z
  .object({
    partnerId: z.string().uuid("Ungültiger Partner."),
    amountEuro: signedEuroSchema,
    currency: z
      .string()
      .trim()
      .toLowerCase()
      .regex(CURRENCY_PATTERN, "Währung als dreistelliges Kürzel angeben, z. B. eur."),
    /** Pflicht laut `check (kind <> 'manual' or note is not null)` (3.11). */
    note: z
      .string()
      .trim()
      .min(5, "Begründung: mindestens 5 Zeichen.")
      .max(1000, "Begründung: höchstens 1000 Zeichen."),
  })
  .transform(({ amountEuro, ...rest }) => ({
    ...rest,
    amountCents: euroStringToCents(amountEuro),
  }))
  .superRefine((data, ctx) => {
    if (data.amountCents === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["amountEuro"],
        message: "Der Betrag darf nicht 0 sein.",
      });
    }
    if (Math.abs(data.amountCents) > INT4_MAX) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["amountEuro"],
        message: "Der Betrag ist zu groß.",
      });
    }
  });
export type AffiliateManualBookingInput = z.infer<typeof affiliateManualBookingSchema>;

/**
 * Umbuchung einer Bestellung auf einen anderen Partner (4.6).
 * `newPartnerId = null` bedeutet „ohne Zuordnung" — die bestehenden Zeilen
 * werden storniert, es entsteht keine neue. Die Begründung ist Pflicht: sie
 * landet in `note` der neuen Zeile und im Auditprotokoll, und sie ist das
 * Einzige, was einen Attributionsstreit später noch erklärt.
 */
export const affiliateReassignSchema = z.object({
  orderId: z.string().uuid("Ungültige Bestellung."),
  newPartnerId: optionalUuid("Ungültiger Partner."),
  reason: z
    .string()
    .trim()
    .min(5, "Begründung: mindestens 5 Zeichen.")
    .max(1000, "Begründung: höchstens 1000 Zeichen."),
});
export type AffiliateReassignInput = z.infer<typeof affiliateReassignSchema>;

/** Verdachtsmarkierung setzen oder lösen (6.3). Beim Setzen ist der Grund Pflicht. */
export const affiliateCommissionFlagSchema = z
  .object({
    commissionId: z.string().uuid("Ungültige Buchung."),
    flagged: switchField,
    reason: optionalText("Grund", 1000),
  })
  .superRefine((data, ctx) => {
    if (data.flagged && !data.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message: "Bitte einen Grund für die Markierung angeben.",
      });
    }
  });
export type AffiliateCommissionFlagInput = z.infer<typeof affiliateCommissionFlagSchema>;

/**
 * Die Stornogründe, die eine menschliche Entscheidung überhaupt hergibt.
 * `self_referral`, `test_order`, `zero_amount` und `reassigned` setzt
 * ausschließlich der Verarbeiter. `satisfies` bindet die Auswahl an die
 * Gesamtliste aus `types.ts`: verschwindet dort ein Wert, bricht der Build
 * hier, statt dass ein CHECK-Fehler erst zur Laufzeit auftaucht.
 */
export const AFFILIATE_MANUAL_CANCEL_REASONS = [
  "fraud_suspicion",
  "manual",
] as const satisfies readonly (typeof AFFILIATE_CANCEL_REASONS)[number][];

/**
 * Entscheidung über eine Zeile in Prüfung (`on_hold` → `approved` oder
 * `cancelled`, 6.3). Begründung ist Pflicht.
 */
export const affiliateCommissionDecisionSchema = z.object({
  commissionId: z.string().uuid("Ungültige Buchung."),
  decision: z.enum(["approved", "cancelled"], { message: "Unbekannte Entscheidung." }),
  cancelReason: z
    .enum(AFFILIATE_MANUAL_CANCEL_REASONS, { message: "Unbekannter Stornogrund." })
    .default("manual"),
  reason: z
    .string()
    .trim()
    .min(5, "Begründung: mindestens 5 Zeichen.")
    .max(1000, "Begründung: höchstens 1000 Zeichen."),
});
export type AffiliateCommissionDecisionInput = z.infer<typeof affiliateCommissionDecisionSchema>;

// --- Abrechnungsprofil (3.13) -------------------------------------------

/** IBAN/BIC/USt-IdNr. kommen mit Leerzeichen aus jeder Zwischenablage — vor der Prüfung normalisieren. */
const compactUpper = (value: unknown) =>
  typeof value === "string" ? value.replace(/[\s-]/g, "").toUpperCase() : value;

/**
 * Anschrift, Steuerstatus und Zahlungsverbindung. Schreibt ausschließlich der
 * Partner selbst (RLS in 3.13) — ein Händler, der die Bankdaten seiner
 * Partner ändern kann, ist der klassische Weg, Auszahlungen umzuleiten.
 *
 * Die drei `vat_check_*`-Felder fehlen hier bewusst: sie setzt nur
 * `service_role` nach der VIES-Prüfung (7.5). Stünden sie im Schema, könnte
 * ein Partner sich selbst `valid` setzen und damit Reverse Charge und die
 * Auszahlungsfreigabe erzeugen.
 */
export const affiliateBillingProfileSchema = z
  .object({
    entityKind: z.enum(AFFILIATE_ENTITY_KINDS, { message: "Bitte Unternehmen oder Privatperson wählen." }),
    legalName: requiredText("Rechtlicher Name", 200),
    street: requiredText("Straße und Hausnummer", 200),
    postalCode: requiredText("Postleitzahl", 20),
    city: requiredText("Ort", 100),
    country: z
      .string()
      .trim()
      .toUpperCase()
      .regex(COUNTRY_PATTERN, "Land als zweistelliges Länderkürzel angeben, z. B. DE."),
    smallBusiness: switchField,
    vatId: z.preprocess(
      (v) => {
        const compact = compactUpper(v);
        return compact === "" || compact == null ? null : compact;
      },
      z.union([z.null(), z.string().regex(VAT_ID_PATTERN, "USt-IdNr. ungültig, z. B. DE123456789.")]),
    ),
    taxNumber: optionalText("Steuernummer", 40),
    payoutMethod: z.enum(AFFILIATE_PAYOUT_METHODS, { message: "Bitte eine Auszahlungsart wählen." }),
    accountHolder: optionalText("Kontoinhaber", 200),
    iban: z.preprocess(
      (v) => {
        const compact = compactUpper(v);
        return compact === "" || compact == null ? null : compact;
      },
      z.union([z.null(), z.string().regex(IBAN_PATTERN, "IBAN ungültig.")]),
    ),
    bic: z.preprocess(
      (v) => {
        const compact = compactUpper(v);
        return compact === "" || compact == null ? null : compact;
      },
      z.union([z.null(), z.string().regex(BIC_PATTERN, "BIC ungültig.")]),
    ),
    paypalEmail: z.preprocess(
      (v) => (v == null || (typeof v === "string" && v.trim() === "") ? null : v),
      z.union([z.null(), affiliateEmailSchema]),
    ),
  })
  .superRefine((data, ctx) => {
    if (data.payoutMethod === "sepa") {
      if (!data.iban) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["iban"],
          message: "Für SEPA-Überweisung wird eine IBAN gebraucht.",
        });
      }
      if (!data.accountHolder) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["accountHolder"],
          message: "Für SEPA-Überweisung wird der Kontoinhaber gebraucht.",
        });
      }
    }
    if (data.payoutMethod === "paypal" && !data.paypalEmail) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["paypalEmail"],
        message: "Für PayPal wird die PayPal-Adresse gebraucht.",
      });
    }
    // Kleinunternehmerregelung ist § 19 UStG und damit deutsches Recht; für
    // ein Unternehmen aus einem anderen Land ergibt der Schalter keinen Sinn
    // und würde in 7.4 zum falschen Steuermodus führen.
    if (data.smallBusiness && data.country !== "DE") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["smallBusiness"],
        message: "Die Kleinunternehmerregelung gilt nur für Unternehmen in Deutschland.",
      });
    }
  });
export type AffiliateBillingProfileInput = z.infer<typeof affiliateBillingProfileSchema>;
