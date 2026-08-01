"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { localeSchema, resolveEnabledLocales, isSupportedLocale } from "@/i18n/config";

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

/**
 * i18n Block B1 (PLAN_Mehrsprachigkeit-i18n.md Abschnitt 4+8.2): kein
 * `domain`-Attribut (host-only, sonst gilt die Sprachwahl mandanten-
 * übergreifend), sonst dieselben Attribute an beiden Schreibstellen dieser
 * Datei (setLocale() und mirrorProfileLocaleCookie(), B4) — deshalb hier
 * einmal zentral statt zweimal dupliziert.
 */
const NEXT_LOCALE_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
};

/**
 * i18n Block B1: Sprachumschalter (locale-switcher.tsx) ruft das direkt mit
 * dem `<select>`-Wert auf (kein FormData/useActionState — gleiches Muster
 * wie updateNotificationPref() oben). `value` ist Nutzereingabe (kommt vom
 * Client) — zod-Prüfung gegen SUPPORTED_LOCALES ist deshalb Pflicht
 * (CLAUDE.md §2.3), bevor irgendetwas geschrieben wird. Zusätzlich muss der
 * Wert in der effektiven Freischaltung DIESES Mandanten liegen (Plan
 * Abschnitt 3) — sonst könnte ein Nutzer über die Server Action eine vom
 * Mandanten gesperrte Sprache erzwingen, obwohl die UI sie gar nicht anbietet.
 */
export async function setLocale(value: string): Promise<SettingsState> {
  const parsed = localeSchema.safeParse(value);
  if (!parsed.success) return { error: "Unbekannte Sprache." };
  const locale = parsed.data;

  const tenant = await getTenant();
  const enabledLocales = resolveEnabledLocales(tenant?.settings ?? {});
  if (!enabledLocales.includes(locale)) {
    return { error: "Diese Sprache ist für diese Akademie nicht freigeschaltet." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Nicht angemeldet." };

  const { error } = await supabase.from("profiles").update({ locale }).eq("id", user.id);
  if (error) return { error: "Speichern fehlgeschlagen." };

  const cookieStore = await cookies();
  cookieStore.set("NEXT_LOCALE", locale, NEXT_LOCALE_COOKIE_OPTIONS);

  return { error: null, success: true };
}

/**
 * i18n Block B4 (Plan Abschnitt 4): spiegelt `profiles.locale` als
 * `NEXT_LOCALE`-Cookie, direkt nach erfolgreichem Login aufgerufen — damit
 * middleware.ts die richtige Sprache schon beim allerersten Request nach dem
 * Login sieht, auch auf einem neuen Gerät ohne bestehendes Cookie.
 *
 * ABWEICHUNG vom Plan (dokumentiert, siehe PHASENSTATUS.md): der Plan zielte
 * auf `src/app/auth/callback/route.ts`. Dieser Route Handler wurde am
 * 26.07.2026 (Commit 65d5910) zu einer Client Component (`page.tsx`), weil
 * die meisten E-Mail-Links dieses Projekts die Session als URL-FRAGMENT
 * liefern (`#access_token=…`) — Fragmente erreichen den Server grundsätzlich
 * nie, ein Route Handler kann sie technisch nicht lesen. Diese Funktion wird
 * deshalb als Server Action direkt aus der Client Component heraus
 * aufgerufen (Next.js erlaubt das ohne Formular/Route Handler), nachdem
 * `setSession()`/`exchangeCodeForSession()` die Auth-Cookies gesetzt hat.
 *
 * Kein zod hier: `profiles.locale` ist kein externer Eingabe-Request, sondern
 * ein bereits gespeicherter DB-Wert (i. d. R. selbst über setLocale() oben
 * geschrieben) — `isSupportedLocale()` genügt als Typ-Wächter, bevor der Wert
 * in einen Set-Cookie-Header gelangt (gleiches Muster wie i18n/request.ts).
 * Bewusst OHNE Freischaltungs-Prüfung des Mandanten (anders als setLocale()
 * oben): middleware.ts prüft `enabled_locales` bei JEDEM Request ohnehin
 * erneut und fällt sonst durch (siehe resolve.ts) — eine zweite Prüfung hier
 * bräuchte einen zusätzlichen Mandanten-Ladevorgang ohne Sicherheitsgewinn.
 */
export async function mirrorProfileLocaleCookie(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: profile } = await supabase
    .from("profiles")
    .select("locale")
    .eq("id", user.id)
    .maybeSingle();

  const locale = profile?.locale;
  if (typeof locale !== "string" || !isSupportedLocale(locale)) return;

  const cookieStore = await cookies();
  cookieStore.set("NEXT_LOCALE", locale, NEXT_LOCALE_COOKIE_OPTIONS);
}
