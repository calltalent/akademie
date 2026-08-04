import { z } from "zod";

/**
 * Zod-Schemas + Konstanten fuer Mandanten-Anlage/-Bearbeitung im
 * Betreiber-Portal (Phase 4, Block 2).
 *
 * ABWEICHUNG vom architect-Plan (dokumentiert, technisch notwendig): der
 * Plan sah nur `src/lib/platform/actions.ts` als neue Datei vor. Next.js 16
 * erlaubt in "use server"-Dateien aber ausschliesslich async-Funktions-
 * Exporte (bereits zweimal in diesem Projekt aufgetreten: Phase 1 Block 3
 * `courses/state.ts`, Phase 2 `stripe/state.ts`) — Konstanten wie
 * `TENANT_PLANS`/`TENANT_PLAN_LABELS` und die Zod-Schemas selbst duerfen
 * deshalb nicht aus `actions.ts` exportiert werden. Diese Datei uebernimmt
 * exakt dieselbe Rolle wie `src/lib/stripe/schema.ts` gegenueber
 * `src/lib/stripe/products.ts` — kein neues Muster, nur dieselbe bereits
 * etablierte Aufteilung.
 *
 * Slug-Regex exakt aus `supabase/migrations/0001_init.sql` Zeile 16
 * (`tenants.slug` check-constraint) uebernommen.
 */

export const TENANT_PLANS = ["trial", "komplett", "enterprise"] as const;
export type TenantPlan = (typeof TENANT_PLANS)[number];

export const TENANT_PLAN_LABELS: Record<TenantPlan, string> = {
  trial: "Trial",
  komplett: "Komplett",
  enterprise: "Enterprise",
};

export const TENANT_STATUSES = ["active", "trial", "suspended"] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const TENANT_STATUS_LABELS: Record<TenantStatus, string> = {
  active: "Aktiv",
  trial: "Trial",
  suspended: "Gesperrt",
};

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,40}$/;

// Einfaches, ausreichendes Domain-Format: mindestens ein Punkt, keine
// Leerzeichen/Sonderzeichen, kein fuehrender/abschliessender Bindestrich je
// Label (z. B. "akademie.beispiel.de"). Kein Anspruch auf vollstaendige
// RFC-1035-Konformitaet — reicht fuer ein Freitext-Datenfeld, echte
// DNS-Validierung passiert ohnehin erst bei der spaeteren Cloudflare-for-
// SaaS-Automatisierung (siehe PHASENSTATUS.md, "Offene Punkte" Phase 4).
const DOMAIN_PATTERN = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

export const tenantNameSchema = z
  .string()
  .trim()
  .min(1, "Name darf nicht leer sein.")
  .max(200, "Name darf höchstens 200 Zeichen haben.");

export const tenantSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    SLUG_PATTERN,
    "Subdomain: 2–41 Zeichen, nur Kleinbuchstaben, Ziffern und Bindestriche, beginnt mit Buchstabe/Ziffer.",
  );

export const tenantPlanSchema = z.enum(TENANT_PLANS);
export const tenantStatusSchema = z.enum(TENANT_STATUSES);

/** Leerer String -> null (kein Domain-Feld ausgefuellt), sonst Format-Pruefung. */
export const tenantCustomDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v) => (v === "" ? null : v))
  .refine(
    (v) => v === null || DOMAIN_PATTERN.test(v),
    "Ungültiges Domain-Format (z. B. akademie.beispiel.de).",
  );

/**
 * NEU (Phase 5, Block 8, 12.07.2026 — Josips Fund: nach dem Anlegen eines
 * Mandanten gab es keine Möglichkeit, einen Inhaber/Owner zu bekommen —
 * bisher nur per manuellem SQL machbar, siehe PHASENSTATUS.md). Optionales
 * Feld: leer lassen = Mandant ohne Inhaber anlegen (z. B. für interne
 * Test-Mandanten), ausfüllen = Owner-Konto + Einladungsmail wird direkt
 * mit angelegt (siehe createTenant() in actions.ts).
 */
const optionalEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v) => (v === "" ? null : v))
  .refine((v) => v === null || z.string().email().safeParse(v).success, "Ungültige E-Mail-Adresse.");

