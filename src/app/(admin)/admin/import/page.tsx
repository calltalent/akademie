import { CourseImportForm } from "@/components/admin/course-import-form";

/**
 * Design-Block (19.07.2026, Claude-Design-Import AdminImport.dc.html aus dem
 * Design-Projekt „Calltalent-Akademie Studenten-Portal"). Ersetzt die
 * schlichte Phase-4-Ansicht (nativer Datei-Input ohne Kartenoptik) durch das
 * Marken-Layout — Kopfzeile im Reporting/Zahlungen/KI-Muster, Karte mit
 * eigenem Datei-Auswahl-Steuerelement.
 *
 * Funktional unverändert: `CourseImportForm`/`importCourseFromFile()` waren
 * bereits vollständig implementiert (Upload, Validierung, Import), anders als
 * bei Reporting/KI-Generator war hier nur das Design nachzuziehen, keine
 * Platzhalter-Funktion durch echte zu ersetzen.
 *
 * Bewusste Abweichung vom Export: Kopf-Avatar-Kachel ("AK") und die
 * generische „Administration/calltalent"-Kopfzeile fallen weg, wie bei allen
 * anderen bereits umgestellten Admin-Seiten — die liefert bereits AdminShell
 * (layout.tsx), kein Vorbild für eine zweite hier.
 */
export default function AdminImportPage() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center gap-[18px]">
        <div className="flex-1">
          <div className="text-[13px] font-semibold" style={{ color: "#A9AAC4" }}>
            Verwaltung · Import
          </div>
          <h1 className="mt-0.5 text-[26px] font-extrabold" style={{ letterSpacing: "-0.01em" }}>
            Altdaten importieren
          </h1>
        </div>
      </header>

      <CourseImportForm />
    </div>
  );
}
