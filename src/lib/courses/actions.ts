"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaffTenant, requireAdminTenant } from "@/lib/auth/staff";
import {
  blocksSchema,
  courseSchema,
  lessonSchema,
  moduleSchema,
  sectionSchema,
} from "@/lib/courses/schema";
import { slugify } from "@/lib/courses/slug";
import { resolveUniqueCourseSlug } from "@/lib/courses/resolve-slug";
import type { CourseActionState } from "@/lib/courses/state";
import { translateDbError } from "@/lib/errors/db";
import { genericErrorMessage } from "@/lib/errors/generic";
import { COURSE_CATEGORIES } from "@/lib/courses/categories";

/** Nur eine der Standard-Kategorien (oder null) zulassen. */
function normalizeCategory(raw: FormDataEntryValue | string | null): string | null {
  return typeof raw === "string" && (COURSE_CATEGORIES as readonly string[]).includes(raw)
    ? raw
    : null;
}

function errorState(e: unknown): CourseActionState {
  return { error: genericErrorMessage(e) };
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
      category: normalizeCategory(formData.get("category")),
      created_by: user.id,
    });
    if (error) {
      return { error: "Anlegen fehlgeschlagen: " + translateDbError(error) };
    }

    revalidatePath("/admin/kurse");
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

export async function updateCourseCategory(
  courseId: string,
  category: string | null,
): Promise<CourseActionState> {
  try {
    const { tenant, supabase } = await requireStaffTenant();
    const { error } = await supabase
      .from("courses")
      .update({ category: normalizeCategory(category) })
      .eq("id", courseId)
      .eq("tenant_id", tenant.id);
    if (error) return { error: translateDbError(error) };
    revalidatePath("/admin/kurse");
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

/**
 * Kursbild (18.07.2026, Josips Auftrag: "Kursübersicht -> Option für
 * Kurs-Thumbnail 16:9"). `courses.cover_url` existiert bereits seit
 * 0001_init.sql, war bisher aber komplett ungenutzt (keine Schreib-/
 * Leseseite) — nur diese Spalte fehlte, keine Migration nötig. Der Upload
 * selbst läuft über den bereits bestehenden `course-assets`-Bucket-Fluss
 * (`/api/course-assets/upload-url`, siehe `image-upload.tsx`); diese Action
 * übernimmt nur das Verknüpfen der fertigen URL mit dem Kurs.
 */
export async function updateCourseCoverUrl(
  courseId: string,
  url: string,
): Promise<CourseActionState> {
  try {
    const { tenant, supabase } = await requireStaffTenant();
    const parsed = z.string().url().safeParse(url);
    if (!parsed.success) {
      return { error: "Ungültige Bild-URL." };
    }
    const { error } = await supabase
      .from("courses")
      .update({ cover_url: parsed.data })
      .eq("id", courseId)
      .eq("tenant_id", tenant.id);
    if (error) return { error: translateDbError(error) };
    revalidatePath("/admin/kurse");
    revalidatePath(`/admin/kurse/${courseId}`);
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

/** Modulbild (19.07.2026, Josips Auftrag: "ähnlich wie für Kurse") — gleiches Muster wie `updateCourseCoverUrl`, nur auf `modules` statt `courses`. */
export async function updateModuleCoverUrl(
  moduleId: string,
  courseId: string,
  url: string,
): Promise<CourseActionState> {
  try {
    const { tenant, supabase } = await requireStaffTenant();
    const parsed = z.string().url().safeParse(url);
    if (!parsed.success) {
      return { error: "Ungültige Bild-URL." };
    }
    const { error } = await supabase
      .from("modules")
      .update({ cover_url: parsed.data })
      .eq("id", moduleId)
      .eq("tenant_id", tenant.id);
    if (error) return { error: translateDbError(error) };
    revalidatePath(`/admin/kurse/${courseId}`);
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
    if (error) return { error: translateDbError(error) };
    revalidatePath("/admin/kurse");
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

/**
 * Titel UND Slug ändern (Josips Entscheidung, siehe PHASENSTATUS.md — bewusst
 * NICHT nur der Titel, alte `/kurs/<slug>`-Links laufen danach ins Leere).
 * Bleibt Staff-Level wie `updateCourseStatus`/`updateCourseCategory` — anders
 * als das Löschen (siehe `deleteCourse`) ist Umbenennen nicht destruktiv
 * genug, um Trainern das Recht zu entziehen.
 *
 * Slug-Kollisionsauflösung über `resolveUniqueCourseSlug` mit
 * `excludeCourseId = courseId`: ohne die Selbst-Ausnahme würde der Kurs bei
 * JEDEM Speichern (auch ohne Titeländerung) mit seinem eigenen, bereits
 * existierenden Slug kollidieren und ein neues `-2` anhängen.
 */
export async function updateCourseTitle(
  courseId: string,
  title: string,
): Promise<CourseActionState & { slug?: string }> {
  try {
    const { tenant, supabase } = await requireStaffTenant();
    const parsed = courseSchema.pick({ title: true }).safeParse({ title });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Ungültiger Titel." };
    }

    const baseSlug = slugify(parsed.data.title);
    const slug = await resolveUniqueCourseSlug(supabase, tenant.id, baseSlug, courseId);

    const { error } = await supabase
      .from("courses")
      .update({ title: parsed.data.title, slug })
      .eq("id", courseId)
      .eq("tenant_id", tenant.id);
    if (error) return { error: translateDbError(error) };

    revalidatePath("/admin/kurse");
    revalidatePath(`/admin/kurse/${courseId}`);
    return { error: null, success: true, slug };
  } catch (e) {
    return errorState(e);
  }
}

/**
 * SICHERHEITSHÄRTUNG (Josips Entscheidung, siehe PHASENSTATUS.md): Löschen
 * kaskadiert per FK `on delete cascade` (0001_init.sql) auf certificates,
 * progress, submissions, enrollments, bookmarks, embeddings,
 * tutor_conversations, quizzes, attempts — ein Trainer (niedrigste
 * Staff-Rolle, von `requireStaffTenant()` bislang zugelassen) darf
 * ausgestellte Kundenzertifikate nicht vernichten können. Gleiche
 * `memberships_admin_write`-Linie wie die Nutzerverwaltung (siehe
 * `requireAdminTenant()`-Kommentar in src/lib/auth/staff.ts) — deshalb hier
 * `requireAdminTenant()` statt `requireStaffTenant()`.
 *
 * `confirmTitle` muss serverseitig EXAKT mit dem aktuellen Kurstitel
 * übereinstimmen — frisch aus der DB nachgeladen, NICHT dem Client vertraut
 * (eine reine Client-seitige Prüfung wäre umgehbar).
 *
 * `redirect()` bewusst AUSSERHALB des try/catch (gleiches Muster wie
 * `deleteTenant()`, src/lib/platform/actions.ts): Next.js implementiert
 * Redirects über eine interne Kontrollfluss-Exception, die ein umgebendes
 * try/catch sonst fälschlich als regulären Fehler abfangen würde.
 */
export async function deleteCourse(
  courseId: string,
  confirmTitle: string,
): Promise<CourseActionState> {
  let deleted = false;
  try {
    const { tenant, supabase } = await requireAdminTenant();

    const { data: course, error: courseError } = await supabase
      .from("courses")
      .select("title")
      .eq("id", courseId)
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    if (courseError) return { error: translateDbError(courseError) };
    if (!course) return { error: "Kurs nicht gefunden." };
    if (confirmTitle !== course.title) {
      return { error: "Bestätigung stimmt nicht überein — bitte den Kurstitel exakt eingeben." };
    }

    const { error } = await supabase
      .from("courses")
      .delete()
      .eq("id", courseId)
      .eq("tenant_id", tenant.id);
    if (error) return { error: translateDbError(error) };

    deleted = true;
  } catch (e) {
    return errorState(e);
  }

  if (deleted) {
    revalidatePath("/admin/kurse");
    redirect("/admin/kurse");
  }
  return { error: "Unbekannter Fehler beim Löschen." };
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
    if (error) return { error: translateDbError(error) };

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
    if (error) return { error: translateDbError(error) };
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
    if (listError || !modules) return { error: listError ? translateDbError(listError) : "Fehler." };

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

// --- Sektionen (Modul -> Sektion -> Lektion, Migration 20260718150000) ---
// Gleiches Muster wie Module oben (Zähl-basierte Position, Swap-Reorder) —
// Sektionen sind strukturell Module, nur eine Ebene tiefer.

export async function createSection(
  moduleId: string,
  courseId: string,
  _prevState: CourseActionState,
  formData: FormData,
): Promise<CourseActionState> {
  try {
    const { tenant, supabase } = await requireStaffTenant();
    const parsed = sectionSchema.safeParse({ title: formData.get("title") });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }

    const { count } = await supabase
      .from("sections")
      .select("id", { count: "exact", head: true })
      .eq("module_id", moduleId);

    const { error } = await supabase.from("sections").insert({
      tenant_id: tenant.id,
      module_id: moduleId,
      title: parsed.data.title,
      position: count ?? 0,
    });
    if (error) return { error: translateDbError(error) };

    revalidatePath(`/admin/kurse/${courseId}`);
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

/**
 * Löscht die Sektion. Lektionen darin werden NICHT mitgelöscht — die
 * Fremdschlüssel-Regel ist `on delete set null` (Migration
 * 20260718150000_sections.sql), sie fallen auf "lose im Modul" zurück statt
 * mit der Sektion zu verschwinden. Bewusst anders als `deleteModule()`
 * (dort kaskadiert das Löschen bis zu den Lektionen, weil ein Modul ohne
 * Lektionen keinen Sinn ergibt) — eine Sektion ist reine Gliederung, ihr
 * Verschwinden darf keine Lerninhalte mitreißen.
 */
export async function deleteSection(
  sectionId: string,
  courseId: string,
): Promise<CourseActionState> {
  try {
    const { tenant, supabase } = await requireStaffTenant();
    const { error } = await supabase
      .from("sections")
      .delete()
      .eq("id", sectionId)
      .eq("tenant_id", tenant.id);
    if (error) return { error: translateDbError(error) };
    revalidatePath(`/admin/kurse/${courseId}`);
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

export async function moveSection(
  sectionId: string,
  moduleId: string,
  courseId: string,
  direction: "up" | "down",
): Promise<CourseActionState> {
  try {
    const { tenant, supabase } = await requireStaffTenant();
    const { data: sections, error: listError } = await supabase
      .from("sections")
      .select("id, position")
      .eq("module_id", moduleId)
      .eq("tenant_id", tenant.id)
      .order("position", { ascending: true });
    if (listError || !sections) return { error: listError ? translateDbError(listError) : "Fehler." };

    const idx = sections.findIndex((s) => s.id === sectionId);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (idx < 0 || swapIdx < 0 || swapIdx >= sections.length) {
      return { error: null, success: true }; // Rand erreicht, kein Fehler
    }

    const a = sections[idx];
    const b = sections[swapIdx];
    await supabase
      .from("sections")
      .update({ position: b.position })
      .eq("id", a.id)
      .eq("tenant_id", tenant.id);
    await supabase
      .from("sections")
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

/**
 * Lektionen entstehen jetzt INNERHALB einer Sektion (Josips Auftrag,
 * 18.07.2026), nicht mehr direkt im Modul. `moduleId` wird bewusst NICHT vom
 * Client übernommen, sondern hier aus der Sektion selbst nachgeladen — sonst
 * könnte ein manipulierter Aufruf eine Lektion mit inkonsistentem
 * module_id/section_id-Paar anlegen (die Sektion gehört zu Modul A, die
 * Lektion trägt aber module_id von Modul B). Der Lookup dient zugleich als
 * Existenz-/Mandantenprüfung der Sektion, bevor überhaupt geschrieben wird.
 */
export async function createLesson(
  sectionId: string,
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

    const { data: section, error: sectionError } = await supabase
      .from("sections")
      .select("id, module_id")
      .eq("id", sectionId)
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    if (sectionError) return { error: translateDbError(sectionError) };
    if (!section) return { error: "Sektion nicht gefunden." };

    const { count } = await supabase
      .from("lessons")
      .select("id", { count: "exact", head: true })
      .eq("section_id", sectionId);

    const { error } = await supabase.from("lessons").insert({
      tenant_id: tenant.id,
      module_id: section.module_id,
      section_id: sectionId,
      title: parsed.data.title,
      position: count ?? 0,
      blocks: [],
    });
    if (error) return { error: translateDbError(error) };

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
    if (error) return { error: translateDbError(error) };
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
    if (error) return { error: translateDbError(error) };
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
        return { error: "Video-Prüfung fehlgeschlagen: " + translateDbError(videoLookupError) };
      }
      const ownedIds = new Set((ownedVideos ?? []).map((v) => v.video_id));
      const foreignId = videoIds.find((id) => !ownedIds.has(id));
      if (foreignId) {
        return { error: "Video gehört nicht zu diesem Mandanten." };
      }
    }

    // ABWEICHUNG vom architect-Plan für Block 6 (Auto-Transkript), technisch
    // nötig, dokumentiert in PHASENSTATUS.md: der Block-6-Plan geht davon
    // aus, dass `lessons.video_bunny_id` bereits gepflegt wird ("findet die
    // Lektion über lessons.video_bunny_id = bunnyVideoId") - tatsächlich gab
    // es dafür bisher KEINEN Schreibpfad, die Video-ID lag ausschließlich im
    // `blocks`-JSON (siehe videoBlockSchema). Ohne diese Synchronisierung
    // hätte der Bunny-Webhook nie eine Lektion zu einem Video finden können.
    // Nimmt den ERSTEN video-Block der Lektion (Ein-Video-pro-Lektion ist die
    // im Editor/SPEC vorgesehene Nutzung). Bei Video-WECHSEL (nicht nur
    // Erstzuweisung) werden alte Transkript-/Kapitel-/Zusammenfassungsdaten
    // zurückgesetzt, damit nie das Transkript des VORHERIGEN Videos unter dem
    // neuen Video angezeigt wird.
    const videoBlock = parsed.data.find(
      (b): b is Extract<typeof b, { type: "video" }> => b.type === "video",
    );
    const newVideoBunnyId = videoBlock?.bunnyVideoId ?? null;

    const { data: currentLesson } = await supabase
      .from("lessons")
      .select("video_bunny_id")
      .eq("id", lessonId)
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    const videoChanged = (currentLesson?.video_bunny_id ?? null) !== newVideoBunnyId;

    const updatePayload: Record<string, unknown> = {
      blocks: parsed.data,
      video_bunny_id: newVideoBunnyId,
    };
    if (videoChanged) {
      updatePayload.video_duration_s = null;
      updatePayload.transcript = null;
      updatePayload.summary = null;
      updatePayload.chapters = [];
    }

    const { error } = await supabase
      .from("lessons")
      .update(updatePayload)
      .eq("id", lessonId)
      .eq("tenant_id", tenant.id);
    if (error) return { error: translateDbError(error) };

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
    if (error) return { error: translateDbError(error) };
    revalidatePath(`/admin/kurse/${courseId}`);
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}