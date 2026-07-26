"use client";

import { useState } from "react";
import { Check, ChevronDown, ExternalLink, Play } from "lucide-react";

const ACCENT = "#5663AE";

export type BookmarkedLesson = {
  bookmarkId: string;
  lessonId: string;
  title: string;
  thumbnailUrl: string | null;
  completed: boolean;
};
export type BookmarkCourseGroup = {
  courseId: string;
  courseTitle: string;
  courseSlug: string;
  courseDescription: string | null;
  courseCoverUrl: string | null;
  lessons: BookmarkedLesson[];
};

/**
 * Lesezeichen-Liste "für alle Kurse" (Josips Auftrag, 26.07.2026: "ordne die
 * Lesezeichen für alle Kurse bitte ähnlich wie bei Baulig an" — siehe
 * Baulig-Screenshot: pro Kurs eine eingeklappte Zeile mit Titel + Anzahl
 * ("N Lesezeichen"), aufklappbar über einen Chevron statt einer immer
 * offenen Lektionsliste). Struktur/Datenherkunft unverändert (weiterhin nach
 * Kurs gruppiert, siehe app/lesezeichen/page.tsx) — nur die Darstellung
 * wechselt von "immer ausgeklappt" zu einem Akkordeon, deshalb Client-
 * Komponente statt der bisherigen reinen Server-Rendering-Schleife.
 *
 * Bewusst im calltalent-Design (weiße Karten, ACCENT-Töne) statt Bauligs
 * Schwarz/Weiß-Optik übernommen — nur die Anordnung (eingeklappt, Zähler,
 * Chevron, Direktlink zum Kurs) ist das Vorbild, nicht die Farbwelt.
 */
export function BookmarksCourseList({ groups }: { groups: BookmarkCourseGroup[] }) {
  const [openId, setOpenId] = useState<string | null>(groups[0]?.courseId ?? null);

  return (
    <div className="flex max-w-[820px] flex-col gap-3">
      {groups.map((group) => {
        const open = openId === group.courseId;
        const doneCount = group.lessons.filter((l) => l.completed).length;
        const count = group.lessons.length;
        return (
          <div
            key={group.courseId}
            className="overflow-hidden rounded-2xl border bg-white"
            style={{ borderColor: "#E7E8F2" }}
          >
            <div
              role="button"
              tabIndex={0}
              onClick={() => setOpenId(open ? null : group.courseId)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpenId(open ? null : group.courseId);
                }
              }}
              aria-expanded={open}
              className="flex w-full cursor-pointer items-center gap-4 px-5 py-4 text-left"
              style={{ background: "transparent" }}
            >
              {group.courseCoverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- Storage-URL, kein next/image-Loader konfiguriert
                <img
                  src={group.courseCoverUrl}
                  alt=""
                  className="h-12 w-12 flex-none rounded-xl object-cover"
                />
              ) : (
                <span
                  className="h-12 w-12 flex-none rounded-xl"
                  style={{ background: "#DFE2F4" }}
                  aria-hidden="true"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-base font-extrabold" style={{ color: "#1A1A2E" }}>
                  {group.courseTitle}
                </div>
                <div className="mt-0.5 text-[13px] font-semibold uppercase" style={{ letterSpacing: "0.04em", color: "#A9AAC4" }}>
                  {count} Lesezeichen
                  {doneCount > 0 ? ` · ${doneCount} von ${count} erledigt` : ""}
                </div>
              </div>
              <a
                href={`/kurs/${group.courseSlug}`}
                onClick={(e) => e.stopPropagation()}
                title="Zum Kurs"
                aria-label="Zum Kurs"
                className="flex h-9 w-9 flex-none items-center justify-center rounded-[9px]"
                style={{ background: "#EEF0F7", color: ACCENT }}
              >
                <ExternalLink size={15} />
              </a>
              <span
                className="flex h-9 w-9 flex-none items-center justify-center rounded-[9px]"
                style={{ background: "#EEF0F7", color: ACCENT, transform: open ? "rotate(180deg)" : undefined }}
                aria-hidden="true"
              >
                <ChevronDown size={16} />
              </span>
            </div>

            {open && (
              <div className="flex flex-col gap-1.5 p-3 pt-0">
                {group.lessons.map((item) => (
                  <a
                    key={item.bookmarkId}
                    href={`/kurs/${group.courseSlug}/l/${item.lessonId}`}
                    className="flex items-center gap-3.5 rounded-xl px-2.5 py-2 no-underline"
                    style={{ background: "transparent" }}
                  >
                    <span
                      className="relative flex h-11 w-[64px] flex-none items-center justify-center overflow-hidden rounded-[8px]"
                      style={
                        item.thumbnailUrl
                          ? undefined
                          : {
                              backgroundColor: "#DFE2F4",
                              backgroundImage:
                                "repeating-linear-gradient(45deg,#DFE2F4 0 9px, rgba(255,255,255,.55) 9px 18px)",
                            }
                      }
                      aria-hidden="true"
                    >
                      {item.thumbnailUrl && (
                        // eslint-disable-next-line @next/next/no-img-element -- Bunny-CDN-URL, kein next/image-Loader konfiguriert
                        <img
                          src={item.thumbnailUrl}
                          alt=""
                          className="absolute inset-0 h-full w-full object-cover object-center"
                        />
                      )}
                      <span
                        className="relative flex h-5 w-5 items-center justify-center rounded-full"
                        style={{ background: ACCENT }}
                      >
                        <Play size={9} color="#fff" fill="#fff" />
                      </span>
                    </span>
                    <span className="min-w-0 flex-1 text-[15px] font-bold" style={{ color: "#1A1A2E" }}>
                      {item.title}
                    </span>
                    <span
                      className="flex h-7 w-7 flex-none items-center justify-center rounded-full"
                      style={{ background: item.completed ? "#E4F5EC" : "#F0F1F8" }}
                      aria-hidden="true"
                    >
                      <Check size={13} strokeWidth={3} color={item.completed ? "#3CA36A" : "#C6C8DC"} />
                    </span>
                  </a>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