export const createTenantSchema = z.object({
  name: tenantNameSchema,
  slug: tenantSlugSchema,
  plan: tenantPlanSchema,
  ownerEmail: optionalEmailSchema,
});

export const updateTenantSchema = z.object({
  name: tenantNameSchema,
  plan: tenantPlanSchema,
  status: tenantStatusSchema,
  customDomain: tenantCustomDomainSchema,
});

/**
 * NEU (Design-Block 6, 13.07.2026, Mandanten.dc.html "Branding & Theming").
 * `tenants.branding.color_primary`/`radius` waren bisher nur lesend genutzt
 * (Kurs-Editor-Vorschau, Zertifikate) — kein Schreibweg existierte. Radius
 * auf den im Export nutzbaren Schieberegler-Bereich (4–24px, wie dort
 * `<input type="range" min="4" max="24">`).
 *
 * Farbe (19.07.2026, Josips Auftrag: "hex Farbcode eintragen ODER direkt aus
 * einer Farbpalette auswählen") — ursprünglich auf die 4 Export-Swatches
 * beschränkt (`z.enum`), jetzt jeder gültige 6-stellige Hex-Code erlaubt.
 * `TENANT_ACCENT_SWATCHES` bleibt als Schnellauswahl-Palette in der UI
 * bestehen, ist aber keine harte Schema-Grenze mehr.
 */
export const TENANT_ACCENT_SWATCHES = ["#5663AE", "#2A6FDB", "#1F8A5B", "#B4682A"] as const;

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export const tenantAccentColorSchema = z
  .string()
  .trim()
  .transform((v) => (v.startsWith("#") ? v : `#${v}`))
  .refine((v) => HEX_COLOR_PATTERN.test(v), "Ungültiger Hex-Farbcode, z. B. #5663AE.")
  .transform((v) => v.toUpperCase());

export const tenantBrandingSchema = z.object({
  colorPrimary: tenantAccentColorSchema,
  radius: z.coerce.number().int().min(4).max(24),
});

/** Für updateTenantLogoUrl() — dieselbe URL-Prüfung wie bei Kurs-/Modul-/Produktbildern. */
export const tenantLogoUrlSchema = z.string().url("Ungültige Bild-URL.");

/**
 * NEU (22.07.2026, Josips Auftrag: "Login-Bildschirm anpassbar machen" —
 * Hintergrund-Transparenz des Marken-Panels, Überschrift/Beschreibung,
 * Copyright-Zeile). Leeres Feld -> `undefined` -> Seite fällt auf den
 * Calltalent-Standardtext zurück (login/login-form.tsx), genau wie ein
 * Mandant ohne gesetztes `branding.*` auf DEFAULT_BRANDING zurückfällt.
 */
const optionalTrimmedText = (max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().max(max, `Höchstens ${max} Zeichen.`).optional(),
  );

export const tenantLoginContentSchema = z.object({
  loginBgOpacity: z.coerce.number().int().min(0).max(100),
  loginHeading: optionalTrimmedText(200),
  loginSubheading: optionalTrimmedText(500),
  loginCopyright: optionalTrimmedText(200),
});

/**
 * NEU (Marketplace M3, 03.08.2026, Plan Abschnitt 6/7): Provisionssatz je
 * Mandant, Eingabe als Prozentzahl (für Josip als Endnutzer verständlicher
 * als Basispunkte, gleiche Erwägung wie die Euro→Cent-Formulare in
 * `stripe/schema.ts`/`marketplace/schema.ts`). Leeres Feld -> `undefined` ->
 * `updateTenantFeatures()` entfernt `marketplace_commission_bp` aus
 * `tenants.settings` wieder, der Mandant fällt dann auf den globalen
 * Standardsatz aus `platform_settings.commission_rate_bp` zurück.
 *
 * Umrechnung Prozent -> Basispunkte direkt im Schema (`.transform`), analog
 * zu `listingFormSchema`s `priceEuro -> priceCents`. Zwei Nachkommastellen
 * erlaubt (1 bp = 0,01 %), Komma ODER Punkt als Dezimaltrenner (gleiche
 * Toleranz wie `priceEuroSchema` in marketplace/schema.ts).
 */
