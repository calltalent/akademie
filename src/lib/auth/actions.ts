"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  magicLinkSchema,
  passwordSignInSchema,
  passwordSignUpSchema,
} from "@/lib/auth/schema";

export type AuthActionState = { error: string | null; success?: boolean };

/**
 * Legt bei Erstanmeldung die profiles-Zeile an, falls sie fehlt.
 * RLS-Policy `profiles_own` erlaubt dem Nutzer nur seine eigene Zeile
 * (id = auth.uid()) — kein Admin-Client nötig.
 */
async function ensureProfile(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  email: string,
  fullName?: string,
) {
  await supabase
    .from("profiles")
    .upsert(
      { id: userId, email, full_name: fullName ?? null },
      { onConflict: "id", ignoreDuplicates: true },
    );
}

export async function signInWithPassword(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = passwordSignInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user) {
    return { error: "E-Mail oder Passwort falsch." };
  }

  await ensureProfile(supabase, data.user.id, data.user.email ?? parsed.data.email);
  redirect("/");
}

export async function signUpWithPassword(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = passwordSignUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    fullName: formData.get("fullName"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { full_name: parsed.data.fullName } },
  });
  if (error) {
    return { error: "Registrierung fehlgeschlagen: " + error.message };
  }
  if (data.user) {
    await ensureProfile(supabase, data.user.id, parsed.data.email, parsed.data.fullName);
  }

  return {
    error: null,
    success: true,
  };
}

export async function signInWithMagicLink(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = magicLinkSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/auth/callback` },
  });
  if (error) {
    return { error: "Versand fehlgeschlagen: " + error.message };
  }

  return { error: null, success: true };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
