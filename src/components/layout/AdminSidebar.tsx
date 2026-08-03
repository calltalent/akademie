"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  BookOpen,
  Sparkles,
  ClipboardCheck,
  Package,
  BarChart3,
  CreditCard,
  Users,
  Upload,
  Building2,
  Settings,
  GraduationCap,
  LogOut,
  type LucideIcon,
} from "lucide-react";

/**
 * Admin-Sidebar — Portierung aus dem Referenzdesign „Calltalent-Akademie
 * Studenten-Portal/AdminSidebar.dc.html". Dunkles Indigo-Schema (#3E3F66),
 * Creme-Pille als aktiver Zustand. Aufbau/Farben/Radien aus dem Referenz-
 * HTML; markenweite Werte über Tokens (accent, cream), die dunklen Grautöne
 * (#DDDEEE/#B9BBDA/#8688B8) inline, da nicht im Token-Set.
 *
 * Der aktive Menüpunkt wird standardmäßig aus der Route (`usePathname`)
 * abgeleitet; das optionale `active`-Prop (wie in AdminSidebar.dc.html)
 * übersteuert bei Bedarf. Wie die produktive learn/sidebar.tsx werden echte
 * lucide-Icons statt der Punkt-Platzhalter genutzt (konsistent mit
 * admin-shell.tsx).
 *
 * Über den minimalen Referenz-Umfang hinaus enthält die Nav die vier real
 * funktionierenden Bereiche KI-Generator, Reporting, Zahlungen und Import
 * (wie zuvor in admin-shell.tsx), damit die Einbindung keinen Funktions-
 * verlust bedeutet. „Abmelden" ist ebenfalls ergänzt (echte Funktion, im
 * Mockup nicht vorhanden).
 *
 * `prefetch={false}` NEU (21.07.2026, Josips Fund: Login/Navigation fühlt
 * sich langsam an — siehe ausführliche Begründung in components/shell/
 * nav-link.tsx). Diese Sidebar hat mit bis zu 10 gleichzeitig sichtbaren
 * Einträgen (Dashboard/Kurse/KI-Generator/Abgaben/Produkte/Reporting/
 * Zahlungen/Teilnehmer/Import/Mandanten/Einstellungen) den größten
 * Prefetch-Multiplikator im ganzen Projekt — 10 automatische Hintergrund-
 * Requests (jeder mit echtem `getUser()`-Rundlauf zu Supabase) auf JEDER
 * Admin-Seite, ohne dass sie je geklickt werden.
 *
 * Zugriff/Rollen: Die Sidebar ist reines UI — der /admin-Bereich ist bereits
 * über `checkStaffAccess()` in admin/layout.tsx (owner/admin/trainer) gated,
 * die zugrundeliegenden Daten zusätzlich per RLS. „Mandanten" (Betreiber-
 * Portal) erscheint nur bei `isPlatformAdmin` — die Mandanten-Verwaltung
 * bleibt exklusiv Plattform-Admins (Sicherheitsgrenze, wie in admin-shell.tsx
 * dokumentiert). Das Abgaben-Badge zeigt die echte Zahl offener Abgaben.
 *
 * `variant` NEU (23.07.2026, Mobile-Umbau Admin-Bereich, Josips Auftrag):
 * "rail" (Standard) ist die bisherige feste Desktop-Schiene, jetzt zusätzlich
 * `hidden lg:flex` — unter `lg` (1024px) unsichtbar, weil `AdminMobileNav`
 * (neue Datei, Kopfzeile mit Hamburger) diesen Platz übernimmt. "panel"
 * rendert dieselbe Komponente (identische Gruppen/Badges/Aktiv-Logik, keine
 * zweite Nav-Datenquelle) als normalen Block statt fixer Schiene, für das
 * Ausklapp-Panel von `AdminMobileNav` — Wortmarke/"VERWALTUNG"-Label
 * entfallen dort, weil die mobile Kopfzeile ihr eigenes kompaktes Logo zeigt.
 */
export type AdminSidebarItemId =
  | "overview"
  | "courses"
  | "ki"
  | "submissions"
  | "products"
  | "reporting"
  | "payments"
  | "members"
  | "import"
  | "tenants"
  | "settings";

type AdminNavItem = {
  id: AdminSidebarItemId;
  label: string;
  href: string;
  icon: LucideIcon;
  /** Nur für Plattform-Admins sichtbar (Betreiber-Portal). */
  platformOnly?: boolean;
};

