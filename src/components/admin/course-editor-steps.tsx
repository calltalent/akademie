"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
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
import { MarketplaceStatusCard } from "@/components/admin/marketplace-status-card";
import { updateCourseCoverUrl } from "@/lib/courses/actions";
import type { CourseCategoryRow } from "@/lib/courses/categories";
import type { Block } from "@/lib/courses/schema";
import type { MarketplaceListingStatus } from "@/lib/marketplace/schema";

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
type StepNumber = 1 | 2 | 3 | 4;

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
  marketplaceListing,
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
  /** Marketplace M2 (03.08.2026) — Statuskarte im Veröffentlichen-Schritt, siehe MarketplaceStatusCard. */
  marketplaceListing: { status: MarketplaceListingStatus; reviewNote: string | null } | null;
  initialStep: StepNumber;
}) {
  const t = useTranslations("admin.courseEditor.steps");
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
          {t("backToList")}
        </Link>
        <div className="min-w-0 flex-1 truncate text-[15px] font-semibold" style={{ color: "#A9AAC4" }}>
          {courseTitle}
        </div>
      </div>

      <Stepper step={step} onSelect={setStep} />

      {step === 1 && (
        <Panel
          title={t("panel1Title")}
          subtitle={t("panel1Subtitle")}
          footer={<StepFoot onNext={() => setStep(2)} nextLabel={t("nextToInfo")} />}
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
                {t("courseImageLabel")}
              </span>
              <ThumbnailUpload
                initialUrl={courseCoverUrl}
                entityLabel={t("courseImageLabel")}
                entityTitle={courseTitle}
                onUpload={updateCourseCoverUrl.bind(null, courseId)}
              />
            </div>
          </div>
        </Panel>
      )}

      {step === 2 && (
        <Panel
          title={t("panel2Title")}
          subtitle={t("panel2Subtitle")}
          footer={<StepFoot onBack={() => setStep(1)} onNext={() => setStep(3)} nextLabel={t("nextToContent")} />}
        >
          <CourseInfoEditor courseId={courseId} initialGoals={courseGoals} initialAuthorId={courseAuthorId} trainers={trainers} />
        </Panel>
      )}

      {step === 3 && (
        <Panel
          title={t("panel3Title")}
          subtitle={t("panel3Subtitle")}
          footer={<StepFoot onBack={() => setStep(2)} onNext={() => setStep(4)} nextLabel={t("nextToPublish")} />}
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
                {t("noLessonSelected")}
              </p>
            )}
          </div>
        </Panel>
      )}

      {step === 4 && (
        <Panel
          title={t("panel4Title")}
          subtitle={t("panel4Subtitle")}
          footer={
            <StepFoot
              onBack={() => setStep(3)}
              onNext={() => router.push("/admin/kurse")}
              nextLabel={t("finishButton")}
              finish
              extraRight={<ReembedCourseButton courseId={courseId} />}
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

          <MarketplaceStatusCard listing={marketplaceListing} />

          <div
            className="flex flex-wrap items-center gap-4 rounded-[12px] border p-5"
            style={{ borderColor: "#E9CFCF", background: "#FBEAEA" }}
          >
            <div className="min-w-[220px] flex-1">
              <div className="text-[14.5px] font-bold" style={{ color: "#B14A4A" }}>
                {t("deleteCourseHeading")}
              </div>
              <div className="mt-0.5 text-[13px]" style={{ color: "#7A3535" }}>
                {t("deleteCourseHint", { enrollmentCount, certificateCount })}
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
  const t = useTranslations("admin.courseEditor.steps");
  const STEPS: { n: StepNumber; label: string }[] = [
    { n: 1, label: t("step1Label") },
    { n: 2, label: t("step2Label") },
    { n: 3, label: t("step3Label") },
    { n: 4, label: t("step4Label") },
  ];
  return (
    <nav
      aria-label={t("stepperAriaLabel")}
      className="flex flex-wrap items-center gap-x-3 gap-y-4 rounded-[14px] border bg-white px-6 py-5 sm:flex-nowrap sm:gap-0"
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
                  {t("stepPrefix", { n: s.n })}
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
  extraRight,
}: {
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  /** Letzter Schritt: kein "weiter zu X", sondern ein echter Abschluss ohne Pfeil. */
  finish?: boolean;
  /** Zusätzlicher Knopf links neben dem Abschluss-Knopf (nur Schritt 4: KI-Einbetten). */
  extraRight?: React.ReactNode;
}) {
  const t = useTranslations("admin.courseEditor.steps");
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5" style={{ borderColor: "#EEF0F7" }}>
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="rounded-[10px] border bg-white px-[18px] py-3 text-[15px] font-semibold"
          style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
        >
          {t("backButton")}
        </button>
      ) : (
        <span />
      )}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {extraRight}
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
  const t = useTranslations("admin.courseEditor.readiness");
  const items: { ok: boolean; okText: string; warnText: string }[] = [
    {
      ok: lessonCount > 0,
      okText: t("lessonsOk", { lessonCount, moduleCount }),
      warnText: t("lessonsWarn"),
    },
    { ok: hasCover, okText: t("coverOk"), warnText: t("coverWarn") },
    {
      ok: hasCategory,
      okText: t("categoryOk"),
      warnText: t("categoryWarn"),
    },
  ];
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[13px] font-bold" style={{ color: "#3E3F66" }}>
        {t("heading")}
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
