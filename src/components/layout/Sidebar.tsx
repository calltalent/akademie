"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Search,
  HelpCircle,
  LayoutGrid,
  Bookmark,
  ShieldCheck,
  Building2,
  ExternalLink,
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
 */
export type SidebarItemId = "dashboard" | "catalog" | "bookmarks";

type NavItem = { id: SidebarItemId; label: string; href: string; badge?: string; icon: LucideIcon };

/** Admin-verwaltbarer "LINKS"-Bereich (Josips Auftrag, 23.07.2026) — siehe app-shell.tsx/sidebar-links-panel.tsx. */
export type SidebarLink = { id: string; label: string; url: string };

const LERNEN: NavItem[] = [
  { id: "dashboard", label: "Meine Kurse", href: "/dashboard", icon: LayoutGrid },
  { id: "catalog", label: "Kurskatalog", href: "/kurskatalog", icon: Search },
  { id: "bookmarks", label: "Lesezeichen", href: "/lesezeichen", icon: Bookmark },
];

/** Leitet den aktiven Menüpunkt aus der Route ab (Semantik wie shell/nav-link.tsx). */
function activeFromPath(pathname: string): SidebarItemId | undefined {
  if (pathname === "/dashboard") return "dashboard";
  if (pathname === "/kurskatalog" || pathname.startsWith("/kurskatalog/")) return "catalog";
  if (pathname === "/lesezeichen" || pathname.startsWith("/lesezeichen/")) return "bookmarks";
  return undefined;
}

