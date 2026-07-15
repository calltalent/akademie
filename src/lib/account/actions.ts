"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Server-Actions für den Einstellungen-Bereich ((portal)/einstellungen,
 * Referenz Einstellungen.dc.html). Alle laufen als eingeloggter Nutzer unter
 * RLS (`profiles_own`, avatars_own_*); die Session-Funktionen filtern selbst
 * auf auth.uid() (Migration 20260715130000).
 */
export type SettingsState = { error: string | null; success?: boolean };

const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png" };

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export async function updateProfile(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Nicht angemeldet." };

  const first = str(formData, "first_name");
  const last = str(formData, "last_name");
  const { error } = await supabase
    .from("profiles")
    .update({
      first_name: first || null,
      last_name: last || null,
      phone: str(formData, "phone") || null,
      city: str(formData, "city") || null,
      job_position: str(formData, "job_position") || null,
      about: str(formData, "about") || null,
      // full_name bleibt die maßgebliche Anzeige (Dashboard/TopBar) — aus
      // Vor-/Nachname zusammengesetzt, damit beides konsistent bleibt.
      full_name: [first, last].filter(Boolean).join(" ") || null,
    })
    .eq("id", user.id);
  if (error) return { error: "Speichern fehlgeschlagen." };
  revalidatePath("/einstellungen");
  return { error: null, success: true };
}

export async function uploadAvatar(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) return { error: "Keine Datei gewählt." };
  if (file.size > AVATAR_MAX_BYTES) return { error: "Datei zu groß (max. 2 MB)." };
  const ext = AVATAR_EXT[file.type];
  if (!ext) return { error: "Nur JPG oder PNG erlaubt." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Nicht angemeldet." };

  // Pfad {user_id}/avatar.ext — die Storage-Policy erlaubt nur den eigenen Ordner.
  const path = `${user.id}/avatar.${ext}`;
  const { error: upErr } = await supabase.storage
    .from("avatars")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (upErr) return { error: "Upload fehlgeschlagen." };

  const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
  // Cache-Bust, damit der neue Avatar sofort statt der alten CDN-Version erscheint.
  const url = `${pub.publicUrl}?v=${Date.now()}`;
  const { error } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", user.id);
  if (error) return { error: "Speichern fehlgeschlagen." };
  revalidatePath("/einstellungen");
  return { error: null, success: true };
}

export async function changeEmail(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const email = str(formData, "email");
  if (!email) return { error: "E-Mail-Adresse fehlt." };
  const supabase = await createClient();
  // Supabase verschickt einen Bestätigungslink an die neue Adresse; die
  // Änderung greift erst nach Bestätigung.
  const { error } = await supabase.auth.updateUser({ email });
  if (error) return { error: "Änderung fehlgeschlagen: " + error.message };
  return { error: null, success: true };
}

export async function updateNotificationPref(
  key: string,
  value: boolean,
): Promise<SettingsState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Nicht angemeldet." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("notification_prefs")
    .eq("id", user.id)
    .maybeSingle();
  const current = (profile?.notification_prefs as Record<string, boolean> | null) ?? {};
  const next = { ...current, [key]: value };
  const { error } = await supabase.from("profiles").update({ notification_prefs: next }).eq("id", user.id);
  if (error) return { error: "Speichern fehlgeschlagen." };
  return { error: null, success: true };
}

export async function revokeSession(sessionId: string): Promise<SettingsState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Nicht angemeldet." };
  // revoke_my_session löscht nur eine EIGENE, nicht-aktuelle Session (SECURITY
  // DEFINER, filtert auf auth.uid() + schließt die aktuelle Session aus).
  const { error } = await supabase.rpc("revoke_my_session", { target: sessionId });
  if (error) return { error: "Abmelden fehlgeschlagen." };
  revalidatePath("/einstellungen");
  return { error: null, success: true };
}
