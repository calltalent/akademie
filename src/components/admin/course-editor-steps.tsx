"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check } from "lucide-react";
import { ModuleLessonTree, DeleteLessonButton, type ModuleRow } from "@/components/admin/module-lesson-tree";
import { BlockEditor } from "@/components/editor/block-editor";
import { LessonPublishToggle, CourseStatusSelect, CourseCategorySelect } from "@/components/admin/publish-toggle";
import { ReembedCourseButton } from "@/components/admin/reembed-course-button";
import { RefreshTranscriptButton } from "@/components/admin/refresh-transcript-button";
import { CourseTitleEditor } from "@/components/admin/course-title-editor";
import { DeleteCourseButton } from "@/components/admin/delete-course-button";
import { CourseInfoEditor } from "@/components/admin/course-info-editor";
import { ThumbnailUpload } from "@/components/admin/thumbnail-upload";
import { updateCourseCoverUrl } from "@/lib/courses/actions";
import type { CourseCategoryRow } from "@/lib/courses/categories";
import type { Block } from "@/lib/courses/schema";

/**
 * Kurs-Editor als 4-Schritte-Assistent (Josips Auftrag, 25.07.2026: die
 * bisher flache Editor-Seite — Titel/Status/Kategorie im Kopf, Kursziele/
 * Autor darunter, dann Modul-Baum + Block-Editor, alles gleichzeitig
 * sichtbar — durch eine geführte Schritt-Struktur ersetzen).
 *
 * Bewusst KEIN linearer Zwangs-Assistent: ein Kurs wird über Wochen
 * wiederholt bearbeitet, nicht einmalig angelegt. Jeder Schritt bleibt über
 * den Stepper jederzeit direkt anklickbar, "Weiter"/"Zurück" sind reine
 * Bequemlichkeits-Knöpfe. Kein Schritt blockiert einen anderen — alle
 * darunterliegenden Felder speichern weiterhin einzeln (onBlur/Server
 * Action) wie vorher, hier ändert sich nur die Anordnung, keine Logik.
 *
 * Schritt-Zuordnung folgt den bestehenden Komponenten 1:1, ohne sie
 * aufzubrechen: CourseTitleEditor (Titel/Slug/Beschreibung) bleibt am Stück
 * in Schritt 1, CourseInfoEditor (Kursziele/Autor) bleibt am Stück in
 * Schritt 2 — beide waren vorher schon in sich geschlossene Karten.
 *
 * Startschritt kommt von der Server Component ([id]/page.tsx): Schritt 3,
 * wenn über `?lesson=` bereits eine Lektion ausgewählt ist (Klick aus dem
 * Baum lädt die Seite serverseitig neu), sonst Schritt 1.
 */
const STEPS = [
  { n: 1 as const, label: "Grunddaten" },
  { n: 2 as const, label: "Informationen" },
  { n: 3 as const, label: "Inhalt & Struktur" },
  { n: 4 as const, label: "Veröffentlichung" },
];
type StepNumber = (typeof STEPS)[number]["n"];

