"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaffTenant, requireAdminTenant } from "@/lib/auth/staff";
import {
  blocksSchema,
  courseCategorySchema,
  courseSchema,
  lessonSchema,
  moduleSchema,
  moduleSectionDescriptionSchema,
  sectionSchema,
} from "@/lib/courses/schema";
import { slugify } from "@/lib/courses/slug";
import { resolveUniqueCourseSlug } from "@/lib/courses/resolve-slug";
import type { CourseActionState } from "@/lib/courses/state";
import { translateDbError } from "@/lib/errors/db";
import { genericErrorMessage } from "@/lib/errors/generic";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Prüft, dass die übergebene Kategorie-ID (falls gesetzt) wirklich zu DIESEM
 * Mandanten gehört, bevor sie in `courses.category_id` geschrieben wird —
 * ohne diesen Check könnte ein manipulierter Aufruf die Kategorie-ID eines
 * FREMDEN Mandanten eintragen (die DB-FK selbst erlaubt das, sie kennt keine
 * Mandantengrenze). Gleiches Prinzip wie der bunny_videos-Eigentümer-Check in
 * `saveLessonBlocks` weiter unten.
 */
async function resolveCategoryId(
  supabase: SupabaseClient,
  tenantId: string,
  raw: FormDataEntryValue | string | null,
): Promise<{ ok: true; categoryId: string | null } | { ok: false; error: string }> {
  if (typeof raw !== "string" || raw === "") return { ok: true, categoryId: null };
  const { data, error } = await supabase
    .from("course_categories")
    .select("id")
    .eq("id", raw)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) return { ok: false, error: translateDbError(error) };
  if (!data) return { ok: false, error: "Kategorie nicht gefunden." };
  return { ok: true, categoryId: data.id };
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

    const categoryResult = await resolveCategoryId(supabase, tenant.id, formData.get("category"));
    if (!categoryResult.ok) return { error: categoryResult.error };

    // Position ans Ende anhängen (Josips Auftrag 23.07.2026, Kursreihenfolge
    // per Auf/Ab) — bisher fehlte das hier komplett, jeder neue Kurs blieb auf
    // dem Spalten-Default 0 stehen. Gleiches Zähl-Muster wie createSection.
    const { count } = await supabase
      .from("courses")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id);

    const { error } = await supabase.from("courses").insert({
      tenant_id: tenant.id,
      title: parsed.data.title,
      slug: parsed.data.slug,
      description: parsed.data.description ?? null,
      category_id: categoryResult.categoryId,
      position: count ?? 0,
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
  categoryId: string | null,
): Promise<CourseActionState> {
  try {
    const { tenant, supabase } = await requireStaffTenant();
    const categoryResult = await resolveCategoryId(supabase, tenant.id, categoryId);
    if (!categoryResult.ok) return { error: categoryResult.error };
    const { error } = await supabase
      .from("courses")
      .update({ category_id: categoryResult.categoryId })
      .eq("id", courseId)
      .eq("tenant_id", tenant.id);
    if (error) return { error: translateDbError(error) };
    revalidatePath("/admin/kurse");
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

// --- Kategorien ---

export async function createCourseCategory(
  _prevState: CourseActionState,
  formData: FormData,
): Promise<CourseActionState> {
  try {
    const { tenant, supabase } = await requireStaffTenant();
    const parsed = courseCategorySchema.safeParse({ name: formData.get("name") });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }

    const { count } = await supabase
      .from("course_categories")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id);

    const { error } = await supabase.from("course_categories").insert({
      tenant_id: tenant.id,
      name: parsed.data.name,
      position: count ?? 0,
    });
    if (error) return { error: translateDbError(error) };

    revalidatePath("/admin/kurse");
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

export async function renameCourseCategory(
  categoryId: string,
  name: string,
): Promise<CourseActionState> {
  try {
    const { tenant, supabase } = await requireStaffTenant();
    const parsed = courseCategorySchema.safeParse({ name });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Ungültiger Name." };
    }
    const { error } = await supabase
      .from("course_categories")
      .update({ name: parsed.data.name })
      .eq("id", categoryId)
      .eq("tenant_id", tenant.id);
    if (error) return { error: translateDbError(error) };
    revalidatePath("/admin/kurse");
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

/**
 * Löscht nur die Kategorie-Zeile selbst — Kurse, die sie trugen, verlieren
 * ihre Zuordnung automatisch über die FK-Regel `on delete set null`
 * (Migration 20260722180000_course_categories.sql), kein manueller
 * Vorab-Schritt nötig. Bewusst `requireStaffTenant()` statt
 * `requireAdminTenant()` wie bei `deleteCourse` — anders als eine
 * Kurslöschung reißt das hier keine Lerninhalte/Zertifikate mit, sondern
 * setzt lediglich ein Tag zurück (gleiche Stufe wie `deleteModule`/
 * `deleteSection`).
 */
export async function deleteCourseCategory(categoryId: string): Promise<CourseActionState> {
  try {
    const { tenant, supabase } = await requireStaffTenant();
    const { error } = await supabase
      .from("course_categories")
      .delete()
      .eq("id", categoryId)
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

/**
 * Modul-/Sektions-Beschreibung (23.07.2026, Josips Auftrag: Karten sollen
 * wie im LearningSuite-Referenzbeispiel eine kurze Beschreibung unter der
 * Überschrift zeigen können — eigenständige Umsetzung, Migration
 * 20260723190000). Leerer String löscht die Beschreibung wieder (auf
 * `null` normalisiert, damit die Lernansicht sauber zwischen "keine
 * Beschreibung" und einer leeren Zeile unterscheiden kann).
 */
export async function updateModuleDescription(
  moduleId: string,
  courseId: string,
  description: string,
): Promise<CourseActionState> {
  try {
    const { tenant, supabase } = await requireStaffTenant();
    const parsed = moduleSectionDescriptionSchema.safeParse(description);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Ungültige Beschreibung." };
    }
    const { error } = await supabase
      .from("modules")
      .update({ description: parsed.data.trim() || null })
      .eq("id", moduleId)
      .eq("tenant_id", tenant.id);
    if (error) return { error: translateDbError(error) };
    revalidatePath(`/admin/kurse/${courseId}`);
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

export async function updateSectionDescription(
  sectionId: string,
  courseId: string,
  description: string,
): Promise<CourseActionState> {
  try {
    const { tenant, supabase } = await requireStaffTenant();
    const parsed = moduleSectionDescriptionSchema.safeParse(description);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Ungültige Beschreibung." };
    }
    const { error } = await supabase
      .from("sections")
      .update({ description: parsed.data.trim() || null })
      .eq("id", sectionId)
      .eq("tenant_id", tenant.id);
    if (error) return { error: translateDbError(error) };
    revalidatePath(`/admin/kurse/${courseId}`);
    revalidatePath(`/kurs`);
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
 * Kursreihenfolge per Auf/Ab (Josips Auftrag, 23.07.2026 — bewusst kein
 * echtes Drag-and-Drop, siehe course-position-buttons.tsx-Kopfkommentar).
 * Gleiches Swap-Muster wie `moveModule`/`moveSection` oben — über ALLE Kurse
 * des Mandanten hinweg (nicht nur die im aktuell gefilterten Status-Tab
 * sichtbaren), damit sich ein archivierter Kurs nicht unsichtbar zwischen
 * zwei sichtbaren verschiebt. Staff-Ebene wie `updateCourseStatus`/
 * `updateCourseCategory` — Umsortieren ist nicht destruktiver als eine
 * Statusänderung, anders als `deleteCourse` (dort `requireAdminTenant()`).
 */
export async function moveCourse(courseId: string, direction: "up" | "down"): Promise<CourseActionState> {
  try {
    const { tenant, supabase } = await requireStaffTenant();
    const { data: courses, error: listError } = await supabase
      .from("courses")
      .select("id, position")
      .eq("tenant_id", tenant.id)
      .order("position", { ascending: true });
    if (listError || !courses) return { error: listError ? translateDbError(listError) : "Fehler." };

    const idx = courses.findIndex((c) => c.id === courseId);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (idx < 0 || swapIdx < 0 || swapIdx >= courses.length) {
      return { error: null, success: true }; // Rand erreicht, kein Fehler
    }

    const a = courses[idx];
    const b = courses[swapIdx];
    await supabase.from("courses").update({ position: b.position }).eq("id", a.id).eq("tenant_id", tenant.id);
    await supabase.from("courses").update({ position: a.position }).eq("id", b.id).eq("tenant_id", tenant.id);

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
 * Kursbeschreibung (23.07.2026, Josips Auftrag): erscheint auf der
 * Lern-Übersichtsseite direkt unter dem Kurstitel (`(learn)/kurs/[slug]/
 * page.tsx`, Zeile ~200 — `courses.description` existiert dort und in der
 * DB seit Migration 0001_init.sql, war bisher aber nirgends im Admin-
 * Bereich editierbar). Gleiches Speicher-Muster wie `updateSectionDescription`
 * (leer -> null statt leerem String, `revalidatePath("/kurs")` für die
 * öffentliche Lernseite).
 */
export async function updateCourseDescription(
  courseId: string,
  description: string,
): Promise<CourseActionState> {
  try {
    const { tenant, supabase } = await requireStaffTenant();
    const parsed = courseSchema.pick({ description: true }).safeParse({
      description: description || undefined,
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Ungültige Beschreibung." };
    }

    const { error } = await supabase
      .from("courses")
      .update({ description: parsed.data.description?.trim() || null })
      .eq("id", courseId)
      .eq("tenant_id", tenant.id);
    if (error) return { error: translateDbError(error) };

    revalidatePath("/admin/kurse");
    revalidatePath(`/admin/kurse/${courseId}`);
    revalidatePath(`/kurs`);
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

/**
 * Kursziele (Information-Tab, Josips Auftrag 24.07.2026: Informations-Tab
 * für Kurse nach Baulig-Vorbild, Migration
 * 20260724130000_course_information.sql). Erscheinen als Checkmark-Liste im
 * neuen `/kurs/[slug]/information`-Tab. Kein Auto-Save pro Tastenanschlag —
 * bewusst einfacher als das Beschreibungsfeld, da Array-Änderungen (siehe
 * course-info-editor.tsx): ein "Kursziele speichern"-Button überschreibt das
 * komplette Array auf einmal. Gleiches Validierungs-/Speicher-Muster wie
 * `updateCourseDescription` (courseSchema.pick, revalidatePath auf
 * Admin-Liste, Admin-Editor UND öffentliche Lernseite).
 */
export async function updateCourseGoals(
  courseId: string,
  goals: string[],
): Promise<CourseActionState> {
  try {
    const { tenant, supabase } = await requireStaffTenant();
    const parsed = courseSchema.pick({ goals: true }).safeParse({ goals });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Ungültige Kursziele." };
    }

    const { error } = await supabase
      .from("courses")
      .update({ goals: parsed.data.goals ?? [] })
      .eq("id", courseId)
      .eq("tenant_id", tenant.id);
    if (error) return { error: translateDbError(error) };

    revalidatePath("/admin/kurse");
    revalidatePath(`/admin/kurse/${courseId}`);
    revalidatePath("/kurs");
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

/**
 * Autor/Trainer eines Kurses (Information-Tab, gleicher Auftrag wie
 * `updateCourseGoals` oben). Einfaches Feld-Update nach Vorbild
 * `updateCourseCoverUrl` — `authorId = null` löst die Verknüpfung wieder
 * ("— kein Autor —" im Kurs-Editor-Dropdown, course-info-editor.tsx). Die
 * FK selbst (`courses.author_id references trainers(id)`) sorgt bereits
 * dafür, dass nur existierende Trainer-IDs geschrieben werden können; ein
 * `trainers`-Datensatz eines FREMDEN Mandanten würde die FK zwar nicht
 * blockieren, ist aber wegen RLS `trainers_member_select` clientseitig nie
 * im Dropdown wählbar (gleiche Absicherungslinie wie bei den Positionen).
 */
export async function updateCourseAuthor(
  courseId: string,
  authorId: string | null,
): Promise<CourseActionState> {
  try {
    const { tenant, supabase } = await requireStaffTenant();
    const { error } = await supabase
      .from("courses")
      .update({ author_id: authorId })
      .eq("id", courseId)
      .eq("tenant_id", tenant.id);
    if (error) return { error: translateDbError(error) };

    revalidatePath("/admin/kurse");
    revalidatePath(`/admin/kurse/${courseId}`);
    revalidatePath("/kurs");
    return { error: null, success: true };
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