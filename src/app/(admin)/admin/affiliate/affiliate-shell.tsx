import type { ReactNode } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { AffiliateManagerAccess } from "@/lib/affiliate/access";
import {
  CARD_BORDER,
  CARD_CLASS,
  FOCUS_RING,
  INK,
  MUTED,
  NAVY,
} from "./affiliate-format";

/**
 * Affiliate-System, Block B6-B — gemeinsamer Rahmen der sieben Seiten unter
 * `/admin/affiliate/*` (PLAN_Affiliate-System.md 8.1, 8.5, 8.6).
 *
 * WARUM KEIN `layout.tsx`: ein Layout in dieser Route-Gruppe liefe VOR jeder
 * Seite und müsste das Manager-Gate ein zweites Mal fahren — zwei Gates in
 * zwei Dateien, die auseinanderdriften können. Der Plan verlangt das Gate je
 * Seite (8.1: „zusätzlich `checkAdminAccess()` je Seite"), deshalb ist dies
 * eine gewöhnliche Komponente, die jede Seite NACH ihrem Gate aufruft.
 *
 * Barrierefreiheit (8.5), an dieser Stelle gebündelt, damit sie keine Seite
 * vergessen kann:
 *   - Skip-Link als erstes fokussierbares Element jeder Seite; er springt auf
 *     `#affiliate-main`, das `tabIndex={-1}` trägt (ohne das nimmt ein <main>
 *     den Fokus nicht an und der Sprung bleibt für den Screenreader wirkungslos).
 *   - Die Unternavigation ist eine echte `<nav>` mit `aria-label`; der aktive
 *     Punkt trägt `aria-current="page"` und ist zusätzlich fett — nie nur
 *     farblich.
 *   - Sekundärtext durchgehend `#66679B` (rund 5,3:1 auf Weiß). `#A9AAC4`
 *     (2,3:1) fällt durch AA und kommt in diesen Seiten nicht vor.
 *   - Klickziele mindestens 40 px hoch (`min-h-[40px]`), Fokusring sichtbar
 *     (`FOCUS_RING`), nie `outline-none` ohne Ersatz.
 */

export type AffiliateNavId =
  | "overview"
  | "partners"
  | "conditions"
  | "commissions"
  | "creatives"
  | "settings";

/**
 * Die Unternavigation des Moduls.
 *
 * ABWEICHUNG VOM PLAN, bewusst: `admin.affiliate.nav.payouts` existiert im
 * Schlüsselgerüst, `/admin/affiliate/auszahlungen` aber erst mit Block B8.
 * Ein Menüpunkt auf eine Route, die es nicht gibt, ist eine Sackgasse — und
 * für einen sehbehinderten Betreiber eine besonders teure: er merkt den
 * Fehlgriff erst nach dem Laden. Der Punkt kommt mit seiner Seite.
 */
const NAV_ITEMS: ReadonlyArray<{
  id: AffiliateNavId;
  href: string;
  /** Literal-Union statt `string`: so prüft TypeScript jeden Schlüssel gegen
   *  `messages/de.json`, statt ihn erst zur Laufzeit zu vermissen. */
  key:
    | "nav.overview"
    | "nav.partners"
    | "nav.conditions"
    | "nav.commissions"
    | "nav.creatives"
    | "nav.settings";
}> = [
  { id: "overview", href: "/admin/affiliate", key: "nav.overview" },
  { id: "partners", href: "/admin/affiliate/partner", key: "nav.partners" },
  {
    id: "conditions",
    href: "/admin/affiliate/konditionen",
    key: "nav.conditions",
  },
  {
    id: "commissions",
    href: "/admin/affiliate/provisionen",
    key: "nav.commissions",
  },
  {
    id: "creatives",
    href: "/admin/affiliate/werbemittel",
    key: "nav.creatives",
  },
  {
    id: "settings",
    href: "/admin/affiliate/einstellungen",
    key: "nav.settings",
  },
];

/**
 * Rahmen einer Affiliate-Seite: Kopfzeile, Unternavigation, Hauptbereich.
 * `title` ist die Überschrift der einzelnen Seite (H1); der Modulname steht
 * darüber als Augenbraue.
 */