export function CourseEditorSteps({
  courseId,
  courseTitle,
  courseSlug,
  courseDescription,
  courseStatus,
  courseCategoryId,
  courseCoverUrl,
  courseGoals,
  courseAuthorId,
  categories,
  trainers,
  modules,
  activeLessonId,
  activeLesson,
  activeLessonBlocks,
  courseQuizzes,
  lessonCount,
  enrollmentCount,
  certificateCount,
  initialStep,
}: {
  courseId: string;
  courseTitle: string;
  courseSlug: string;
  courseDescription: string;
  courseStatus: string;
  courseCategoryId: string | null;
  courseCoverUrl: string | null;
  courseGoals: string[];
  courseAuthorId: string | null;
  categories: CourseCategoryRow[];
  trainers: { id: string; name: string }[];
  modules: ModuleRow[];
  activeLessonId?: string;
  activeLesson: { id: string; title: string; status: string; video_bunny_id: string | null } | null;
  activeLessonBlocks: Block[];
  courseQuizzes: { id: string; title: string }[];
  lessonCount: number;
  enrollmentCount: number;
  certificateCount: number;
  initialStep: StepNumber;
}) {
  const [step, setStep] = useState<StepNumber>(initialStep);
  const router = useRouter();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/admin/kurse"
          className="inline-flex items-center gap-2 rounded-[10px] border bg-white px-4 py-3 text-[15px] font-semibold no-underline"
          style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
        >
          <ArrowLeft size={16} aria-hidden="true" style={{ color: "#5663AE" }} />
          Zurück zur Kursliste
        </Link>
        {/* Direkt neben "Zurück zur Kursliste" statt rechts aussen (Josips
            Fund, 25.07.2026): stand vorher weit vom Zurück-Link getrennt,
            mit dem Kurstitel dazwischen. */}
        <ReembedCourseButton courseId={courseId} />
        <div className="min-w-0 flex-1 truncate text-[15px] font-semibold" style={{ color: "#A9AAC4" }}>
          {courseTitle}
        </div>
      </div>

      <Stepper step={step} onSelect={setStep} />

      {step === 1 && (
        <Panel
          title="Grunddaten"
          subtitle="Titel, Adresse, Kategorie und Kursbild — sichtbar in Kursliste und Katalog."
          footer={<StepFoot onNext={() => setStep(2)} nextLabel="Weiter zu Informationen" />}
        >
          <CourseTitleEditor
            courseId={courseId}
            initialTitle={courseTitle}
            initialSlug={courseSlug}
            initialDescription={courseDescription}
          />
          <div className="flex flex-wrap items-start gap-6">
            <CourseCategorySelect courseId={courseId} categoryId={courseCategoryId} categories={categories} />
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-bold" style={{ color: "#3E3F66" }}>
                Kursbild
              </span>
              <ThumbnailUpload
                initialUrl={courseCoverUrl}
                entityLabel="Kursbild"
                entityTitle={courseTitle}
                onUpload={updateCourseCoverUrl.bind(null, courseId)}
              />
            </div>
          </div>
        </Panel>
      )}

      {step === 2 && (
        <Panel
          title="Informationen"
          subtitle="Kursziele und der zuständige Trainer — erscheinen im Information-Tab der Lernansicht."
          footer={<StepFoot onBack={() => setStep(1)} onNext={() => setStep(3)} nextLabel="Weiter zu Inhalt & Struktur" />}
        >
          <CourseInfoEditor courseId={courseId} initialGoals={courseGoals} initialAuthorId={courseAuthorId} trainers={trainers} />
        </Panel>
      )}

      {step === 3 && (
        <Panel
          title="Inhalt & Struktur"
          subtitle="Module, Sektionen und Lektionen anlegen und mit Inhalt füllen."
          footer={<StepFoot onBack={() => setStep(2)} onNext={() => setStep(4)} nextLabel="Weiter zu Veröffentlichung" />}
        >
          <div className="flex flex-col gap-[18px] lg:grid lg:items-start lg:gap-[26px] lg:grid-cols-[300px_1fr]">
            <ModuleLessonTree courseId={courseId} modules={modules} activeLessonId={activeLessonId} />

            {activeLesson ? (
              <div className="flex min-w-0 flex-col gap-5">
                <BlockEditor
                  lessonId={activeLesson.id}
                  courseId={courseId}
                  initialTitle={activeLesson.title}
                  initialBlocks={activeLessonBlocks}
                  courseQuizzes={courseQuizzes}
                />
                <div className="flex flex-wrap items-center gap-3">
                  <LessonPublishToggle lessonId={activeLesson.id} courseId={courseId} status={activeLesson.status} />
                  <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
                    {activeLesson.video_bunny_id ? <RefreshTranscriptButton lessonId={activeLesson.id} /> : null}
                    <DeleteLessonButton lessonId={activeLesson.id} courseId={courseId} title={activeLesson.title} />
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-base" style={{ color: "#66679B" }}>
                Lektion links auswählen oder anlegen, um Blöcke zu bearbeiten.
              </p>
            )}
          </div>
        </Panel>
      )}

      {step === 4 && (
        <Panel
          title="Veröffentlichung"
          subtitle="Status setzen und letzte Prüfung vor dem Sichtbarwerden für Teilnehmer."
          footer={
            <StepFoot
              onBack={() => setStep(3)}
              onNext={() => router.push("/admin/kurse")}
              nextLabel="Fertig — zur Kursliste"
              finish
            />
          }
        >
          <CourseStatusSelect courseId={courseId} status={courseStatus} />

          <ReadinessChecklist
            lessonCount={lessonCount}
            moduleCount={modules.length}
            hasCover={!!courseCoverUrl}
            hasCategory={!!courseCategoryId}
          />

          <div
            className="flex flex-wrap items-center gap-4 rounded-[12px] border p-5"
            style={{ borderColor: "#E9CFCF", background: "#FBEAEA" }}
          >
            <div className="min-w-[220px] flex-1">
              <div className="text-[14.5px] font-bold" style={{ color: "#B14A4A" }}>
                Kurs löschen
              </div>
              <div className="mt-0.5 text-[13px]" style={{ color: "#7A3535" }}>
                Entfernt den Kurs inkl. aller Lektionen unwiderruflich. {enrollmentCount}{" "}
                {enrollmentCount === 1 ? "Teilnehmer" : "Teilnehmer"} und {certificateCount}{" "}
                {certificateCount === 1 ? "Zertifikat sind" : "Zertifikate sind"} betroffen.
              </div>
            </div>
            <DeleteCourseButton
              courseId={courseId}
              title={courseTitle}
              lessonCount={lessonCount}
              enrollmentCount={enrollmentCount}
              certificateCount={certificateCount}
            />
          </div>
        </Panel>
      )}
    </div>
  );
}

