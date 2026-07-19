"use server";

import { revalidatePath } from "next/cache";
import { requireAdminTenant } from "@/lib/auth/staff";
import type { CourseActionState } from "@/lib/courses/state";
import { translateDbError } from "@/lib/errors/db";
import { genericErrorMessage } from "@/lib/errors/generic";

/**
 * "Bericht zurücksetzen" (Design-Import AdminReporting.dc.html, 19.07.2026
 * — Josips Auftrag: "Funktionen genau wie im Design abgebildet"). Der Export
 * zeigt nur einen `confirm()`-Dialog mit einem leeren Platzhalter-Kommentar
 * ("// Zurücksetzen ausführen") — was tatsächlich zurückgesetzt wird, ist
 * hier aus dem jeweiligen Bericht selbst abgeleitet: der Bericht zeigt
 * Fortschritt/Quiz-Versuche an, "zurücksetzen" heißt also, die zugrunde
 * liegenden `progress`/`attempts`-Zeilen zu löschen, NICHT die Einschreibung
 * selbst — ein Lernender bleibt Mitglied des Kurses, nur sein Fortschritt/
 * seine Versuche fangen wieder bei null an.
 *
 * ADMIN-ONLY (`requireAdminTenant`, nicht `requireStaffTenant` wie beim
 * reinen Lesen der Berichte): irreversible Löschung, gleiche Rollen-Grenze
 * wie `deleteMembership()`/`deleteProduct()` in diesem Bereich — ein Trainer
 * darf Berichte einsehen, aber keine Lerndaten anderer Nutzer löschen.
 *
 * BEWUSST NICHT ANGEFASST: bereits ausgestellte Zertifikate (`certificates`-
 * Tabelle). Ein zurückgesetzter Kurs-/Nutzerbericht kann dazu führen, dass
 * jemand ein Zertifikat für einen jetzt wieder "unvollständigen" Kurs
 * behält — das Widerrufen von Zertifikaten ist eine eigene, sensiblere
 * Entscheidung (real ausgestelltes PDF/Dokument) und kein Teil dieses
 * Auftrags; es gibt im ganzen Repo noch keinen Zertifikat-Lösch-Pfad, den
 * man hier wiederverwenden könnte.
 */

const DUMMY_UUID = "00000000-0000-0000-0000-000000000000";

function errorState(e: unknown): CourseActionState {
  return { error: genericErrorMessage(e) };
}

/** Setzt den Fortschritt ALLER eingeschriebenen Lernenden für einen Kurs zurück (Kursbericht-Zeile). */
export async function resetCourseReport(courseId: string): Promise<CourseActionState> {
  try {
    const { tenant, supabase } = await requireAdminTenant();

    const { data: course } = await supabase
      .from("courses")
      .select("id")
      .eq("id", courseId)
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    if (!course) return { error: "Kurs nicht gefunden." };

    const { data: modules } = await supabase
      .from("modules")
      .select("id")
      .eq("tenant_id", tenant.id)
      .eq("course_id", courseId);
    const moduleIds = (modules ?? []).map((m) => m.id);

    const { data: lessons } = await supabase
      .from("lessons")
      .select("id")
      .eq("tenant_id", tenant.id)
      .in("module_id", moduleIds.length > 0 ? moduleIds : [DUMMY_UUID]);
    const lessonIds = (lessons ?? []).map((l) => l.id);

    if (lessonIds.length > 0) {
      const { error } = await supabase
        .from("progress")
        .delete()
        .eq("tenant_id", tenant.id)
        .in("lesson_id", lessonIds);
      if (error) return { error: translateDbError(error) };
    }

    revalidatePath("/admin/reporting");
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

/** Setzt den Fortschritt EINES Lernenden für EINEN Kurs zurück (Nutzerbericht-Zeile). */
export async function resetUserReport(userId: string, courseId: string): Promise<CourseActionState> {
  try {
    const { tenant, supabase } = await requireAdminTenant();

    const { data: modules } = await supabase
      .from("modules")
      .select("id")
      .eq("tenant_id", tenant.id)
      .eq("course_id", courseId);
    const moduleIds = (modules ?? []).map((m) => m.id);

    const { data: lessons } = await supabase
      .from("lessons")
      .select("id")
      .eq("tenant_id", tenant.id)
      .in("module_id", moduleIds.length > 0 ? moduleIds : [DUMMY_UUID]);
    const lessonIds = (lessons ?? []).map((l) => l.id);

    if (lessonIds.length > 0) {
      const { error } = await supabase
        .from("progress")
        .delete()
        .eq("tenant_id", tenant.id)
        .eq("user_id", userId)
        .in("lesson_id", lessonIds);
      if (error) return { error: translateDbError(error) };
    }

    revalidatePath("/admin/reporting");
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

/** Löscht die Versuche EINES Lernenden für EIN Quiz (Quiz-Auswertung-Zeile). */
export async function resetQuizReport(userId: string, quizId: string): Promise<CourseActionState> {
  try {
    const { tenant, supabase } = await requireAdminTenant();

    const { error } = await supabase
      .from("attempts")
      .delete()
      .eq("tenant_id", tenant.id)
      .eq("user_id", userId)
      .eq("quiz_id", quizId);
    if (error) return { error: translateDbError(error) };

    revalidatePath("/admin/reporting");
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}
