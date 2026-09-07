"use server";

import { revalidatePath } from "next/cache";
import { requireAdminTenant } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";
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

/**
 * ABWEICHUNG (technisch nötig, verifizierter Fehler): `progress` erlaubt laut
 * `progress_own_delete` (supabase/migrations/20260712234600_rls_consolidate_
 * part_b.sql:129) nur `user_id = auth.uid()` — ein Admin darf über den
 * regulären RLS-Client NIE den Fortschritt eines ANDEREN Lernenden löschen.
 * `attempts` hat nach Migration 20260712234500 gar keine DELETE-Policy für
 * irgendeine Rolle. Beide Löschungen liefen deshalb über den RLS-Client
 * still ins Leere (0 betroffene Zeilen, `error` bleibt `null`) — die Action
 * meldete fälschlich Erfolg, ohne dass irgendetwas zurückgesetzt wurde.
 * Fix: Admin-Client, NACH der bestehenden `requireAdminTenant()`-Prüfung
 * (CLAUDE.md §2.10 — jede `createAdminClient()`-Verwendung nur nach
 * Autorisierungsprüfung) und mit der Löschung strikt auf `tenant.id` des
 * aufrufenden Mandanten eingeschränkt (Defense-in-Depth, gleiches Muster wie
 * `deleteShiftPlanJob()` in src/lib/calendar/ai/actions.ts). Zusätzlich wird
 * die tatsächlich betroffene Zeilenzahl per `.select("id")` geprüft — bei 0
 * betroffenen Zeilen eine ehrliche Rückmeldung statt eines blinden
 * `success: true`.
 */

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

    let deletedCount = 0;
    if (lessonIds.length > 0) {
      const admin = createAdminClient();
      const { data: deleted, error } = await admin
        .from("progress")
        .delete()
        .eq("tenant_id", tenant.id)
        .in("lesson_id", lessonIds)
        .select("id");
      if (error) return { error: translateDbError(error) };
      deletedCount = deleted?.length ?? 0;
    }
    if (deletedCount === 0) {
      return { error: "Es gab keine Fortschrittsdaten zum Zurücksetzen." };
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

    let deletedCount = 0;
    if (lessonIds.length > 0) {
      const admin = createAdminClient();
      const { data: deleted, error } = await admin
        .from("progress")
        .delete()
        .eq("tenant_id", tenant.id)
        .eq("user_id", userId)
        .in("lesson_id", lessonIds)
        .select("id");
      if (error) return { error: translateDbError(error) };
      deletedCount = deleted?.length ?? 0;
    }
    if (deletedCount === 0) {
      return { error: "Es gab keine Fortschrittsdaten zum Zurücksetzen." };
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
    const { tenant } = await requireAdminTenant();

    const admin = createAdminClient();
    const { data: deleted, error } = await admin
      .from("attempts")
      .delete()
      .eq("tenant_id", tenant.id)
      .eq("user_id", userId)
      .eq("quiz_id", quizId)
      .select("id");
    if (error) return { error: translateDbError(error) };
    if (!deleted || deleted.length === 0) {
      return { error: "Es gab keine Versuche zum Zurücksetzen." };
    }

    revalidatePath("/admin/reporting");
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}
