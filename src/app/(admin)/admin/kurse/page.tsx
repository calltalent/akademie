import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { NewCourseDialog } from "@/components/admin/new-course-dialog";

/**
 * Design-Block 6 (13.07.2026, Claude-Design-Export Teil 3,
 * AdminKurse.dc.html — Fortsetzung der Design-Angleichung nach Teil 2/
 * Dashboard, siehe PHASENSTATUS.md). Ersetzt die bisherige schlichte Liste
 * ohne Filter/Kennzahlen/Statusfarben aus Phase 2.
 *
 * "Lektionen" = ALLE Lektionen des Kurses (Entwurf + veröffentlicht), nicht
 * nur veröffentlichte — bewusst anders als die Abschlussquoten-Logik im
 * Dashboard (admin/page.tsx zählt dort nur veröffentlichte Lektionen), weil
 * dies hier eine reine Redaktions-/Inhaltsübersicht ist, die auch unfertige
 * Kurse vollständig zeigen soll.
 *
 * "Teilnehmer" = echte Zeilenanzahl aus `enrollments` je Kurs — NICHT die im
 * Dashboard verwendete progress-Proxy-Metrik (dort dokumentiert begründet:
 * "alle aktiven Mitglieder sehen alle veröffentlichten Kurse"-Vereinfachung
 * ohne Enrollment-Pflicht). `enrollments` ist die tatsächliche
 * Kurszugehörigkeits-Quelle (supabase/migrations/0001_init.sql, genutzt u. a.
 * in lib/reporting/queries.ts, api/v1/enrollments) und damit hier die
 * präzisere, dokumentierte Wahl für eine Verwaltungsliste.
 *
 * Farbige Karo-Kacheln links vom Titel sind rein dekorativ (5 Tönungen aus
 * dem Export im Rundlauf nach Zeilenindex) — im Export beliebig zugewiesen,
 * hier ebenso ohne fachliche Bedeutung, keine erfundene Datenquelle.
 *
 * Statusänderung (Live/Entwurf/Archiviert) ist bewusst NICHT mehr inline in
 * dieser Liste (Export zeigt dort nur einen Anzeige-Badge) — die echte
 * Steuerung ist auf die Bearbeiten-Seite gewandert, siehe CourseStatusSelect
 * in publish-toggle.tsx und [id]/page.tsx.
 *
 * "Neuer Kurs" öffnet das bestehende CreateCourseForm in einem Modal
 * (new-course-dialog.tsx) statt einer im Export nicht vorhandenen Zielseite.
 */

const TINTS = ["#DFE2F4", "#E7E9F6", "#EDE7F5", "#E4E6F5", "#E9E6F3"];

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  published: { label: "Live", color: "#1F8A5B", bg: "#E3F2EA" },
  draft: { label: "Entwurf", color: "#1A1A2E", bg: "#F7EED4" },
  archived: { label: "Archiviert", color: "#66679B", bg: "#EEF0F7" },
};

const TABS: { key: string; label: string; status: string | null }[] = [
  { key: "alle", label: "Alle", status: null },
  { key: "live", label: "Live", status: "published" },
  { key: "entwurf", label: "Entwürfe", status: "draft" },
  { key: "archiv", label: "Archiv", status: "archived" },
];

