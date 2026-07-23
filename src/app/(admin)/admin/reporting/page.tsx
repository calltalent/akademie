import { Download } from "lucide-react";
import { getTenant } from "@/lib/tenant/context";
import { getCourseReport, getUserReport, getQuizReport } from "@/lib/reporting/queries";
import { resetCourseReport, resetUserReport, resetQuizReport } from "@/lib/reporting/actions";
import { ReportResetButton } from "@/components/admin/report-reset-button";

const COURSE_REPORT_COLS = "2fr 1fr 1fr 1.2fr 0.5fr";
const USER_REPORT_COLS = "1.6fr 1.6fr 1fr 1fr 0.5fr";
const QUIZ_REPORT_COLS = "1.8fr 1.4fr 1fr 1fr 0.5fr";

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  completed: { label: "Abgeschlossen", color: "#1F8A5B", bg: "#E3F2EA" },
  active: { label: "Aktiv", color: "#5663AE", bg: "#EAEBF7" },
  inactive: { label: "Inaktiv", color: "#66679B", bg: "#EEF0F7" },
};

function CsvExportLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      className="inline-flex items-center gap-2 rounded-[9px] border px-4 py-[9px] text-[13px] font-bold no-underline"
      style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
    >
      <Download size={14} aria-hidden="true" />
      CSV exportieren
    </a>
  );
}

/**
 * Admin/Reporting (Design-Import 19.07.2026, AdminReporting.dc.html aus dem
 * Design-Projekt „Calltalent-Akademie Studenten-Portal" — Josips Auftrag:
 * "Design UND Funktionen genau wie im Design abgebildet"). Ersetzt die
 * schlichte Phase-2-Tabellenliste (`ReportTable`, jetzt entfernt) durch das
 * Marken-Kartenlayout mit Fortschrittsbalken, Status-Chips und einem echten
 * "Bericht zurücksetzen"-Symbol je Zeile (`lib/reporting/actions.ts`) — der
 * Export zeigt dafür nur einen `confirm()`-Dialog ohne echte Wirkung
 * ("// Zurücksetzen ausführen"), die tatsächliche Lösch-Logik ist hier neu.
 *
 * GRANULARITÄT DER QUIZ-AUSWERTUNG bewusst geändert (siehe Kommentar in
 * queries.ts): der Export zeigt eine Zeile je Quiz+Nutzer statt der
 * bisherigen Mandanten-weiten Aggregation je Quiz — nötig, damit "Bericht
 * zurücksetzen" ein konkretes Ziel hat (ein Aggregat lässt sich nicht
 * sinnvoll "zurücksetzen"). Nichts anderes im Repo hing an der alten
 * Aggregat-Form (nur diese Seite + ihr eigener CSV-Export).
 *
 * Bewusste Abweichungen vom Export:
 * - Reset-Aktionen sind ADMIN-only (`requireAdminTenant` in actions.ts),
 *   nicht nur Staff — irreversible Löschung von Lerndaten, gleiche
 *   Rollen-Grenze wie Teilnehmer-/Produkt-Löschen andernorts im Admin-Bereich.
 * - Kopf-Avatar-Kachel ("AK") fällt weg, wie bei allen anderen bereits
 *   umgestellten Admin-Seiten — rein dekorativ, kein Vorbild dafür hier.
 * - Zertifikate werden von einem Reset NICHT angefasst — siehe ausführliche
 *   Begründung im Kopfkommentar von lib/reporting/actions.ts.
 */
