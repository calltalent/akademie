"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, ChevronDown } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";

/**
 * Layout-Kopfzeile — 1:1-Portierung aus dem Referenzdesign
 * „Calltalent-Akademie Studenten-Portal/TopBar.dc.html". Struktur, Farben,
 * Abstände und Radien sind exakt aus dem Referenz-HTML übernommen; alle
 * Farb-/Radius-Werte laufen über die Prompt-1-Tokens (globals.css @theme):
 * bg #F4F5FA, ink #1A1A2E, navy #3E3F66, accent #5663AE, cream #F7EED4,
 * border-100 #E7E8F2, muted-400 #A9AAC4, muted-500 #66679B sowie
 * rounded-md=12px sowie rounded-xl=16px. Nicht-Token-Einzelwerte der
 * Dropdowns (#EEF0F7, #F2F3F9, #EEF0FA, #B24343) bleiben als arbitrary
 * Tailwind-Werte erhalten, da sie im Token-Set nicht vorgesehen sind.
 *
 * `breadcrumb` und `title` sind Props (wie die data-props in TopBar.dc.html).
 * `user` und `notifications` sind optionale Props mit Referenz-Werten als
 * Default (Standalone-Vorschau rendert pixelgleich). In Produktion übergibt
 * app-shell.tsx den echten Nutzer und `notifications={[]}` — bei leerer Liste
 * erscheinen weder Badge noch erfundene Einträge, sondern ein ehrlicher
 * Leerzustand (DESIGN-MASTERPROMPT.md §8.1). Die Dropdown-Mechanik (öffnen,
 * gegenseitiges Schließen, Klick-außerhalb) ist "use client".
 *
 * Bewusste, nicht-optische Abweichung: „Abmelden" nutzt das echte
 * Signout-Form (/auth/signout) statt des Mock-Links auf Login.dc.html.
 *
 * Mobile-Umbau (23.07.2026, Josips Auftrag): Gutter `px-10 py-5` gilt jetzt
 * erst ab `lg`, mobil `px-4 py-4`. Die beiden Dropdown-Panels waren fest
 * `absolute right-0 w-[360px]`/`w-[250px]` — relativ zum jeweiligen (kleinen)
 * Trigger-Button positioniert. Beim Benachrichtigungen-Button (NICHT das
 * äußerste rechte Element, das Profil-Icon sitzt weiter rechts daneben)
 * führte eine einfache Breitenkappung (`w-[calc(100vw-2rem)]`) dazu, dass
 * das Panel über den LINKEN Rand hinausragte (live geprüft: `right:0`
 * relativ zu einem Anker, der selbst schon links der Viewport-Kante sitzt,
 * plus fast Viewport-Breite = negativer `left`-Wert).
 *
 * Fix: unter `lg` `fixed inset-x-4` (Panel-Breite hängt vom VIEWPORT ab,
 * nicht vom Trigger-Button — kein Overflow in keine Richtung mehr) UND ein
 * per `ResizeObserver` gemessenes `headerHeight` für die `top`-Position
 * (`useIsMobile()`-gated Inline-Style, NUR unter `lg` gesetzt, sonst
 * `undefined` und die `lg:top-14`-Klasse greift unverändert). Ein fester
 * `top-16`-Wert reichte NICHT: die Kopfzeile ist je nach Seite/Namenslänge
 * unterschiedlich hoch (live geprüft: "Willkommen zurück, …" kann auf
 * schmalen Bildschirmen mehrzeilig umbrechen, Header dann bis zu 192px statt
 * der angenommenen ~64px) — ein statischer Wert hätte das Panel auf manchen
 * Seiten über den unteren Header-Rand hinweg gezeichnet. Ab `lg` bleibt exakt
 * das ursprüngliche `absolute right-0 w-[...]`-Verhalten (keine optische
 * Änderung am Desktop).
 */
type NotificationItem = { text: string; time: string };

const DEFAULT_USER = {
  name: "Jonas Weber",
  role: "Kursteilnehmer",
  email: "jonas.weber@email.de",
};

