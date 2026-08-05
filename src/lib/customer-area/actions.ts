"use server";

import { revalidatePath } from "next/cache";
import { requireAdminTenant } from "@/lib/auth/staff";
import { translateDbError } from "@/lib/errors/db";
import { genericErrorMessage } from "@/lib/errors/generic";
import {
  customerAreaGroupNameSchema,
  customerAreaItemSchema,
  customerAreaMemberIdsSchema,
  toCustomerAreaItemRow,
  CUSTOMER_AREA_ITEM_COLUMNS,
  type CustomerAreaItemInput,
  type CustomerAreaItemRow,
} from "@/lib/customer-area/schema";

/**
 * Server Actions für "Meine Kunden Area" (Plan Abschnitt 2,
 * verwende-den-planungs-agenten-sequential-frost.md). Gleiches Grundmuster
 * wie `settings/actions.ts` (`requireAdminTenant()` → zod `safeParse` →
 * Schreiben mit `.eq("tenant_id", tenant.id)` → `translateDbError` →
 * `revalidatePath`), eigenes Modul statt Erweiterung von
 * `settings/actions.ts` (bereits 601 Zeilen/vier Themen) — analog
 * `src/lib/marketplace/`. Kein Rate-Limit: reine Konfigurationsdaten, gleiche
 * Einstufung wie Sidebar-Links/Promo-Karten/Trainer.
 *
 * Kein transaktionaler Schutz beim Anlegen (Risiko 8.5 im Plan):
 * `createCustomerAreaItem`/`updateCustomerAreaItem` schreiben erst das Item,
 * dann die Zuordnungszeilen (supabase-js kennt keine Transaktionsklammer
 * über zwei Aufrufe). Scheitert der zweite Schritt, bleibt ein Item mit
 * `visibility='restricted'` und leerer/unvollständiger Zuordnung —
 * fail-closed (niemand sieht das Item außer owner/admin), in der Admin-UI
 * jederzeit korrigierbar.
 */

type ActionResult = { ok: true } | { ok: false; error: string };
type GroupResult = { ok: true; group: { id: string; name: string } } | { ok: false; error: string };
type ItemResult = { ok: true; item: CustomerAreaItemRow } | { ok: false; error: string };

// --- Gruppen ---------------------------------------------------------

export async function createCustomerAreaGroup(name: string): Promise<GroupResult> {
  try {
    const { tenant, supabase } = await requireAdminTenant();
    const parsed = customerAreaGroupNameSchema.safeParse(name);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }

    const { count } = await supabase
      .from("customer_area_groups")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id);

    const { data, error } = await supabase
      .from("customer_area_groups")
      .insert({ tenant_id: tenant.id, name: parsed.data, position: count ?? 0 })
      .select("id, name")
      .single();
    if (error || !data) return { ok: false, error: error ? translateDbError(error) : "Anlegen fehlgeschlagen." };

    revalidatePath("/admin/einstellungen");
    return { ok: true, group: { id: data.id, name: data.name } };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

