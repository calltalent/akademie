"use client";

import { useState } from "react";
import Link from "next/link";
import { Pencil, Search } from "lucide-react";
import { ThumbnailUpload } from "@/components/admin/thumbnail-upload";
import { CourseCategorySelect } from "@/components/admin/publish-toggle";
import { CoursePositionButtons } from "@/components/admin/course-position-buttons";
import { DeleteCourseIconButton } from "@/components/admin/delete-course-icon-button";
import { updateCourseCoverUrl } from "@/lib/courses/actions";
import type { CourseCategoryRow } from "@/lib/courses/categories";

export type CourseListRow = {
  id: string;
  title: string;
  status: string;
  coverUrl: string | null;
  categoryId: string | null;
  lessons: number;
  members: number;
  certificates: number;
  isFirst: boolean;
  isLast: boolean;
};

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  published: { label: "Live", color: "#1F8A5B", bg: "#E3F2EA" },
  draft: { label: "Entwurf", color: "#1A1A2E", bg: "#F7EED4" },
  archived: { label: "Archiviert", color: "#66679B", bg: "#EEF0F7" },
};

const COURSE_LIST_COLS = "1.7fr 1.1fr 0.7fr 0.8fr 0.8fr 1.3fr";

/**
 * Live-Suche über der Kursliste (Josips Auftrag, 25.07.2026 — "auch die
 * Kursliste umbauen"). Eigene Client-Komponente, weil Suche zwangsläufig
 * Browser-Zustand ist; die Seite selbst (admin/kurse/page.tsx) bleibt
 * Server Component und filtert wie bisher nach Status-Tab (URL-getrieben,
 * `?status=`), BEVOR sie die Zeilen hierher übergibt — die Suche filtert
 * innerhalb der bereits tab-gefilterten Menge weiter, sucht also nicht über
 * Tab-Grenzen hinweg. Die Zeilen selbst (Thumbnail-Upload, Kategorie-Auswahl,
 * Positions-/Löschknöpfe) sind unverändert dieselben Komponenten wie vorher,
 * nur aus der Server Component hierher verschoben.
 */
export function CourseListTable({
  courses,
  categories,
  isAdmin,
}: {
  courses: CourseListRow[];
  categories: CourseCategoryRow[];
  isAdmin: boolean;
}) {
  const [search, setSearch] = useState("");
  const visible = courses.filter((c) => c.title.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <div className="flex flex-col gap-3">
      <label
        className="flex max-w-xs items-center gap-2 rounded-[10px] border bg-white px-3 py-2.5"
        style={{ borderColor: "#E7E8F2" }}
      >
        <Search size={16} aria-hidden="true" style={{ color: "#A9AAC4" }} />
        <span className="sr-only">Kurs suchen</span>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Kurs suchen …"
          className="w-full text-[14.5px] outline-none"
          style={{ color: "#1A1A2E" }}
        />
      </label>

      <div className="overflow-hidden rounded-[14px] border bg-white" style={{ borderColor: "#E7E8F2" }}>
        <div
          className="rgrid-header px-[26px] pb-3 pt-[18px] text-[13px] font-bold"
          style={{
            "--rgrid-cols": COURSE_LIST_COLS,
            color: "#A9AAC4",
            borderBottom: "1px solid #EEF0F7",
          } as React.CSSProperties}
        >
          <div>Kurs</div>
          <div>Kategorie</div>
          <div>Lektionen</div>
          <div>Teilnehmer</div>
          <div>Status</div>
          <div />
        </div>
        {visible.length === 0 ? (
          <p className="px-[26px] py-6 text-sm" style={{ color: "#A9AAC4" }}>
            {courses.length === 0 ? "Keine Kurse in dieser Ansicht." : `Kein Kurs gefunden für „${search}“.`}
          </p>
        ) : (
          visible.map((c) => {
            const meta = STATUS_META[c.status] ?? STATUS_META.draft;
            return (
              <div
                key={c.id}
                className="rgrid-row px-[18px] py-4 text-[15px] lg:px-[26px]"
                style={{
                  "--rgrid-cols": COURSE_LIST_COLS,
                  borderBottom: "1px solid #F4F5FA",
                } as React.CSSProperties}
              >
                <div className="flex items-center gap-3.5">
                  <ThumbnailUpload
                    initialUrl={c.coverUrl}
                    entityLabel="Kursbild"
                    entityTitle={c.title}
                    onUpload={updateCourseCoverUrl.bind(null, c.id)}
                  />
                  <Link
                    href={`/admin/kurse/${c.id}`}
                    prefetch={false}
                    className="min-w-0 truncate font-semibold no-underline hover:underline"
                    style={{ color: "inherit" }}
                  >
                    {c.title}
                  </Link>
                </div>
                <div>
                  <span className="rgrid-label">Kategorie</span>
                  <CourseCategorySelect
                    courseId={c.id}
                    categoryId={c.categoryId}
                    categories={categories}
                    title={c.title}
                    compact
                  />
                </div>
                <div>
                  <span className="rgrid-label">Lektionen</span>
                  <span style={{ color: "#3E3F66" }}>{c.lessons}</span>
                </div>
                <div>
                  <span className="rgrid-label">Teilnehmer</span>
                  <span style={{ color: "#3E3F66" }}>{c.members}</span>
                </div>
                <div>
                  <span
                    className="inline-flex rounded-lg px-3 py-1 text-[13px] font-bold"
                    style={{ color: meta.color, background: meta.bg }}
                  >
                    {meta.label}
                  </span>
                </div>
                <div className="flex items-center gap-2 lg:justify-end">
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
                  <CoursePositionButtons courseId={c.id} title={c.title} isFirst={c.isFirst} isLast={c.isLast} />
                  {isAdmin && (
                    <DeleteCourseIconButton
                      courseId={c.id}
                      title={c.title}
                      lessonCount={c.lessons}
                      enrollmentCount={c.members}
                      certificateCount={c.certificates}
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
