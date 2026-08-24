import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getTenant } from "@/lib/tenant/context";
import { resolveLegalEntity } from "@/lib/legal/company";

/**
 * Shell für die Rechtsseiten eines MANDANTEN-Hosts (/legal-notice, /privacy,
 * /terms) — NEU 24.08.2026, Josips Auftrag "AGB und Privacy für
 * salestalent.app auf Calltalent LLC umstellen". Bis dahin gab es auf
 * Mandanten-Domains überhaupt keine Rechtstexte: die einzigen Rechtsseiten
 * im Code lagen unter `src/app/marketplace/` und sind per Host-Gate
 * ausschließlich auf `marketplace.calltalent.ai` erreichbar
 * (PHASENSTATUS.md, Abschnitt "salestalent.app", offener Punkt 1).
 *
 * Zugriffsgrenze: gerendert wird nur, wenn der aufgelöste Mandant einen
 * Rechtsträger in `tenants.legal.entity` hinterlegt hat. Ohne diesen
 * Datensatz -> `notFound()`. Damit kann auf der Domain eines White-Label-
 * Kunden niemals Calltalents eigenes Impressum erscheinen, auch nicht
 * versehentlich über einen geteilten Link — dieselbe Überlegung wie beim
 * Host-Gate der Marketplace-Shell, nur datengetrieben statt hostgetrieben.
 *
 * Kein eigenes `<html>/<body>`: RootLayout (src/app/layout.tsx) umschließt
 * diesen Baum und setzt bereits Mandanten-Theme (ThemeStyle) und
 * next-intl-Provider.
 */
export async function generateMetadata(): Promise<Metadata> {
  const [tenant, t] = await Promise.all([getTenant(), getTranslations("legal.shell")]);
  return { title: `${t("metaTitle")} — ${tenant?.name ?? ""}`.trim() };
}

const LINK_CLASS =
  "font-semibold text-muted-500 underline-offset-2 hover:text-ink hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 rounded-sm";

export default async function LegalLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const tenant = await getTenant();
  const entity = resolveLegalEntity(tenant?.legal);
  if (!entity) notFound();

  const t = await getTranslations("legal.shell");
  const year = new Date().getFullYear();

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <header className="border-b border-border-100 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-4">
          <Link href="/" className={LINK_CLASS}>
            {tenant?.name ?? entity.name}
          </Link>
          <Link href="/" className={LINK_CLASS}>
            {t("backToApp")}
          </Link>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border-100 bg-white">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 px-6 py-8 text-sm text-muted-400 sm:flex-row sm:items-center sm:justify-between">
          <p>{t("copyright", { year, company: entity.name })}</p>
          <nav aria-label={t("navLabel")} className="flex gap-5">
            <Link href="/legal-notice" className={LINK_CLASS}>
              {t("navNotice")}
            </Link>
            <Link href="/privacy" className={LINK_CLASS}>
              {t("navPrivacy")}
            </Link>
            <Link href="/terms" className={LINK_CLASS}>
              {t("navTerms")}
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
