"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { computeCourseProgress, type ModuleSummary } from "@/lib/progress/compute";
import { issueCertificateIfEligible } from "@/lib/certificates/issue";

export type ProgressActionState = { error: string | null; success?: boolean };

/**
 * RLS `progress_own` erlaubt jedem angemeldeten Nutzer nur seine eigene
 * Zeile (user_id = auth.uid()) — keine Mitgliedschafts- oder Enrollment-
 * Prüfung nötig, das erzwingt die Datenbank bereits.
 */
export async function completeLesson(
  lessonId: string,
  courseSlug: string,
): Promise<ProgressActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Nicht angemeldet." };

  const tenant = await getTenant();
  if (!tenant) return { error: "Kein Mandant zu diesem Host gefunden." };

  const { error } = await supabase.from("progress").upsert(
    {
      tenant_id: tenant.id,
      user_id: user.id,
      lesson_id: lessonId,
      status: "completed",
      completed_at: new Date().toISOString(),
    },
    { onConflict: "user_id,lesson_id" },
  );
  if (error) return { error: error.message };

  // Zertifikats-Ausstellung (Phase 2, Block 4) — FAIL-SOFT: die Lektion ist
  // bereits korrekt als abgeschlossen gespeichert (Upsert oben erfolgreich),
  // ein Fehler bei der Zertifikat-Ausstellung darf completeLesson() selbst
  // nie scheitern lassen. issueCertificateIfEligible() prüft die
  // Vollständigkeit selbst nochmal (Defense-in-Depth) — der Aufruf hier
  // dient nur als Trigger direkt nach jedem Lektionsabschluss.
  try {
    const { data: course } = await supabase
      .from("courses")
      .select("id")
      .eq("tenant_id", tenant.id)
      .eq("slug", courseSlug)
      .maybeSingle();

    if (course) {
      const { data: modules } = await supabase
        .from("modules")
        .select("id")
        .eq("course_id", course.id);
      const moduleIds = (modules ?? []).map((m) => m.id);

      const { data: lessons } =
        moduleIds.length > 0
          ? await supabase
              .from("lessons")
              .select("id, module_id")
              .in("module_id", moduleIds)
              .eq("status", "published")
          : { data: [] };

      const { data: progressRows } =
        (lessons ?? []).length > 0
          ? await supabase
              .from("progress")
              .select("lesson_id, status")
              .eq("user_id", user.id)
              .in(
                "lesson_id",
                (lessons ?? []).map((l) => l.id),
              )
          : { data: [] };

      const completedIds = new Set(
        (progressRows ?? []).filter((p) => p.status === "completed").map((p) => p.lesson_id),
      );
      const moduleSummaries: ModuleSummary[] = moduleIds.map((mid) => ({
        id: mid,
        lessons: (lessons ?? [])
          .filter((l) => l.module_id === mid)
          .map((l) => ({ id: l.id, completed: completedIds.has(l.id) })),
      }));

      if (computeCourseProgress(moduleSummaries).isComplete) {
        const result = await issueCertificateIfEligible(course.id, user.id, tenant.id);
        if (!result.ok) {
          console.error("[progress/actions] Zertifikat-Ausstellung fehlgeschlagen (fail-soft):", result.error);
        }
      }
    }
  } catch (certError) {
    console.error(
      "[progress/actions] Ausnahme bei Zertifikat-Ausstellung (fail-soft):",
      certError instanceof Error ? certError.message : certError,
    );
  }

  revalidatePath(`/kurs/${courseSlug}`);
  revalidatePath("/");
  revalidatePath("/profil");
  return { error: null, success: true };
}
