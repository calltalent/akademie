import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { questionRecordSchema, type Question, type QuizKind } from "@/lib/quiz/schema";
import { QuizEditor } from "@/components/admin/quiz-editor";

/**
 * Staff-Editor für ein einzelnes Quiz (Metadaten + Fragenliste). Liegt unter
 * (admin)/admin/... und erbt damit das Staff-Gate aus admin/layout.tsx;
 * Mutationen prüfen zusätzlich requireStaffTenant() (Defense-in-Depth wie
 * überall in courses/actions.ts).
 *
 * Fragen inkl. Lösung werden hier ganz normal über den Nutzer-Client
 * gelesen — RLS `questions_staff_all` erlaubt Staff vollen Zugriff, kein
 * Admin-Client nötig (anders als im Lernenden-Pfad, siehe lib/quiz/load.ts).
 */
export default async function QuizEditorPage({
  params,
}: {
  params: Promise<{ id: string; quizId: string }>;
}) {
  const { id: courseId, quizId } = await params;
  const tenant = await getTenant();
  const supabase = await createClient();

  const { data: quiz } = await supabase
    .from("quizzes")
    .select("id, title, kind, pass_pct, settings")
    .eq("id", quizId)
    .eq("tenant_id", tenant!.id)
    .maybeSingle();

  if (!quiz) {
    return (
      <div className="mx-auto max-w-3xl">
        <p className="text-base">Quiz nicht gefunden.</p>
        <a href={`/admin/kurse/${courseId}`} className="text-sm underline">
          Zurück zum Kurs-Editor
        </a>
      </div>
    );
  }

  const { data: questionRows } = await supabase
    .from("questions")
    .select("id, kind, prompt, options, answer, points, position")
    .eq("quiz_id", quizId)
    .order("position", { ascending: true });

  const questions: Question[] = (questionRows ?? [])
    .map((row) => {
      const parsed = questionRecordSchema.safeParse(row);
      return parsed.success ? parsed.data : null;
    })
    .filter((q): q is Question => q !== null);

  const settings = (quiz.settings ?? {}) as {
    time_limit_s?: number | null;
    attempts_allowed?: number | null;
    shuffle?: boolean;
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Quiz: {quiz.title}</h1>
        <a href={`/admin/kurse/${courseId}`} className="text-sm underline">
          Zurück zum Kurs-Editor
        </a>
      </div>

      <QuizEditor
        courseId={courseId}
        quizId={quiz.id}
        initialMeta={{
          title: quiz.title,
          kind: quiz.kind as QuizKind,
          passPct: quiz.pass_pct,
          timeLimitS: settings.time_limit_s ?? null,
          attemptsAllowed: settings.attempts_allowed ?? null,
          shuffle: settings.shuffle ?? false,
        }}
        initialQuestions={questions}
      />
    </div>
  );
}