export default async function AdminReportingPage() {
  const tenant = await getTenant();
  const [courseReport, userReport, quizReport] = await Promise.all([
    getCourseReport(tenant!.id),
    getUserReport(tenant!.id),
    getQuizReport(tenant!.id),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center gap-[18px]">
        <div className="flex-1">
          <div className="text-[13px] font-semibold" style={{ color: "#A9AAC4" }}>
            Auswertung · Reporting
          </div>
          <h1 className="mt-0.5 text-[26px] font-extrabold" style={{ letterSpacing: "-0.01em" }}>
            Reporting
          </h1>
          <div className="mt-1 text-sm" style={{ color: "#66679B" }}>
            Fortschritt, Abschlussquoten und Quiz-Auswertung dieses Mandanten.
          </div>
        </div>
      </header>

      {/* Kursberichte */}
      <div className="overflow-hidden rounded-[14px] border bg-white" style={{ borderColor: "#E7E8F2" }}>
        <div className="flex items-center justify-between p-[24px_28px_16px]">
          <div className="text-[17px] font-bold">Kursberichte</div>
          <CsvExportLink href="/api/admin/reporting/csv?type=courses" />
        </div>
        <div
          className="rgrid-header px-[28px] pb-2.5 text-[13px] font-bold"
          style={{ "--rgrid-cols": COURSE_REPORT_COLS, color: "#A9AAC4", borderBottom: "1px solid #EEF0F7" } as React.CSSProperties}
        >
          <div>Kurs</div>
          <div>Eingeschrieben</div>
          <div>Aktiv</div>
          <div>Abschlussquote</div>
          <div />
        </div>
        {courseReport.length === 0 ? (
          <p className="px-[28px] py-6 text-sm" style={{ color: "#A9AAC4" }}>
            Noch keine Kurse mit Einschreibungen.
          </p>
        ) : (
          courseReport.map((r) => (
            <div
              key={r.courseId}
              className="rgrid-row px-[18px] py-4 text-[15px] lg:px-[28px]"
              style={{ "--rgrid-cols": COURSE_REPORT_COLS, borderBottom: "1px solid #F4F5FA" } as React.CSSProperties}
            >
              <div className="truncate font-semibold">{r.courseTitle}</div>
              <div>
                <span className="rgrid-label">Eingeschrieben</span>
                <span style={{ color: "#66679B" }}>{r.enrolledCount}</span>
              </div>
              <div>
                <span className="rgrid-label">Aktiv</span>
                <span style={{ color: "#66679B" }}>{r.activeCount}</span>
              </div>
              <div className="flex items-center gap-2.5 pr-4">
                <div
                  className="h-[7px] max-w-[120px] flex-1 overflow-hidden rounded-[4px]"
                  style={{ background: "#EEF0F7" }}
                  role="img"
                  aria-label={`${r.completionRatePct}% Abschlussquote`}
                >
                  <div className="h-full rounded-[4px]" style={{ background: "#5663AE", width: `${r.completionRatePct}%` }} />
                </div>
                <span className="font-bold" style={{ color: "#3E3F66" }}>
                  {r.completionRatePct}%
                </span>
              </div>
              <div className="lg:text-right">
                <ReportResetButton
                  label={`Kursbericht zurücksetzen: ${r.courseTitle}`}
                  confirmMessage={`Kursbericht für „${r.courseTitle}“ zurücksetzen? Der Fortschritt ALLER eingeschriebenen Lernenden in diesem Kurs wird gelöscht (Einschreibungen selbst bleiben erhalten). Dieser Vorgang kann nicht rückgängig gemacht werden.`}
                  action={resetCourseReport.bind(null, r.courseId)}
                />
              </div>
            </div>
          ))
        )}
      </div>

      {/* Nutzerberichte */}
      <div className="overflow-hidden rounded-[14px] border bg-white" style={{ borderColor: "#E7E8F2" }}>
        <div className="flex items-center justify-between p-[24px_28px_6px]">
          <div className="text-[17px] font-bold">Nutzerberichte</div>
          <CsvExportLink href="/api/admin/reporting/csv?type=users" />
        </div>
        <div className="px-[28px] pb-4 text-sm" style={{ color: "#66679B" }}>
          Alle eingeschriebenen Lernenden über alle Kurse hinweg (eine Zeile je Kurs-Einschreibung).
        </div>
        {userReport.length === 0 ? (
          <p className="px-[28px] pb-7 text-sm" style={{ color: "#A9AAC4" }}>
            Noch keine Einschreibungen.
          </p>
        ) : (
          <>
            <div
              className="rgrid-header px-[28px] pb-2.5 text-[13px] font-bold"
              style={{ "--rgrid-cols": USER_REPORT_COLS, color: "#A9AAC4", borderBottom: "1px solid #EEF0F7" } as React.CSSProperties}
            >
              <div>Nutzer</div>
              <div>Kurs</div>
              <div>Fortschritt</div>
              <div>Status</div>
              <div />
            </div>
            {userReport.map((u) => {
              const meta = STATUS_META[u.status];
              return (
                <div
                  key={`${u.userId}-${u.courseId}`}
                  className="rgrid-row px-[18px] py-3.5 text-sm lg:px-[28px]"
                  style={{ "--rgrid-cols": USER_REPORT_COLS, borderBottom: "1px solid #F4F5FA" } as React.CSSProperties}
                >
                  <div className="truncate font-semibold">{u.userName}</div>
                  <div className="truncate" style={{ color: "#3E3F66" }}>
                    {u.courseTitle}
                  </div>
                  <div>
                    <span className="rgrid-label">Fortschritt</span>
                    <span style={{ color: "#66679B" }}>{u.progressPct}%</span>
                  </div>
                  <div>
                    <span
                      className="inline-flex rounded-lg px-3 py-1 text-[13px] font-bold"
                      style={{ color: meta.color, background: meta.bg }}
                    >
                      {meta.label}
                    </span>
                  </div>
                  <div className="lg:text-right">
                    <ReportResetButton
                      label={`Nutzerbericht zurücksetzen: ${u.userName} – ${u.courseTitle}`}
                      confirmMessage={`Nutzerbericht für „${u.userName} – ${u.courseTitle}“ zurücksetzen? Der Fortschritt dieses Lernenden in diesem Kurs wird gelöscht (Einschreibung selbst bleibt erhalten). Dieser Vorgang kann nicht rückgängig gemacht werden.`}
                      action={resetUserReport.bind(null, u.userId, u.courseId)}
                    />
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Quiz-Auswertung */}
      <div className="overflow-hidden rounded-[14px] border bg-white" style={{ borderColor: "#E7E8F2" }}>
        <div className="flex items-center justify-between p-[24px_28px_6px]">
          <div className="text-[17px] font-bold">Quiz-Auswertung</div>
          <CsvExportLink href="/api/admin/reporting/csv?type=quiz" />
        </div>
        {quizReport.length === 0 ? (
          <p className="px-[28px] pb-7 pt-2 text-sm" style={{ color: "#A9AAC4" }}>
            Noch keine Quiz-Versuche.
          </p>
        ) : (
          <>
            <div
              className="rgrid-header px-[28px] pb-2.5 pt-4 text-[13px] font-bold"
              style={{ "--rgrid-cols": QUIZ_REPORT_COLS, color: "#A9AAC4", borderBottom: "1px solid #EEF0F7" } as React.CSSProperties}
            >
              <div>Quiz</div>
              <div>Nutzer</div>
              <div>Versuche</div>
              <div>Bestes Ergebnis</div>
              <div />
            </div>
            {quizReport.map((q) => (
              <div
                key={`${q.quizId}-${q.userId}`}
                className="rgrid-row px-[18px] py-3.5 text-sm lg:px-[28px]"
                style={{ "--rgrid-cols": QUIZ_REPORT_COLS, borderBottom: "1px solid #F4F5FA" } as React.CSSProperties}
              >
                <div className="truncate font-semibold">{q.quizTitle}</div>
                <div className="truncate" style={{ color: "#3E3F66" }}>
                  {q.userName}
                </div>
                <div>
                  <span className="rgrid-label">Versuche</span>
                  <span style={{ color: "#66679B" }}>{q.attemptsCount}</span>
                </div>
                <div>
                  <span className="rgrid-label">Bestes Ergebnis</span>
                  <span className="font-bold">{q.bestScorePct ?? "—"}{q.bestScorePct !== null ? "%" : ""}</span>
                </div>
                <div className="lg:text-right">
                  <ReportResetButton
                    label={`Quiz-Auswertung zurücksetzen: ${q.quizTitle} – ${q.userName}`}
                    confirmMessage={`Quiz-Auswertung für „${q.quizTitle} – ${q.userName}“ zurücksetzen? Alle Versuche dieses Nutzers für dieses Quiz werden gelöscht. Dieser Vorgang kann nicht rückgängig gemacht werden.`}
                    action={resetQuizReport.bind(null, q.userId, q.quizId)}
                  />
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
