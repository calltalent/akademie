import Link from "next/link";
import { Sparkles } from "lucide-react";
import { getTenant } from "@/lib/tenant/context";
import { createClient } from "@/lib/supabase/server";
import { AiQuotaCard } from "@/components/admin/ai-quota-card";
import { NewCourseButton } from "@/components/admin/new-course-button";
import { InviteUserDialog } from "@/components/admin/invite-user-dialog";
import { formatRelativeTime } from "@/lib/format/relative-time";

/**
 * Design-Block (12.07.2026, Claude-Design-Export Teil 2, Admin.dc.html —
 * von Josip als verbindlich bestätigt, siehe PHASENSTATUS.md "Design-Update
 * Teil 2"). Ersetzt die bisherige Seite, die laut eigenem Kommentar bewusst
 * nur die KI-Kontingent-Kachel zeigte ("die übrigen SPEC-4.2-Kacheln ...
 * folgen bei Bedarf in einem eigenen Block") — das ist jetzt dieser Block.
 *
 * ALLE Zahlen unten sind echte Abfragen, keine aus dem Export übernommenen
 * Demo-Werte (dort z. B. "1.284 Teilnehmer", "Nord GmbH" — frei erfunden).
 * Es gibt keine generische Activity-Log-Tabelle — "Letzte Aktivität" wird
 * daher aus drei real vorhandenen, zeitgestempelten Quellen zusammengesetzt
 * (neue Mitglieder, neue Abgaben, veröffentlichte Kurse), nicht erfunden.
 *
 * "Ø Abschlussquote" je Kurs = abgeschlossene Lektionen / (veröffentlichte
 * Lektionen × Mitglieder mit mindestens einer Fortschritts-Zeile in diesem
 * Kurs) — bewusste, dokumentierte Definition, da es (siehe page.tsx der
 * Startseite) keine verpflichtende Enrollment-Zeile gibt und "alle aktiven
 * Mitglieder sehen alle veröffentlichten Kurse" gilt (Phase-1-Vereinfachung).
 */
