"use server";

import { revalidatePath } from "next/cache";
import { requireStaffTenant } from "@/lib/auth/staff";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import {
  quizFormSchema,
  questionInputSchema,
  questionRecordSchema,
  attemptAnswersSchema,
  type Question,
} from "@/lib/quiz/schema";
import { gradeAttempt } from "@/lib/quiz/grade";
import type { QuizActionState, QuestionActionState } from "@/lib/quiz/state";
import { dispatchWebhookEvent } from "@/lib/webhooks/dispatch";
import { translateDbError } from "@/lib/errors/db";
import { genericErrorMessage } from "@/lib/errors/generic";

function errorState(e: unknown): QuizActionState {
  return { error: genericErrorMessage(e) };
}

// -------------------------------------------------------------
// Staff: Quiz-Metadaten
// -------------------------------------------------------------

/**
 * Legt ein leeres Quiz an (Default-Titel, 70% Bestehensgrenze, unbegrenzte
 * Versuche). Wird direkt aus dem Quiz-Block im Lektions-Editor aufgerufen
 * ("Neues Quiz anlegen"), nicht als <form>-Action — daher einfache
 * Argumente statt (prevState, formData).
 */
export async function createQuiz(
  courseId: string,
  title: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const { tenant, supabase } = await requireStaffTenant();

    const { data: course } = await supabase
      .from("courses")
      .select("id")
      .eq("id", courseId)
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    if (!course) return { ok: false, error: "Kurs nicht gefunden." };

    const safeTitle = title.trim().slice(0, 300) || "Neues Quiz";

    const { data, error } = await supabase
      .from("quizzes")
      .insert({
        tenant_id: tenant.id,
        course_id: courseId,
        title: safeTitle,
        kind: "quiz",
        pass_pct: 70,
        settings: {},
      })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: error ? translateDbError(error) : "Anlegen fehlgeschlagen." };

    revalidatePath(`/admin/kurse/${courseId}`);
    return { ok: true, id: data.id };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