const GROUPS: { title: string; items: AdminNavItem[] }[] = [
  { title: "Übersicht", items: [{ id: "overview", label: "Dashboard", href: "/admin", icon: LayoutDashboard }] },
  {
    title: "Inhalte",
    items: [
      { id: "courses", label: "Kurse", href: "/admin/kurse", icon: BookOpen },
      { id: "ki", label: "KI-Generator", href: "/admin/ki", icon: Sparkles },
      { id: "submissions", label: "Abgaben", href: "/admin/abgaben", icon: ClipboardCheck },
      { id: "products", label: "Produkte", href: "/admin/produkte", icon: Package },
    ],
  },
  {
    title: "Auswertung",
    items: [
      { id: "reporting", label: "Reporting", href: "/admin/reporting", icon: BarChart3 },
      { id: "payments", label: "Zahlungen", href: "/admin/zahlungen", icon: CreditCard },
    ],
  },
  {
    title: "Nutzer",
    items: [
      { id: "members", label: "Teilnehmer", href: "/admin/teilnehmer", icon: Users },
      { id: "import", label: "Import", href: "/admin/import", icon: Upload },
    ],
  },
  {
    title: "Plattform",
    items: [
      { id: "tenants", label: "Mandanten", href: "/portal/mandanten", icon: Building2, platformOnly: true },
      { id: "settings", label: "Einstellungen", href: "/admin/einstellungen", icon: Settings },
    ],
  },
];

/** Leitet den aktiven Menüpunkt aus der Route ab. */
function activeFromPath(pathname: string): AdminSidebarItemId | undefined {
  if (pathname === "/admin") return "overview";
  if (pathname.startsWith("/admin/kurse")) return "courses";
  if (pathname.startsWith("/admin/ki")) return "ki";
  if (pathname.startsWith("/admin/abgaben")) return "submissions";
  if (pathname.startsWith("/admin/produkte")) return "products";
  if (pathname.startsWith("/admin/reporting")) return "reporting";
  if (pathname.startsWith("/admin/zahlungen")) return "payments";
  if (pathname.startsWith("/admin/teilnehmer")) return "members";
  if (pathname.startsWith("/admin/import")) return "import";
  if (pathname.startsWith("/portal/mandanten")) return "tenants";
  if (pathname.startsWith("/admin/einstellungen")) return "settings";
  return undefined;
}