const DEFAULT_NOTIFICATIONS: NotificationItem[] = [
  { text: 'Neue Lektion in „Einwandbehandlung am Telefon" verfügbar.', time: "vor 2 Std." },
  { text: 'Dein Feedback zur Abgabe „Rollenspiel 3" ist da.', time: "vor 5 Std." },
  { text: "Live-Q&A mit dem Coach startet morgen um 18:00 Uhr.", time: "gestern" },
];

export function TopBar({
  breadcrumb,
  title,
  user = DEFAULT_USER,
  notifications = DEFAULT_NOTIFICATIONS,
}: {
  breadcrumb: string;
  title: string;
  user?: { name: string; role?: string; email?: string };
  notifications?: NotificationItem[];
}) {
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const isMobile = useIsMobile();

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  // Header-Position für die mobile Dropdown-Platzierung wird ERST beim
  // Öffnen gemessen (in den beiden onClick-Handlern unten).
  //
  // BUGFIX 1 (live geprüft): `entries[0].contentRect.height` (ResizeObserver)
  // misst die CONTENT-Box ohne Padding — der Header hat `py-4` (32px),
  // `getBoundingClientRect()` liefert dagegen die tatsächlich sichtbare
  // Border-Box-Höhe.
  //
  // BUGFIX 2 (live geprüft, der eigentliche Fund): `.height` allein reicht
  // NICHT — unter `lg` steht `LearnMobileNav`/`AdminMobileNav` (Logo +
  // Hamburger, eigene ~65px hohe Leiste) VOR diesem Header im normalen
  // Fluss, der Header selbst beginnt also nicht bei `y=0`. Ein `fixed`
  // positioniertes Panel braucht die Position relativ zum VIEWPORT —
  // `.bottom` (= tatsächliche Y-Position des Header-Endes im Viewport)
  // statt `.height` (das die vorangehende Leiste komplett ignoriert und das
  // Panel dadurch permanent zu weit oben platzierte, mitten im Header).
  function measureHeaderHeight(): number {
    return (headerRef.current?.getBoundingClientRect().bottom ?? 0) + 8;
  }

  const mobileDropdownTop = isMobile ? headerHeight : undefined;

  const unread = notifications.length;

  return (
    <header
      ref={headerRef}
      className="sticky top-0 z-20 flex items-center gap-[18px] bg-bg px-4 py-4 font-sans lg:px-10 lg:py-5"
    >
      {/* Breadcrumb + Titel */}
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold tracking-[0.02em] text-muted-400">{breadcrumb}</p>
        <h1 className="mt-0.5 text-[20px] font-extrabold tracking-[-0.01em] text-ink lg:text-[26px]">{title}</h1>
      </div>

      {/* Benachrichtigungen */}
      <div className="relative flex-shrink-0" ref={notifRef}>
        <button
          type="button"
          onClick={() => {
            if (!notifOpen) setHeaderHeight(measureHeaderHeight());
            setNotifOpen((v) => !v);
            setProfileOpen(false);
          }}
          aria-expanded={notifOpen}
          aria-haspopup="true"
          aria-label="Benachrichtigungen"
          className="relative flex h-[46px] w-[46px] items-center justify-center rounded-md border border-border-100 bg-white"
        >
          <Bell size={21} aria-hidden="true" className="text-navy" />
          {unread > 0 && (
            <span className="absolute right-2 top-2 flex h-[17px] min-w-[17px] items-center justify-center rounded-[9px] border-2 border-white bg-accent px-1 text-[10px] font-bold text-white">
              {unread}
            </span>
          )}
        </button>
        {notifOpen && (
          <div
            className="fixed inset-x-4 z-30 overflow-hidden rounded-xl border border-border-100 bg-white shadow-[0_18px_44px_rgba(26,26,46,0.16)] lg:absolute lg:inset-x-auto lg:right-0 lg:top-14 lg:w-[360px]"
            style={{ top: mobileDropdownTop }}
            role="menu"
          >
            <div className="flex items-center justify-between px-[18px] pb-3 pt-4">
              <span className="text-[16px] font-bold text-ink">Benachrichtigungen</span>
              {unread > 0 && (
                <button type="button" className="text-[13px] font-semibold text-accent">
                  Alle gelesen
                </button>
              )}
            </div>
            {unread === 0 ? (
              <div className="border-t border-[#EEF0F7] px-[18px] py-10 text-center text-sm text-muted-400">
                Noch keine Benachrichtigungen.
              </div>
            ) : (
              <>
                <div className="flex gap-1.5 border-b border-[#EEF0F7] px-[18px] pb-3">
                  <span className="border-b-2 border-accent pb-2 text-sm font-bold text-accent">Ungelesen</span>
                  <span className="px-2 pb-2 text-sm font-medium text-muted-400">Gelesen</span>
                </div>
                <div className="max-h-[320px] overflow-auto">
                  {notifications.map((n, i) => (
                    <div
                      key={i}
                      className="flex gap-[13px] border-b border-[#F2F3F9] px-[18px] py-[14px]"
                    >
                      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] bg-[#EEF0FA]">
                        <span className="h-[15px] w-[15px] rounded-[4px] bg-accent" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-medium leading-[1.45] text-ink">{n.text}</p>
                        <p className="mt-[3px] text-[12px] text-muted-400">{n.time}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Profil */}
      <div className="relative flex-shrink-0" ref={profileRef}>
        <button
          type="button"
          onClick={() => {
            if (!profileOpen) setHeaderHeight(measureHeaderHeight());
            setProfileOpen((v) => !v);
            setNotifOpen(false);
          }}
          aria-expanded={profileOpen}
          aria-haspopup="true"
          className="flex items-center gap-[11px] rounded-md border border-border-100 bg-white py-[5px] pl-[5px] pr-3"
        >
          <span
            className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-navy text-[15px] font-bold text-cream"
            aria-hidden="true"
          >
            {initialsFrom(user.name)}
          </span>
          <span className="text-left leading-tight">
            <span className="block text-[14px] font-semibold text-ink">{user.name}</span>
            {user.role && <span className="block text-[12px] text-muted-400">{user.role}</span>}
          </span>
          <ChevronDown size={16} aria-hidden="true" className="text-muted-500" />
        </button>
        {profileOpen && (
          <div
            className="fixed inset-x-4 z-30 overflow-hidden rounded-xl border border-border-100 bg-white p-2 shadow-[0_18px_44px_rgba(26,26,46,0.16)] lg:absolute lg:inset-x-auto lg:right-0 lg:top-14 lg:w-[250px]"
            style={{ top: mobileDropdownTop }}
            role="menu"
          >
            <div className="px-3 pb-[14px] pt-3">
              <p className="text-[15px] font-bold text-ink">{user.name}</p>
              {user.email && <p className="text-[13px] text-muted-400">{user.email}</p>}
            </div>
            <Link
              href="/einstellungen"
              prefetch={false}
              className="flex items-center gap-[11px] rounded-[10px] px-3 py-[10px] text-[14px] font-medium text-navy no-underline"
            >
              <span className="h-2 w-2 rounded-[2px] bg-accent" />
              Profil ansehen
            </Link>
            {/* NEU (23.07.2026, Josips Auftrag): "Einstellungen" aus der
                Haupt-Sidebar hierher verschoben, direkt unter "Profil
                ansehen" — siehe Sidebar.tsx-Kopfkommentar zum KONTO-Umbau. */}
            <Link
              href="/einstellungen"
              prefetch={false}
              className="flex items-center gap-[11px] rounded-[10px] px-3 py-[10px] text-[14px] font-medium text-navy no-underline"
            >
              <span className="h-2 w-2 rounded-[2px] bg-accent" />
              Einstellungen
            </Link>
            <Link
              href="/einstellungen?tab=benachrichtigungen"
              prefetch={false}
              className="flex items-center gap-[11px] rounded-[10px] px-3 py-[10px] text-[14px] font-medium text-navy no-underline"
            >
              <span className="h-2 w-2 rounded-[2px] bg-accent" />
              Benachrichtigungen
            </Link>
            <div className="mx-1 my-1.5 h-px bg-[#EEF0F7]" />
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="flex w-full items-center gap-[11px] rounded-[10px] px-3 py-[10px] text-[14px] font-semibold text-[#B24343]"
              >
                <span className="h-2 w-2 rounded-[2px] bg-[#B24343]" />
                Abmelden
              </button>
            </form>
          </div>
        )}
      </div>
    </header>
  );
}

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
