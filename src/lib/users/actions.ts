"use server";

import { revalidatePath } from "next/cache";
import { requireAdminTenant } from "@/lib/auth/staff";
import { csvRowSchema } from "@/lib/users/csv";
import { importUsers } from "@/lib/users/import";
import type { CourseActionState } from "@/lib/courses/state";

function errorState(e: unknown): CourseActionState {
  return { error: e instanceof Error ? e.message : "Unbekannter Fehler." };
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

    revalidatePath("/admin/nutzer");
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
    if (error) return { error: error.message };
    revalidatePath("/admin/nutzer");
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
    if (error) return { error: error.message };
    revalidatePath("/admin/nutzer");
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}
