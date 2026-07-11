import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Option, QuestionKind, QuizKind } from "@/lib/quiz/schema";

/**
 * Lädt ein Quiz für Lernende (Client/QuizRunner) — SICHERHEITSKRITISCH.
 *
 * `questions` hat laut 0001_init.sql ausschließlich die Policy
 * `questions_staff_all` (`for all using (is_staff(tenant_id))`) — ein
 * Lernender darf über RLS gar nichts aus `questions` lesen. Deshalb:
 * 1. Mitgliedschaft + Quiz-Metadaten zuerst über den normalen Nutzer-Client
 *    prüfen (RLS `quizzes_member_select`: nur wenn member_role(tenant_id)
 *    gesetzt ist — jede aktive Mitgliedschaft, nicht nur Staff).
 * 2. Erst danach Fragen über den Admin-Client laden — mit einer STRIKTEN
 *    Spaltenliste, die `answer` (Lösung) NIE enthält. Die Lösung wird nicht
 *    nur im Rückgabewert weggelassen, sondern gar nicht erst aus der DB
 *    selektiert (kein Risiko durch versehentliches Weiterreichen).
 *
 * Für die vollständige Frage INKLUSIVE Lösung siehe die separate,
 * ausschließlich innerhalb von submitAttempt() genutzte Ladefunktion in
 * src/lib/quiz/actions.ts — bewusst NICHT hier, damit dieser Lernenden-Pfad
 * strukturell gar keinen Zugriff auf `answer` haben kann.
 */

export type LearnerQuestion =
  | { id: string; kind: "single"; prompt: string; points: number; options: Option[] }
  | { id: string; kind: "multi"; prompt: string; points: number; options: Option[] }
  | { id: string; kind: "gap"; prompt: string; points: number }
  | { id: string; kind: "open"; prompt: string; points: number };

export type LearnerQuiz = {
  id: string;
  title: string;
  kind: QuizKind;
  passPct: number;
  timeLimitS: number | null;
  attemptsAllowed: number | null;
  shuffle: boolean;
  questions: LearnerQuestion[];
  attemptsUsed: number;
};

export type LoadQuizResult =
  | { ok: true; quiz: LearnerQuiz }
  | { ok: false; reason: "not-found" | "not-authenticated" };

type QuestionWhitelistRow = {
  id: string;
  kind: QuestionKind;
  prompt: string;
  options: unknown;
  points: number;
};

function toLearnerQuestion(row: QuestionWhitelistRow): LearnerQuestion {
  if (row.kind === "single" || row.kind === "multi") {
    return {
      id: row.id,
      kind: row.kind,
      prompt: row.prompt,
      points: row.points,
      options: Array.isArray(row.options) ? (row.options as Option[]) : [],
    };
  }
  return { id: row.id, kind: row.kind, prompt: row.prompt, points: row.points };
}

export async function loadQuizForLearner(quizId: string): Promise<LoadQuizResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "not-authenticated" };

  // RLS quizzes_member_select liefert null sowohl bei Nichtexistenz als auch
  // bei fehlender Mitgliedschaft — bewusst dieselbe Fehlermeldung nach außen
  // (kein Leak, ob eine Quiz-ID überhaupt existiert).
  const { data: quizRow } = await supabase
    .from("quizzes")
    .select("id, tenant_id, title, kind, pass_pct, settings")
    .eq("id", quizId)
    .maybeSingle();
  if (!quizRow) return { ok: false, reason: "not-found" };

  const admin = createAdminClient();
  const { data: questionRows, error } = await admin
    .from("questions")
    .select("id, kind, prompt, options, points") // NIE 'answer' selektieren
    .eq("tenant_id", quizRow.tenant_id)
    .eq("quiz_id", quizId)
    .order("position", { ascending: true });
  if (error || !questionRows) return { ok: false, reason: "not-found" };

  const { count: attemptsUsed } = await supabase
    .from("attempts")
    .select("id", { count: "exact", head: true })
    .eq("quiz_id", quizId)
    .eq("user_id", user.id);

  const settings = (quizRow.settings ?? {}) as {
    time_limit_s?: number | null;
    attempts_allowed?: number | null;
    shuffle?: boolean;
  };

  return {
    ok: true,
    quiz: {
      id: quizRow.id,
      title: quizRow.title,
      kind: quizRow.kind as QuizKind,
      passPct: quizRow.pass_pct,
      timeLimitS: settings.time_limit_s ?? null,
      attemptsAllowed: settings.attempts_allowed ?? null,
      shuffle: settings.shuffle ?? false,
      questions: (questionRows as QuestionWhitelistRow[]).map(toLearnerQuestion),
      attemptsUsed: attemptsUsed ?? 0,
    },
  };
}
