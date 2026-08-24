"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Search,
  HelpCircle,
  LayoutGrid,
  Bookmark,
  Headset,
  ShieldCheck,
  Building2,
  ExternalLink,
  CalendarClock,
  type LucideIcon,
} from "lucide-react";

/**
 * Layout-Sidebar — 1:1-Portierung aus dem Referenzdesign
 * „Calltalent-Akademie Studenten-Portal/Sidebar.dc.html". Struktur, Farben,
 * Abstände und Radien sind exakt aus dem Referenz-HTML übernommen; alle
 * Farb-/Radius-Werte laufen über die in Prompt 1 ergänzten Tailwind-Tokens
 * (globals.css @theme): accent #5663AE, navy #3E3F66, ink #1A1A2E, bg
 * #F4F5FA, cream #F7EED4, border-100 #E7E8F2, muted-400 #A9AAC4, muted-500
 * #66679B sowie rounded-sm=11px. Icon-Farben kommen über `currentColor`
 * (lucide) aus den `text-*`-Token-Utilities — das erzwingt zugleich die
 * Emission der CSS-Variablen.
 *
 * Der aktive Menüpunkt wird standardmäßig aus der Route (`usePathname`)
 * abgeleitet; das optionale `active`-Prop (wie in Sidebar.dc.html) übersteuert
 * das bei Bedarf. `isStaff` blendet den Link zum Admin-Bereich ein (sonst
 * gäbe es aus der Lernansicht keinen Weg zu /admin). Das Ein-/Ausklappen
 * (`expanded`) ist lokaler State über den Such-Button, daher "use client".
 *
 * `prefetch={false}` NEU (21.07.2026, Josips Fund: Login/Navigation fühlt
 * sich langsam an) — siehe ausführliche Begründung im Kopfkommentar von
 * components/shell/nav-link.tsx: jeder im Viewport sichtbare `<Link>` löst
 * standardmäßig einen Hintergrund-Request durch middleware.ts (inkl. echtem
 * `getUser()`-Netzwerk-Rundlauf zu Supabase) aus — diese Sidebar hat 5-6
 * gleichzeitig sichtbare Einträge, macht auf JEDER Seite also 5-6
 * zusätzliche Auth-Rundläufe, ohne dass sie je geklickt werden.
 *
 * `isPlatformAdmin` NEU (19.07.2026, Josips Auftrag: "Direktlink zum
 * Mandantenbereich unter dem Admin-Bereich-Link"): zweiter, unabhängiger
 * Link direkt darunter, zum Betreiber-Portal (`/portal/mandanten`) — eigene
 * Berechtigungsstufe (Plattform-Admin, geprüft in app-shell.tsx), NICHT
 * dasselbe wie `isStaff`. Das Portal läuft auf einem ANDEREN Host
 * (`NEXT_PUBLIC_PORTAL_HOST`, z. B. portal.calltalent.ai vs.
 * academy.calltalent.ai) — ein normales `<a>` statt `next/link`, analog zum
 * umgekehrten Link im Portal (portal-shell.tsx, "Zum Admin-Bereich").
 * `NODE_ENV`/`NEXT_PUBLIC_*` sind zur Build-Zeit inlined, deshalb hier auch
 * in dieser Client-Komponente sicher lesbar (kein Server-Only-Geheimnis).
 *
 * Bewusste, nicht-optische Abweichungen von der reinen Mockup-Datei:
 * - hrefs zeigen auf die echten App-Routen statt auf die *.dc.html-Dateien.
 * - Statt der quadratischen Punkt-Marker aus dem Referenz-Mockup werden
 *   echte lucide-Icons genutzt; sie erben die Item-Farbe (navy idle, weiß
 *   aktiv) über currentColor.
 * - Kein fest verdrahteter Zähler-Badge an „Benachrichtigungen" — es gibt
 *   (noch) keine notifications-Tabelle; ein Badge erscheint nur, wenn ein
 *   echter Wert übergeben wird (DESIGN-MASTERPROMPT.md §8.1, keine erfundenen
 *   Zahlen).
 *
 * `customLinks` NEU (23.07.2026, Josips Auftrag: admin-verwaltbarer "LINKS"-
 * Bereich, z. B. YouTube-Kanal/Terminbuchung) — Verwaltung in
 * `/admin/einstellungen` (sidebar-links-panel.tsx), Daten kommen aus
 * app-shell.tsx (dort geladen, nicht hier — Sidebar bleibt tenant-agnostisch/
 * reine Darstellungskomponente). Plain `<a target="_blank">` statt `next/link`,
 * da Ziele immer externe URLs sind, nie interne Routen. Abschnitt inkl.
 * Überschrift erscheint nur, wenn mindestens ein Link existiert.
 *
 * KONTO-Umbau (23.07.2026, Josips Folgeauftrag): "Einstellungen" und
 * "Benachrichtigungen" gibt es jetzt NICHT mehr als eigene Haupt-Nav-Punkte
 * hier — "Einstellungen" ist ins Profil-Dropdown gewandert (TopBar.tsx,
 * unter "Profil ansehen"), "Benachrichtigungen" ist ganz entfallen (bereits
 * im selben Profil-Dropdown vorhanden, hier redundant). Die "Konto"-
 * Überschrift sitzt jetzt stattdessen im Footer über Admin-Bereich/
 * Mandantenbereich — erscheint nur, wenn mindestens einer der beiden
 * sichtbar ist (sonst stünde eine leere Überschrift über "Hilfe & Kontakt",
 * das bewusst NICHT zu "Konto" zählt und für alle Rollen sichtbar bleibt).
 *
 * `variant` NEU (23.07.2026, Mobile-Umbau Lernansicht, Josips Auftrag) —
 * gleiches Muster wie `AdminSidebar.tsx`: "rail" (Standard) ist die
 * bisherige Schiene, jetzt zusätzlich `hidden lg:flex` (unter `lg` übernimmt
 * `LearnMobileNav` den Platz). "panel" rendert dieselbe Komponente
 * (identische Nav-Items/Badges/customLinks, keine zweite Datenquelle) als
 * Block fürs mobile Ausklapp-Panel: Wortmarke entfällt (die mobile
 * Kopfzeile zeigt ihr eigenes kompaktes Logo), der Ein-/Ausklapp-Button
 * entfällt (im Panel ergibt "einklappen" keinen Sinn), Labels sind IMMER
 * sichtbar unabhängig vom gespeicherten `expanded`-Zustand der Desktop-
 * Schiene (`showLabels`, ersetzt die bisherigen `expanded &&`-Stellen).
 *
 * `showCustomerArea` NEU (05.08.2026, "Meine Kunden Area", Plan
 * verwende-den-planungs-agenten-sequential-frost.md Abschnitt 5) — der
 * Menüpunkt erscheint nur, wenn für den angemeldeten Nutzer mindestens ein
 * sichtbares `customer_area_items`-Item existiert (gleiches Prinzip "keine
 * toten Links" wie bei `customLinks`). Default `false`: jeder Aufrufer ohne
 * dieses Prop verhält sich exakt wie zuvor.
 *
 * `showShiftCalendar` NEU (Schichtplan S1, 07.08.2026) — gleiches Prinzip
 * wie `showCustomerArea`: nur sichtbar, wenn der Mandant das Feature über
 * das Betreiber-Portal freigeschaltet hat UND der Nutzer eine eigene
 * `calendar_workers`-Zeile hat (Berechnung in app-shell.tsx). Default `false`.
 */
