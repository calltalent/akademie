import { Download } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { getTenant } from "@/lib/tenant/context";
import { getCourseReport, getUserReport, getQuizReport } from "@/lib/reporting/queries";
import { resetCourseReport, resetUserReport, resetQuizReport } from "@/lib/reporting/actions";
import { ReportResetButton } from "@/components/admin/report-reset-button";

const COURSE_REPORT_COLS = "2fr 1fr 1fr 1.2fr 0.5fr";
const USER_REPORT_COLS = "1.6fr 1.6fr 1fr 1fr 0.5fr";
const QUIZ_REPORT_COLS = "1.8fr 1.4fr 1fr 1fr 0.5fr";

const STATUS_COLORS: Record<string, { color: string; bg: string }> = {
  completed: { color: "#1F8A5B", bg: "#E3F2EA" },
  active: { color: "#5663AE", bg: "#EAEBF7" },
  inactive: { color: "#66679B", bg: "#EEF0F7" },
};

/** `label` kommt vorformatiert vom Aufrufer (gleiches Muster wie `PayLinkIcon`, Block C4). */
function CsvExportLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="inline-flex items-center gap-2 rounded-[9px] border px-4 py-[9px] text-[13px] font-bold no-underline"
      style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
    >
      <Download size={14} aria-hidden="true" />
      {label}
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
  const t = await getTranslations("reporting");
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
            {t("eyebrow")}
          </div>
          <h1 className="mt-0.5 text-[26px] font-extrabold" style={{ letterSpacing: "-0.01em" }}>
            {t("title")}
          </h1>
          <div className="mt-1 text-sm" style={{ color: "#66679B" }}>
            {t("subtitle")}
          </div>
        </div>
      </header>

      {/* Kursberichte */}
      <div className="overflow-hidden rounded-[14px] border bg-white" style={{ borderColor: "#E7E8F2" }}>
        <div className="flex items-center justify-between p-[24px_28px_16px]">
          <div className="text-[17px] font-bold">{t("courses.title")}</div>
          <CsvExportLink href="/api/admin/reporting/csv?type=courses" label={t("exportCsv")} />
        </div>
        <div
          className="rgrid-header px-[28px] pb-2.5 text-[13px] font-bold"
          style={{ "--rgrid-cols": COURSE_REPORT_COLS, color: "#A9AAC4", borderBottom: "1px solid #EEF0F7" } as React.CSSProperties}
        >
          <div>{t("courses.columnCourse")}</div>
          <div>{t("courses.columnEnrolled")}</div>
          <div>{t("courses.columnActive")}</div>
          <div>{t("courses.columnCompletionRateHeader")}</div>
          <div />
        </div>
        {courseReport.length === 0 ? (
          <p className="px-[28px] py-6 text-sm" style={{ color: "#A9AAC4" }}>
            {t("courses.empty")}
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
                <span className="rgrid-label">{t("courses.columnEnrolled")}</span>
                <span style={{ color: "#66679B" }}>{r.enrolledCount}</span>
              </div>
              <div>
                <span className="rgrid-label">{t("courses.columnActive")}</span>
                <span style={{ color: "#66679B" }}>{r.activeCount}</span>
              </div>
              <div className="flex items-center gap-2.5 pr-4">
                <div
                  className="h-[7px] max-w-[120px] flex-1 overflow-hidden rounded-[4px]"
                  style={{ background: "#EEF0F7" }}
                  role="img"
                  aria-label={t("courses.completionAriaLabel", { pct: r.completionRatePct })}
                >
                  <div className="h-full rounded-[4px]" style={{ background: "#5663AE", width: `${r.completionRatePct}%` }} />
                </div>
                <span className="font-bold" style={{ color: "#3E3F66" }}>
                  {r.completionRatePct}%
                </span>
              </div>
              <div className="lg:text-right">
                <ReportResetButton
                  label={t("courses.resetLabel", { title: r.courseTitle })}
                  confirmMessage={t("courses.resetConfirm", { title: r.courseTitle })}
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
          <div className="text-[17px] font-bold">{t("users.title")}</div>
          <CsvExportLink href="/api/admin/reporting/csv?type=users" label={t("exportCsv")} />
        </div>
        <div className="px-[28px] pb-4 text-sm" style={{ color: "#66679B" }}>
          {t("users.subtitle")}
        </div>
        {userReport.length === 0 ? (
          <p className="px-[28px] pb-7 text-sm" style={{ color: "#A9AAC4" }}>
            {t("users.empty")}
          </p>
        ) : (
          <>
            <div
              className="rgrid-header px-[28px] pb-2.5 text-[13px] font-bold"
              style={{ "--rgrid-cols": USER_REPORT_COLS, color: "#A9AAC4", borderBottom: "1px solid #EEF0F7" } as React.CSSProperties}
            >
              <div>{t("users.columnUser")}</div>
              <div>{t("users.columnCourse")}</div>
              <div>{t("users.columnProgressHeader")}</div>
              <div>{t("users.columnStatus")}</div>
              <div />
            </div>
            {userReport.map((u) => {
              const colors = STATUS_COLORS[u.status];
              const statusLabel =
                u.status === "completed"
                  ? t("users.statusCompleted")
                  : u.status === "active"
                    ? t("users.statusActive")
                    : t("users.statusInactive");
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
                    <span className="rgrid-label">{t("users.columnProgressHeader")}</span>
                    <span style={{ color: "#66679B" }}>{u.progressPct}%</span>
                  </div>
                  <div>
                    <span
                      className="inline-flex rounded-lg px-3 py-1 text-[13px] font-bold"
                      style={{ color: colors.color, background: colors.bg }}
                    >
                      {statusLabel}
                    </span>
                  </div>
                  <div className="lg:text-right">
                    <ReportResetButton
                      label={t("users.resetLabel", { name: u.userName, course: u.courseTitle })}
                      confirmMessage={t("users.resetConfirm", { name: u.userName, course: u.courseTitle })}
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
          <div className="text-[17px] font-bold">{t("quiz.title")}</div>
          <CsvExportLink href="/api/admin/reporting/csv?type=quiz" label={t("exportCsv")} />
        </div>
        {quizReport.length === 0 ? (
          <p className="px-[28px] pb-7 pt-2 text-sm" style={{ color: "#A9AAC4" }}>
            {t("quiz.empty")}
          </p>
        ) : (
          <>
            <div
              className="rgrid-header px-[28px] pb-2.5 pt-4 text-[13px] font-bold"
              style={{ "--rgrid-cols": QUIZ_REPORT_COLS, color: "#A9AAC4", borderBottom: "1px solid #EEF0F7" } as React.CSSProperties}
            >
              <div>{t("quiz.columnQuiz")}</div>
              <div>{t("quiz.columnUser")}</div>
              <div>{t("quiz.columnAttempts")}</div>
              <div>{t("quiz.columnBestScore")}</div>
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
                  <span className="rgrid-label">{t("quiz.columnAttempts")}</span>
                  <span style={{ color: "#66679B" }}>{q.attemptsCount}</span>
                </div>
                <div>
                  <span className="rgrid-label">{t("quiz.columnBestScore")}</span>
                  <span className="font-bold">{q.bestScorePct ?? t("quiz.noAttempts")}{q.bestScorePct !== null ? "%" : ""}</span>
                </div>
                <div className="lg:text-right">
                  <ReportResetButton
                    label={t("quiz.resetLabel", { quiz: q.quizTitle, user: q.userName })}
                    confirmMessage={t("quiz.resetConfirm", { quiz: q.quizTitle, user: q.userName })}
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
