import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { checkAdminAccess } from "@/lib/auth/staff";
import { NewCourseButton } from "@/components/admin/new-course-button";
import { CourseCategoryManager } from "@/components/admin/course-category-manager";
import { CourseListTable, type CourseListRow } from "@/components/admin/course-list-table";

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
 * "Neuer Kurs" (Stand 13.07.2026, siehe Änderung unten): ursprünglich ein
 * Modal mit Titel/Slug/Kategorie statt einer im Export nicht vorhandenen
 * Zielseite.
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
 *
 * Kategorie inline (23.07.2026, Josips Auftrag) — bewusste EINZIGE Ausnahme
 * von der obigen "Statusänderung nicht inline"-Entscheidung: Josip wollte
 * die Kategorie hier ausdrücklich direkt änderbar, ohne in den Editor zu
 * wechseln (`CourseCategorySelect`, gleiche Komponente wie im Editor, mit
 * neuer `compact`-Prop für die dichte Zeile). Status bleibt bewusst NUR im
 * Editor steuerbar (kein Auftrag, das zu ändern).
 *
 * Reihenfolge per Auf/Ab (23.07.2026, Josips Auftrag: "Kursposition nach oben
 * oder unten korrigieren") — `CoursePositionButtons`, gleiches Auf/Ab-Muster
 * wie Module/Sektionen im Kurs-Editor (kein Drag-and-Drop, siehe dortiger
 * Kopfkommentar). Bestimmt zugleich die Reihenfolge unter "Meine Kurse"
 * (`dashboard/page.tsx`, sortiert ebenfalls nach `courses.position`).
 *
 * Kennzahlenzeile + Live-Suche (25.07.2026, Josips Auftrag "auch die
 * Kursliste umbauen" im Zuge des neuen 4-Schritte-Editors): die eigentliche
 * Zeilendarstellung (Thumbnail, Kategorie, Status, Positions-/Löschknöpfe)
 * wanderte dafür unverändert in `CourseListTable` (course-list-table.tsx) —
 * Suche ist zwangsläufig Browser-Zustand, diese Seite bleibt Server
 * Component und liefert nur noch fertig aufbereitete Zeilen.
 *
 * "Neuer Kurs" ohne Modal (25.07.2026, Josips Fund direkt nach dem ersten
 * Live-Test des 4-Schritte-Editors: das alte Modal wirkte wie ein zweites,
 * älteres System): `NewCourseButton` (new-course-button.tsx) legt sofort
 * einen Entwurfs-Kurs an (`createDraftCourse()`) und navigiert direkt zu
 * Schritt 1 des Assistenten — kein Zwischenformular mehr.
 */

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
  const draftCount = allCourses.filter((c) => c.status === "draft").length;
  const totalMembers = (enrollments ?? []).length;

  const rows: CourseListRow[] = visibleCourses.map((c) => {
    // Auf/Ab bezieht sich auf ALLE Kurse des Mandanten (nicht nur die im
    // aktuell gefilterten Status-Tab sichtbaren) — siehe moveCourse()-
    // Kommentar und CoursePositionButtons-Kopfkommentar.
    const overallIndex = allCourses.findIndex((ac) => ac.id === c.id);
    return {
      id: c.id,
      title: c.title,
      status: c.status,
      coverUrl: c.cover_url,
      categoryId: c.category_id,
      lessons: lessonCountByCourse.get(c.id) ?? 0,
      members: memberCountByCourse.get(c.id) ?? 0,
      certificates: certificateCountByCourse.get(c.id) ?? 0,
      isFirst: overallIndex <= 0,
      isLast: overallIndex === -1 || overallIndex >= allCourses.length - 1,
    };
  });

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
          <p className="mt-1 text-[13.5px]" style={{ color: "#A9AAC4" }}>
            <b style={{ color: "#3E3F66" }}>{allCourses.length}</b> {allCourses.length === 1 ? "Kurs" : "Kurse"}
            {" · "}
            <b style={{ color: "#3E3F66" }}>{draftCount}</b> {draftCount === 1 ? "Entwurf" : "Entwürfe"}
            {" · "}
            <b style={{ color: "#3E3F66" }}>{totalMembers}</b> Teilnehmer insgesamt
          </p>
        </div>
        <div className="flex flex-none items-center gap-2.5">
          <CourseCategoryManager categories={managedCategories} />
          <NewCourseButton />
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

      <CourseListTable courses={rows} categories={allCategories} isAdmin={isAdmin} />
    </div>
  );
}
