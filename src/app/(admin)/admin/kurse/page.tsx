import Link from "next/link";
import { Pencil } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { checkAdminAccess } from "@/lib/auth/staff";
import { NewCourseDialog } from "@/components/admin/new-course-dialog";
import { DeleteCourseIconButton } from "@/components/admin/delete-course-icon-button";
import { ThumbnailUpload } from "@/components/admin/thumbnail-upload";
import { CourseCategoryManager } from "@/components/admin/course-category-manager";
import { updateCourseCoverUrl } from "@/lib/courses/actions";

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
 * Kursbild (18.07.2026, Josips Auftrag): die früher rein dekorative
 * Karo-Kachel links vom Titel zeigt jetzt das echte `cover_url`-Bild (16:9,
 * `object-fit: cover`) bzw. — falls noch keins gesetzt ist — eine anklick-
 * bare Platzhalterkachel zum Hochladen, siehe die generische
 * `components/admin/thumbnail-upload.tsx` (seit 19.07.2026 auch fürs
 * Modulbild in `module-lesson-tree.tsx` wiederverwendet).
 *
 * Statusänderung (Live/Entwurf/Archiviert) ist bewusst NICHT mehr inline in
 * dieser Liste (Export zeigt dort nur einen Anzeige-Badge) — die echte
 * Steuerung ist auf die Bearbeiten-Seite gewandert, siehe CourseStatusSelect
 * in publish-toggle.tsx und [id]/page.tsx.
 *
 * "Neuer Kurs" öffnet das bestehende CreateCourseForm in einem Modal
 * (new-course-dialog.tsx) statt einer im Export nicht vorhandenen Zielseite.
 *
 * Aktionsspalte (17.07.2026, Josips Wunsch): statt des früheren Textlinks
 * "Bearb." zwei Symbole — Stift (Bearbeiten) und Papierkorb (Löschen ohne
 * Umweg über den Kurs). Beide tragen ein `aria-label` MIT Kurstitel; ein
 * Symbol ohne zugänglichen Namen wäre ein Barrierefreiheits-Verstoß
 * (CLAUDE.md §3.4), und beim Durchtabben einer Liste hört man sonst nur
 * mehrfach "Bearbeiten"/"Löschen" ohne Bezug zur Zeile.
 *
 * Der Kurstitel ist zusätzlich selbst ein Link auf denselben Editor — zwei
 * Wege zum selben Ziel ist hier Absicht: der Titel ist das große, offensicht-
 * liche Klickziel (ein 36px-Stift als EINZIGER Weg in den Kurs wäre eine
 * unnötig kleine Trefferfläche), der Stift bleibt die explizite, beschriftete
 * Aktion neben dem Papierkorb.
 *
 * Der Papierkorb erscheint NUR für owner/admin (`checkAdminAccess()`):
 * `deleteCourse()` verlangt serverseitig `requireAdminTenant()` — einem
 * Trainer einen Knopf zu zeigen, der ausnahmslos in einer Fehlermeldung
 * endet, wäre in einer Liste gleich reihenweise irreführend. Der Stift bleibt
 * für alle Staff sichtbar (Bearbeiten verlangt nur `is_staff()`). Das ist die
 * zweite Verteidigungslinie in der UI-Schicht, nicht die Absicherung selbst —
 * die liegt weiterhin in RLS + Server Action (siehe lib/auth/staff.ts).
 */

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

  // Performance-Fix (19.07.2026, Josips Fund: "Löschen von Kursen" fühlt
  // sich langsam an — tatsächlich ist es diese Seite, die nach dem Löschen
  // neu lädt): die fünf Abfragen unten hängen ausschließlich an `tenantId`,
  // nicht voneinander — liefen aber sequenziell hintereinander (5-6
  // Rundläufe addiert statt parallel). `checkAdminAccess()` hängt ebenfalls
  // nur an Tenant/Session, nicht an den Kursdaten — läuft jetzt mit im
  // selben Promise.all statt danach.
  const [{ data: courses }, { data: modules }, { data: lessons }, { data: enrollments }, { data: certificates }, { data: categories }, adminAccess] =
    await Promise.all([
      supabase
        .from("courses")
        .select("id, title, slug, status, cover_url, category_id")
        .eq("tenant_id", tenantId)
        .order("position", { ascending: true }),
      supabase.from("modules").select("id, course_id").eq("tenant_id", tenantId),
      supabase.from("lessons").select("id, module_id").eq("tenant_id", tenantId),
      supabase.from("enrollments").select("course_id").eq("tenant_id", tenantId),
      // Für den Lösch-Bestätigungsdialog: echte Zählungen, keine Schätzung —
      // dieselbe Anforderung wie im Kurs-Editor ([id]/page.tsx). Hier bewusst
      // EINE Abfrage über alle Kurse des Mandanten statt einer
      // `count`-Abfrage pro Zeile (die Detailseite betrachtet genau einen
      // Kurs und zählt deshalb dort per `head: true`).
      supabase.from("certificates").select("course_id").eq("tenant_id", tenantId),
      // Kurskategorien (Migration 20260722180000_course_categories.sql,
      // Josips Auftrag: Kategorien im Admin-Bereich verwalten) — für
      // CourseCategoryManager und die Kategorie-Auswahl im "Neuer Kurs"-Modal.
      supabase
        .from("course_categories")
        .select("id, name")
        .eq("tenant_id", tenantId)
        .order("position", { ascending: true }),
      // Rollen-Gate für den Papierkorb (siehe Kopfkommentar unten). Schlägt
      // die Prüfung fehl, ist `isAdmin` false und die Liste rendert ohne
      // Löschknopf — der Zugriff auf die Seite selbst ist bereits über
      // admin/layout.tsx gegated.
      checkAdminAccess(),
    ]);
  const isAdmin = adminAccess.ok;
  const allCategories = categories ?? [];
  const courseCountByCategory = new Map<string, number>();
  for (const c of courses ?? []) {
    if (!c.category_id) continue;
    courseCountByCategory.set(c.category_id, (courseCountByCategory.get(c.category_id) ?? 0) + 1);
  }
  const managedCategories = allCategories.map((c) => ({
    id: c.id,
    name: c.name,
    courseCount: courseCountByCategory.get(c.id) ?? 0,
  }));

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
  const certificateCountByCourse = new Map<string, number>();
  for (const c of certificates ?? []) {
    certificateCountByCourse.set(c.course_id, (certificateCountByCourse.get(c.course_id) ?? 0) + 1);
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
        <div className="flex flex-none items-center gap-2.5">
          <CourseCategoryManager categories={managedCategories} />
          <NewCourseDialog categories={allCategories} />
        </div>
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
          visibleCourses.map((c) => {
            const meta = STATUS_META[c.status] ?? STATUS_META.draft;
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
                  <ThumbnailUpload
                    initialUrl={c.cover_url}
                    entityLabel="Kursbild"
                    entityTitle={c.title}
                    onUpload={updateCourseCoverUrl.bind(null, c.id)}
                  />
                  <Link
                    href={`/admin/kurse/${c.id}`}
                    prefetch={false}
                    className="font-semibold no-underline hover:underline"
                    style={{ color: "inherit" }}
                  >
                    {c.title}
                  </Link>
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
                <div className="flex items-center justify-end gap-2">
                  <Link
                    href={`/admin/kurse/${c.id}`}
                    prefetch={false}
                    aria-label={`Kurs bearbeiten: ${c.title}`}
                    title="Bearbeiten"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-[9px] border bg-white no-underline"
                    style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
                  >
                    <Pencil size={16} aria-hidden="true" />
                  </Link>
                  {isAdmin && (
                    <DeleteCourseIconButton
                      courseId={c.id}
                      title={c.title}
                      lessonCount={lessonCountByCourse.get(c.id) ?? 0}
                      enrollmentCount={memberCountByCourse.get(c.id) ?? 0}
                      certificateCount={certificateCountByCourse.get(c.id) ?? 0}
                    />
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
