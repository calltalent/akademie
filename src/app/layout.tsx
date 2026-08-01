import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { getTenant } from "@/lib/tenant/context";
import { ThemeStyle } from "@/components/branding/theme-style";
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

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [messages, tenant, locale] = await Promise.all([
    getMessages(),
    getTenant(),
    getLocale(),
  ]);

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
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
