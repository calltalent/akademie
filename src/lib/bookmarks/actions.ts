"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { translateDbError } from "@/lib/errors/db";

export type BookmarkActionState = { error: string | null; bookmarked?: boolean };

/**
 * Design-Block (12.07.2026, Claude-Design-Export Teil 2 — siehe
 * supabase/migrations/20260712220000_bookmarks.sql). Ein Toggle statt
 * getrennter add/remove-Actions, spiegelt completeLesson()-Muster
 * (src/lib/progress/actions.ts): RLS (`bookmarks_own_all`) erzwingt
 * Eigentum + aktive Mitgliedschaft bereits auf DB-Ebene, hier nur die
 * Existenzprüfung für den Toggle selbst.
 */
export async function toggleBookmark(
  lessonId: string,
  courseSlug: string,
): Promise<BookmarkActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Nicht angemeldet." };

  const tenant = await getTenant();
  if (!tenant) return { error: "Kein Mandant zu diesem Host gefunden." };

  const { data: existing } = await supabase
    .from("bookmarks")
    .select("id")
    .eq("user_id", user.id)
    .eq("lesson_id", lessonId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase.from("bookmarks").delete().eq("id", existing.id);
    if (error) return { error: translateDbError(error) };
    revalidatePath(`/kurs/${courseSlug}/l/${lessonId}`);
    revalidatePath("/lesezeichen");
    return { error: null, bookmarked: false };
  }

  const { error } = await supabase.from("bookmarks").insert({
    tenant_id: tenant.id,
    user_id: user.id,
    lesson_id: lessonId,
  });
  if (error) return { error: translateDbError(error) };
  revalidatePath(`/kurs/${courseSlug}/l/${lessonId}`);
  revalidatePath("/lesezeichen");
  return { error: null, bookmarked: true };
}
