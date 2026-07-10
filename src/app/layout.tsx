import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "Calltalent-Akademie",
  description: "KI-native, mandantenfähige Lernplattform von Calltalent Ltd.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const messages = await getMessages();

  return (
    <html lang="de" suppressHydrationWarning>
      {/* suppressHydrationWarning: bekannte Fehlmeldung durch Browser-Erweiterungen
          (z. B. LanguageTool, data-lt-installed), die vor React-Hydration ins
          <html>-Tag schreiben. Betrifft nur dieses Tag, keine Kindelemente. */}
      <body className="min-h-screen bg-white text-gray-900 antialiased">
        <NextIntlClientProvider messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