export async function updateQuiz(
  quizId: string,
  courseId: string,
  _prevState: QuizActionState,
  formData: FormData,
): Promise<QuizActionState> {
  try {
    const { tenant, supabase } = await requireStaffTenant();

    const parsed = quizFormSchema.safeParse({
      title: formData.get("title"),
      kind: formData.get("kind"),
      passPct: formData.get("passPct"),
      attemptsAllowed: formData.get("attemptsAllowed"),
      timeLimitS: formData.get("timeLimitS"),
      shuffle: formData.get("shuffle"),
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }

    const { error } = await supabase
      .from("quizzes")
      .update({
        title: parsed.data.title,
        kind: parsed.data.kind,
        pass_pct: parsed.data.passPct,
        settings: {
          time_limit_s: parsed.data.timeLimitS,
          attempts_allowed: parsed.data.attemptsAllowed,
          shuffle: parsed.data.shuffle,
        },
      })
      .eq("id", quizId)
      .eq("tenant_id", tenant.id);
    if (error) return { error: translateDbError(error) };

    revalidatePath(`/admin/kurse/${courseId}/quiz/${quizId}`);
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

export async function deleteQuiz(
  quizId: string,
  courseId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { tenant, supabase } = await requireStaffTenant();
    // questions/attempts hängen per "on delete cascade" an quizzes (0001_init.sql)
    // — werden automatisch mit entfernt.
    const { error } = await supabase.from("quizzes").delete().eq("id", quizId).eq("tenant_id", tenant.id);
    if (error) return { ok: false, error: translateDbError(error) };

    revalidatePath(`/admin/kurse/${courseId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

// -------------------------------------------------------------
// Staff: Fragen
// -------------------------------------------------------------

export async function upsertQuestion(
  quizId: string,
  courseId: string,
  questionId: string | null,
  input: unknown,
): Promise<QuestionActionState> {
  try {
    const { tenant, supabase } = await requireStaffTenant();

    const parsed = questionInputSchema.safeParse(input);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Ungültige Frage." };
    }

    const { data: quiz } = await supabase
      .from("quizzes")
      .select("id")
      .eq("id", quizId)
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    if (!quiz) return { error: "Quiz nicht gefunden." };

    const row = {
      kind: parsed.data.kind,
      prompt: parsed.data.prompt,
      points: parsed.data.points,
      options: parsed.data.options,
      answer: parsed.data.answer,
    };

    if (questionId) {
      const { error } = await supabase
        .from("questions")
        .update(row)
        .eq("id", questionId)
        .eq("tenant_id", tenant.id)
        .eq("quiz_id", quizId);
      if (error) return { error: translateDbError(error) };
    } else {
      const { count } = await supabase
        .from("questions")
        .select("id", { count: "exact", head: true })
        .eq("quiz_id", quizId);
      const { error } = await supabase.from("questions").insert({
        tenant_id: tenant.id,
        quiz_id: quizId,
        position: count ?? 0,
        ...row,
      });
      if (error) return { error: translateDbError(error) };
    }

    revalidatePath(`/admin/kurse/${courseId}/quiz/${quizId}`);
    return { error: null, success: true };
  } catch (e) {
    return { error: genericErrorMessage(e) };
  }
}

export async function deleteQuestion(
  questionId: string,
  quizId: string,
  courseId: string,
): Promise<QuestionActionState> {
  try {
    const { tenant, supabase } = await requireStaffTenant();
    const { error } = await supabase
      .from("questions")
      .delete()
      .eq("id", questionId)
      .eq("tenant_id", tenant.id)
      .eq("quiz_id", quizId);
    if (error) return { error: translateDbError(error) };
    revalidatePath(`/admin/kurse/${courseId}/quiz/${quizId}`);
    return { error: null, success: true };
  } catch (e) {
    return { error: genericErrorMessage(e) };
  }
}

/** Auf/Ab wie moveModule in courses/actions.ts — kein Drag & Drop (Konsistenz mit Phase 1). */
export async function moveQuestion(
  questionId: string,
  quizId: string,
  courseId: string,
  direction: "up" | "down",
): Promise<QuestionActionState> {
  try {
    const { tenant, supabase } = await requireStaffTenant();
    const { data: questions, error: listError } = await supabase
      .from("questions")
      .select("id, position")
      .eq("quiz_id", quizId)
      .eq("tenant_id", tenant.id)
      .order("position", { ascending: true });
    if (listError || !questions) return { error: listError ? translateDbError(listError) : "Fehler." };

    const idx = questions.findIndex((q) => q.id === questionId);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (idx < 0 || swapIdx < 0 || swapIdx >= questions.length) {
      return { error: null, success: true }; // Rand erreicht, kein Fehler
    }

    const a = questions[idx];
    const b = questions[swapIdx];
    await supabase.from("questions").update({ position: b.position }).eq("id", a.id).eq("tenant_id", tenant.id);
    await supabase.from("questions").update({ position: a.position }).eq("id", b.id).eq("tenant_id", tenant.id);

    revalidatePath(`/admin/kurse/${courseId}/quiz/${quizId}`);
    return { error: null, success: true };
  } catch (e) {
    return { error: genericErrorMessage(e) };
  }
}

// -------------------------------------------------------------
// Lernende: Versuche
// -------------------------------------------------------------

type StartAttemptResult =
  | { ok: true; attemptsUsed: number; attemptsAllowed: number | null }
  | { ok: false; error: string };

/**
 * Reine Prüfung, KEIN Datenbank-Schreibvorgang (siehe SPEC-Abweichung in
 * PHASENSTATUS.md: es wird nur EINE vollständige attempts-Zeile geschrieben,
 * beim Abschluss in submitAttempt — kein separates "in Bearbeitung"-Row,
 * das sonst ohne UPDATE-RLS-Policy auf attempts nicht sauber abschließbar
 * wäre, ohne eine neue Migration zu benötigen).
 */
export async function startAttempt(quizId: string): Promise<StartAttemptResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Nicht angemeldet." };

  const allowed = await checkRateLimit("quiz-start", { maxRequests: 20, windowSeconds: 60, extraKey: user.id });
  if (!allowed) return { ok: false, error: RATE_LIMIT_MESSAGE };

  const { data: quizRow } = await supabase.from("quizzes").select("id, settings").eq("id", quizId).maybeSingle();
  if (!quizRow) return { ok: false, error: "Quiz nicht gefunden oder kein Zugriff." };

  const attemptsAllowed = ((quizRow.settings ?? {}) as { attempts_allowed?: number | null }).attempts_allowed ?? null;
  const { count } = await supabase
    .from("attempts")
    .select("id", { count: "exact", head: true })
    .eq("quiz_id", quizId)
    .eq("user_id", user.id);
  const attemptsUsed = count ?? 0;

  if (attemptsAllowed !== null && attemptsUsed >= attemptsAllowed) {
    return { ok: false, error: `Versuchslimit erreicht (${attemptsUsed} von ${attemptsAllowed}).` };
  }
  return { ok: true, attemptsUsed, attemptsAllowed };
}

type SubmitAttemptResult =
  | {
      ok: true;
      result: { scorePct: number; passed: boolean; attemptsUsed: number; attemptsAllowed: number | null };
    }
  | { ok: false; error: string };

/**
 * SICHERHEITSKRITISCH — Datenfluss exakt nach architect-Plan:
 * 1. Mandant/Mitgliedschaft ausschließlich aus dem Server-Kontext (nie aus
 *    Client-Eingaben).
 * 2. Versuchslimit serverseitig erneut gezählt (nicht dem Client vertraut,
 *    auch nicht dem Ergebnis von startAttempt() — das könnte veraltet sein).
 * 3. Rate Limiting gegen Brute-Force-Raten.
 * 4. Fragen INKLUSIVE Lösung ausschließlich hier über den Admin-Client
 *    geladen (nicht über loadQuizForLearner, das die Lösung entfernt).
 * 5. gradeAttempt() — reine Funktion, keine Client-Eingabe für Punkte/
 *    Bestanden-Status möglich.
 * 6. EINE vollständige attempts-Zeile über den Admin-Client geschrieben;
 *    tenant_id/user_id ausschließlich aus dem geprüften Server-Kontext.
 */
export async function submitAttempt(quizId: string, answersInput: unknown): Promise<SubmitAttemptResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Nicht angemeldet." };

    const allowed = await checkRateLimit("quiz-submit", { maxRequests: 15, windowSeconds: 60, extraKey: user.id });
    if (!allowed) return { ok: false, error: RATE_LIMIT_MESSAGE };

    const parsedAnswers = attemptAnswersSchema.safeParse(answersInput);
    if (!parsedAnswers.success) return { ok: false, error: "Ungültige Antworten." };

    // Mandant/Mitgliedschaft + Quiz-Metadaten per Nutzer-Client (RLS erzwingt
    // Mitgliedschaft im richtigen Mandanten; tenant_id für alle Folgeschritte
    // kommt ausschließlich hieraus, nie aus dem Client).
    const { data: quizRow } = await supabase
      .from("quizzes")
      .select("id, tenant_id, pass_pct, settings")
      .eq("id", quizId)
      .maybeSingle();
    if (!quizRow) return { ok: false, error: "Quiz nicht gefunden oder kein Zugriff." };

    const attemptsAllowed =
      ((quizRow.settings ?? {}) as { attempts_allowed?: number | null }).attempts_allowed ?? null;
    const { count: existingAttempts } = await supabase
      .from("attempts")
      .select("id", { count: "exact", head: true })
      .eq("quiz_id", quizId)
      .eq("user_id", user.id);
    const attemptsUsed = existingAttempts ?? 0;
    if (attemptsAllowed !== null && attemptsUsed >= attemptsAllowed) {
      return { ok: false, error: "Versuchslimit erreicht." };
    }

    // Interner Lade-Pfad NUR für diese Funktion: Fragen inklusive Lösung,
    // ausschließlich über den Admin-Client (RLS questions_staff_all würde
    // Lernende sonst komplett aussperren). Bewusst NICHT exportiert/in
    // load.ts, damit der Lernenden-Lesepfad (loadQuizForLearner) strukturell
    // nie an `answer` herankommen kann.
    const admin = createAdminClient();
    const { data: questionRows, error: qError } = await admin
      .from("questions")
      .select("id, kind, prompt, options, answer, points")
      .eq("tenant_id", quizRow.tenant_id)
      .eq("quiz_id", quizId)
      .order("position", { ascending: true });
    if (qError || !questionRows) return { ok: false, error: "Fragen konnten nicht geladen werden." };

    const questions: Question[] = [];
    for (const row of questionRows) {
      const parsedQuestion = questionRecordSchema.safeParse(row);
      if (parsedQuestion.success) {
        questions.push(parsedQuestion.data);
      } else {
        // Sollte bei staff-validierten Schreibpfaden (upsertQuestion) nicht
        // vorkommen — defensiv trotzdem: Frage überspringen statt Absturz.
        console.error("Ungültige Frage beim Bewerten übersprungen:", row.id, parsedQuestion.error.message);
      }
    }

    const grading = gradeAttempt(questions, parsedAnswers.data, quizRow.pass_pct);

    const nowIso = new Date().toISOString();
    const { error: insertError } = await admin.from("attempts").insert({
      tenant_id: quizRow.tenant_id,
      quiz_id: quizId,
      user_id: user.id,
      started_at: nowIso,
      submitted_at: nowIso,
      answers: parsedAnswers.data,
      score_pct: grading.scorePct,
      passed: grading.passed,
    });
    if (insertError) return { ok: false, error: "Speichern fehlgeschlagen: " + translateDbError(insertError) };

    // Block 7 (Webhooks): quiz.passed fire-and-forget, NUR wenn bestanden
    // (siehe dispatch.ts).
    if (grading.passed) {
      dispatchWebhookEvent(quizRow.tenant_id, "quiz.passed", {
        quiz_id: quizId,
        user_id: user.id,
        score_pct: grading.scorePct,
      }).catch(() => {});
    }

    return {
      ok: true,
      result: {
        scorePct: grading.scorePct,
        passed: grading.passed,
        attemptsUsed: attemptsUsed + 1,
        attemptsAllowed,
      },
    };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}
