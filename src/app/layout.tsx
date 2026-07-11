import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { getTenant } from "@/lib/tenant/context";
import { ThemeStyle } from "@/components/branding/theme-style";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenant();
  return {
    title: tenant?.name ?? "Calltalent-Akademie",
    description: "KI-native, mandantenfähige Lernplattform von Calltalent Ltd.",
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [messages, tenant] = await Promise.all([getMessages(), getTenant()]);

  return (
    <html lang="de" suppressHydrationWarning>
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
