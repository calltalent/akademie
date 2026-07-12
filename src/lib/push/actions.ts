"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { translateDbError } from "@/lib/errors/db";
import { genericErrorMessage } from "@/lib/errors/generic";

/**
 * Server Actions für das Web-Push-Fundament (Phase 4, Block 5).
 *
 * Beide Actions laufen bewusst über den normalen Session-Client
 * (`createClient()`), NICHT über den Admin-Client: die RLS-Policy
 * `push_subscriptions_own_all` (Migration `20260711225617_push_subscriptions`)
 * erlaubt jedem angemeldeten Nutzer ausschließlich seine eigenen Zeilen zu
 * verwalten (`user_id = auth.uid()`, `with check` zusätzlich aktive
 * Mitgliedschaft im Mandanten) — das ist hier das korrekte, engste
 * Sicherheitsnetz, kein Admin-Client-Umweg nötig (gleiches Prinzip wie
 * `requestDeletion()` in src/app/profil/actions.ts).
 */

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export type PushActionState = { error: string | null; success?: boolean };

/**
 * `subscriptionJson` kommt vom Client (`PushSubscription.toJSON()`) — zod-
 * Validierung an dieser Eingabegrenze (CLAUDE.md §2.3, jede Eingabegrenze).
 * `tenant_id`/`user_id` ausschließlich aus Session/`getTenant()`, niemals
 * aus Client-Eingaben übernommen (gleiches Prinzip wie überall sonst in der
 * Codebasis, z. B. `profil/export/route.ts`).
 */
export async function subscribeToPush(subscriptionJson: unknown): Promise<PushActionState> {
  try {
    const parsed = subscribeSchema.safeParse(subscriptionJson);
    if (!parsed.success) {
      return { error: "Ungültige Push-Subscription." };
    }

    const tenant = await getTenant();
    if (!tenant) return { error: "Kein Mandant zu diesem Host gefunden." };

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { error: "Nicht angemeldet." };

    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        tenant_id: tenant.id,
        user_id: user.id,
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
      },
      { onConflict: "endpoint" },
    );
    if (error) return { error: "Speichern fehlgeschlagen: " + translateDbError(error) };

    return { error: null, success: true };
  } catch (e) {
    return { error: genericErrorMessage(e) };
  }
}

export async function unsubscribeFromPush(endpoint: string): Promise<PushActionState> {
  try {
    const parsedEndpoint = z.string().url().safeParse(endpoint);
    if (!parsedEndpoint.success) return { error: "Ungültiger Endpoint." };

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { error: "Nicht angemeldet." };

    const { error } = await supabase
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", parsedEndpoint.data)
      .eq("user_id", user.id);
    if (error) return { error: "Abmelden fehlgeschlagen: " + translateDbError(error) };

    return { error: null, success: true };
  } catch (e) {
    return { error: genericErrorMessage(e) };
  }
}
