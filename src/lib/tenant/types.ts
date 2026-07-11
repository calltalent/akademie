/**
 * Öffentliche, sichere Teilmenge von `public.tenants` — das ist alles, was
 * anonyme Besucher vor dem Login zu sehen bekommen (Branding). Niemals
 * `settings.payments_enabled`-interne Details oder Ähnliches erweitern,
 * ohne zu prüfen, ob es für anonyme Besucher unbedenklich ist.
 */
export type PublicTenant = {
  id: string;
  slug: string;
  name: string;
  plan: "trial" | "komplett" | "enterprise";
  status: "active" | "trial" | "suspended";
  branding: {
    logo_url?: string | null;
    color_primary?: string;
    color_bg?: string;
    font?: string;
    radius?: string;
  };
  legal: {
    impressum_url?: string;
    datenschutz_url?: string;
  };
  settings: {
    payments_enabled?: boolean;
    tutor_enabled?: boolean;
    course_generator_enabled?: boolean;
    default_locale?: string;
  };
};

export const DEFAULT_BRANDING: PublicTenant["branding"] = {
  color_primary: "#171717",
  color_bg: "#ffffff",
  font: "Inter",
  radius: "0.5rem",
};
