"use client";

import { NotificationsMenu, ProfileMenu, useExclusiveMenu, type NotificationItem, type TopBarUser } from "@/components/layout/topbar-menus";

/**
 * Layout-Kopfzeile — 1:1-Portierung aus dem Referenzdesign
 * „Calltalent-Akademie Studenten-Portal/TopBar.dc.html". Struktur, Farben,
 * Abstände und Radien sind exakt aus dem Referenz-HTML übernommen; alle
 * Farb-/Radius-Werte laufen über die Prompt-1-Tokens (globals.css @theme):
 * bg #F4F5FA, ink #1A1A2E, navy #3E3F66, accent #5663AE, cream #F7EED4,
 * border-100 #E7E8F2, muted-400 #A9AAC4, muted-500 #66679B sowie
 * rounded-md=12px sowie rounded-xl=16px.
 *
 * `breadcrumb` und `title` sind Props (wie die data-props in TopBar.dc.html).
 * `user` und `notifications` sind optionale Props mit Referenz-Werten als
 * Default (Standalone-Vorschau rendert pixelgleich). In Produktion übergibt
 * app-shell.tsx den echten Nutzer und `notifications={[]}` — bei leerer Liste
 * erscheinen weder Badge noch erfundene Einträge, sondern ein ehrlicher
 * Leerzustand (DESIGN-MASTERPROMPT.md §8.1).
 *
 * Bewusste, nicht-optische Abweichung: „Abmelden" nutzt das echte
 * Signout-Form (/auth/signout) statt des Mock-Links auf Login.dc.html.
 *
 * Mobile-Umbau (23.07.2026): Gutter `px-10 py-5` gilt jetzt erst ab `lg`,
 * mobil `px-4 py-4`.
 *
 * Glocke/Profil ausgelagert (24.07.2026, Josips Fund: auf dem Handy saßen
 * beide mitten im mehrzeilig umbrechenden Begrüßungstext) — `NotificationsMenu`/
 * `ProfileMenu`/`useExclusiveMenu()` leben jetzt in `topbar-menus.tsx` und
 * werden HIER nur noch ab `lg` gerendert (`hidden lg:flex`); unter `lg`
 * übernimmt `LearnMobileNav.tsx` dieselben Komponenten (kompakte Variante,
 * icon-only Profil, kein Platz für Name+Rolle) direkt in der schmalen
 * Logo-/Hamburger-Leiste — DIESELBE Komponente, keine zweite Kopie der
 * Dropdown-Inhalte. Siehe dortigen bzw. topbar-menus.tsx-Kopfkommentar für
 * die volle Begründung/Fehlersuche.
 *
 * `hideHeading` NEU (24.07.2026, Josips Fund: Breadcrumb+Titel hier waren
 * auf den Kurs-/Lektions-/Modulseiten reine Dopplung — der Kurs-/Lektions-/
 * Modultitel steht dort bereits prominent in der eigenen Hero-Karte weiter
 * unten auf der Seite). `breadcrumb`/`title` bleiben Pflicht-Props (andere
 * Seiten wie Dashboard/Kurskatalog/Einstellungen haben KEINE eigene
 * Titel-Anzeige und brauchen diese Kopfzeile weiterhin unverändert).
 *
 * Unter `lg` verschwindet die ganze Kopfzeile (`hidden lg:flex` auf dem
 * `<header>` selbst statt nur den Text auszublenden) — Glocke/Profil leben
 * mobil ohnehin schon in `LearnMobileNav.tsx` (siehe oben), eine zweite,
 * jetzt leere Balkenzeile darunter wäre nur verschenkter Platz. Ab `lg`
 * bleibt die Kopfzeile bestehen (dort ist sie die einzige Stelle für
 * Glocke/Profil), nur Breadcrumb/Titel-Text entfällt.
 */
const DEFAULT_USER: TopBarUser = {
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
  hideHeading = false,
}: {
  breadcrumb: string;
  title: string;
  user?: TopBarUser;
  notifications?: NotificationItem[];
  hideHeading?: boolean;
}) {
  const menu = useExclusiveMenu();

  return (
    <header
      className={`${hideHeading ? "hidden lg:flex" : "flex"} sticky top-0 z-20 items-center gap-[18px] bg-bg px-4 py-4 font-sans lg:px-10 lg:py-5`}
    >
      {/* Breadcrumb + Titel — bei hideHeading nur ein leerer Abstandshalter
          (Kopfzeile selbst ist unter `lg` dann ohnehin komplett `hidden`,
          siehe Kopfkommentar), damit Glocke/Profil ab `lg` rechts bleiben. */}
      <div className="min-w-0 flex-1">
        {!hideHeading && (
          <>
            <p className="text-[13px] font-semibold tracking-[0.02em] text-muted-400">{breadcrumb}</p>
            <h1 className="mt-0.5 text-[20px] font-extrabold tracking-[-0.01em] text-ink lg:text-[26px]">{title}</h1>
          </>
        )}
      </div>

      <div className="hidden flex-shrink-0 items-center gap-[18px] lg:flex">
        <NotificationsMenu
          notifications={notifications}
          open={menu.notifOpen}
          onToggle={menu.toggleNotif}
          onClose={menu.close}
        />
        <ProfileMenu user={user} open={menu.profileOpen} onToggle={menu.toggleProfile} onClose={menu.close} />
      </div>
    </header>
  );
}