function Stepper({ step, onSelect }: { step: StepNumber; onSelect: (n: StepNumber) => void }) {
  return (
    <nav
      aria-label="Kurs bearbeiten — Schritte"
      className="flex flex-wrap items-center gap-0 rounded-[14px] border bg-white px-6 py-5 sm:flex-nowrap"
      style={{ borderColor: "#E7E8F2" }}
    >
      {STEPS.map((s, idx) => {
        const state = s.n < step ? "done" : s.n === step ? "current" : "todo";
        return (
          <div key={s.n} className="flex flex-1 items-center gap-0" style={{ minWidth: "45%" }}>
            <button
              type="button"
              onClick={() => onSelect(s.n)}
              aria-current={state === "current" ? "step" : undefined}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
              <span
                className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-[13.5px] font-extrabold"
                style={
                  state === "done"
                    ? { background: "#5663AE", color: "#fff" }
                    : state === "current"
                      ? { background: "#EEF0FA", color: "#5663AE", border: "2px solid #5663AE" }
                      : { background: "#fff", color: "#A9AAC4", border: "2px solid #E7E8F2" }
                }
              >
                {state === "done" ? <Check size={15} aria-hidden="true" /> : s.n}
              </span>
              <span className="min-w-0">
                <span
                  className="block text-[11.5px] font-bold uppercase tracking-wide"
                  style={{ color: state === "current" ? "#5663AE" : "#A9AAC4" }}
                >
                  Schritt {s.n}
                </span>
                <span
                  className="block truncate text-[14.5px] font-bold"
                  style={{ color: state === "todo" ? "#3E3F66" : "#1A1A2E" }}
                >
                  {s.label}
                </span>
              </span>
            </button>
            {idx < STEPS.length - 1 && (
              <span
                aria-hidden="true"
                className="mx-3 hidden h-0.5 flex-1 rounded-full sm:block"
                style={{ background: s.n < step ? "#5663AE" : "#E7E8F2", minWidth: "24px" }}
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}

function Panel({
  title,
  subtitle,
  footer,
  children,
}: {
  title: string;
  subtitle: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5 rounded-[14px] border bg-white p-6 sm:p-7" style={{ borderColor: "#E7E8F2" }}>
      <div>
        <div className="text-[18px] font-extrabold" style={{ letterSpacing: "-0.005em" }}>
          {title}
        </div>
        <div className="mt-0.5 text-[13.5px]" style={{ color: "#A9AAC4" }}>
          {subtitle}
        </div>
      </div>
      {children}
      {footer}
    </div>
  );
}

function StepFoot({
  onBack,
  onNext,
  nextLabel,
  finish = false,
}: {
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  /** Letzter Schritt: kein "weiter zu X", sondern ein echter Abschluss ohne Pfeil. */
  finish?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t pt-5" style={{ borderColor: "#EEF0F7" }}>
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="rounded-[10px] border bg-white px-[18px] py-3 text-[15px] font-semibold"
          style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
        >
          ← Zurück
        </button>
      ) : (
        <span />
      )}
      {onNext && (
        <button
          type="button"
          onClick={onNext}
          className="inline-flex items-center gap-2 rounded-[10px] px-[18px] py-3 text-[15px] font-bold text-white"
          style={{ background: "#5663AE" }}
        >
          {finish && <Check size={16} aria-hidden="true" />}
          {nextLabel}
          {!finish && " →"}
        </button>
      )}
    </div>
  );
}

/**
 * Rein informativ, kein Speicher-Gate (siehe Kopfkommentar) — zeigt nur den
 * echten Stand aus bereits geladenen Props, keine zusätzliche Abfrage.
 */
function ReadinessChecklist({
  lessonCount,
  moduleCount,
  hasCover,
  hasCategory,
}: {
  lessonCount: number;
  moduleCount: number;
  hasCover: boolean;
  hasCategory: boolean;
}) {
  const items: { ok: boolean; okText: string; warnText: string }[] = [
    {
      ok: lessonCount > 0,
      okText: `${lessonCount} ${lessonCount === 1 ? "Lektion" : "Lektionen"} in ${moduleCount} ${moduleCount === 1 ? "Modul" : "Modulen"}`,
      warnText: "Noch keine Lektionen angelegt",
    },
    { ok: hasCover, okText: "Kursbild gesetzt", warnText: "Noch kein Kursbild (Schritt 1)" },
    {
      ok: hasCategory,
      okText: "Kategorie gesetzt",
      warnText: "Keine Kategorie gewählt — Kurs erscheint im Katalog nur unter „Alle Kurse“ (Schritt 1)",
    },
  ];
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[13px] font-bold" style={{ color: "#3E3F66" }}>
        Prüfung vor Veröffentlichung
      </div>
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2.5 text-[14px]" style={{ color: "#3E3F66" }}>
          <span
            className="flex h-5 w-5 flex-none items-center justify-center rounded-full text-[11px] font-extrabold"
            style={item.ok ? { background: "#E3F2EA", color: "#1F8A5B" } : { background: "#F7EED4", color: "#8A6D1F" }}
            aria-hidden="true"
          >
            {item.ok ? <Check size={12} aria-hidden="true" /> : "!"}
          </span>
          {item.ok ? item.okText : item.warnText}
        </div>
      ))}
    </div>
  );
}
