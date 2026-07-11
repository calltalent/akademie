import { getTenant } from "@/lib/tenant/context";
import { getCourseReport, getUserReport, getQuizReport } from "@/lib/reporting/queries";
import { ReportTable } from "@/components/admin/report-table";

function formatLastActivity(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("de-DE") : "—";
}

/**
 * Admin/Reporting (SPEC 4.2, Auftrag Block 6) — Server Component, Staff-Gate
 * aus admin/layout.tsx. Drei Berichte (Kurse, Nutzer, Quiz), je mit
 * CSV-Export-Link auf /api/admin/reporting/csv. Lädt alle drei Berichte
 * serverseitig über src/lib/reporting/queries.ts (regulärer RLS-Client,
 * kein Admin-Client nötig — Begründung siehe dort).
 *
 * Bewusste Vereinfachung (siehe PHASENSTATUS.md): der Nutzerbericht zeigt
 * alle Einschreibungen über alle Kurse — es gibt in v1 noch keine
 * UI-Auswahl für den optionalen `courseId`-Filter (die Query-Funktion und
 * die CSV-Route unterstützen ihn bereits, nur die Oberfläche hier nicht;
 * bei Bedarf per `?courseId=` direkt am CSV-Export nutzbar).
 */
export default async function AdminReportingPage() {
  const tenant = await getTenant();
  const [courseReport, userReport, quizReport] = await Promise.all([
    getCourseReport(tenant!.id),
    getUserReport(tenant!.id),
    getQuizReport(tenant!.id),
  ]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-10">
      <div>
        <h1 className="text-2xl font-semibold">Reporting</h1>
        <p className="text-sm text-gray-500">
          Fortschritt, Abschlussquoten und Quiz-Auswertung dieses Mandanten.
        </p>
      </div>

      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-medium">Kursberichte</h2>
          <a
            href="/api/admin/reporting/csv?type=courses"
            className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
            style={{ borderRadius: "var(--radius)" }}
          >
            CSV exportieren
          </a>
        </div>
        <ReportTable
          caption="Kursberichte: eingeschriebene und aktive Lernende, Abschlussquote je Kurs"
          headers={["Kurs", "Eingeschrieben", "Aktiv", "Abschlussquote (%)"]}
          rows={courseReport.map((r) => [r.courseTitle, r.enrolledCount, r.activeCount, r.completionRatePct])}
          emptyMessage="Noch keine Kurse mit Einschreibungen."
        />
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-medium">Nutzerberichte</h2>
          <a
            href="/api/admin/reporting/csv?type=users"
            className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
            style={{ borderRadius: "var(--radius)" }}
          >
            CSV exportieren
          </a>
        </div>
        <p className="text-sm text-gray-500">
          Alle eingeschriebenen Lernenden über alle Kurse hinweg (eine Zeile je Kurs-Einschreibung).
        </p>
        <ReportTable
          caption="Nutzerberichte: Fortschritt, abgeschlossene Lektionen und letzte Aktivität je Lernendem und Kurs"
          headers={["Name", "E-Mail", "Kurs", "Fortschritt (%)", "Abgeschlossene Lektionen", "Letzte Aktivität"]}
          rows={userReport.map((r) => [
            r.userName,
            r.userEmail,
            r.courseTitle,
            r.progressPct,
            r.completedLessonsCount,
            formatLastActivity(r.lastActivityAt),
          ])}
          emptyMessage="Noch keine Einschreibungen."
        />
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-medium">Quiz-Auswertung</h2>
          <a
            href="/api/admin/reporting/csv?type=quiz"
            className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
            style={{ borderRadius: "var(--radius)" }}
          >
            CSV exportieren
          </a>
        </div>
        <ReportTable
          caption="Quiz-Auswertung: Versuche, bestanden/nicht bestanden und Durchschnittsergebnis je Quiz"
          headers={["Quiz", "Kurs", "Versuche", "Bestanden", "Nicht bestanden", "Durchschnitt (%)"]}
          rows={quizReport.map((r) => [
            r.quizTitle,
            r.courseTitle,
            r.attemptsCount,
            r.passedCount,
            r.failedCount,
            r.avgScorePct ?? "—",
          ])}
          emptyMessage="Noch keine Quiz-Versuche."
        />
      </section>
    </div>
  );
}