const COMMISSION_PERCENT_PATTERN = /^\d{1,3}([.,]\d{1,2})?$/;

// `v == null` zusätzlich zum leeren String (anders als bei
// `optionalTrimmedText` oben): das Provisionssatz-Feld wird im Formular NUR
// bei aktiviertem Marketplace-Schalter überhaupt gerendert
// (tenant-features-form.tsx) — ist der Schalter aus, liefert
// `formData.get("marketplaceCommissionPercent")` `null` (Feld fehlt im DOM),
// nicht `""`.
export const tenantMarketplaceCommissionSchema = z.preprocess(
  (v) => (v == null || (typeof v === "string" && v.trim() === "") ? undefined : v),
  z
    .string()
    .trim()
    .regex(
      COMMISSION_PERCENT_PATTERN,
      "Provisionssatz als Prozentzahl angeben, z. B. 20 oder 17,5 — leer lassen für den Standardsatz.",
    )
    .transform((v) => Math.round(parseFloat(v.replace(",", ".")) * 100))
    .refine((bp) => bp <= 10000, "Provisionssatz darf höchstens 100 % betragen.")
    .optional(),
);

/**
 * NEU (Marketplace M3): Pflicht-Begründung beim Ablehnen/Sperren eines
 * Listings im Betreiber-Portal (Plan Abschnitt 7: "Ablehnung mit
 * Pflicht-Begründung"). Auch für `suspendListing()` genutzt — bewusste
 * Design-Entscheidung (Plan nennt eine Begründung dort nicht explizit als
 * Pflicht, siehe PHASENSTATUS.md): ein Sperren eines bereits laufenden,
 * öffentlich sichtbaren Listings ist genauso begründungspflichtig wie eine
 * Ablehnung, damit der betroffene Mandant im Formular (`review_note`) immer
 * einen nachvollziehbaren Grund sieht statt eines stillen Verschwindens.
 */
export const platformReviewNoteSchema = z
  .string()
  .trim()
  .min(5, "Begründung muss mindestens 5 Zeichen haben.")
  .max(1000, "Begründung darf höchstens 1000 Zeichen haben.");

/**
 * NEU (Marketplace M6, 04.08.2026, Plan Abschnitt 7): Auszahlungsreferenz
 * beim manuellen "Als ausgezahlt markieren" im Betreiber-Portal
 * (`markPayoutPaid()` in `platform/marketplace.ts`). Freitext ohne feste
 * Struktur — unterschiedliche Banken/Buchhaltungssysteme liefern
 * unterschiedliche Referenzformate (z. B. "SEPA-Überweisung Ref. XY",
 * IBAN-Auszug-Nr., interne Belegnummer) — nur Mindest-/Maximallänge wie
 * `platformReviewNoteSchema` oben, keine Regex-Formvorgabe.
 */
export const payoutReferenceSchema = z
  .string()
  .trim()
  .min(3, "Auszahlungsreferenz muss mindestens 3 Zeichen haben.")
  .max(200, "Auszahlungsreferenz darf höchstens 200 Zeichen haben.");

/**
 * NEU (Marketplace M6): Filter-Query-Parameter für die Auszahlungs-Ansicht
 * (`/portal/marketplace/auszahlungen`) und ihren CSV-Export
 * (`.../auszahlungen/export`). `from`/`to` sind reine Datumsfelder
 * (`<input type="date">`, Plan Abschnitt 7: "einfache Datumsfelder reichen
 * nicht nötig kein komplexes Datepicker-Widget") im Format JJJJ-MM-TT.
 *
 * Die Umwandlung in eine tatsächliche `created_at`-Grenze (inkl. Tagesende
 * bei `to`, damit der gewählte Tag selbst mitgezählt wird) passiert bewusst
 * NICHT hier, sondern in `getPayoutRows()` (`platform/marketplace.ts`) —
 * dieses Schema prüft nur das Eingabeformat, die Anwendungslogik (wie ein
 * Datum zu einer Zeitgrenze wird) gehört dorthin, wo der eigentliche
 * `created_at`-Vergleich stattfindet.
 */
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Datum im Format JJJJ-MM-TT angeben.");

export const payoutFilterQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});
export type PayoutFilterQuery = z.infer<typeof payoutFilterQuerySchema>;
