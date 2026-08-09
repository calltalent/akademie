import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { getAuthUser } from "@/lib/auth/context";
import { AppShell } from "@/components/learn/app-shell";
import type { ShiftCalendarDay, ShiftCalendarOpenSlotBlock } from "@/components/learn/shift-calendar-view";
import { ShiftCalendarBoard } from "@/components/learn/shift-calendar-board";
import { TimeClockWidget } from "@/components/learn/time-clock-widget";
import { OpenSlotsPanel } from "@/components/learn/open-slots-panel";
import { TargetHoursForm } from "@/components/learn/target-hours-form";
import {
  getOpenSlotsForWorker,
  getOpenTimeEntry,
  getOwnCalendarWorker,
  getWorkerChangeRequests,
  getWorkerShifts,
} from "@/lib/calendar/queries";
import {
  addDays,
  formatDayLabel,
  formatShortDayLabel,
  formatTimeRange,
  isoDateString,
  startOfIsoWeek,
  toTimeInputValue,
} from "@/lib/calendar/date";

/** "HH:MM" -> Minuten seit Mitternacht, für die Stunden-Raster-Positionierung in `ShiftCalendarView`. */
function toMinutesSinceMidnight(date: Date): number {
  const [hours, minutes] = toTimeInputValue(date).split(":").map(Number);
  return hours * 60 + minutes;
}

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
  const [user, tenant, t, tShared, tDragBoard] = await Promise.all([
    getAuthUser(),
    getTenant(),
    getTranslations("learn.shiftCalendar"),
    getTranslations("learn.shared"),
    // Block S6 (09.08.2026) — eigener Übersetzer für die per-Slot-Aria-Labels
    // der Drag-Blöcke, gleiches Muster wie `tShared` oben.
    getTranslations("learn.shiftCalendar.dragBoard"),
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

  const [shifts, openEntry, { data: profile }, { data: isStaff }, openSlots, changeRequests] = await Promise.all([
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
    // Änderungsanfragen (Block S3) — für ALLE Arbeitertypen, nicht nur
    // Freelancer (anders als der Selbstbuchungs-Block oben): jeder Arbeiter
    // mit einer geplanten Schicht darf eine Änderung/Stornierung beantragen.
    getWorkerChangeRequests(supabase, tenant.id, worker.id),
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
        const startMinutes = toMinutesSinceMidnight(startsAt);
        const endMinutesRaw = toMinutesSinceMidnight(endsAt);
        // Nachtschicht (Ende liegt kalendarisch am Folgetag, z. B. 22:00–06:00):
        // für den Raster-Block dieses Tages auf Tagesende kappen. Die volle
        // Zeit bleibt in `timeRange`/`ariaLabel` und der Liste unten sichtbar.
        const endMinutes = endMinutesRaw <= startMinutes ? 24 * 60 : endMinutesRaw;
        return {
          id: s.id,
          timeRange,
          ariaLabel,
          projectName: s.projectName,
          projectColor: s.projectColor,
          status: s.status,
          startMinutes,
          endMinutes,
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

  // Block S6 (09.08.2026) — offene Zeitfenster in ShiftCalendarOpenSlotBlock[]
  // umgerechnet (gleiches Muster wie die dayShifts-Umrechnung oben:
  // toMinutesSinceMidnight() + Nachtschicht-Kappung auf 24*60 für die
  // Raster-Positionierung; `timeRange` bleibt trotzdem die VOLLE, echte
  // Zeitspanne). `alreadyBooked` wird durchgereicht — `ShiftCalendarView`
  // filtert intern selbst (siehe dortiger Kommentar), diese Seite muss
  // dafür nicht selbst filtern.
  const openSlotBlocks: ShiftCalendarOpenSlotBlock[] = isFreelancer
    ? openSlots.map((s) => {
        const startsAt = new Date(s.startsAt);
        const endsAt = new Date(s.endsAt);
        const timeRange = formatTimeRange(startsAt, endsAt);
        const isFull = s.freeSeats <= 0;
        const ariaLabel = isFull
          ? tDragBoard("openSlotFullAriaLabel", {
              day: formatDayLabel(startsAt),
              start: timeRange.split("–")[0],
              end: timeRange.split("–")[1],
              project: s.projectName,
            })
          : tDragBoard("openSlotAriaLabel", {
              day: formatDayLabel(startsAt),
              start: timeRange.split("–")[0],
              end: timeRange.split("–")[1],
              project: s.projectName,
              freeSeats: s.freeSeats,
              capacity: s.capacity,
            });
        const startMinutes = toMinutesSinceMidnight(startsAt);
        const endMinutesRaw = toMinutesSinceMidnight(endsAt);
        const endMinutes = endMinutesRaw <= startMinutes ? 24 * 60 : endMinutesRaw;
        return {
          id: s.id,
          isoDate: isoDateString(startsAt),
          startMinutes,
          endMinutes,
          timeRange,
          ariaLabel,
          projectName: s.projectName,
          capacity: s.capacity,
          freeSeats: s.freeSeats,
          alreadyBooked: s.alreadyBooked,
        };
      })
    : [];

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

        <ShiftCalendarBoard
          isFreelancer={isFreelancer}
          days={days}
          gridAriaLabel={t("gridAriaLabel")}
          emptyDayText={t("emptyDay")}
          listHeading={t("listHeading")}
          listDescription={t("listDescription")}
          emptyWeekText={t("emptyWeek")}
          noProjectText={t("noProject")}
          weekNav={{
            weekLabel,
            isCurrentWeek,
            prevHref: `/schichtplan?week=${isoDateString(addDays(weekStart, -7))}`,
            nextHref: `/schichtplan?week=${isoDateString(addDays(weekStart, 7))}`,
            todayHref: "/schichtplan",
            prevLabel: t("prevWeekButton"),
            nextLabel: t("nextWeekButton"),
            todayLabel: t("todayButton"),
          }}
          unavailableLegendText={t("unavailableLegend")}
          shifts={shifts}
          requests={changeRequests}
          openSlots={openSlotBlocks}
        />

        {/* OpenSlotsPanel/TargetHoursForm bleiben UNVERÄNDERT an ihrer
            heutigen Stelle (additiv, keine Ablösung — Barrierefreiheits-
            Präzedenzfall aus video-trimmer.tsx: der Tastatur-Weg bleibt
            primär, Drag im Raster oben ist rein ergänzend). */}
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