export async function AffiliateShell({
  active,
  title,
  description,
  children,
}: {
  active: AffiliateNavId;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const t = await getTranslations("admin.affiliate");

  return (
    <div className="flex flex-col gap-6">
      <a
        href="#affiliate-main"
        className={`sr-only focus:not-sr-only focus:absolute focus:z-50 focus:rounded-[10px] focus:bg-white focus:px-4 focus:py-3 focus:text-[15px] focus:font-bold ${FOCUS_RING}`}
        style={{ color: NAVY, border: `1px solid ${CARD_BORDER}` }}
      >
        {t("skipToContent")}
      </a>

      <header>
        <p className="text-[13px] font-semibold" style={{ color: MUTED }}>
          {t("eyebrow")}
        </p>
        <h1
          className="mt-0.5 text-[26px] font-extrabold"
          style={{ letterSpacing: "-0.01em", color: INK }}
        >
          {title}
        </h1>
        {description && (
          <p className="mt-1 max-w-3xl text-[15px]" style={{ color: MUTED }}>
            {description}
          </p>
        )}
      </header>

      <nav aria-label={t("navLabel")}>
        <ul className="flex flex-wrap gap-2 p-0" style={{ listStyle: "none" }}>
          {NAV_ITEMS.map((item) => {
            const isActive = item.id === active;
            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  prefetch={false}
                  aria-current={isActive ? "page" : undefined}
                  className={`inline-flex min-h-[40px] items-center rounded-[11px] border px-[14px] text-[15px] no-underline ${FOCUS_RING}`}
                  style={
                    isActive
                      ? {
                          background: NAVY,
                          borderColor: NAVY,
                          color: "#FFFFFF",
                          fontWeight: 700,
                        }
                      : {
                          background: "#FFFFFF",
                          borderColor: CARD_BORDER,
                          color: NAVY,
                          fontWeight: 600,
                        }
                  }
                >
                  {t(item.key)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* `tabIndex={-1}`: ohne das läuft der Skip-Link ins Leere (8.5). */}
      <main
        id="affiliate-main"
        tabIndex={-1}
        className="flex flex-col gap-6 outline-none"
      >
        {children}
      </main>
    </div>
  );
}

/**
 * Der Hinweis statt einer Seite, wenn das Gate „nein" sagt (8.1: „sonst einen
 * erklärenden Hinweis statt 404").
 *
 * Je Grund ein eigener Text — das ist hier KEIN Enumeration-Leck im Sinne von
 * CLAUDE.md §2.15: alle vier Gründe sind Aussagen über den Anfragenden selbst
 * bzw. über den Mandanten, unter dessen Domain er ohnehin steht. Nichts davon
 * verrät die Existenz fremder Daten.
 */
export async function AffiliateAccessNotice({
  reason,
}: {
  reason: Exclude<AffiliateManagerAccess, { ok: true }>["reason"];
}) {
  const t = await getTranslations("admin.affiliate");

  const heading =
    reason === "feature-disabled" ? t("disabled.heading") : t("access.heading");
  const body =
    reason === "feature-disabled"
      ? t("disabled.body")
      : reason === "not-manager"
        ? t("access.notManager")
        : reason === "not-authenticated"
          ? t("access.notAuthenticated")
          : t("access.noTenant");

  return (
    <div
      className={`${CARD_CLASS} max-w-2xl p-[26px_28px]`}
      style={{ borderColor: CARD_BORDER }}
    >
      <h1 className="text-[20px] font-bold" style={{ color: INK }}>
        {heading}
      </h1>
      <p className="mt-2 text-[15px]" style={{ color: MUTED }}>
        {body}
      </p>
    </div>
  );
}

/**
 * Der Hinweis, wenn das Modul an ist, aber noch keine Programmzeile
 * existiert. Ohne sie gibt es keinen Satz, keine Währung und keine Frist —
 * jede Zahl auf jeder Seite wäre erfunden. Deshalb führt der Weg zuerst in
 * die Einstellungen.
 */
export async function AffiliateProgramMissing() {
  const t = await getTranslations("admin.affiliate");
  return (
    <div
      className={`${CARD_CLASS} max-w-2xl p-[26px_28px]`}
      style={{ borderColor: CARD_BORDER }}
    >
      <p className="text-[15px]" style={{ color: INK }}>
        {t("programMissing")}
      </p>
      <Link
        href="/admin/affiliate/einstellungen"
        prefetch={false}
        className={`mt-4 inline-flex min-h-[40px] items-center rounded-[11px] px-[18px] text-[15px] font-bold text-white no-underline ${FOCUS_RING}`}
        style={{ background: "#5663AE" }}
      >
        {t("nav.settings")}
      </Link>
    </div>
  );
}