export type SidebarItemId = "dashboard" | "catalog" | "bookmarks" | "customerArea" | "shiftCalendar";

type NavItem = {
  id: SidebarItemId;
  labelKey: "navDashboardLabel" | "navBookmarksLabel" | "navCatalogLabel" | "navCustomerAreaLabel" | "navShiftCalendarLabel";
  href: string;
  badge?: string;
  icon: LucideIcon;
};

/** Admin-verwaltbarer "LINKS"-Bereich (Josips Auftrag, 23.07.2026) — siehe app-shell.tsx/sidebar-links-panel.tsx. */
export type SidebarLink = { id: string; label: string; url: string };

const LERNEN: NavItem[] = [
  { id: "dashboard", labelKey: "navDashboardLabel", href: "/dashboard", icon: LayoutGrid },
  { id: "bookmarks", labelKey: "navBookmarksLabel", href: "/lesezeichen", icon: Bookmark },
  { id: "catalog", labelKey: "navCatalogLabel", href: "/kurskatalog", icon: Search },
  { id: "customerArea", labelKey: "navCustomerAreaLabel", href: "/kunden-area", icon: Headset },
  { id: "shiftCalendar", labelKey: "navShiftCalendarLabel", href: "/schichtplan", icon: CalendarClock },
];

/** Leitet den aktiven Menüpunkt aus der Route ab (Semantik wie shell/nav-link.tsx). */
function activeFromPath(pathname: string): SidebarItemId | undefined {
  if (pathname === "/dashboard") return "dashboard";
  if (pathname === "/kurskatalog" || pathname.startsWith("/kurskatalog/")) return "catalog";
  if (pathname === "/lesezeichen" || pathname.startsWith("/lesezeichen/")) return "bookmarks";
  if (pathname === "/kunden-area" || pathname.startsWith("/kunden-area/")) return "customerArea";
  if (pathname === "/schichtplan" || pathname.startsWith("/schichtplan/")) return "shiftCalendar";
  return undefined;
}