export function Sidebar({
  active,
  isStaff = false,
  isPlatformAdmin = false,
  customLinks = [],
}: {
  active?: SidebarItemId;
  isStaff?: boolean;
  isPlatformAdmin?: boolean;
  customLinks?: SidebarLink[];
}) {
  const [expanded, setExpanded] = useState(true);
  const pathname = usePathname();
  const activeId = active ?? activeFromPath(pathname);

  const portalHost = process.env.NEXT_PUBLIC_PORTAL_HOST || "portal.localhost";
  const portalMandantenUrl =
    process.env.NODE_ENV !== "production"
      ? `http://${portalHost}:3000/portal/mandanten`
      : `https://${portalHost}/portal/mandanten`;

  function renderItem(item: NavItem) {
    const isActive = activeId === item.id;
    const Icon = item.icon;
    return (
      <Link
        key={item.id}
        href={item.href}
        prefetch={false}
        aria-current={isActive ? "page" : undefined}
        title={!expanded ? item.label : undefined}
        className={[
          "mb-[3px] flex items-center gap-3 rounded-sm px-3 py-[11px] text-[15px] no-underline transition-colors",
          !expanded ? "justify-center" : "",
          isActive
            ? "bg-accent font-bold text-white"
            : "font-medium text-navy hover:bg-[rgba(62,63,102,0.06)]",
        ].join(" ")}
      >
        <Icon size={20} aria-hidden="true" className="flex-shrink-0" />
        {expanded && <span className="flex-1">{item.label}</span>}
        {expanded && item.badge && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-[10px] bg-accent px-1.5 text-[11px] font-bold text-white">
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
        title={!expanded ? link.label : undefined}
        className={[
          "mb-[3px] flex items-center gap-3 rounded-sm px-3 py-[11px] text-[15px] font-medium text-navy no-underline transition-colors hover:bg-[rgba(62,63,102,0.06)]",
          !expanded ? "justify-center" : "",
        ].join(" ")}
      >
        <ExternalLink size={20} aria-hidden="true" className="flex-shrink-0" />
        {expanded && <span className="flex-1">{link.label}</span>}
      </a>
    );
  }

  return (
    <aside
      className="sticky top-0 flex h-screen flex-shrink-0 flex-col border-r border-border-100 bg-white py-[26px] font-sans transition-[width] duration-[180ms] ease-out"
      style={{ width: expanded ? "264px" : "84px" }}
      aria-label="Hauptnavigation"
    >
      {/* Wortmarke + Logomarke */}
      <Link
        href="/dashboard"
        prefetch={false}
        className="mb-[30px] flex min-h-[34px] items-center gap-3 px-[22px] no-underline"
      >
        <span
          className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-[9px] bg-accent text-[18px] font-extrabold text-cream"
          aria-hidden="true"
        >
          C
        </span>
        {expanded && (
          <span className="leading-[1.15]">
            <span className="block text-[15px] font-extrabold tracking-[0.02em] text-ink">
              CALLTALENT
            </span>
            <span className="block text-[11px] font-semibold tracking-[0.28em] text-muted-500">
              AKADEMIE
            </span>
          </span>
        )}
      </Link>

      {/* Such-Button = Ein-/Ausklappen (wie in der Referenz) */}
      <div className="mb-[26px] px-4">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? "Sidebar einklappen" : "Sidebar ausklappen"}
          className={`flex w-full items-center gap-3 rounded-sm border border-border-100 bg-bg px-[13px] py-[11px] text-[15px] text-muted-500 ${
            expanded ? "" : "justify-center"
          }`}
        >
          <Search size={19} aria-hidden="true" className="flex-shrink-0 text-accent" />
          {expanded && <span>Suchen …</span>}
        </button>
      </div>

      {/* Navigation */}
      {/* min-h-0: gleicher Fix wie AdminSidebar.tsx (Josips Fund "Footer der
          Sidebar abgeschnitten") — ohne das wächst dieses Flex-Kind bei
          vielen admin-verwaltbaren Zusatzlinks (customLinks) über die feste
          h-screen-Höhe des <aside> hinaus und drückt den Footer darunter aus
          dem sichtbaren Bereich. */}
      <nav className="min-h-0 flex-1 overflow-hidden px-4">
        {expanded && (
          <p className="mb-[9px] px-3 text-[11px] font-bold uppercase tracking-[0.18em] text-muted-400">
            Lernen
          </p>
        )}
        {LERNEN.map(renderItem)}

        {customLinks.length > 0 && (
          <>
            <div className="h-5" />
            {expanded && (
              <p className="mb-[9px] px-3 text-[11px] font-bold uppercase tracking-[0.18em] text-muted-400">
                Links
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
            {expanded && (
              <p className="mb-[9px] px-3 text-[11px] font-bold uppercase tracking-[0.18em] text-muted-400">
                Konto
              </p>
            )}
            {isStaff && (
              <a
                href="/admin"
                title={!expanded ? "Admin-Bereich" : undefined}
                className={`flex items-center gap-3 rounded-sm px-3 py-[10px] text-[15px] font-medium text-muted-500 no-underline ${
                  expanded ? "" : "justify-center"
                }`}
              >
                <ShieldCheck size={19} aria-hidden="true" className="flex-shrink-0" />
                {expanded && <span>Admin-Bereich</span>}
              </a>
            )}
            {isPlatformAdmin && (
              <a
                href={portalMandantenUrl}
                title={!expanded ? "Mandantenbereich" : undefined}
                className={`flex items-center gap-3 rounded-sm px-3 py-[10px] text-[15px] font-medium text-muted-500 no-underline ${
                  expanded ? "" : "justify-center"
                }`}
              >
                <Building2 size={19} aria-hidden="true" className="flex-shrink-0" />
                {expanded && <span>Mandantenbereich</span>}
              </a>
            )}
          </>
        )}
        <a
          href="mailto:support@calltalent.ai"
          title={!expanded ? "Hilfe & Kontakt" : undefined}
          className={`flex items-center gap-3 rounded-sm px-3 py-[10px] text-[15px] font-medium text-muted-500 no-underline ${
            expanded ? "" : "justify-center"
          }`}
        >
          <HelpCircle size={19} aria-hidden="true" className="flex-shrink-0" />
          {expanded && <span>Hilfe &amp; Kontakt</span>}
        </a>
      </div>
    </aside>
  );
}
