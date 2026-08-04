import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { BrandLogo } from "@/components/shell/brand-logo";

/**
 * Eigene Shell für `marketplace.calltalent.ai` (Marketplace M4, Plan
 * "ich-möchte-einen-eigenen-groovy-toast.md" Abschnitt 4). Echter Ordner wie
 * `src/app/portal/`, kein Klammer-Group — bewusst KEIN `getTenant()`-Aufruf
 * irgendwo in diesem Baum: es gibt per Definition keinen Mandanten auf
 * dieser Domain (mandantenübergreifender, zentraler Marketplace).
 *
 * Branding: KEIN Mandanten-Theme. `src/app/layout.tsx` (RootLayout, umschließt
 * auch diesen Baum, da `src/app/marketplace/` kein eigenes `<html>/<body>`
 * definiert) ruft dort bereits `getTenant()` auf und reicht das Ergebnis an
 * `ThemeStyle` durch — auf diesem Host liefert `getTenant()` `null`, wodurch
 * `ThemeStyle` automatisch auf `DEFAULT_BRANDING` (Calltalent-Periwinkle,
 * `tenant/types.ts`) zurückfällt. Keine zusätzliche Branding-Logik hier
 * nötig. `BrandLogo` (`components/shell/brand-logo.tsx`) ist die bestehende,
 * wiederverwendbare Calltalent-Wortmarke (bereits im Studenten-Portal/Admin/
 * Betreiber-Portal im Einsatz) — hier mit `variant="white"` (dunkler Text auf
 * hellem Grund) statt eines neu erfundenen Logos.
 *
 * Host-Gate (SICHERHEITSKRITISCH laut Auftragstext): middleware.ts setzt
 * `x-marketplace-host: "1"` NUR, wenn der Host-Header tatsächlich
 * `NEXT_PUBLIC_MARKETPLACE_HOST` entspricht (`routing.ts::isSameHost()`,
 * Host-Spoofing-Schutz). Ohne dieses Gate wäre `/marketplace/...` auch über
 * JEDEN beliebigen Mandanten-Host direkt erreichbar — Next.js kennt
 * Ordnerpfade unabhängig vom Host, ein Kunde könnte sonst z. B.
 * `kunde.calltalent.ai/marketplace/impressum` aufrufen und bekäme Calltalents
 * eigenes Impressum unter der eigenen Domain angezeigt, was der in Plan
 * Abschnitt 9 gewollten Trennung ("eigenständiges Telemedienangebot")
 * widerspricht. `notFound()` statt `redirect()`: kein Hinweis, dass unter
 * diesem Pfad überhaupt etwas existiert.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketplace.shell");
  return { title: t("metaTitle") };
}

export default async function MarketplaceLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const headerList = await headers();
  if (headerList.get("x-marketplace-host") !== "1") {
    notFound();
  }

  const t = await getTranslations("marketplace.shell");
  const year = new Date().getFullYear();

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <header className="border-b border-border-100 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 rounded-md">
            <BrandLogo subLabel={t("subLabel")} variant="white" compact />
          </Link>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border-100 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-8 text-sm text-muted-400 sm:flex-row sm:items-center sm:justify-between">
          <p>{t("footerCopyright", { year })}</p>
          <nav aria-label={t("footerNavLabel")} className="flex gap-5">
            <Link
              href="/impressum"
              className="font-semibold text-muted-500 underline-offset-2 hover:text-ink hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 rounded-sm"
            >
              {t("footerImpressum")}
            </Link>
            <Link
              href="/datenschutz"
              className="font-semibold text-muted-500 underline-offset-2 hover:text-ink hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 rounded-sm"
            >
              {t("footerDatenschutz")}
            </Link>
            <Link
              href="/agb"
              className="font-semibold text-muted-500 underline-offset-2 hover:text-ink hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 rounded-sm"
            >
              {t("footerAgb")}
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
