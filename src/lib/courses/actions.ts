"use server";

import { revalidatePath } from "next/cache";
import { requireStaffTenant } from "@/lib/auth/staff";
import {
  blocksSchema,
  courseSchema,
  lessonSchema,
  moduleSchema,
} from "@/lib/courses/schema";
import type { CourseActionState } from "@/lib/courses/state";

function errorState(e: unknown): CourseActionState {
  return { error: e instanceof Error ? e.message : "Unbekannter Fehler." };
}

// --- Kurse ---

export async function createCourse(
  _prevState: CourseActionState,
  formData: FormData,
): Promise<CourseActionState> {
  try {
    const { tenant, user, supabase } = await requireStaffTenant();
    const parsed = courseSchema.safeParse({
      title: formData.get("title"),
      slug: formData.get("slug"),
      description: formData.get("description") || undefined,
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }

    const { error } = await supabase.from("courses").insert({
      tenant_id: tenant.id,
      title: parsed.data.title,
      slug: parsed.data.slug,
      description: parsed.data.description ?? null,
      created_by: user.id,
    });
    if (error) {
      return { error: "Anlegen fehlgeschlagen: " + error.message };
    }

    revalidatePath("/admin/kurse");
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

export async function updateCourseStatus(
  courseId: string,
  status: "draft" | "published" | "archived",
): Promise<CourseActionState> {
  try {
    const { tenant, supabase } = await requireStaffTenant();
    const { error } = await supabase
      .from("courses")
      .update({ status })
      .eq("id", courseId)
      .eq("tenant_id", tenant.id);
    if (error) return { error: error.message };
    revalidatePath("/admin/kurse");
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

export async function deleteCourse(courseId: string): Promise<CourseActionState> {
  try {
    const { tenant, supabase } = await requireStaffTenant();
    const { error } = await supabase
      .from("courses")
      .delete()
      .eq("id", courseId)
      .eq("tenant_id", tenant.id);
    if (error) return { error: error.message };
    revalidatePath("/admin/kurse");
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

// --- Module ---

export async function createModule(
  courseId: string,
  _prevState: CourseActionState,
  formData: FormData,
): Promise<CourseActionState> {
  try {
    const { tenant, supabase } = await requireStaffTenant();
    const parsed = moduleSchema.safeParse({ title: formData.get("title") });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }

    const { count } = await supabase
      .from("modules")
      .select("id", { count: "exact", head: true })
      .eq("course_id", courseId);

    const { error } = await supabase.from("modules").insert({
      tenant_id: tenant.id,
      course_id: courseId,
      title: parsed.data.title,
      position: count ?? 0,
    });
    if (error) return { error: error.message };

    revalidatePath(`/admin/kurse/${courseId}`);
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

export async function deleteModule(
  moduleId: string,
  courseId: string,
): Promise<CourseActionState> {
  try {
    const { tenant, supabase } = await requireStaffTenant();
    const { error } = await supabase
      .from("modules")
      .delete()
      .eq("id", moduleId)
      .eq("tenant_id", tenant.id);
    if (error) return { error: error.message };
    revalidatePath(`/admin/kurse/${courseId}`);
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

export async function moveModule(
  moduleId: string,
  courseId: string,
  direction: "up" | "down",
): Promise<CourseActionState> {
  try {
    const { tenant, supabase } = await requireStaffTenant();
    const { data: modules, error: listError } = await supabase
      .from("modules")
      .select("id, position")
      .eq("course_id", courseId)
      .eq("tenant_id", tenant.id)
      .order("position", { ascending: true });
    if (listError || !modules) return { error: listError?.message ?? "Fehler." };

    const idx = modules.findIndex((m) => m.id === moduleId);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (idx < 0 || swapIdx < 0 || swapIdx >= modules.length) {
      return { error: null, success: true }; // Rand erreicht, kein Fehler
    }

    const a = modules[idx];
    const b = modules[swapIdx];
    await supabase
      .from("modules")
      .update({ position: b.position })
      .eq("id", a.id)
      .eq("tenant_id", tenant.id);
    await supabase
      .from("modules")
      .update({ position: a.position })
      .eq("id", b.id)
      .eq("tenant_id", tenant.id);

    revalidatePath(`/admin/kurse/${courseId}`);
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

// --- Lektionen ---

export async function createLesson(
  moduleId: string,
  courseId: string,
  _prevState: CourseActionState,
  formData: FormData,
): Promise<CourseActionState> {
  try {
    const { tenant, supabase } = await requireStaffTenant();
    const parsed = lessonSchema.safeParse({ title: formData.get("title") });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }

    const { count } = await supabase
      .from("lessons")
      .select("id", { count: "exact", head: true })
      .eq("module_id", moduleId);

    const { error } = await supabase.from("lessons").insert({
      tenant_id: tenant.id,
      module_id: moduleId,
      title: parsed.data.title,
      position: count ?? 0,
      blocks: [],
    });
    if (error) return { error: error.message };

    revalidatePath(`/admin/kurse/${courseId}`);
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

export async function deleteLesson(
  lessonId: string,
  courseId: string,
): Promise<CourseActionState> {
  try {
    const { tenant, supabase } = await requireStaffTenant();
    const { error } = await supabase
      .from("lessons")
      .delete()
      .eq("id", lessonId)
      .eq("tenant_id", tenant.id);
    if (error) return { error: error.message };
    revalidatePath(`/admin/kurse/${courseId}`);
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

export async function updateLessonStatus(
  lessonId: string,
  courseId: string,
  status: "draft" | "published",
): Promise<CourseActionState> {
  try {
    const { tenant, supabase } = await requireStaffTenant();
    const { error } = await supabase
      .from("lessons")
      .update({ status })
      .eq("id", lessonId)
      .eq("tenant_id", tenant.id);
    if (error) return { error: error.message };
    revalidatePath(`/admin/kurse/${courseId}`);
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

/** Autosave: komplettes blocks-Array serverseitig zod-validiert überschreiben. */
export async function saveLessonBlocks(
  lessonId: string,
  courseId: string,
  blocksJson: unknown,
): Promise<CourseActionState> {
  try {
    const { tenant, supabase } = await requireStaffTenant();
    const parsed = blocksSchema.safeParse(blocksJson);
    if (!parsed.success) {
      return { error: "Ungültige Blöcke: " + parsed.error.issues[0]?.message };
    }

    // Security-Fix (security-reviewer-Audit 11.07.2026, MITTEL): Bunny-
    // Video-IDs waren ohne Mandantenbindung speicherbar. Jede referenzierte
    // videoId muss über bunny_videos zum eigenen Mandanten gehören (RLS
    // bunny_videos_staff_all filtert automatisch auf is_staff(tenant.id),
    // ein fremdes Video taucht hier also gar nicht erst auf).
    const videoIds = parsed.data
      .filter((b): b is Extract<typeof b, { type: "video" }> => b.type === "video")
      .map((b) => b.bunnyVideoId)
      .filter((id): id is string => id !== null);
    if (videoIds.length > 0) {
      const { data: ownedVideos, error: videoLookupError } = await supabase
        .from("bunny_videos")
        .select("video_id")
        .in("video_id", videoIds);
      if (videoLookupError) {
        return { error: "Video-Prüfung fehlgeschlagen: " + videoLookupError.message };
      }
      const ownedIds = new Set((ownedVideos ?? []).map((v) => v.video_id));
      const foreignId = videoIds.find((id) => !ownedIds.has(id));
      if (foreignId) {
        return { error: "Video gehört nicht zu diesem Mandanten." };
      }
    }

    const { error } = await supabase
      .from("lessons")
      .update({ blocks: parsed.data })
      .eq("id", lessonId)
      .eq("tenant_id", tenant.id);
    if (error) return { error: error.message };

    revalidatePath(`/admin/kurse/${courseId}`);
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

export async function updateLessonTitle(
  lessonId: string,
  courseId: string,
  title: string,
): Promise<CourseActionState> {
  try {
    const { tenant, supabase } = await requireStaffTenant();
    const parsed = lessonSchema.safeParse({ title });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Ungültiger Titel." };
    }
    const { error } = await supabase
      .from("lessons")
      .update({ title: parsed.data.title })
      .eq("id", lessonId)
      .eq("tenant_id", tenant.id);
    if (error) return { error: error.message };
    revalidatePath(`/admin/kurse/${courseId}`);
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}
