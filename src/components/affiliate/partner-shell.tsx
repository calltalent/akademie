import type { ReactNode } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

/**
 * Affiliate-System, Block B7-A — der Rahmen aller Seiten unter `/partner/*`
 * (PLAN_Affiliate-System.md 8.2, 8.5, 8.6).
 *
 * ## Warum kein `layout.tsx` den Rahmen rendert
 *
 * Ein Layout liefe VOR jeder Seite und müsste das Partner-Gate ein zweites
 * Mal fahren — zwei Gates in zwei Dateien, die auseinanderdriften können.
 * Dieselbe Entscheidung wie im Händlerbereich (`affiliate-shell.tsx`): das
 * Layout ist das Gate und die Bedingungssperre, der Rahmen ist eine
 * gewöhnliche Komponente, die jede Seite NACH ihrem eigenen Gate aufruft und
 * mit ihrem eigenen Titel füllt.
 *
 * Diese Datei ist eine SERVER-Komponente (sie holt ihre Texte selbst über
 * `getTranslations()`). Die Farbkonstanten unten exportiert sie trotzdem —
 * aber nur für andere Server-Komponenten. Die `"use client"`-Formulare in
 * `partner-forms.tsx` führen dieselben Werte ausdrücklich ein zweites Mal:
 * ein Import von hier zöge `next-intl/server` ins Browser-Bündel und bräche
 * den Build (derselbe Grund, aus dem im Händlerbereich `affiliate-format.ts`
 * von `affiliate-shell.tsx` getrennt ist). Wer einen Wert ändert, ändert ihn
 * an beiden Stellen.
 *
 * Die Konstanten sind bewusst NICHT aus
 * `src/app/(admin)/admin/affiliate/affiliate-format.ts` importiert, obwohl
 * sie dieselben Werte tragen: der Partnerbereich ist White-Label und liegt
 * auf der Mandanten-Domain; ein Import aus dem Admin-Routenbaum würde dessen
 * Modulgraph an eine Seite hängen, die ein Partner OHNE jede
 * `memberships`-Zeile sieht (G9). Die Werte stammen aus 8.5 und sind dort
 * begründet; wer einen ändert, ändert ihn an beiden Stellen.
 *
 * ## Barrierefreiheit (8.5), hier gebündelt, damit keine Seite sie vergisst
 *
 *   - Skip-Link als erstes fokussierbares Element, Ziel `#partner-main` mit
 *     `tabIndex={-1}` — ohne das nimmt ein `<main>` den Fokus nicht an und
 *     der Sprung bleibt für den Screenreader wirkungslos.
 *   - `<nav aria-label>`, aktiver Punkt mit `aria-current="page"` UND fett,
 *     nie nur farblich.
 *   - Sekundärtext `#66679B` (rund 5,3:1 auf Weiß). `#A9AAC4` (2,3:1) fällt
 *     durch AA und kommt im Partnerbereich nicht vor.
 *   - Fließtext mindestens 15 px, Label und Chips 13 px; keine festen
 *     Pixelhöhen an Textcontainern, damit bei 200 % Zoom nichts abschneidet
 *     (`min-h-[40px]` an Bedienelementen ist eine MINDEST-, keine Festhöhe).
 *   - Klickziele mindestens 40 × 40 px, sichtbarer Fokusring überall.
 *
 * ## Branding (8.2: „der Partnerbereich ist White-Label")
 *
 * Die Mandantenfarben kommen aus der bestehenden `ThemeStyle`-Injektion im
 * Wurzel-Layout (`--color-primary`, `--color-background`) und sind hier
 * bewusst nur FLÄCHIG verwendet — als Akzentbalken und als Seitenhintergrund.
 * Auf der Mandantenfarbe steht nirgends Text: sie ist frei wählbar
 * (`cssColor()` prüft nur die Syntax, nicht den Kontrast), ein Mandant mit
 * hellem Gelb erzeugte sonst Beschriftungen unter 4,5:1 — und ausgerechnet
 * die Person, für die dieses Projekt Barrierefreiheit zur Produktanforderung
 * macht, könnte sie nicht mehr lesen.
 */

// --- Palette (8.5) ------------------------------------------------------

/** Sekundärtext, Spaltenüberschriften, Leerzustände — rund 5,3:1 auf Weiß. */
export const PARTNER_MUTED = "#66679B";
/** Überschriften, Zahlen und jeder Wert, auf den es ankommt. */
export const PARTNER_INK = "#1A1A2E";
export const PARTNER_NAVY = "#3E3F66";
export const PARTNER_BORDER = "#E7E8F2";
export const PARTNER_HAIRLINE = "#EEF0F7";

