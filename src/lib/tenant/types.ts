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
  /**
   * NEU (Phase 5, Block 8, 12.07.2026): war vorher gar nicht Teil des
   * öffentlichen Mandanten-Objekts — dadurch bauten `checkout.ts`, `portal.ts`
   * und `import.ts` Mandanten-URLs IMMER aus `{slug}.akademie.calltalent.ai`
   * (altes, seit heute abgelöstes Schema, s. tenant/resolve.ts) zusammen und
   * ignorierten `custom_domain` komplett — für den ersten echten Mandanten
   * (`learning.calltalent.ai`) wären Checkout-Redirect, Stripe-Billing-Portal-
   * Rückkehr-URL und CSV-Import-Willkommensmail-Login-Links alle auf eine
   * falsche, nicht erreichbare Domain gezeigt. Nicht sicherheitskritisch
   * (ist ohnehin öffentlich in der Adresszeile sichtbar), daher unbedenklich
   * hier mit aufzunehmen. Siehe src/lib/tenant/url.ts (neue zentrale Stelle,
   * die dieses Feld nutzt statt es an drei Stellen zu duplizieren).
   */
  custom_domain?: string | null;
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
    /**
     * NEU (Design-Block 6, 13.07.2026, AdminEinstellungen.dc.html): drei
     * echte, persistierte Mandanten-Schalter statt der im Export rein
     * dekorativen Toggles. Alle drei sind bei Fehlen (bestehende Mandanten)
     * so zu behandeln, als wären sie NICHT gesetzt/„true" (unverändertes
     * Verhalten) — außer explizit auf `false` gesetzt.
     *
     * - `self_signup_enabled`: gate in signUpWithPassword() (auth/actions.ts).
     * - `certificates_enabled`: zusätzliches Gate NEBEN dem bestehenden
     *   `courses.settings.certificate_enabled` in certificates/issue.ts.
     * - `maintenance_enabled`: NUR persistiert, NOCH NICHT durchgesetzt —
     *   eine echte Portal-Sperre bräuchte eine seitenübergreifende Prüfung
     *   (z. B. middleware.ts), die aus Zeit-/Risikogründen bewusst nicht Teil
     *   dieses Design-Blocks ist (siehe PHASENSTATUS.md, offener Punkt für
     *   Josip). Nicht sicherheitskritisch, hier unbedenklich mit aufzunehmen.
     */
    self_signup_enabled?: boolean;
    certificates_enabled?: boolean;
    maintenance_enabled?: boolean;
    support_email?: string;
  };
};

/**
 * Design-Block (12.07.2026, DESIGN-MASTERPROMPT.md): Calltalent-eigene
 * Markenfarben statt generischem Schwarz/Weiß, Quelle Branding/BRANDING.md
 * §3+§5 (Periwinkle #5663AE, Montserrat, Radius 14px). Gilt für jeden
 * Mandanten ohne eigenes Branding — Mandanten mit gesetztem `branding.*`
 * überschreiben weiterhin per components/branding/theme-style.tsx. Das
 * `font`-Feld wird aktuell noch nicht in CSS eingebunden (siehe
 * theme-style.tsx) — hier nur als Absichtserklärung für eine spätere
 * Mandanten-Schriftwahl gepflegt, keine funktionale Änderung.
 */
export const DEFAULT_BRANDING: PublicTenant["branding"] = {
  color_primary: "#5663ae",
  color_bg: "#ffffff",
  font: "Montserrat",
  radius: "14px",
};