export async function renameCustomerAreaGroup(id: string, name: string): Promise<GroupResult> {
  try {
    const { tenant, supabase } = await requireAdminTenant();
    const parsed = customerAreaGroupNameSchema.safeParse(name);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }

    const { data, error } = await supabase
      .from("customer_area_groups")
      .update({ name: parsed.data })
      .eq("id", id)
      .eq("tenant_id", tenant.id)
      .select("id, name")
      .single();
    if (error || !data) return { ok: false, error: error ? translateDbError(error) : "Speichern fehlgeschlagen." };

    revalidatePath("/admin/einstellungen");
    return { ok: true, group: { id: data.id, name: data.name } };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

/**
 * Cascade räumt `customer_area_group_members`/`customer_area_item_audience`
 * ab (FK `on delete cascade`). Ein dadurch unsichtbar gewordenes Item bleibt
 * bestehen (`visibility='restricted'` ohne Zuordnung) — die Admin-UI zeigt
 * dafür "Aktuell für niemanden sichtbar." (Risiko 8.7 im Plan), kein
 * automatischer Rückfall auf "alle".
 */
export async function deleteCustomerAreaGroup(id: string): Promise<ActionResult> {
  try {
    const { tenant, supabase } = await requireAdminTenant();
    const { error } = await supabase.from("customer_area_groups").delete().eq("id", id).eq("tenant_id", tenant.id);
    if (error) return { ok: false, error: translateDbError(error) };

    revalidatePath("/admin/einstellungen");
    revalidatePath("/kunden-area");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

/**
 * Ersetzen-Operation (Plan Abschnitt 2): alle bestehenden Mitgliedszeilen
 * dieser Gruppe löschen, dann die neue Menge einfügen. `userIds` wird vorher
 * gegen aktive Mitgliedschaften DIESES Mandanten geprüft — RLS fängt das
 * nicht ab, `profiles` ist mandantenübergreifend (gleiches Muster wie
 * `resendInviteLink` in `users/actions.ts`).
 */
export async function setCustomerAreaGroupMembers(groupId: string, userIds: string[]): Promise<ActionResult> {
  try {
    const { tenant, supabase } = await requireAdminTenant();
    const parsed = customerAreaMemberIdsSchema.safeParse(userIds);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültige Auswahl." };
    }

    let validUserIds: string[] = [];
    if (parsed.data.length > 0) {
      const { data: memberships } = await supabase
        .from("memberships")
        .select("user_id")
        .eq("tenant_id", tenant.id)
        .eq("status", "active")
        .in("user_id", parsed.data);
      validUserIds = (memberships ?? []).map((m) => m.user_id);
    }

    const { error: deleteError } = await supabase
      .from("customer_area_group_members")
      .delete()
      .eq("group_id", groupId)
      .eq("tenant_id", tenant.id);
    if (deleteError) return { ok: false, error: translateDbError(deleteError) };

    if (validUserIds.length > 0) {
      const { error: insertError } = await supabase
        .from("customer_area_group_members")
        .insert(validUserIds.map((userId) => ({ group_id: groupId, user_id: userId, tenant_id: tenant.id })));
      if (insertError) return { ok: false, error: translateDbError(insertError) };
    }

    revalidatePath("/admin/einstellungen");
    revalidatePath("/kunden-area");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

// --- Inhalte -----------------------------------------------------------

/**
 * Schreibt die Sichtbarkeits-Zuordnung eines Items neu. `groupIds`/`userIds`
 * werden vorher gegen diesen Mandanten geprüft (Gruppen: `tenant_id`-Filter;
 * Nutzer: aktive Mitgliedschaft) — exakt wie bei
 * `setCustomerAreaGroupMembers` oben, gleiche Begründung.
 */
async function writeAudience(
  supabase: Awaited<ReturnType<typeof requireAdminTenant>>["supabase"],
  tenantId: string,
  itemId: string,
  groupIds: string[],
  userIds: string[],
): Promise<{ group_id: string | null; user_id: string | null }[]> {
  let validGroupIds: string[] = [];
  if (groupIds.length > 0) {
    const { data } = await supabase
      .from("customer_area_groups")
      .select("id")
      .eq("tenant_id", tenantId)
      .in("id", groupIds);
    validGroupIds = (data ?? []).map((g) => g.id as string);
  }

  let validUserIds: string[] = [];
  if (userIds.length > 0) {
    const { data } = await supabase
      .from("memberships")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .in("user_id", userIds);
    validUserIds = (data ?? []).map((m) => m.user_id as string);
  }

  const rows = [
    ...validGroupIds.map((groupId) => ({ tenant_id: tenantId, item_id: itemId, group_id: groupId, user_id: null })),
    ...validUserIds.map((userId) => ({ tenant_id: tenantId, item_id: itemId, group_id: null, user_id: userId })),
  ];
  if (rows.length === 0) return [];

  const { data } = await supabase.from("customer_area_item_audience").insert(rows).select("group_id, user_id");
  return data ?? [];
}

/**
 * Prüft `trainerId` gegen den aufrufenden Mandanten (Security-Review
 * 05.08.2026, MITTEL-Fund) — `customer_area_items.trainer_id` hat anders als
 * `customer_area_group_members` keinen zusammengesetzten FK auf `tenant_id`
 * (dafür bräuchte `trainers` ein `unique(id, tenant_id)`), war also bislang
 * nur durch die UI-Dropdown-Auswahl und `trainers_member_select` abgesichert
 * — keine zweite Verteidigungslinie in der Server Action. Gleiches Prinzip
 * wie die Gruppen-/Nutzer-Prüfung in `writeAudience` oben.
 */
async function resolveContactTrainerId(
  supabase: Awaited<ReturnType<typeof requireAdminTenant>>["supabase"],
  tenantId: string,
  trainerId: string,
): Promise<string | null> {
  const { data } = await supabase.from("trainers").select("id").eq("tenant_id", tenantId).eq("id", trainerId).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export async function createCustomerAreaItem(input: CustomerAreaItemInput): Promise<ItemResult> {
  try {
    const { tenant, supabase } = await requireAdminTenant();
    const parsed = customerAreaItemSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }
    const data = parsed.data;

    let trainerId: string | null = null;
    if (data.kind === "contact" && data.trainerId) {
      trainerId = await resolveContactTrainerId(supabase, tenant.id, data.trainerId);
      if (!trainerId) return { ok: false, error: "Trainer-/Ansprechperson-Profil nicht gefunden." };
    }

    const { count } = await supabase
      .from("customer_area_items")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .eq("kind", data.kind);

    const { data: item, error } = await supabase
      .from("customer_area_items")
      .insert({
        tenant_id: tenant.id,
        kind: data.kind,
        title: data.title ?? null,
        description: data.description ?? null,
        url: data.url ?? null,
        image_url: data.imageUrl ?? null,
        icon: data.icon ?? null,
        item_date: data.itemDate ?? null,
        trainer_id: trainerId,
        visibility: data.visibility,
        position: count ?? 0,
      })
      .select(CUSTOMER_AREA_ITEM_COLUMNS)
      .single();
    if (error || !item) return { ok: false, error: error ? translateDbError(error) : "Anlegen fehlgeschlagen." };

    const audience =
      data.visibility === "restricted" ? await writeAudience(supabase, tenant.id, item.id, data.groupIds, data.userIds) : [];

    revalidatePath("/admin/einstellungen");
    revalidatePath("/kunden-area");
    return { ok: true, item: toCustomerAreaItemRow(item, audience) };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

export async function updateCustomerAreaItem(id: string, input: CustomerAreaItemInput): Promise<ItemResult> {
  try {
    const { tenant, supabase } = await requireAdminTenant();
    const parsed = customerAreaItemSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }
    const data = parsed.data;

    let trainerId: string | null = null;
    if (data.kind === "contact" && data.trainerId) {
      trainerId = await resolveContactTrainerId(supabase, tenant.id, data.trainerId);
      if (!trainerId) return { ok: false, error: "Trainer-/Ansprechperson-Profil nicht gefunden." };
    }

    const { data: item, error } = await supabase
      .from("customer_area_items")
      .update({
        title: data.title ?? null,
        description: data.description ?? null,
        url: data.url ?? null,
        image_url: data.imageUrl ?? null,
        icon: data.icon ?? null,
        item_date: data.itemDate ?? null,
        trainer_id: trainerId,
        visibility: data.visibility,
      })
      .eq("id", id)
      .eq("tenant_id", tenant.id)
      .select(CUSTOMER_AREA_ITEM_COLUMNS)
      .single();
    if (error || !item) return { ok: false, error: error ? translateDbError(error) : "Speichern fehlgeschlagen." };

    // Ersetzen-Operation, gleiches Prinzip wie setCustomerAreaGroupMembers.
    await supabase.from("customer_area_item_audience").delete().eq("item_id", id).eq("tenant_id", tenant.id);
    const audience =
      data.visibility === "restricted" ? await writeAudience(supabase, tenant.id, id, data.groupIds, data.userIds) : [];

    revalidatePath("/admin/einstellungen");
    revalidatePath("/kunden-area");
    return { ok: true, item: toCustomerAreaItemRow(item, audience) };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

/** Cascade räumt die Zuordnung ab (FK `on delete cascade` auf `item_id`). */
export async function deleteCustomerAreaItem(id: string): Promise<ActionResult> {
  try {
    const { tenant, supabase } = await requireAdminTenant();
    const { error } = await supabase.from("customer_area_items").delete().eq("id", id).eq("tenant_id", tenant.id);
    if (error) return { ok: false, error: translateDbError(error) };

    revalidatePath("/admin/einstellungen");
    revalidatePath("/kunden-area");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

/**
 * Reihenfolge per Auf/Ab, gefiltert auf denselben `kind` (Plan Abschnitt 2:
 * "gefiltert auf denselben kind") — Links/Kontakte/Ankündigungen haben je
 * eine eigene Reihenfolge trotz gemeinsamer Tabelle. Bewusst kein
 * Drag-and-Drop (CLAUDE.md §3.4/6, Auftraggeber sehbehindert), gleiches
 * Swap-Muster wie `moveTrainer`/`movePromoCard`.
 */
export async function moveCustomerAreaItem(id: string, direction: "up" | "down"): Promise<ActionResult> {
  try {
    const { tenant, supabase } = await requireAdminTenant();
    const { data: current } = await supabase
      .from("customer_area_items")
      .select("kind")
      .eq("id", id)
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    if (!current) return { ok: false, error: "Eintrag nicht gefunden." };

    const { data: items, error: listError } = await supabase
      .from("customer_area_items")
      .select("id, position")
      .eq("tenant_id", tenant.id)
      .eq("kind", current.kind)
      .order("position", { ascending: true });
    if (listError || !items) return { ok: false, error: listError ? translateDbError(listError) : "Fehler." };

    const idx = items.findIndex((i) => i.id === id);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (idx < 0 || swapIdx < 0 || swapIdx >= items.length) {
      return { ok: true }; // Rand erreicht, kein Fehler
    }

    const a = items[idx];
    const b = items[swapIdx];
    await supabase.from("customer_area_items").update({ position: b.position }).eq("id", a.id).eq("tenant_id", tenant.id);
    await supabase.from("customer_area_items").update({ position: a.position }).eq("id", b.id).eq("tenant_id", tenant.id);

    revalidatePath("/admin/einstellungen");
    revalidatePath("/kunden-area");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

// KEIN Typ-Re-Export hier: `export type { X } from "..."` bricht in einer
// "use server"-Datei zur Laufzeit ("ReferenceError: X is not defined",
// Turbopack-Server-Actions-Codegen behandelt re-exportierte Importe anders
// als lokal deklarierte Typen wie `PromoCardRow` in settings/actions.ts).
// Panels importieren `CustomerAreaItemInput`/`CustomerAreaItemRow` direkt
// aus `@/lib/customer-area/schema`.