/**
 * Ein sichtbarer Fokusring an JEDEM Bedienelement. Als Konstante statt als
 * globale CSS-Regel, damit er beim Lesen der Komponente sichtbar ist und
 * nicht versehentlich von einem `outline-none` überschrieben wird.
 */
export const PARTNER_FOCUS_RING =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3E3F66]";

/** Karte — überall gleich, damit die acht Seiten nicht auseinanderlaufen. */
export const PARTNER_CARD_CLASS = "rounded-[14px] border bg-white";

/** Primärer Knopf (Speichern, Zustimmen, Exportieren). Weiß auf #5663AE ≈ 6,3:1. */
export const PARTNER_BUTTON_CLASS =
  "inline-flex min-h-[40px] items-center justify-center rounded-[11px] px-[18px] text-[15px] font-bold text-white no-underline disabled:opacity-60";
export const PARTNER_BUTTON_BG = "#5663AE";

// --- Navigation ---------------------------------------------------------

export type PartnerNavId =
  | "dashboard"
  | "links"
  | "statistics"
  | "statement"
  | "payouts"
  | "team"
  | "profile"
  | "terms";

/**
 * Reihenfolge und Ziele der Navigation. `key` ist eine Literal-Union statt
 * `string`, damit TypeScript jeden Schlüssel gegen `messages/de.json` prüft,
 * statt ihn erst zur Laufzeit zu vermissen.
 */
const NAV_ORDER: ReadonlyArray<{
  id: PartnerNavId;
  href: string;
  key:
    | "nav.dashboard"
    | "nav.links"
    | "nav.statistics"
    | "nav.statement"
    | "nav.payouts"
    | "nav.team"
    | "nav.profile"
    | "nav.terms";
}> = [
  { id: "dashboard", href: "/partner", key: "nav.dashboard" },
  { id: "links", href: "/partner/links", key: "nav.links" },
  { id: "statistics", href: "/partner/statistik", key: "nav.statistics" },
  { id: "statement", href: "/partner/kontoauszug", key: "nav.statement" },
  { id: "payouts", href: "/partner/auszahlungen", key: "nav.payouts" },
  { id: "team", href: "/partner/team", key: "nav.team" },
  { id: "profile", href: "/partner/stammdaten", key: "nav.profile" },
  { id: "terms", href: "/partner/bedingungen", key: "nav.terms" },
];