export function Sidebar({
  active,
  isStaff = false,
  isPlatformAdmin = false,
  customLinks = [],
  showCustomerArea = false,
  showShiftCalendar = false,
  variant = "rail",
  tenantName = "Calltalent",
  logoUrl = null,
  showLegalLinks = false,
}: {
  active?: SidebarItemId;
  isStaff?: boolean;
  isPlatformAdmin?: boolean;
  customLinks?: SidebarLink[];
  /** Siehe Kopfkommentar oben — Default `false` erhält das bisherige Verhalten. */
  showCustomerArea?: boolean;
  /** Siehe Kopfkommentar oben — Default `false` erhält das bisherige Verhalten. */
  showShiftCalendar?: boolean;
  variant?: "rail" | "panel";
  /** Mandanten-Wortmarke/-Logo (26.07.2026, Josips Fund: "oben links kommt
   * das Logo von Calltalent statt von Projekt X"). Default bewahrt exakt das
   * bisherige Calltalent-Aussehen für Mandanten ohne eigenes Logo. */
  tenantName?: string;
  logoUrl?: string | null;
  /**
   * NEU (24.08.2026, Rechtsträger-Wechsel auf Calltalent LLC): zeigt im Fuß
   * die Links auf /privacy und /terms. Default `false` — die Seiten
   * antworten für Mandanten ohne hinterlegten Rechtsträger
   * (`tenants.legal.entity`) mit 404, ein Link dorthin wäre eine Sackgasse.
   */
  showLegalLinks?: boolean;
}) {
  const t = useTranslations("learn.shell");
  const tAuthShared = useTranslations("auth.shared");
  const tLegal = useTranslations("legal.shell");
  const [expanded, setExpanded] = useState(true);
  const pathname = usePathname();
  const activeId = active ?? activeFromPath(pathname);
  const isPanel = variant === "panel";
  const visibleLernen = LERNEN.filter(
    (item) =>
      (item.id !== "customerArea" || showCustomerArea) && (item.id !== "shiftCalendar" || showShiftCalendar),
  );
  // Im Panel (mobiles Ausklapp-Menü) sind Labels immer sichtbar — der
  // Ein-/Ausklapp-Zustand der Desktop-Schiene ist dort irrelevant.
  const showLabels = isPanel || expanded;

  const portalHost = process.env.NEXT_PUBLIC_PORTAL_HOST || "portal.localhost";
  const portalMandantenUrl =
    process.env.NODE_ENV !== "production"
      ? `http://${portalHost}:3000/portal/mandanten`
      : `https://${portalHost}/portal/mandanten`;

  function renderItem(item: NavItem) {
    const isActive = activeId === item.id;
    const Icon = item.icon;
    const label = t(item.labelKey);
    return (
      <Link
        key={item.id}
        href={item.href}
        prefetch={false}
        aria-current={isActive ? "page" : undefined}
        title={!showLabels ? label : undefined}
        className={[
          "mb-[3px] flex items-center gap-3 rounded-sm px-3 py-[11px] text-[15px] no-underline transition-colors",
          !showLabels ? "justify-center" : "",
          isActive
            ? "bg-primary font-bold text-white"
            : "font-medium text-navy hover:bg-[rgba(62,63,102,0.06)]",
        ].join(" ")}
      >
        <Icon size={20} aria-hidden="true" className="flex-shrink-0" />
        {showLabels && <span className="flex-1">{label}</span>}
        {showLabels && item.badge && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-[10px] bg-primary px-1.5 text-[11px] font-bold text-white">
            {item.badge}
          </span>
        )}
      </Link>
    );
  }

  /** Externe Links (YouTube, Terminbuchung, …) — kein `next/link`, da Ziel nie eine interne Route ist. */
  function renderCustomLink(link: SidebarLink) {
    return (
      <a
        key={link.id}
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        title={!showLabels ? link.label : undefined}
        className={[
          "mb-[3px] flex items-center gap-3 rounded-sm px-3 py-[11px] text-[15px] font-medium text-navy no-underline transition-colors hover:bg-[rgba(62,63,102,0.06)]",
          !showLabels ? "justify-center" : "",
        ].join(" ")}
      >
        <ExternalLink size={20} aria-hidden="true" className="flex-shrink-0" />
        {showLabels && <span className="flex-1">{link.label}</span>}
      </a>
    );
  }

  return (
    <aside
      className={
        isPanel
          ? "flex w-full flex-shrink-0 flex-col bg-white py-[14px] font-sans"
          : "hidden flex-shrink-0 flex-col border-r border-border-100 bg-white py-[26px] font-sans transition-[width] duration-[180ms] ease-out lg:sticky lg:top-0 lg:flex lg:h-screen"
      }
      style={{ width: isPanel ? "100%" : expanded ? "264px" : "84px" }}
      aria-label={t("mainNavAriaLabel")}
    >
      {!isPanel && (
        <>
          {/* Wortmarke + Logomarke.
              BUGFIX (26.07.2026, Josips Fund: "Logo links oben wird nicht
              richtig angezeigt"): erzwang bisher IMMER ein 34×34-Quadrat mit
              `object-cover` — passend für ein reines Icon (wie Calltalents
              eigenes "C"), aber ein hochgeladenes Mandanten-Logo ist meist
              ein VOLLES, breites Icon+Wortmarke-Lockup (bei Projekt X
              2280×660px). `object-cover` in einem Quadrat schneidet davon
              nur einen schmalen, meist unlesbaren Mittelstreifen aus (sah
              wie abgeschnittener Text "PROJ" aus) — UND daneben stand
              zusätzlich noch einmal redundant der Mandantenname als Text,
              obwohl das Logo ihn oft schon selbst enthält. Jetzt: im
              ausgeklappten Zustand zeigt ein eigenes Logo die volle Breite
              per `object-contain` (keine Beschneidung) OHNE den redundanten
              Text daneben; im eingeklappten Zustand (nur 84px, kein Platz
              für ein breites Logo) bleibt es bei der Initiale im Quadrat —
              exakt wie zuvor, unabhängig vom Logo. */}
          <Link
            href="/dashboard"
            prefetch={false}
            className="mb-[30px] flex min-h-[34px] items-center gap-3 px-[22px] no-underline"
          >
            {logoUrl && expanded ? (
              // eslint-disable-next-line @next/next/no-img-element -- Storage-URL, kein next/image-Loader konfiguriert
              <img
                src={logoUrl}
                alt={tenantName}
                className="h-[34px] w-auto max-w-[190px] flex-shrink-0 object-contain object-left"
              />
            ) : (
              <span
                className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-[9px] bg-primary text-[18px] font-extrabold text-cream"
                aria-hidden="true"
              >
                {tenantName.charAt(0).toUpperCase()}
              </span>
            )}
            {expanded && !logoUrl && (
              <span className="min-w-0 leading-[1.15]">
                <span className="block truncate text-[15px] font-extrabold tracking-[0.02em] text-ink">
                  {tenantName.toUpperCase()}
                </span>
                <span className="block text-[11px] font-semibold tracking-[0.28em] text-muted-500">
                  {tAuthShared("brandSuffix")}
                </span>
              </span>
            )}
          </Link>

          {/* Such-Button = Ein-/Ausklappen (wie in der Referenz) — nur auf der
              Desktop-Schiene, im mobilen Panel ergibt Einklappen keinen Sinn. */}
          <div className="mb-[26px] px-4">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              aria-label={expanded ? t("collapseLabel") : t("expandLabel")}
              className={`flex w-full items-center gap-3 rounded-sm border border-border-100 bg-bg px-[13px] py-[11px] text-[15px] text-muted-500 ${
                expanded ? "" : "justify-center"
              }`}
            >
              <Search size={19} aria-hidden="true" className="flex-shrink-0 text-accent" />
              {expanded && <span>{t("searchButton")}</span>}
            </button>
          </div>
        </>
      )}

      {/* Navigation */}
      {/* min-h-0: gleicher Fix wie AdminSidebar.tsx (Josips Fund "Footer der
          Sidebar abgeschnitten") — ohne das wächst dieses Flex-Kind bei
          vielen admin-verwaltbaren Zusatzlinks (customLinks) über die feste
          h-screen-Höhe des <aside> hinaus und drückt den Footer darunter aus
          dem sichtbaren Bereich. Im Panel gibt es keine feste Höhe (der
          Aufrufer begrenzt stattdessen per `max-h-[..vh] overflow-y-auto`). */}
      <nav className={isPanel ? "px-4" : "min-h-0 flex-1 overflow-hidden px-4"}>
        {showLabels && (
          <p className="mb-[9px] px-3 text-[11px] font-bold uppercase tracking-[0.18em] text-muted-400">
            {t("navLernenLabel")}
          </p>
        )}
        {visibleLernen.map(renderItem)}

        {customLinks.length > 0 && (
          <>
            <div className="h-5" />
            {showLabels && (
              <p className="mb-[9px] px-3 text-[11px] font-bold uppercase tracking-[0.18em] text-muted-400">
                {t("navLinksLabel")}
              </p>
            )}
            {customLinks.map(renderCustomLink)}
          </>
        )}
      </nav>

      {/* Footer: "Konto" (Admin-Zugang nur Staff + Mandantenbereich nur Plattform-Admin) + Hilfe & Kontakt */}
      <div className="mt-4 flex flex-col gap-1 border-t border-border-100 px-4 pt-4">
        {(isStaff || isPlatformAdmin) && (
          <>
            {showLabels && (
              <p className="mb-[9px] px-3 text-[11px] font-bold uppercase tracking-[0.18em] text-muted-400">
                {t("navAccountLabel")}
              </p>
            )}
            {isStaff && (
              <a
                href="/admin"
                title={!showLabels ? t("navAdminAreaLabel") : undefined}
                className={`flex items-center gap-3 rounded-sm px-3 py-[10px] text-[15px] font-medium text-muted-500 no-underline ${
                  showLabels ? "" : "justify-center"
                }`}
              >
                <ShieldCheck size={19} aria-hidden="true" className="flex-shrink-0" />
                {showLabels && <span>{t("navAdminAreaLabel")}</span>}
              </a>
            )}
            {isPlatformAdmin && (
              <a
                href={portalMandantenUrl}
                title={!showLabels ? t("navTenantAreaLabel") : undefined}
                className={`flex items-center gap-3 rounded-sm px-3 py-[10px] text-[15px] font-medium text-muted-500 no-underline ${
                  showLabels ? "" : "justify-center"
                }`}
              >
                <Building2 size={19} aria-hidden="true" className="flex-shrink-0" />
                {showLabels && <span>{t("navTenantAreaLabel")}</span>}
              </a>
            )}
          </>
        )}
        <a
          href="mailto:support@calltalent.ai"
          title={!showLabels ? t("navHelpContact") : undefined}
          className={`flex items-center gap-3 rounded-sm px-3 py-[10px] text-[15px] font-medium text-muted-500 no-underline ${
            showLabels ? "" : "justify-center"
          }`}
        >
          <HelpCircle size={19} aria-hidden="true" className="flex-shrink-0" />
          {showLabels && <span>{t("navHelpContact")}</span>}
        </a>
        {showLegalLinks && showLabels && (
          <nav aria-label={tLegal("navLabel")} className="flex flex-wrap gap-x-3 gap-y-1 px-3 pt-2 text-[13px]">
            <a href="/privacy" className="font-semibold text-muted-400 no-underline">
              {tLegal("navPrivacy")}
            </a>
            <a href="/terms" className="font-semibold text-muted-400 no-underline">
              {tLegal("navTerms")}
            </a>
            <a href="/legal-notice" className="font-semibold text-muted-400 no-underline">
              {tLegal("navNotice")}
            </a>
          </nav>
        )}
      </div>
    </aside>
  );
}
