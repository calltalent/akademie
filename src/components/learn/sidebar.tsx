"use client";

import { useState } from "react";
import { LayoutGrid, Search, Bookmark, Settings, Bell, HelpCircle, ShieldCheck } from "lucide-react";
import { NavLink } from "@/components/shell/nav-link";
import { SectionLabel } from "@/components/shell/section-label";
import { BrandLogo } from "@/components/shell/brand-logo";

/**
 * Design-Block (12.07.2026, Claude-Design-Export
 * `claude.ai/design/p/890b98ed-af1b-4360-8b96-b9076f8986cd`, von Josip als
 * verbindlich bestätigt — siehe PHASENSTATUS.md "Design-Update"). Löst die
 * vorherige, inline in app-shell.tsx gebaute dunkle Indigo-Sidebar ab.
 *
 * Eigene Client-Komponente (nicht mehr Teil von app-shell.tsx), weil das
 * Ein-/Ausklappen (`expanded`) React-State braucht — app-shell.tsx bleibt
 * dadurch eine Server Component.
 *
 * Bewusst NICHT 1:1 aus dem Export übernommen (DESIGN-MASTERPROMPT.md §8.1,
 * kein Feature ohne echtes Datenmodell):
 * - Kein Badge-Zähler an "Benachrichtigungen" — es gibt noch keine
 *   `notifications`-Tabelle (offener Folgeauftrag, siehe PHASENSTATUS.md).
 * - "Lesezeichen" verlinkt auf eine echte, aber bewusst leere Platzhalter-
 *   seite (`/lesezeichen`) statt auf `href="#"` wie im Export — ein
 *   Menüpunkt ins Leere wäre schlechter als eine ehrliche
 *   "in Vorbereitung"-Seite.
 * - "Kurskatalog" NEU (Design-Update Teil 2, 12.07.2026) zeigt jetzt auf
 *   die echte Katalog-Seite `/kurse` statt der Fehlverlinkung auf `/suche`
 *   (semantische KI-Suche) — Filter-Chips aus dem Export bewusst nicht
 *   übernommen, siehe Kommentar in `src/app/(learn)/kurse/page.tsx`
 *   (kein Kategorie-Datenmodell vorhanden).
 *
 * Korrektur (Josips Lint-Lauf, 12.07.2026): `isStaff` war ein ungenutztes
 * Prop (`no-unused-vars`-Warnung). Echte Verwendung ergänzt: Staff-
 * Mitglieder sehen jetzt einen "Admin-Bereich"-Link (die alte dunkle
 * Indigo-Sidebar hatte diesen Link, der Claude-Design-Export zeigt ihn
 * nicht — ohne ihn gäbe es aus der Lernenden-Ansicht keinen direkten Weg
 * mehr zu `/admin`, das wäre ein echter Funktionsverlust).
 */
export function Sidebar({ isStaff = false }: { isStaff?: boolean }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <aside
      className="sticky top-0 flex h-screen flex-shrink-0 flex-col border-r py-6 transition-[width] duration-150 ease-out"
      style={{
        width: expanded ? "264px" : "84px",
        borderColor: "#E7E8F2",
        background: "#FFFFFF",
      }}
      aria-label="Hauptnavigation"
    >
      <div className="px-4">
        <BrandLogo subLabel="AKADEMIE" variant="white" expanded={expanded} />
      </div>

      <div className="mb-6 px-4">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? "Sidebar einklappen" : "Sidebar ausklappen und suchen"}
          className={`flex w-full items-center gap-3 rounded-[11px] border px-3 py-[11px] text-[15px] transition-colors${
            expanded ? "" : " justify-center"
          }`}
          style={{ background: "#F4F5FA", borderColor: "#E7E8F2", color: "#66679B" }}
        >
          <Search aria-hidden="true" size={19} style={{ color: "var(--color-primary)", flexShrink: 0 }} />
          {expanded && <span>Suchen …</span>}
        </button>
      </div>

      <nav className="flex-1 overflow-hidden px-4">
        <SectionLabel variant="white" expanded={expanded}>
          Lernen
        </SectionLabel>
        <NavLink
          href="/"
          label="Meine Kurse"
          exact
          variant="white"
          expanded={expanded}
          icon={<LayoutGrid aria-hidden="true" size={20} />}
        />
        <NavLink
          href="/kurse"
          label="Kurskatalog"
          variant="white"
          expanded={expanded}
          icon={<Search aria-hidden="true" size={20} />}
        />
        <NavLink
          href="/lesezeichen"
          label="Lesezeichen"
          variant="white"
          expanded={expanded}
          icon={<Bookmark aria-hidden="true" size={20} />}
        />

        <SectionLabel variant="white" expanded={expanded}>
          Konto
        </SectionLabel>
        <NavLink
          href="/profil"
          label="Einstellungen"
          variant="white"
          expanded={expanded}
          icon={<Settings aria-hidden="true" size={20} />}
        />
        <NavLink
          href="/profil?tab=benachrichtigungen"
          label="Benachrichtigungen"
          variant="white"
          expanded={expanded}
          icon={<Bell aria-hidden="true" size={20} />}
        />
      </nav>

      <div className="flex flex-col gap-1 px-4 pt-4" style={{ borderTop: "1px solid #E7E8F2" }}>
        {isStaff && (
          <a
            href="/admin"
            title={!expanded ? "Admin-Bereich" : undefined}
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-[15px]${expanded ? "" : " justify-center"}`}
            style={{ color: "#66679B" }}
          >
            <ShieldCheck aria-hidden="true" size={19} />
            {expanded && <span>Admin-Bereich</span>}
          </a>
        )}
        <a
          href="mailto:office@calltalent.ai"
          title={!expanded ? "Hilfe & Kontakt" : undefined}
          className={`flex items-center gap-3 rounded-md px-3 py-2 text-[15px]${expanded ? "" : " justify-center"}`}
          style={{ color: "#66679B" }}
        >
          <HelpCircle aria-hidden="true" size={19} />
          {expanded && <span>Hilfe &amp; Kontakt</span>}
        </a>
      </div>
    </aside>
  );
}
