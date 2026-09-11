import type { Metadata } from "next";
import { headers } from "next/headers";
import { Montserrat } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { getTenant } from "@/lib/tenant/context";
import type { PublicTenant } from "@/lib/tenant/types";
import { needsConsentDecision, readTrackingConsent } from "@/lib/consent/read";
import { ThemeStyle } from "@/components/branding/theme-style";
import { ConsentBanner } from "@/components/consent/consent-banner";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";
import "./globals.css";

/**
 * Design-Block (12.07.2026, DESIGN-MASTERPROMPT.md): Calltalent-Hausschrift
 * Montserrat statt Inter, siehe Branding/BRANDING.md §5. `next/font/google`
 * lädt die Schriftdateien zur Build-Zeit und liefert sie selbst aus (kein
 * Laufzeit-Request an Google Fonts) — erfüllt damit den DSGVO-Hinweis aus
 * BRANDING.md §5 ohne manuelle TTF→WOFF2-Konvertierung. `variable` macht
 * die Schrift als CSS-Variable verfügbar, globals.css bindet sie in
 * `--font-sans` ein.
 */
const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-montserrat",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  // i18n Block A8: hartkodierter deutscher Fallback-Titel/-Beschreibung durch
  // getTranslations() ersetzt — Namensraum "common" existiert bereits in
  // messages/de.json (appName) bzw. wird hier um metaDescription ergänzt.
  const [tenant, t] = await Promise.all([getTenant(), getTranslations("common")]);
  return {
    title: tenant?.name ?? t("appName"),
    description: t("metaDescription"),
  };
}

/**
 * Affiliate-Modul, Block B2 (PLAN_Affiliate-System.md Abschnitt 10/B2,
 * 10.09.2026): Ist das Partnerprogramm für DIESEN Mandanten freigeschaltet?
 *
 * Nur dann darf der Einwilligungsdialog erscheinen. Ohne diese Bedingung
 * bekäme jeder Besucher jeder Akademie einen Cookie-Hinweis zu einem
 * Partnerprogramm, das es dort nicht gibt — das widerspricht der Vorgabe des
 * Plans, dass B1 bis B5 ohne den Feature-Schalter vollständig inert bleiben
 * (Plan 10.1), und es fragt nach einer Einwilligung, die niemand braucht.
 *
 * Der Wert wird über einen Index-Zugriff gelesen statt über ein typisiertes
 * Feld: `affiliate_enabled` lebt in `tenants.settings` (jsonb, Erlaubnisliste
 * in Migration 20260910120000, Abschnitt (d)), das passende Feld in
 * `PublicTenant["settings"]` legt aber Block B1 an — der zu dieser Datei
 * gehört, nicht zu B2. Sobald B1 das Feld typisiert, kann diese Hilfsfunktion
 * durch `tenant.settings.affiliate_enabled === true` ersetzt und mit der
 * gleichlautenden Funktion in src/app/(legal)/privacy/page.tsx zu einer
 * gemeinsamen Stelle zusammengezogen werden.
 */
function isAffiliateModuleEnabled(tenant: PublicTenant | null): boolean {
  if (!tenant) return false;
  const settings: Record<string, unknown> = tenant.settings;
  return settings.affiliate_enabled === true;
}

/**
 * Auf diesen Seiten erscheint der Dialog nicht. Er verlinkt selbst auf
 * /privacy; ein modaler Dialog über der Datenschutzerklärung verhindert genau
 * das Lesen, das eine Einwilligung erst informiert macht (Art. 4 Nr. 11
 * DSGVO). Die deutschen Aliase (/datenschutz, /agb, /impressum) leiten auf
 * diese drei Pfade weiter und sind damit mit abgedeckt.
 */
const CONSENT_EXEMPT_PATHS = ["/privacy", "/terms", "/legal-notice"];

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [messages, tenant, locale, consent, headerList] = await Promise.all([
    getMessages(),
    getTenant(),
    getLocale(),
    readTrackingConsent(),
    headers(),
  ]);

  /**
   * Die eine Einhängestelle des Einwilligungsdialogs (Plan 10/B2). Er hängt
   * hier und nicht in einem Bereichs-Layout, weil ein Partnerlink auf jeder
   * öffentlichen Seite eines Mandanten landen kann — und weil es genau eine
   * Stelle geben soll, an der über sein Erscheinen entschieden wird.
   *
   * Vier Bedingungen, alle notwendig:
   *   - Mandant aufgelöst: ohne ihn kann `setTrackingConsent()` keinen
   *     Nachweis schreiben (`tracking_consents.tenant_id` ist not null) und
   *     weist jede Entscheidung ab. Auf dem Betreiber-Portal- und dem
   *     Marketplace-Host ist das der Fall.
   *   - Partnerprogramm freigeschaltet (siehe oben).
   *   - Noch keine Entscheidung zum aktuellen Stand der Rechtstexte. Eine
   *     Ablehnung ist eine Entscheidung und wird nicht erneut abgefragt.
   *   - Keine Rechtsseite (siehe CONSENT_EXEMPT_PATHS).
   *
   * `x-portal-pathname` setzt die Middleware bei JEDEM Request auf den
   * tatsächlich ausgelieferten Pfad (middleware.ts:128) und überschreibt
   * dabei einen etwaigen vom Client mitgeschickten Wert — der Header ist
   * also nicht fälschbar. Der Name stammt vom ersten Nutzer (Portal-Gate);
   * der Inhalt ist der allgemeine Pfad.
   *
   * Kosten für das Performance-Budget: keine zusätzliche Dynamik. Dieses
   * Layout liest über `getTenant()` ohnehin schon `headers()`, der Baum ist
   * damit bereits dynamisch; `readTrackingConsent()` liest nur ein Cookie,
   * ohne Datenbank-Rundlauf.
   */
  const showConsentBanner =
    tenant !== null &&
    isAffiliateModuleEnabled(tenant) &&
    needsConsentDecision(consent) &&
    !CONSENT_EXEMPT_PATHS.includes(headerList.get("x-portal-pathname") ?? "");

  return (
    <html lang={locale} suppressHydrationWarning className={montserrat.variable}>
      {/* suppressHydrationWarning: bekannte Fehlmeldung durch Browser-Erweiterungen
          (z. B. LanguageTool, data-lt-installed), die vor React-Hydration ins
          <html>-Tag schreiben. Betrifft nur dieses Tag, keine Kindelemente. */}
      <head>
        <ThemeStyle tenant={tenant} />
      </head>
      <body className="min-h-screen antialiased" style={{ background: "var(--color-background)" }}>
        <ServiceWorkerRegister />
        <NextIntlClientProvider messages={messages}>
          {children}
          {showConsentBanner && <ConsentBanner />}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
