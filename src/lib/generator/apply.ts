"use server";

import { revalidatePath } from "next/cache";
import { requireStaffTenant } from "@/lib/auth/staff";
import type { createClient } from "@/lib/supabase/server";
import { blocksSchema } from "@/lib/courses/schema";
import { questionInputSchema } from "@/lib/quiz/schema";
import { courseDraftSchema, courseGenOutputSchema, type CourseDraft } from "@/lib/generator/schema";
import { translateDbError } from "@/lib/errors/db";

/**
 * `applyDraftAsCourse()` — Phase 3, Block 5 (Kurs-Generator). Wandelt einen
 * fertigen, von Staff im Admin-Bereich geprüften KI-Entwurf
 * (`ai_jobs.output.draft`, `status='done'`) in echte `courses`/`modules`/
 * `lessons`/`quizzes`/`questions`-Zeilen um.
 *
 * SICHERHEITSKRITISCH:
 * - Kurs wird IMMER als `status='draft'` angelegt (Spalten-Default aus
 *   0001_init.sql) — NIE automatisch `published`. Veröffentlichung bleibt
 *   ein bewusster, separater Schritt (Publish-Toggle aus Phase 1), genau
 *   wie überall sonst im Produkt. Qualitätskontrolle bei KI-generiertem
 *   Lerninhalt bleibt bei Staff.
 * - Lektionsinhalte laufen durch `blocksSchema` (inkl. `sanitizeLessonHtml`-
 *   Transform aus src/lib/courses/schema.ts) — der Kurs-Generator ist KEIN
 *   Sonderfall des HTML-Sanitizing-Fixes vom Phase-1-Security-Review:
 *   KI-generiertes HTML ist genauso wenig vertrauenswürdig wie
 *   Staff-eingegebenes.
 * - Der gespeicherte `output.draft`-jsonb wird erneut gegen
 *   `courseDraftSchema` validiert statt blind übernommen zu werden
 *   (Eingabegrenze, CLAUDE.md §2.3 — gilt auch für "eigene", bereits
 *   einmal validierte Daten aus der DB).
 * - Alle Schreibvorgänge über den regulären, RLS-gescopten Staff-Client
 *   (`requireStaffTenant()`), zusätzlich `.eq("tenant_id", tenant.id)` als
 *   Defense-in-Depth (Muster wie in src/lib/courses/actions.ts).
 */

type ApplyResult = { ok: true; courseId: string } | { ok: false; error: string };

/** Entfernt kombinierende diakritische Zeichen (U+0300-U+036F) nach NFKD-Normalisierung (ä -> a, ...). */
function stripDiacritics(input: string): string {
  return Array.from(input)
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return !(code >= 0x0300 && code <= 0x036f);
    })
    .join("");
}

function slugify(input: string): string {
  const base = stripDiacritics(input.toLowerCase().normalize("NFKD"))
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base || "kurs";
}

export async function applyDraftAsCourse(jobId: string): Promise<ApplyResult> {
  try {
    const { tenant, user, supabase } = await requireStaffTenant();

    const { data: job, error: jobError } = await supabase
      .from("ai_jobs")
      .select("id, tenant_id, kind, status, output")
      .eq("id", jobId)
      .eq("tenant_id", tenant.id)
      .eq("kind", "course_gen")
      .maybeSingle();
    if (jobError || !job) return { ok: false, error: "Kursentwurf nicht gefunden." };
    if (job.status !== "done") {
      return { ok: false, error: "Kursentwurf ist noch nicht fertig generiert." };
    }

    const parsedOutput = courseGenOutputSchema.safeParse(job.output ?? {});
    if (!parsedOutput.success || !parsedOutput.data.draft) {
      return { ok: false, error: "Kursentwurf ist beschädigt oder unvollständig." };
    }
    const draftParsed = courseDraftSchema.safeParse(parsedOutput.data.draft);
    if (!draftParsed.success) {
      return {
        ok: false,
        error: "Kursentwurf ist ungültig: " + (draftParsed.error.issues[0]?.message ?? "unbekannter Fehler"),
      };
    }
    const draft: CourseDraft = draftParsed.data;

    // Eindeutigen Slug ermitteln (unique(tenant_id, slug), 0001_init.sql).
    const baseSlug = slugify(draft.title);
    let slug = baseSlug;
    for (let attempt = 1; attempt <= 20; attempt++) {
      const { data: existing } = await supabase
        .from("courses")
        .select("id")
        .eq("tenant_id", tenant.id)
        .eq("slug", slug)
        .maybeSingle();
      if (!existing) break;
      slug = `${baseSlug}-${attempt + 1}`;
    }

    // Kurs immer als Entwurf anlegen (courses.status default 'draft').
    const { data: course, error: courseError } = await supabase
      .from("courses")
      .insert({
        tenant_id: tenant.id,
        title: draft.title.slice(0, 300),
        slug,
        description: draft.description?.slice(0, 5000) ?? null,
        created_by: user.id,
      })
      .select("id")
      .single();
    if (courseError || !course) {
      return { ok: false, error: "Kurs konnte nicht angelegt werden: " + (courseError ? translateDbError(courseError) : "unbekannt") };
    }
    const courseId: string = course.id;

    for (let moduleIndex = 0; moduleIndex < draft.modules.length; moduleIndex++) {
      const draftModule = draft.modules[moduleIndex];

      const { data: moduleRow, error: moduleError } = await supabase
        .from("modules")
        .insert({
          tenant_id: tenant.id,
          course_id: courseId,
          title: draftModule.title.slice(0, 300),
          position: moduleIndex,
        })
        .select("id")
        .single();
      if (moduleError || !moduleRow) {
        console.error("[generator/apply] Modul konnte nicht angelegt werden:", moduleError?.message);
        continue; // einzelnes Modul überspringen statt gesamten Import abzubrechen
      }
      const moduleId: string = moduleRow.id;

      let lessonPosition = 0;
      for (const draftLesson of draftModule.lessons) {
        const blockId = crypto.randomUUID();
        const parsedBlocks = blocksSchema.safeParse([{ id: blockId, type: "text", html: draftLesson.contentHtml }]);
        const { error: lessonError } = await supabase.from("lessons").insert({
          tenant_id: tenant.id,
          module_id: moduleId,
          title: draftLesson.title.slice(0, 300),
          position: lessonPosition++,
          blocks: parsedBlocks.success ? parsedBlocks.data : [],
        });
        if (lessonError) {
          console.error("[generator/apply] Lektion konnte nicht angelegt werden:", lessonError.message);
        }
      }

      // Modul-Quiz: eigene, ans Modulende angehängte Lektion. Vermeidet die
      // Mehrdeutigkeit, an welche der mehreren Inhaltslektionen der
      // Quiz-Block sonst angehängt werden müsste — jede Lektion bekommt so
      // höchstens einen Block, analog zur bewussten Vereinfachung aus
      // Phase-2-Block-3 ("eine Lektion hat i. d. R. höchstens einen Block
      // eines Typs").
      if (draftModule.quiz) {
        await createModuleQuizLesson(supabase, {
          tenantId: tenant.id,
          courseId,
          moduleId,
          position: lessonPosition,
          quiz: draftModule.quiz,
        });
      }
    }

    revalidatePath("/admin/kurse");
    return { ok: true, courseId };
  } catch (e) {
    console.error("[generator/apply] applyDraftAsCourse fehlgeschlagen:", e instanceof Error ? e.message : e);
    return { ok: false, error: "Entwurf konnte nicht übernommen werden. Bitte erneut versuchen." };
  }
}