export function AdminSidebar({
  active,
  isPlatformAdmin = false,
  pendingSubmissions = 0,
  variant = "rail",
  tenantName = "Calltalent",
  logoUrl = null,
}: {
  active?: AdminSidebarItemId;
  isPlatformAdmin?: boolean;
  pendingSubmissions?: number;
  variant?: "rail" | "panel";
  /** Mandanten-Wortmarke/-Logo (03.08.2026, Josips Fund: "Logo im Admin-
   * Bereich ist immer noch Calltalent") — gleiches Muster wie Sidebar.tsx
   * (26.07.2026). Default bewahrt das bisherige Calltalent-Aussehen für
   * Mandanten ohne eigenes Logo. */
  tenantName?: string;
  logoUrl?: string | null;
}) {
  const pathname = usePathname();
  const activeId = active ?? activeFromPath(pathname);

  function renderItem(item: AdminNavItem) {
    const isActive = activeId === item.id;
    const Icon = item.icon;
    const badge =
      item.id === "submissions" && pendingSubmissions > 0 ? String(pendingSubmissions) : undefined;
    return (
      <Link
        key={item.id}
        href={item.href}
        prefetch={false}
        aria-current={isActive ? "page" : undefined}
        className="mb-[3px] flex items-center gap-3 rounded-sm px-3 py-[11px] text-[15px] no-underline transition-colors"
        style={
          isActive
            ? { background: "#F7EED4", color: "#1A1A2E", fontWeight: 700 }
            : { color: "#DDDEEE", fontWeight: 500 }
        }
      >
        <Icon size={18} aria-hidden="true" className="flex-shrink-0" />
        <span className="flex-1">{item.label}</span>
        {badge && (
          <span
            className="flex h-5 min-w-5 items-center justify-center rounded-[10px] px-1.5 text-[11px] font-bold"
            // Creme-Badge auf dunklem Grund; auf der aktiven Creme-Pille wäre
            // Creme unsichtbar → dort Accent-Füllung.
            style={isActive ? { background: "#5663AE", color: "#fff" } : { background: "#F7EED4", color: "#1A1A2E" }}
          >
            {badge}
          </span>
        )}
      </Link>
    );
  }

  return (
    <aside
      className={
        variant === "panel"
          ? "flex w-full flex-shrink-0 flex-col py-[10px] font-sans"
          : "hidden flex-shrink-0 flex-col py-[26px] font-sans lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-[264px]"
      }
      style={{ background: "#3E3F66" }}
      aria-label="Verwaltungs-Navigation"
    >
      {variant === "rail" && (
        <>
          {/* Wortmarke */}
          <Link href="/admin" prefetch={false} className="mb-2 flex min-h-[34px] items-center gap-3 px-[22px] no-underline">
            {logoUrl ? (
              // Weiße Kachel wie login-form.tsx/kontakt-form.tsx: ein Logo mit
              // dunklem Text/Icon wäre auf dem dunklen Marken-Panel sonst kaum
              // lesbar (gleicher Fund wie dort, siehe Kopfkommentar).
              <div className="flex h-[34px] flex-none items-center rounded-[8px] bg-white px-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- Storage-URL, kein next/image-Loader konfiguriert */}
                <img
                  src={logoUrl}
                  alt={tenantName}
                  className="h-[22px] w-auto max-w-[170px] object-contain"
                />
              </div>
            ) : (
              <>
                <span
                  className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-[9px] bg-accent text-[18px] font-extrabold text-cream"
                  aria-hidden="true"
                >
                  {tenantName.charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 leading-[1.15]">
                  <span className="block truncate text-[15px] font-extrabold tracking-[0.02em] text-white">
                    {tenantName.toUpperCase()}
                  </span>
                  <span className="block text-[11px] font-semibold" style={{ color: "#B9BBDA", letterSpacing: "0.24em" }}>
                    ADMIN
                  </span>
                </span>
              </>
            )}
          </Link>

          <div
            className="mx-[22px] mb-6 inline-block self-start rounded-[8px] px-2.5 py-1.5 text-[11px] font-bold"
            style={{ letterSpacing: "0.14em", color: "#8688B8", background: "rgba(255,255,255,0.08)" }}
          >
            VERWALTUNG
          </div>
        </>
      )}

      {/* Navigation */}
      {/* BUGFIX (23.07.2026, Josips Fund: "Footer der Sidebar abgeschnitten"):
          `min-h-0` fehlte — ohne das ignoriert ein Flex-Kind mit `flex-1` +
          `overflow-y-auto` sein `overflow` und wächst über die feste
          `h-screen`-Höhe des <aside> hinaus (Flexbox-Standard: `min-height`
          eines Flex-Kinds ist `auto`, nicht `0`), drückt dadurch den darunter
          liegenden Footer ("Zur Lernansicht"/"Abmelden") aus dem sichtbaren
          Bereich, statt selbst intern zu scrollen. */}
      <nav className="min-h-0 flex-1 overflow-y-auto px-4">
        {GROUPS.map((group) => {
          const items = group.items.filter((i) => !i.platformOnly || isPlatformAdmin);
          if (items.length === 0) return null;
          return (
            <div key={group.title}>
              <p
                className="mb-[9px] mt-[14px] px-3 text-[11px] font-bold uppercase tracking-[0.18em] first:mt-0"
                style={{ color: "#8688B8" }}
              >
                {group.title}
              </p>
              {items.map(renderItem)}
            </div>
          );
        })}
      </nav>

      {/* Footer: Zur Lernansicht + Abmelden */}
      <div
        className="mt-4 flex flex-col gap-1 px-4 pt-4"
        style={{ borderTop: "1px solid rgba(255,255,255,0.12)" }}
      >
        <Link
          href="/dashboard"
          prefetch={false}
          className="flex items-center gap-3 rounded-sm px-3 py-[10px] text-sm font-medium no-underline"
          style={{ color: "#B9BBDA" }}
        >
          <GraduationCap size={18} aria-hidden="true" className="flex-shrink-0" />
          Zur Lernansicht
        </Link>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-sm px-3 py-[10px] text-sm font-medium"
            style={{ color: "#B9BBDA" }}
          >
            <LogOut size={18} aria-hidden="true" className="flex-shrink-0" />
            Abmelden
          </button>
        </form>
      </div>
    </aside>
  );
}
