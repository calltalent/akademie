import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { getAuthUser } from "@/lib/auth/context";
import { AppShell } from "@/components/learn/app-shell";
import { ShiftCalendarWeekNav } from "@/components/learn/shift-calendar-week-nav";
import { ShiftCalendarView, type ShiftCalendarDay } from "@/components/learn/shift-calendar-view";
import { TimeClockWidget } from "@/components/learn/time-clock-widget";
import { OpenSlotsPanel } from "@/components/learn/open-slots-panel";
import { TargetHoursForm } from "@/components/learn/target-hours-form";
import { getOpenSlotsForWorker, getOpenTimeEntry, getOwnCalendarWorker, getWorkerShifts } from "@/lib/calendar/queries";
import { addDays, formatDayLabel, formatShortDayLabel, formatTimeRange, isoDateString, startOfIsoWeek } from "@/lib/calendar/date";

/**
 * "Mein Schichtplan" (Block S1, 07.08.2026). URL `/schichtplan`, Route-Group
 * `(portal)` ohne Präfix — gleiches Muster wie `(portal)/kunden-area/page.tsx`
 * (`getAuthUser()`+`getTenant()`, Redirects, `AppShell`).
 *
 * Doppeltes Gate, bewusst beide serverseitig geprüft (Direktaufruf der URL
 * ohne sichtbaren Menüpunkt darf nicht funktionieren):
 *   1. `tenant.settings.shift_calendar_enabled === true` (Betreiber-Portal-
 *      Freischaltung — Mandant selbst hat keinen eigenen Schalter).
 *   2. eine eigene `calendar_workers`-Zeile des Nutzers (nicht jedes
 *      Mandanten-Mitglied ist ein Arbeiter).
 * Beides ist zusätzlich durch RLS abgesichert (kein Datenzugriff ohne
 * Arbeiterzeile möglich) — dieses Gate ist die freundliche UX-Ebene
 * (Redirect statt leerer/fehlerhafter Seite), kein Ersatz für RLS.
 */
export default async function SchichtplanPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week } = await searchParams;
  const supabase = await createClient();
  const [user, tenant, t, tShared] = await Promise.all([
    getAuthUser(),
    getTenant(),
    getTranslations("learn.shiftCalendar"),
    getTranslations("learn.shared"),
  ]);

  if (!tenant) redirect("/");
  if (!user) redirect("/login");
  if (tenant.settings.shift_calendar_enabled !== true) redirect("/dashboard");

  const worker = await getOwnCalendarWorker(supabase, tenant.id, user.id);
  if (!worker) redirect("/dashboard");

  const referenceDate = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? new Date(`${week}T12:00:00Z`) : new Date();
  const weekStart = startOfIsoWeek(referenceDate);
  const weekEnd = addDays(weekStart, 7);
  const currentWeekStart = startOfIsoWeek(new Date());
  const isCurrentWeek = isoDateString(weekStart) === isoDateString(currentWeekStart);

  const isFreelancer = worker.workerType === "freelancer";

  const [shifts, openEntry, { data: profile }, { data: isStaff }, openSlots] = await Promise.all([
    getWorkerShifts(supabase, tenant.id, worker.id, weekStart.toISOString(), weekEnd.toISOString()),
    getOpenTimeEntry(supabase, tenant.id, worker.id),
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    supabase.rpc("is_staff", { t: tenant.id }),
    // Offene Zeitfenster nur für Freelancer laden — Festangestellte
    // bekommen den Selbstbuchungs-Block ohnehin nicht gerendert (Josips
    // ausdrückliche Vorgabe, siehe target-hours-form.tsx-Kopfkommentar).
    isFreelancer
      ? getOpenSlotsForWorker(supabase, tenant.id, weekStart.toISOString(), weekEnd.toISOString())
      : Promise.resolve([]),
  ]);

  const emailLocalPart = (user.email ?? "").split("@")[0] ?? "";
  const displayName =
    profile?.full_name?.trim() ||
    (emailLocalPart ? emailLocalPart[0].toUpperCase() + emailLocalPart.slice(1) : tShared("fallbackUserName"));

  const days: ShiftCalendarDay[] = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    const isoDate = isoDateString(date);
    const dayShifts = shifts
      .filter((s) => isoDateString(new Date(s.startsAt)) === isoDate)
      .map((s) => {
        const startsAt = new Date(s.startsAt);
        const endsAt = new Date(s.endsAt);
        const timeRange = formatTimeRange(startsAt, endsAt);
        const ariaLabel = s.projectName
          ? t("shiftAriaLabelWithProject", {
              day: formatDayLabel(startsAt),
              start: formatTimeRange(startsAt, endsAt).split("–")[0],
              end: formatTimeRange(startsAt, endsAt).split("–")[1],
              project: s.projectName,
            })
          : t("shiftAriaLabelNoProject", {
              day: formatDayLabel(startsAt),
              start: formatTimeRange(startsAt, endsAt).split("–")[0],
              end: formatTimeRange(startsAt, endsAt).split("–")[1],
            });
        return {
          id: s.id,
          timeRange,
          ariaLabel,
          projectName: s.projectName,
          projectColor: s.projectColor,
          status: s.status,
        };
      });
    return {
      isoDate,
      dayLabel: formatDayLabel(date),
      shortLabel: formatShortDayLabel(date),
      isToday: isoDate === isoDateString(new Date()),
      shifts: dayShifts,
    };
  });

  const weekYear = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", year: "numeric" }).format(weekStart);
  const weekLabel = t("weekRangeLabel", {
    startLabel: formatShortDayLabel(weekStart),
    endLabel: formatShortDayLabel(addDays(weekStart, 6)),
    year: weekYear,
  });

  return (
    <AppShell
      isStaff={Boolean(isStaff)}
      userName={displayName}
      userEmail={user.email ?? undefined}
      breadcrumb={t("breadcrumb")}
      title={t("title")}
    >
      <div className="flex flex-col gap-6">
        <TimeClockWidget initialOpenEntryStartedAt={openEntry?.startedAt ?? null} />

        <ShiftCalendarWeekNav
          weekLabel={weekLabel}
          isCurrentWeek={isCurrentWeek}
          prevHref={`/schichtplan?week=${isoDateString(addDays(weekStart, -7))}`}
          nextHref={`/schichtplan?week=${isoDateString(addDays(weekStart, 7))}`}
          todayHref="/schichtplan"
          prevLabel={t("prevWeekButton")}
          nextLabel={t("nextWeekButton")}
          todayLabel={t("todayButton")}
        />

        <ShiftCalendarView
          days={days}
          gridAriaLabel={t("gridAriaLabel")}
          emptyDayText={t("emptyDay")}
          listHeading={t("listHeading")}
          listDescription={t("listDescription")}
          emptyWeekText={t("emptyWeek")}
          noProjectText={t("noProject")}
        />

        {isFreelancer && (
          <>
            <OpenSlotsPanel slots={openSlots} />
            <TargetHoursForm initialTargetHours={worker.targetHours} initialTargetPeriod={worker.targetPeriod} />
          </>
        )}
      </div>
    </AppShell>
  );
}