export async function PartnerShell({
  active,
  title,
  description,
  tenantName,
  logoUrl,
  showTeam,
  children,
}: {
  active: PartnerNavId;
  title: string;
  description?: string;
  tenantName: string;
  logoUrl: string | null;
  /**
   * `/partner/team` gibt es nur bei `tier2_enabled` (8.2). Ein Menüpunkt auf
   * eine Seite, die nur erklärt, dass es sie nicht gibt, ist eine Sackgasse —
   * und für einen sehbehinderten Nutzer eine besonders teure, weil er den
   * Fehlgriff erst nach dem Laden bemerkt.
   */
  showTeam: boolean;
  children: ReactNode;
}) {
  const t = await getTranslations("affiliate.shell");
  const items = showTeam ? NAV_ORDER : NAV_ORDER.filter((item) => item.id !== "team");

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
      <a
        href="#partner-main"
        className={`sr-only focus:not-sr-only focus:absolute focus:z-50 focus:rounded-[10px] focus:bg-white focus:px-4 focus:py-3 focus:text-[15px] focus:font-bold ${PARTNER_FOCUS_RING}`}
        style={{ color: PARTNER_NAVY, border: `1px solid ${PARTNER_BORDER}` }}
      >
        {t("skipLink")}
      </a>

      {/* Akzentbalken in der Mandantenfarbe — Fläche, kein Textträger. */}
      <div
        aria-hidden="true"
        className="h-[6px] w-full rounded-[3px]"
        style={{ background: "var(--color-primary)" }}
      />

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {logoUrl !== null && (
            /* Mandanten-Logo liegt auf einer je Mandant anderen Domain;
               `next/image` bräuchte dafür eine Positivliste in
               next.config.ts, die es hier nicht gibt. */
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt=""
              className="h-[36px] w-auto max-w-[160px] object-contain"
            />
          )}
          <div className="min-w-0">
            <p className="text-[13px] font-semibold" style={{ color: PARTNER_MUTED }}>
              {tenantName} · {t("title")}
            </p>
            <h1
              className="mt-0.5 text-[26px] font-extrabold"
              style={{ letterSpacing: "-0.01em", color: PARTNER_INK }}
            >
              {title}
            </h1>
          </div>
        </div>

        {/* Abmelden ohne JavaScript: dieselbe Route wie überall (POST mit
            Origin-Prüfung, src/app/auth/signout/route.ts). */}
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className={`inline-flex min-h-[40px] items-center rounded-[11px] border px-[14px] text-[15px] font-semibold ${PARTNER_FOCUS_RING}`}
            style={{ borderColor: PARTNER_BORDER, color: PARTNER_NAVY, background: "#FFFFFF" }}
          >
            {t("logout")}
          </button>
        </form>
      </header>

      {description !== undefined && (
        <p className="max-w-3xl text-[15px]" style={{ color: PARTNER_MUTED }}>
          {description}
        </p>
      )}

      <nav aria-label={t("navLabel")}>
        <ul className="flex flex-wrap gap-2 p-0" style={{ listStyle: "none" }}>
          {items.map((item) => {
            const isActive = item.id === active;
            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  prefetch={false}
                  aria-current={isActive ? "page" : undefined}
                  className={`inline-flex min-h-[40px] items-center rounded-[11px] border px-[14px] text-[15px] no-underline ${PARTNER_FOCUS_RING}`}
                  style={
                    isActive
                      ? {
                          background: PARTNER_NAVY,
                          borderColor: PARTNER_NAVY,
                          color: "#FFFFFF",
                          fontWeight: 700,
                        }
                      : {
                          background: "#FFFFFF",
                          borderColor: PARTNER_BORDER,
                          color: PARTNER_NAVY,
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
      <main id="partner-main" tabIndex={-1} className="flex flex-col gap-6 outline-none">
        {children}
      </main>
    </div>
  );
}

/**
 * Der Hinweis statt einer Seite, wenn das Gate „nein" sagt.
 *
 * EIN Text für alle Ablehnungsgründe außer „nicht angemeldet" (11.15): ob
 * jemand nie beworben, ob seine Bewerbung offen, abgelehnt oder sein Konto
 * gesperrt ist, darf aus der Antwort nicht ableitbar sein — sonst wird die
 * Seite zum Auskunftsdienst über den Partnerbestand des Mandanten.
 * „Nicht angemeldet" ist davon ausgenommen: das weiß der Aufrufer über sich
 * selbst ohnehin, und ohne diesen Hinweis fehlte ihm der Weg zum Login.
 */
export async function PartnerAccessNotice({
  reason,
}: {
  reason: "no-tenant" | "feature-disabled" | "not-authenticated" | "not-partner";
}) {
  // Namensraum `affiliate.shell` und KEIN eigener `affiliate.access`: die
  // Meldung gehört zum Rahmen des Bereichs, und ein Namensraum mit vier
  // Schlüsseln ist eine Datei mehr, die jemand in drei Sprachen pflegen muss.
  const t = await getTranslations("affiliate.shell");
  const notAuthenticated = reason === "not-authenticated";

  return (
    <main
      id="partner-main"
      tabIndex={-1}
      className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-16 outline-none sm:px-6"
    >
      <h1 className="text-[22px] font-bold" style={{ color: PARTNER_INK }}>
        {t("accessHeading")}
      </h1>
      <p className="text-[15px]" style={{ color: PARTNER_MUTED }}>
        {notAuthenticated ? t("accessNotAuthenticated") : t("accessBody")}
      </p>
      {notAuthenticated && (
        <Link
          href="/login"
          prefetch={false}
          className={`${PARTNER_BUTTON_CLASS} self-start ${PARTNER_FOCUS_RING}`}
          style={{ background: PARTNER_BUTTON_BG }}
        >
          {t("accessLogin")}
        </Link>
      )}
    </main>
  );
}

/**
 * Eine Kennzahl als TEXT. Der Auftraggeber ist sehbehindert; jede Zahl, die
 * nur in einer Grafik existiert, existiert für ihn nicht (8.5, CLAUDE.md
 * §3.4). Deshalb ist dies die Grundform jeder Kennzahl im Partnerbereich —
 * eine Grafik kommt, wenn überhaupt, DANACH.
 *
 * `hint` steht als eigener Absatz und nicht als `title`-Attribut: ein
 * Tooltip ist für Tastatur- und Screenreader-Nutzer nicht zuverlässig
 * erreichbar.
 */
export function PartnerMetric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div
      className={`${PARTNER_CARD_CLASS} p-[18px_20px]`}
      style={{ borderColor: PARTNER_BORDER }}
    >
      <p className="text-[13px] font-semibold" style={{ color: PARTNER_MUTED }}>
        {label}
      </p>
      <p className="mt-1 text-[22px] font-extrabold" style={{ color: PARTNER_INK }}>
        {value}
      </p>
      {hint !== undefined && (
        <p className="mt-1 text-[13px]" style={{ color: PARTNER_MUTED }}>
          {hint}
        </p>
      )}
    </div>
  );
}