async function createModuleQuizLesson(
  supabase: Awaited<ReturnType<typeof createClient>>,
  params: {
    tenantId: string;
    courseId: string;
    moduleId: string;
    position: number;
    quiz: NonNullable<CourseDraft["modules"][number]["quiz"]>;
  },
): Promise<void> {
  const { data: lessonRow, error: lessonError } = await supabase
    .from("lessons")
    .insert({
      tenant_id: params.tenantId,
      module_id: params.moduleId,
      title: `Quiz: ${params.quiz.title}`.slice(0, 300),
      position: params.position,
      blocks: [],
    })
    .select("id")
    .single();
  if (lessonError || !lessonRow) {
    console.error("[generator/apply] Quiz-Lektion konnte nicht angelegt werden:", lessonError?.message);
    return;
  }
  const lessonId: string = lessonRow.id;

  const { data: quizRow, error: quizError } = await supabase
    .from("quizzes")
    .insert({
      tenant_id: params.tenantId,
      course_id: params.courseId,
      lesson_id: lessonId,
      title: params.quiz.title.slice(0, 300),
      kind: "quiz",
      pass_pct: 70,
      settings: {},
    })
    .select("id")
    .single();
  if (quizError || !quizRow) {
    console.error("[generator/apply] Quiz konnte nicht angelegt werden:", quizError?.message);
    return;
  }
  const quizId: string = quizRow.id;

  for (let qIndex = 0; qIndex < params.quiz.questions.length; qIndex++) {
    const draftQuestion = params.quiz.questions[qIndex];
    const optionIds = draftQuestion.options.map(() => crypto.randomUUID());

    // Gleiches Muster wie src/lib/quiz/actions.ts::upsertQuestion —
    // ausschließlich Einfachauswahl-Fragen (siehe schema.ts-Dateikopf).
    const parsedQuestion = questionInputSchema.safeParse({
      kind: "single",
      prompt: draftQuestion.prompt,
      points: 1,
      options: draftQuestion.options.map((opt, i) => ({ id: optionIds[i], text: opt.text })),
      answer: { correctOptionId: optionIds[draftQuestion.correctOptionIndex] },
    });
    if (!parsedQuestion.success) {
      console.error(
        "[generator/apply] Frage übersprungen (ungültig):",
        parsedQuestion.error.issues[0]?.message,
      );
      continue;
    }

    const { error: questionError } = await supabase.from("questions").insert({
      tenant_id: params.tenantId,
      quiz_id: quizId,
      position: qIndex,
      kind: parsedQuestion.data.kind,
      prompt: parsedQuestion.data.prompt,
      options: parsedQuestion.data.options,
      answer: parsedQuestion.data.answer,
      points: parsedQuestion.data.points,
    });
    if (questionError) {
      console.error("[generator/apply] Frage konnte nicht gespeichert werden:", questionError.message);
    }
  }

  // Quiz-Block in der neu angelegten Lektion verknüpfen (gleiches Muster wie
  // "Neues Quiz anlegen" im normalen Block-Editor, src/components/editor/block-form.tsx).
  const blockId = crypto.randomUUID();
  const parsedBlocks = blocksSchema.safeParse([{ id: blockId, type: "quiz", quizId, title: params.quiz.title }]);
  if (parsedBlocks.success) {
    const { error: updateError } = await supabase
      .from("lessons")
      .update({ blocks: parsedBlocks.data })
      .eq("id", lessonId)
      .eq("tenant_id", params.tenantId);
    if (updateError) {
      console.error("[generator/apply] Quiz-Block konnte nicht gespeichert werden:", updateError.message);
    }
  }
}
