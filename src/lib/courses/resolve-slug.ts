import "server-only";
import type { createClient } from "@/lib/supabase/server";

/**
 * Findet einen für `unique (tenant_id, slug)` (0001_init.sql:97) eindeutigen
 * Kurs-Slug. Bei Kollision wird `-2`, `-3`, … angehängt (max. 20 Versuche —
 * bestehendes Muster aus `generator/apply.ts`, hierher gezogen, damit sowohl
 * der KI-Kurs-Generator (`applyDraftAsCourse`) als auch das manuelle
 * Umbenennen (`updateCourseTitle`) dieselbe Logik nutzen statt einer
 * zweiten Kopie.
 *
 * `excludeCourseId` (Umbenennen-Fall): nimmt den Kurs selbst aus der
 * Kollisionsprüfung aus. Ohne das würde ein Kurs beim Speichern OHNE
 * Titeländerung (Slug bleibt gleich) mit seinem eigenen, bereits
 * existierenden Slug kollidieren und bei jedem Speichern ein neues `-2`
 * bekommen.
 */
export async function resolveUniqueCourseSlug(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  baseSlug: string,
  excludeCourseId?: string,
): Promise<string> {
  let slug = baseSlug;
  for (let attempt = 1; attempt <= 20; attempt++) {
    let query = supabase.from("courses").select("id").eq("tenant_id", tenantId).eq("slug", slug);
    if (excludeCourseId) {
      query = query.neq("id", excludeCourseId);
    }
    const { data: existing } = await query.maybeSingle();
    if (!existing) break;
    slug = `${baseSlug}-${attempt + 1}`;
  }
  return slug;
}
