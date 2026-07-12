"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { translateDbError } from "@/lib/errors/db";
import { genericErrorMessage } from "@/lib/errors/generic";

/**
 * Server Action für den Löschantrag (Art. 17 DSGVO), Phase 4 Block 3.
 *
 * Insert läuft bewusst über den normalen Session-Client (`createClient()`),
 * NICHT über den Admin-Client: die RLS-Policy `deletion_requests_self_insert`
 * (Migration 20260711222020_deletion_requests.sql) erlaubt genau das —
 * `user_id = auth.uid()` UND Mitgliedschaft im Mandanten —, das ist hier das
 * korrekte, engste Sicherheitsnetz statt einer weiteren Admin-Client-Umgehung.
 */

const MAX_REASON_LENGTH = 1000;

const requestDeletionSchema = z.object({
  reason: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z
      .string()
      .trim()
      .max(MAX_REASON_LENGTH, `Grund darf höchstens ${MAX_REASON_LENGTH} Zeichen haben.`)
      .optional(),
  ),
});

export type ProfilActionState = {
  error: string | null;
  success?: boolean;
};

export async function requestDeletion(
  _prevState: ProfilActionState,
  formData: FormData,
): Promise<ProfilActionState> {
  try {
    const tenant = await getTenant();
    if (!tenant) {
      return { error: "Kein Mandant erkannt." };
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { error: "Nicht angemeldet." };
    }

    const parsed = requestDeletionSchema.safeParse({
      reason: formData.get("reason"),
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }

    const { error } = await supabase.from("deletion_requests").insert({
      tenant_id: tenant.id,
      user_id: user.id,
      reason: parsed.data.reason ?? null,
    });

    if (error) {
      // 23505 = unique_violation (Postgres) — der partielle Unique-Index
      // `deletion_requests_pending_unique` erlaubt nur einen offenen Antrag
      // pro Nutzer/Mandant gleichzeitig.
      if (error.code === "23505") {
        return { error: "Es liegt bereits ein offener Löschantrag vor." };
      }
      return { error: "Antrag konnte nicht gespeichert werden: " + translateDbError(error) };
    }

    revalidatePath("/profil");
    return { error: null, success: true };
  } catch (e) {
    return { error: genericErrorMessage(e) };
  }
}
