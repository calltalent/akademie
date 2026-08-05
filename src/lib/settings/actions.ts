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
import { trainerSchema, type TrainerInput } from "@/lib/settings/schema";
// KEIN `export type { TrainerInput }` hier: ein Typ-Re-Export in einer
// "use server"-Datei bricht zur Laufzeit ("ReferenceError: TrainerInput is
// not defined", Turbopack-Server-Actions-Codegen behandelt re-exportierte
// Importe anders als lokal deklarierte Typen wie `TrainerRow` unten).
// Aufrufer importieren `TrainerInput` direkt aus `@/lib/settings/schema`.

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

/**
 * Reihenfolge per Auf/Ab (Josips Auftrag, 23.07.2026: "per Drag and Drop
 * verschieben"). Bewusst kein echtes Drag-and-Drop — gleiche Entscheidung wie
 * bei `moveCourse()` (src/lib/courses/actions.ts) und den seit Phase 1
 * bestehenden Modul-/Sektion-Reorder-Pfeilen: diese Codebase sortiert
 * überall ausschließlich per Auf/Ab-Button, weil der Auftraggeber selbst
 * sehbehindert ist und reines Maus-Ziehen für ihn nicht bedienbar wäre
 * (CLAUDE.md §3.4). Gleiches Swap-Muster wie `moveModule`.
 */
export async function moveSidebarLink(id: string, direction: "up" | "down"): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { tenant, supabase } = await requireAdminTenant();
    const { data: links, error: listError } = await supabase
      .from("sidebar_links")
      .select("id, position")
      .eq("tenant_id", tenant.id)
      .order("position", { ascending: true });
    if (listError || !links) return { ok: false, error: listError ? translateDbError(listError) : "Fehler." };

    const idx = links.findIndex((l) => l.id === id);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (idx < 0 || swapIdx < 0 || swapIdx >= links.length) {
      return { ok: true }; // Rand erreicht, kein Fehler
    }

    const a = links[idx];
    const b = links[swapIdx];
    await supabase.from("sidebar_links").update({ position: b.position }).eq("id", a.id).eq("tenant_id", tenant.id);
    await supabase.from("sidebar_links").update({ position: a.position }).eq("id", b.id).eq("tenant_id", tenant.id);

    revalidatePath("/admin/einstellungen");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

// --- Positionen (Josips Auftrag, 24.07.2026: admin-verwaltbare Kärtchen in
// der rechten Spalte der Kurs-/Modulansicht, ersetzen die bisher fest
// verdrahteten "Kostenloses Erstgespräch buchen"/"Nutze die Calltalent-App"-
// Kärtchen, siehe Migration 20260724120000_promo_cards.sql). Gleiches
// Grundmuster wie die Sidebar-Links oben (requireAdminTenant, Auf/Ab statt
// Drag-and-Drop — CLAUDE.md §3.4), kein Rate-Limit (reine Konfigurations-
// daten, gleiche Einstufung wie Sidebar-Links).
//
// `linkUrl` erlaubt HIER zusätzlich relative Pfade ("/kontakt") — anders als
// `sidebarLinkSchema` oben, dessen Kommentar Sidebar-Links explizit als
// "immer externe Ziele" einordnet. Positionen sollen genau wie das bisherige
// Erstgespräch-Kärtchen auch auf interne Routen zeigen können.
const promoCardSchema = z
  .object({
    title: z.string().trim().min(1, "Titel erforderlich.").max(150),
    description: z.string().trim().max(500).optional(),
    mediaKind: z.enum(["image", "video"]),
    imageUrl: z.string().trim().url("Ungültige Bild-URL.").optional(),
    bunnyVideoId: z.string().trim().min(1).optional(),
    linkUrl: z
      .string()
      .trim()
      .max(2000)
      .refine((v) => v.startsWith("/") || /^https?:\/\//i.test(v), "Nur interne Pfade oder http(s)-Links erlaubt.")
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.mediaKind === "image" && !data.imageUrl) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["imageUrl"], message: "Bild erforderlich." });
    }
    if (data.mediaKind === "video" && !data.bunnyVideoId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["bunnyVideoId"], message: "Video erforderlich." });
    }
  });

export type PromoCardInput = z.infer<typeof promoCardSchema>;

export type PromoCardRow = {
  id: string;
  title: string;
  description: string | null;
  mediaKind: "image" | "video";
  imageUrl: string | null;
  bunnyVideoId: string | null;
  linkUrl: string | null;
};

type PromoCardResult = { ok: true; card: PromoCardRow } | { ok: false; error: string };

