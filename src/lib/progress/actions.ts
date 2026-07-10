"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";

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

  revalidatePath(`/kurs/${courseSlug}`);
  revalidatePath("/");
  return { error: null, success: true };
}