export default async function AdminKursePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: statusParam } = await searchParams;
  const activeKey = TABS.some((t) => t.key === statusParam) ? statusParam! : "alle";

  const tenant = await getTenant();
  // Zugriff ist über admin/layout.tsx (checkStaffAccess) gated; ohne Mandant
  // rendert das Layout „Kein Zugriff". Die Seite wird im RSC-Baum dennoch
  // ausgewertet — daher defensiv abbrechen statt auf tenant!.id zu laufen.
  if (!tenant) return null;
  const tenantId = tenant.id;
  const supabase = await createClient();

  const { data: courses } = await supabase
    .from("courses")
    .select("id, title, slug, status")
    .eq("tenant_id", tenantId)
    .order("position", { ascending: true });

  const { data: modules } = await supabase
    .from("modules")
    .select("id, course_id")
    .eq("tenant_id", tenantId);

  const { data: lessons } = await supabase
    .from("lessons")
    .select("id, module_id")
    .eq("tenant_id", tenantId);

  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("course_id")
    .eq("tenant_id", tenantId);

  const courseIdByModule = new Map((modules ?? []).map((m) => [m.id, m.course_id]));
  const lessonCountByCourse = new Map<string, number>();
  for (const l of lessons ?? []) {
    const courseId = courseIdByModule.get(l.module_id);
    if (!courseId) continue;
    lessonCountByCourse.set(courseId, (lessonCountByCourse.get(courseId) ?? 0) + 1);
  }
  const memberCountByCourse = new Map<string, number>();
  for (const e of enrollments ?? []) {
    memberCountByCourse.set(e.course_id, (memberCountByCourse.get(e.course_id) ?? 0) + 1);
  }

  const allCourses = courses ?? [];
  const activeStatus = TABS.find((t) => t.key === activeKey)!.status;
  const visibleCourses = activeStatus
    ? allCourses.filter((c) => c.status === activeStatus)
    : allCourses;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-[18px]">
        <div className="flex-1">
          <div className="text-[13px] font-semibold" style={{ color: "#A9AAC4" }}>
            Inhalte · Kurse
          </div>
          <h1 className="mt-0.5 text-[26px] font-extrabold" style={{ letterSpacing: "-0.01em" }}>
            Kurse
          </h1>
        </div>
        <NewCourseDialog />
      </header>

      <div className="flex gap-2.5">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key === "alle" ? "/admin/kurse" : `/admin/kurse?status=${t.key}`}
            className="inline-flex rounded-[10px] px-[15px] py-[9px] text-sm font-semibold no-underline"
            style={
              t.key === activeKey
                ? { background: "#5663AE", color: "#fff" }
                : { background: "#fff", color: "#3E3F66", border: "1px solid #E7E8F2" }
            }
          >
            {t.label}
          </Link>
        ))}
      </div>

      <div className="overflow-hidden rounded-[14px] border bg-white" style={{ borderColor: "#E7E8F2" }}>
        <div
          className="grid gap-0 px-[26px] pb-3 pt-[18px] text-[13px] font-bold"
          style={{
            gridTemplateColumns: "2.6fr 1fr 1fr 1fr 0.6fr",
            color: "#A9AAC4",
            borderBottom: "1px solid #EEF0F7",
          }}
        >
          <div>Kurs</div>
          <div>Lektionen</div>
          <div>Teilnehmer</div>
          <div>Status</div>
          <div />
        </div>
        {visibleCourses.length === 0 ? (
          <p className="px-[26px] py-6 text-sm" style={{ color: "#A9AAC4" }}>
            Keine Kurse in dieser Ansicht.
          </p>
        ) : (
          visibleCourses.map((c, i) => {
            const meta = STATUS_META[c.status] ?? STATUS_META.draft;
            const tint = TINTS[i % TINTS.length];
            return (
              <div
                key={c.id}
                className="grid items-center gap-0 px-[26px] py-4 text-[15px]"
                style={{
                  gridTemplateColumns: "2.6fr 1fr 1fr 1fr 0.6fr",
                  borderBottom: "1px solid #F4F5FA",
                }}
              >
                <div className="flex items-center gap-3.5">
                  <span
                    aria-hidden="true"
                    className="h-8 w-11 flex-none rounded-[8px]"
                    style={{
                      backgroundColor: tint,
                      backgroundImage: `repeating-linear-gradient(45deg, ${tint} 0 6px, rgba(255,255,255,.5) 6px 12px)`,
                    }}
                  />
                  <span className="font-semibold">{c.title}</span>
                </div>
                <div style={{ color: "#3E3F66" }}>{lessonCountByCourse.get(c.id) ?? 0}</div>
                <div style={{ color: "#3E3F66" }}>{memberCountByCourse.get(c.id) ?? 0}</div>
                <div>
                  <span
                    className="inline-flex rounded-lg px-3 py-1 text-[13px] font-bold"
                    style={{ color: meta.color, background: meta.bg }}
                  >
                    {meta.label}
                  </span>
                </div>
                <div>
                  <Link href={`/admin/kurse/${c.id}`} className="text-sm font-semibold no-underline">
                    Bearb.
                  </Link>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