function toPromoCardRow(row: {
  id: string;
  title: string;
  description: string | null;
  media_kind: string;
  image_url: string | null;
  bunny_video_id: string | null;
  link_url: string | null;
}): PromoCardRow {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    mediaKind: row.media_kind as "image" | "video",
    imageUrl: row.image_url,
    bunnyVideoId: row.bunny_video_id,
    linkUrl: row.link_url,
  };
}

export async function createPromoCard(input: PromoCardInput): Promise<PromoCardResult> {
  try {
    const { tenant, supabase } = await requireAdminTenant();
    const parsed = promoCardSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }

    const { count } = await supabase
      .from("promo_cards")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id);

    const { data, error } = await supabase
      .from("promo_cards")
      .insert({
        tenant_id: tenant.id,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        media_kind: parsed.data.mediaKind,
        image_url: parsed.data.imageUrl ?? null,
        bunny_video_id: parsed.data.bunnyVideoId ?? null,
        link_url: parsed.data.linkUrl ?? null,
        position: count ?? 0,
      })
      .select("id, title, description, media_kind, image_url, bunny_video_id, link_url")
      .single();
    if (error || !data) return { ok: false, error: error ? translateDbError(error) : "Anlegen fehlgeschlagen." };

    revalidatePath("/admin/einstellungen");
    revalidatePath("/kurs");
    return { ok: true, card: toPromoCardRow(data) };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