export default async function AdminOverviewPage() {
  const tenant = await getTenant();
  // Zugriff ist über admin/layout.tsx (checkStaffAccess) gated; ohne Mandant
  // rendert das Layout „Kein Zugriff". Die Seite wird im RSC-Baum dennoch
  // ausgewertet — daher defensiv abbrechen statt auf tenant!.id zu laufen.
  if (!tenant) return null;
  const tenantId = tenant.id;
  const supabase = await createClient();

  const { data: courses } = await supabase
    .from("courses")
    .select("id, title, status, position")
    .eq("tenant_id", tenantId)
    .order("position", { ascending: true });

  const publishedCourses = (courses ?? []).filter((c) => c.status === "published");
  // Tabelle zeigt Live UND Entwurf (Admin.dc.html „Status Live/Entwurf");
  // archivierte Kurse bleiben außen vor.
  const tableCourses = (courses ?? []).filter(
    (c) => c.status === "published" || c.status === "draft",
  );

  const { data: modules } = await supabase
    .from("modules")
    .select("id, course_id")
    .eq("tenant_id", tenantId);

  const { data: lessons } = await supabase
    .from("lessons")
    .select("id, module_id, status")
    .eq("tenant_id", tenantId)
    .eq("status", "published");

  const { data: progressRows } = await supabase
    .from("progress")
    .select("lesson_id, user_id, status")
    .eq("tenant_id", tenantId);

  const { data: memberships } = await supabase
    .from("memberships")
    .select("id, role, status, created_at")
    .eq("tenant_id", tenantId);

  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("enrolled_at")
    .eq("tenant_id", tenantId);

  const { data: recentSubmissions } = await supabase
    .from("submissions")
    .select("id, status, created_at, lesson_id")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(5);

  const pendingSubmissions = (recentSubmissions ?? []).filter((s) => s.status === "submitted");
  const { count: pendingCount } = await supabase
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("status", "submitted");

  const activeMembers = (memberships ?? []).filter((m) => m.role === "member" && m.status === "active");

  // Pro Kurs: veröffentlichte Lektionen + deren Fortschritts-Zeilen.
  const lessonIdsByCourse = new Map<string, Set<string>>();
  for (const c of tableCourses) lessonIdsByCourse.set(c.id, new Set());
  for (const m of modules ?? []) {
    const set = lessonIdsByCourse.get(m.course_id);
    if (!set) continue;
    for (const l of lessons ?? []) {
      if (l.module_id === m.id) set.add(l.id);
    }
  }

  const courseStats = tableCourses.map((c) => {
    const lessonIds = lessonIdsByCourse.get(c.id) ?? new Set<string>();
    const rows = (progressRows ?? []).filter((p) => lessonIds.has(p.lesson_id));
    const distinctMembers = new Set(rows.map((r) => r.user_id));
    const completed = rows.filter((r) => r.status === "completed").length;
    const denom = lessonIds.size * distinctMembers.size;
    const pct = denom > 0 ? Math.round((completed / denom) * 100) : 0;
    return { id: c.id, title: c.title, status: c.status, members: distinctMembers.size, pct };
  });

  const coursesWithActivity = courseStats.filter((c) => c.members > 0);
  const avgCompletion =
    coursesWithActivity.length > 0
      ? Math.round(coursesWithActivity.reduce((sum, c) => sum + c.pct, 0) / coursesWithActivity.length)
      : 0;

  // Einschreibungen pro Woche (letzte 8 Wochen) aus der echten
  // enrollments-Tabelle (enrolled_at).
  const now = new Date();
  const weekBuckets: { label: string; count: number }[] = [];
  for (let i = 7; i >= 0; i--) {
    const start = new Date(now);
    start.setUTCDate(start.getUTCDate() - i * 7 - 6);
    const end = new Date(now);
    end.setUTCDate(end.getUTCDate() - i * 7);
    const count = (enrollments ?? []).filter((e) => {
      const at = new Date(e.enrolled_at as string);
      return at >= start && at <= end;
    }).length;
    weekBuckets.push({ label: `KW${isoWeek(end)}`, count });
  }
  const maxWeekCount = Math.max(1, ...weekBuckets.map((w) => w.count));

  // Letzte Aktivität: aus drei echten Quellen zusammengesetzt, chronologisch sortiert.
  type ActivityItem = { text: string; time: Date };
  const activity: ActivityItem[] = [
    ...(memberships ?? [])
      .filter((m) => m.role === "member")
      .slice(-3)
      .map((m) => ({ text: "Neue Mitgliedschaft angelegt", time: new Date(m.created_at) })),
    ...pendingSubmissions
      .slice(0, 3)
      .map((s) => ({ text: "Neue Abgabe eingereicht", time: new Date(s.created_at) })),
  ]
    .sort((a, b) => b.time.getTime() - a.time.getTime())
    .slice(0, 5);

  return (
    <div className="flex flex-col gap-7">
      <header className="flex flex-wrap items-center gap-[18px]">
        <div className="flex-1">
          <div className="text-[13px] font-semibold" style={{ color: "#A9AAC4" }}>
            Übersicht
          </div>
          <h1 className="mt-0.5 text-[26px] font-extrabold" style={{ letterSpacing: "-0.01em" }}>
            Dashboard
          </h1>
        </div>
        {/* Schnellzugriff (25.07.2026, Josips Auftrag "auch intuitiv und neu
            designen"): das Dashboard hatte bisher keine eigene Überschrift
            und keine direkten Aktionen — reine Kennzahlenübersicht, jeder
            nächste Schritt (Kurs anlegen, einladen, KI-Generator) brauchte
            erst einen Umweg über die Seitenleiste. Dieselben Einstiege wie
            in Kurse/Teilnehmer, nur hier zusätzlich gebündelt als schnellster
            Weg von der Startseite aus — kein Duplikat der Funktionalität,
            NewCourseButton/InviteUserDialog sind exakt dieselben Komponenten. */}
        <div className="flex flex-none flex-wrap items-center gap-2.5">
          <Link
            href="/admin/ki"
            className="inline-flex items-center gap-2 rounded-[11px] border bg-white px-[18px] py-3 text-[15px] font-semibold no-underline"
            style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
          >
            <Sparkles size={16} aria-hidden="true" style={{ color: "#5663AE" }} />
            KI-Generator
          </Link>
          <InviteUserDialog />
          <NewCourseButton />
        </div>
      </header>

      <AiQuotaCard />

      <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
        <KpiCard label="Teilnehmer" value={String(activeMembers.length)} />
        <KpiCard label="Aktive Kurse" value={String(publishedCourses.length)} />
        <KpiCard label="Ø Abschlussquote" value={`${avgCompletion}%`} />
        <KpiCard
          label="Offene Abgaben"
          value={String(pendingCount ?? 0)}
          tone={(pendingCount ?? 0) > 0 ? "warn" : "ok"}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="rounded-2xl border bg-white p-7" style={{ borderColor: "#E7E8F2" }}>
          <div className="mb-5 flex items-baseline justify-between">
            <div className="text-[17px] font-bold">Einschreibungen</div>
            <div className="text-[13px] font-semibold" style={{ color: "#A9AAC4" }}>
              letzte 8 Wochen
            </div>
          </div>
          <div className="flex h-[180px] items-end gap-3.5">
            {weekBuckets.map((w) => (
              <div key={w.label} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
                <div
                  className="w-full rounded-t-[7px]"
                  style={{
                    height: `${Math.max(4, (w.count / maxWeekCount) * 100)}%`,
                    background: w.count === maxWeekCount && w.count > 0 ? "#5663AE" : "#B7BEE0",
                  }}
                />
                <div className="text-xs" style={{ color: "#A9AAC4" }}>
                  {w.label}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-7" style={{ borderColor: "#E7E8F2" }}>
          <div className="mb-4.5 text-[17px] font-bold">Letzte Aktivität</div>
          {activity.length === 0 ? (
            <p className="text-sm" style={{ color: "#A9AAC4" }}>
              Noch keine Aktivität.
            </p>
          ) : (
            activity.map((a, i) => (
              <div
                key={i}
                className="flex gap-3.5 py-3.5"
                style={{ borderTop: i === 0 ? undefined : "1px solid #F2F3F9" }}
              >
                <span
                  className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-[9px]"
                  style={{ background: "#EEF0FA" }}
                  aria-hidden="true"
                >
                  <span className="h-[13px] w-[13px] rounded" style={{ background: "#5663AE" }} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium leading-snug">{a.text}</div>
                  <div className="mt-0.5 text-xs" style={{ color: "#A9AAC4" }}>
                    {formatRelativeTime(a.time)}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border bg-white" style={{ borderColor: "#E7E8F2" }}>
        <div className="flex items-baseline justify-between px-7 pb-4 pt-6">
          <div className="text-[17px] font-bold">Kurse</div>
          <Link href="/admin/kurse" className="text-sm font-semibold no-underline">
            Alle verwalten
          </Link>
        </div>
        <div
          className="grid grid-cols-[2.4fr_1fr_1fr_0.8fr] gap-0 px-7 pb-2.5 text-[13px] font-bold"
          style={{ color: "#A9AAC4", borderBottom: "1px solid #EEF0F7" }}
        >
          <div>Kurs</div>
          <div>Aktive Teilnehmer</div>
          <div>Ø Fortschritt</div>
          <div>Status</div>
        </div>
        {courseStats.length === 0 ? (
          <p className="px-7 py-6 text-sm" style={{ color: "#A9AAC4" }}>
            Noch keine Kurse angelegt.
          </p>
        ) : (
          courseStats.map((c) => (
            <div
              key={c.id}
              className="grid grid-cols-[2.4fr_1fr_1fr_0.8fr] items-center gap-0 px-7 py-4 text-[15px]"
              style={{ borderBottom: "1px solid #F4F5FA" }}
            >
              <div className="font-semibold">{c.title}</div>
              <div style={{ color: "#3E3F66" }}>{c.members}</div>
              <div className="flex items-center gap-2.5">
                <div
                  className="h-[7px] max-w-[100px] flex-1 overflow-hidden rounded-[5px]"
                  style={{ background: "#EEF0F7" }}
                >
                  <div className="h-full rounded-[5px]" style={{ width: `${c.pct}%`, background: "#5663AE" }} />
                </div>
                <span className="text-[13px] font-semibold" style={{ color: "#5663AE" }}>
                  {c.pct}%
                </span>
              </div>
              <div>
                {c.status === "published" ? (
                  <span
                    className="inline-flex rounded-lg px-3 py-1 text-[13px] font-bold"
                    style={{ color: "#1F8A5B", background: "#E3F2EA" }}
                  >
                    Live
                  </span>
                ) : (
                  <span
                    className="inline-flex rounded-lg px-3 py-1 text-[13px] font-bold"
                    style={{ color: "#1A1A2E", background: "#F7EED4" }}
                  >
                    Entwurf
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function KpiCard({ label, value, tone }: { label: string; value: string; tone?: "warn" | "ok" }) {
  return (
    <div className="rounded-2xl border bg-white px-6 py-5.5" style={{ borderColor: "#E7E8F2" }}>
      <div className="mb-2.5 text-[13px] font-semibold" style={{ color: "#A9AAC4" }}>
        {label}
      </div>
      <div className="text-[30px] font-extrabold" style={{ color: "#1A1A2E", letterSpacing: "-0.01em" }}>
        {value}
      </div>
      {tone && (
        <div className="mt-1.5 text-[13px] font-semibold" style={{ color: tone === "warn" ? "#B24343" : "#1F8A5B" }}>
          {tone === "warn" ? "braucht Aufmerksamkeit" : "alles bearbeitet"}
        </div>
      )}
    </div>
  );
}

function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
