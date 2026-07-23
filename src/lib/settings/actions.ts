"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminTenant } from "@/lib/auth/staff";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import { generateApiKey, generateWebhookSecret } from "@/lib/webhooks/keys";
import { webhookEventSchema } from "@/lib/webhooks/dispatch";
import { assertSafeWebhookUrl } from "@/lib/webhooks/url-safety";
import { translateDbError } from "@/lib/errors/db";
import { genericErrorMessage } from "@/lib/errors/generic";

/**
 * Phase 3, Block 7 — Server Actions für `/admin/einstellungen`
 * (API-Keys/Webhooks). `requireAdminTenant()` statt des allgemeineren
 * `requireStaffTenant()`: RLS `api_keys_admin_all`/`webhooks_admin_all`
 * erlaubt Schreiben NUR owner/admin (nicht trainer) — exakt das Muster,
 * für das `requireAdminTenant()` in Block 6 (`src/lib/users/actions.ts`)
 * bereits existiert (Defense-in-Depth zusätzlich zur RLS, konsistent mit
 * allen bisherigen Blöcken).
 */

type ApiKeyCreateResult =
  | { ok: true; id: string; name: string; plaintext: string }
  | { ok: false; error: string };

const apiKeyNameSchema = z.string().trim().min(1, "Name erforderlich.").max(100);

export async function createApiKey(name: string): Promise<ApiKeyCreateResult> {
  try {
    const { tenant, supabase } = await requireAdminTenant();

    if (
      !(await checkRateLimit("settings-create-api-key", {
        maxRequests: 20,
        windowSeconds: 3600,
        extraKey: tenant.id,
      }))
    ) {
      return { ok: false, error: RATE_LIMIT_MESSAGE };
    }

    const parsedName = apiKeyNameSchema.safeParse(name);
    if (!parsedName.success) {
      return { ok: false, error: parsedName.error.issues[0]?.message ?? "Ungültiger Name." };
    }

    const { plaintext, hash } = generateApiKey();
    const { data, error } = await supabase
      .from("api_keys")
      .insert({ tenant_id: tenant.id, name: parsedName.data, key_hash: hash, active: true })
      .select("id, name")
      .single();
    if (error || !data) return { ok: false, error: error ? translateDbError(error) : "Anlegen fehlgeschlagen." };

    revalidatePath("/admin/einstellungen");
    return { ok: true, id: data.id, name: data.name, plaintext };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

export async function revokeApiKey(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { tenant, supabase } = await requireAdminTenant();
    const { error } = await supabase
      .from("api_keys")
      .update({ active: false })
      .eq("id", id)
      .eq("tenant_id", tenant.id);
    if (error) return { ok: false, error: translateDbError(error) };

    revalidatePath("/admin/einstellungen");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

const webhookCreateSchema = z.object({
  url: z.string().trim().url("Ungültige URL.").max(2000),
  events: z.array(webhookEventSchema).min(1, "Mindestens ein Ereignis auswählen."),
});

type WebhookCreateResult =
  | { ok: true; id: string; url: string; events: string[]; secret: string }
  | { ok: false; error: string };

export async function createWebhook(url: string, events: string[]): Promise<WebhookCreateResult> {
  try {
    const { tenant, supabase } = await requireAdminTenant();

    if (
      !(await checkRateLimit("settings-create-webhook", {
        maxRequests: 20,
        windowSeconds: 3600,
        extraKey: tenant.id,
      }))
    ) {
      return { ok: false, error: RATE_LIMIT_MESSAGE };
    }

    const parsed = webhookCreateSchema.safeParse({ url, events });
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }

    // Security-Fix (security-reviewer-Durchgang Phase 3, 11.07.2026, MITTEL):
    // SSRF-Schutz — siehe Dateikopf-Kommentar in url-safety.ts.
    try {
      await assertSafeWebhookUrl(parsed.data.url);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Ungültige Webhook-URL." };
    }

    const secret = generateWebhookSecret();
    const { data, error } = await supabase
      .from("webhooks")
      .insert({
        tenant_id: tenant.id,
        url: parsed.data.url,
        events: parsed.data.events,
        secret,
        active: true,
      })
      .select("id, url, events")
      .single();
    if (error || !data) return { ok: false, error: error ? translateDbError(error) : "Anlegen fehlgeschlagen." };

    revalidatePath("/admin/einstellungen");
    return { ok: true, id: data.id, url: data.url, events: data.events, secret };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

export async function deleteWebhook(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { tenant, supabase } = await requireAdminTenant();
    const { error } = await supabase.from("webhooks").delete().eq("id", id).eq("tenant_id", tenant.id);
    if (error) return { ok: false, error: translateDbError(error) };

    revalidatePath("/admin/einstellungen");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

// --- Sidebar-Links (Josips Auftrag, 23.07.2026: admin-verwaltbarer "LINKS"-
// Bereich in der Lernbereich-Sidebar) — kein Rate-Limit wie bei API-Keys/
// Webhooks: reine Konfigurationsdaten, kein Secret, kein Kostenrisiko (gleiche
// Einstufung wie course_categories, src/lib/courses/actions.ts). Die
// http(s)-only-Prüfung im Schema verhindert `javascript:`-URLs, die als
// anklickbarer Sidebar-Link sonst eine gespeicherte XSS-Falle für Lernende
// wären, auch wenn nur ein vertrauenswürdiger owner/admin schreiben kann.
const sidebarLinkSchema = z.object({
  label: z.string().trim().min(1, "Name erforderlich.").max(60),
  url: z
    .string()
    .trim()
    .url("Ungültige URL.")
    .max(2000)
    .refine((v) => /^https?:\/\//i.test(v), "Nur http(s)-Links erlaubt."),
});

type SidebarLinkResult =
  | { ok: true; id: string; label: string; url: string }
  | { ok: false; error: string };

export async function createSidebarLink(label: string, url: string): Promise<SidebarLinkResult> {
  try {
    const { tenant, supabase } = await requireAdminTenant();
    const parsed = sidebarLinkSchema.safeParse({ label, url });
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }

    const { count } = await supabase
      .from("sidebar_links")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id);

    const { data, error } = await supabase
      .from("sidebar_links")
      .insert({ tenant_id: tenant.id, label: parsed.data.label, url: parsed.data.url, position: count ?? 0 })
      .select("id, label, url")
      .single();
    if (error || !data) return { ok: false, error: error ? translateDbError(error) : "Anlegen fehlgeschlagen." };

    revalidatePath("/admin/einstellungen");
    return { ok: true, id: data.id, label: data.label, url: data.url };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

export async function updateSidebarLink(id: string, label: string, url: string): Promise<SidebarLinkResult> {
  try {
    const { tenant, supabase } = await requireAdminTenant();
    const parsed = sidebarLinkSchema.safeParse({ label, url });
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }

    const { data, error } = await supabase
      .from("sidebar_links")
      .update({ label: parsed.data.label, url: parsed.data.url })
      .eq("id", id)
      .eq("tenant_id", tenant.id)
      .select("id, label, url")
      .single();
    if (error || !data) return { ok: false, error: error ? translateDbError(error) : "Speichern fehlgeschlagen." };

    revalidatePath("/admin/einstellungen");
    return { ok: true, id: data.id, label: data.label, url: data.url };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

export async function deleteSidebarLink(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { tenant, supabase } = await requireAdminTenant();
    const { error } = await supabase.from("sidebar_links").delete().eq("id", id).eq("tenant_id", tenant.id);
    if (error) return { ok: false, error: translateDbError(error) };

    revalidatePath("/admin/einstellungen");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}