export async function updatePromoCard(id: string, input: PromoCardInput): Promise<PromoCardResult> {
  try {
    const { tenant, supabase } = await requireAdminTenant();
    const parsed = promoCardSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }

    const { data, error } = await supabase
      .from("promo_cards")
      .update({
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        media_kind: parsed.data.mediaKind,
        image_url: parsed.data.imageUrl ?? null,
        bunny_video_id: parsed.data.bunnyVideoId ?? null,
        link_url: parsed.data.linkUrl ?? null,
      })
      .eq("id", id)
      .eq("tenant_id", tenant.id)
      .select("id, title, description, media_kind, image_url, bunny_video_id, link_url")
      .single();
    if (error || !data) return { ok: false, error: error ? translateDbError(error) : "Speichern fehlgeschlagen." };

    revalidatePath("/admin/einstellungen");
    revalidatePath("/kurs");
    return { ok: true, card: toPromoCardRow(data) };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

export async function deletePromoCard(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { tenant, supabase } = await requireAdminTenant();
    const { error } = await supabase.from("promo_cards").delete().eq("id", id).eq("tenant_id", tenant.id);
    if (error) return { ok: false, error: translateDbError(error) };

    revalidatePath("/admin/einstellungen");
    revalidatePath("/kurs");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

export async function movePromoCard(id: string, direction: "up" | "down"): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { tenant, supabase } = await requireAdminTenant();
    const { data: cards, error: listError } = await supabase
      .from("promo_cards")
      .select("id, position")
      .eq("tenant_id", tenant.id)
      .order("position", { ascending: true });
    if (listError || !cards) return { ok: false, error: listError ? translateDbError(listError) : "Fehler." };

    const idx = cards.findIndex((c) => c.id === id);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (idx < 0 || swapIdx < 0 || swapIdx >= cards.length) {
      return { ok: true }; // Rand erreicht, kein Fehler
    }

    const a = cards[idx];
    const b = cards[swapIdx];
    await supabase.from("promo_cards").update({ position: b.position }).eq("id", a.id).eq("tenant_id", tenant.id);
    await supabase.from("promo_cards").update({ position: a.position }).eq("id", b.id).eq("tenant_id", tenant.id);

    revalidatePath("/admin/einstellungen");
    revalidatePath("/kurs");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

// --- Trainer-/Ansprechperson-Profile (Josips Auftrag, 24.07.2026:
// Informations-Tab für Kurse nach Baulig-Vorbild, Migration
// 20260724130000_course_information.sql). Wiederverwendbares Profil (Bild +
// Name + optional Rolle/Bio), verwaltet hier unter /admin/einstellungen, im
// Kurs-Editor pro Kurs als "Autor" auswählbar (src/lib/courses/actions.ts,
// `updateCourseAuthor`). Exakt dasselbe Grundmuster wie die Positionen
// oben (`createPromoCard`/`updatePromoCard`/`deletePromoCard`/
// `movePromoCard`): requireAdminTenant(), zähl-basierte Position beim
// Anlegen, Auf/Ab statt Drag-and-Drop (CLAUDE.md §3.4), kein Rate-Limit
// (reine Konfigurationsdaten, gleiche Einstufung wie Positionen/Sidebar-
// Links).
//
// `trainerSchema`/`TrainerInput` NEU ausgelagert nach `settings/schema.ts`
// (05.08.2026, "Meine Kunden Area") — eine `"use server"`-Datei darf laut
// Next.js ausschließlich async Server Actions exportieren, kein zod-Schema
// als Laufzeitwert; siehe Kopfkommentar dort. `phone`/`email` NEU (gleicher
// Auftrag, Migration 20260805090000_customer_area.sql): Kunden-Area-
// Ansprechpartner (customer_area_items, kind='contact') zeigen diese Felder
// zusätzlich. Der Kurs-Informations-Tab bleibt unverändert — er zeigt
// weiterhin nur Bild/Name/Rolle/Bio, phone/email werden dort NICHT
// angezeigt (Variante-A-Entscheidung, siehe PHASENSTATUS.md/
// Entscheidungs-Log.md).
export type TrainerRow = {
  id: string;
  name: string;
  role: string | null;
  bio: string | null;
  imageUrl: string | null;
  phone: string | null;
  email: string | null;
};

type TrainerResult = { ok: true; trainer: TrainerRow } | { ok: false; error: string };

function toTrainerRow(row: {
  id: string;
  name: string;
  role: string | null;
  bio: string | null;
  image_url: string | null;
  phone: string | null;
  email: string | null;
}): TrainerRow {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    bio: row.bio,
    imageUrl: row.image_url,
    phone: row.phone,
    email: row.email,
  };
}

export async function createTrainer(input: TrainerInput): Promise<TrainerResult> {
  try {
    const { tenant, supabase } = await requireAdminTenant();
    const parsed = trainerSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }

    const { count } = await supabase
      .from("trainers")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id);

    const { data, error } = await supabase
      .from("trainers")
      .insert({
        tenant_id: tenant.id,
        name: parsed.data.name,
        role: parsed.data.role ?? null,
        bio: parsed.data.bio ?? null,
        image_url: parsed.data.imageUrl ?? null,
        phone: parsed.data.phone ?? null,
        email: parsed.data.email ?? null,
        position: count ?? 0,
      })
      .select("id, name, role, bio, image_url, phone, email")
      .single();
    if (error || !data) return { ok: false, error: error ? translateDbError(error) : "Anlegen fehlgeschlagen." };

    revalidatePath("/admin/einstellungen");
    return { ok: true, trainer: toTrainerRow(data) };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

export async function updateTrainer(id: string, input: TrainerInput): Promise<TrainerResult> {
  try {
    const { tenant, supabase } = await requireAdminTenant();
    const parsed = trainerSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }

    const { data, error } = await supabase
      .from("trainers")
      .update({
        name: parsed.data.name,
        role: parsed.data.role ?? null,
        bio: parsed.data.bio ?? null,
        image_url: parsed.data.imageUrl ?? null,
        phone: parsed.data.phone ?? null,
        email: parsed.data.email ?? null,
      })
      .eq("id", id)
      .eq("tenant_id", tenant.id)
      .select("id, name, role, bio, image_url, phone, email")
      .single();
    if (error || !data) return { ok: false, error: error ? translateDbError(error) : "Speichern fehlgeschlagen." };

    revalidatePath("/admin/einstellungen");
    return { ok: true, trainer: toTrainerRow(data) };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

export async function deleteTrainer(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { tenant, supabase } = await requireAdminTenant();
    const { error } = await supabase.from("trainers").delete().eq("id", id).eq("tenant_id", tenant.id);
    if (error) return { ok: false, error: translateDbError(error) };

    revalidatePath("/admin/einstellungen");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

export async function moveTrainer(id: string, direction: "up" | "down"): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { tenant, supabase } = await requireAdminTenant();
    const { data: trainers, error: listError } = await supabase
      .from("trainers")
      .select("id, position")
      .eq("tenant_id", tenant.id)
      .order("position", { ascending: true });
    if (listError || !trainers) return { ok: false, error: listError ? translateDbError(listError) : "Fehler." };

    const idx = trainers.findIndex((t) => t.id === id);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (idx < 0 || swapIdx < 0 || swapIdx >= trainers.length) {
      return { ok: true }; // Rand erreicht, kein Fehler
    }

    const a = trainers[idx];
    const b = trainers[swapIdx];
    await supabase.from("trainers").update({ position: b.position }).eq("id", a.id).eq("tenant_id", tenant.id);
    await supabase.from("trainers").update({ position: a.position }).eq("id", b.id).eq("tenant_id", tenant.id);

    revalidatePath("/admin/einstellungen");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}
