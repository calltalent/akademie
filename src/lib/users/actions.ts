"use server";

import { revalidatePath } from "next/cache";
import { requireAdminTenant } from "@/lib/auth/staff";
import { csvRowSchema } from "@/lib/users/csv";
import { importUsers, buildSetPasswordLink } from "@/lib/users/import";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/client";
import { welcomeInvite } from "@/lib/email/templates";
import { DEFAULT_BRANDING } from "@/lib/tenant/types";
import type { CourseActionState } from "@/lib/courses/state";
import { translateDbError } from "@/lib/errors/db";
import { genericErrorMessage } from "@/lib/errors/generic";

function errorState(e: unknown): CourseActionState {
  return { error: genericErrorMessage(e) };
}

/** Einzel-Einladung — nutzt dieselbe Import-Logik wie der CSV-Bulk-Import. */
export async function inviteSingleUser(
  _prevState: CourseActionState,
  formData: FormData,
): Promise<CourseActionState> {
  try {
    const { tenant } = await requireAdminTenant();

    const parsed = csvRowSchema.safeParse({
      email: formData.get("email"),
      fullName: formData.get("fullName") || undefined,
      courseSlug: formData.get("courseSlug") || undefined,
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }

    const summary = await importUsers(tenant, [parsed.data]);
    const result = summary.results[0];
    if (result?.status === "error") {
      return { error: result.message ?? "Einladung fehlgeschlagen." };
    }

    revalidatePath("/admin/teilnehmer");
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

/** Mitgliedschaft deaktivieren (kein Hard-Delete — Historie/Fortschritt bleibt erhalten). */
export async function disableMembership(userId: string): Promise<CourseActionState> {
  try {
    const { tenant, supabase } = await requireAdminTenant();
    const { error } = await supabase
      .from("memberships")
      .update({ status: "disabled" })
      .eq("tenant_id", tenant.id)
      .eq("user_id", userId);
    if (error) return { error: translateDbError(error) };
    revalidatePath("/admin/teilnehmer");
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

/** Mitgliedschaft reaktivieren. */
export async function enableMembership(userId: string): Promise<CourseActionState> {
  try {
    const { tenant, supabase } = await requireAdminTenant();
    const { error } = await supabase
      .from("memberships")
      .update({ status: "active" })
      .eq("tenant_id", tenant.id)
      .eq("user_id", userId);
    if (error) return { error: translateDbError(error) };
    revalidatePath("/admin/teilnehmer");
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

/**
 * Einladungslink erneut verschicken (19.07.2026, Josips Fund: der ursprüng-
 * liche Link ist nach dem ERSTEN Klick verbraucht — Supabase-Recovery-Links
 * sind strikt einmalig, ein zweiter Klick auf denselben E-Mail-Link scheitert
 * immer mit "otp_expired", unabhängig davon, ob der erste Klick erfolgreich
 * war). Baut denselben Link wie beim Erstanlegen (`buildSetPasswordLink()`,
 * siehe import.ts) und verschickt dieselbe Willkommensmail erneut — kein
 * neuer Vorlagen-Text nötig, "Passwort festlegen" passt inhaltlich genauso
 * für einen erneuten Versand.
 *
 * `profiles` ist NICHT mandantenskaliert — erst die `memberships`-Prüfung
 * unten stellt sicher, dass `userId` wirklich zu DIESEM Mandanten gehört,
 * bevor mit dem service_role-Client (umgeht RLS) auf die E-Mail zugegriffen
 * wird. Ohne diese Prüfung könnte ein manipulierter Aufruf mit einer
 * beliebigen fremden userId eine E-Mail an einen Nutzer eines ANDEREN
 * Mandanten auslösen.
 */
export async function resendInviteLink(userId: string): Promise<CourseActionState> {
  try {
    const { tenant, supabase } = await requireAdminTenant();

    const { data: membership, error: membershipError } = await supabase
      .from("memberships")
      .select("user_id")
      .eq("tenant_id", tenant.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (membershipError) return { error: translateDbError(membershipError) };
    if (!membership) return { error: "Teilnehmer nicht gefunden." };

    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("email, full_name")
      .eq("id", userId)
      .maybeSingle();
    if (!profile?.email) return { error: "Teilnehmer nicht gefunden." };

    const loginUrl = await buildSetPasswordLink(admin, tenant, profile.email);
    const accentColor = tenant.branding?.color_primary ?? DEFAULT_BRANDING.color_primary;
    const html = welcomeInvite({
      tenantName: tenant.name,
      recipientName: profile.full_name ?? undefined,
      loginUrl,
      accentColor,
    });

    const sendResult = await sendEmail({
      to: profile.email,
      subject: `Willkommen bei ${tenant.name}`,
      html,
      tenant: { name: tenant.name },
    });
    if (!sendResult.success) {
      return { error: "Mail konnte nicht verschickt werden." };
    }

    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

/**
 * Teilnehmer endgültig aus DIESEM Mandanten entfernen (Josips Auftrag,
 * 19.07.2026). Löscht bewusst nur die `memberships`-Zeile (tenant_id +
 * user_id), NICHT das globale Auth-Konto/`profiles`: `memberships` ist eine
 * Viele-zu-viele-Zuordnung (`unique(tenant_id, user_id)`, siehe
 * 0001_init.sql) — derselbe Nutzer kann Mitglied in einem ANDEREN Mandanten
 * sein. Ein globales Löschen würde diese Zugehörigkeit ungefragt mit-
 * zerstören. Enrollments/Progress/Zertifikate hängen direkt an `profiles.id`,
 * nicht an `memberships` — sie bleiben nach dem Entfernen als Verlauf
 * erhalten (gleiche Linie wie schon `disableMembership`), nur der Zugriff
 * auf diesen Mandanten verschwindet sofort (RLS-Policies prüfen `memberships`).
 *
 * Rollen-Schutz serverseitig dupliziert (nicht nur UI-Ausblendung in
 * `teilnehmer/[id]/page.tsx`, s. dort): der Inhaber darf über diesen Weg
 * nie entfernt werden, auch nicht durch einen manipulierten Direktaufruf.
 */
export async function deleteMembership(userId: string): Promise<CourseActionState> {
  try {
    const { tenant, supabase } = await requireAdminTenant();

    const { data: membership, error: membershipError } = await supabase
      .from("memberships")
      .select("role")
      .eq("tenant_id", tenant.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (membershipError) return { error: translateDbError(membershipError) };
    if (!membership) return { error: "Teilnehmer nicht gefunden." };
    if (membership.role === "owner") {
      return { error: "Der Inhaber kann nicht gelöscht werden." };
    }

    const { error } = await supabase
      .from("memberships")
      .delete()
      .eq("tenant_id", tenant.id)
      .eq("user_id", userId);
    if (error) return { error: translateDbError(error) };

    revalidatePath("/admin/teilnehmer");
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}