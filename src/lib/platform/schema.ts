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

export const createTenantSchema = z.object({
  name: tenantNameSchema,
  slug: tenantSlugSchema,
  plan: tenantPlanSchema,
});

export const updateTenantSchema = z.object({
  name: tenantNameSchema,
  plan: tenantPlanSchema,
  status: tenantStatusSchema,
  customDomain: tenantCustomDomainSchema,
});
