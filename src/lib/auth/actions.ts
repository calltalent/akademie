"use server";

import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  magicLinkSchema,
  passwordSignInSchema,
  passwordSignUpSchema,
  passwordResetRequestSchema,
  newPasswordSchema,
} from "@/lib/auth/schema";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import { getTenant } from "@/lib/tenant/context";
import { tenantOrigin } from "@/lib/tenant/url";
import { resolveTenantEmailLocale, type Locale } from "@/i18n/config";
import { translateAuthError } from "@/lib/auth/errors";
import { sendEmail } from "@/lib/email/client";
import { passwordReset, magicLinkEmail, confirmSignup } from "@/lib/email/templates";

export type AuthActionState = { error: string | null; success?: boolean; redirectTo?: string };

/**
 * Legt bei Erstanmeldung die profiles-Zeile an, falls sie fehlt.
 * RLS-Policy `profiles_own` erlaubt dem Nutzer nur seine eigene Zeile
 * (id = auth.uid()) — kein Admin-Client nötig.
 *
 * BUGFIX (02.08.2026, Josips Fund: "Mandanten-Standardsprache auf Bosnisch
 * gestellt, Admin-/Lernbereich bleiben trotzdem Deutsch"): `profiles.locale`
 * hat in 0001_init.sql einen harten Spalten-Default `'de'` — jede neue Zeile
 * bekam den bisher unabhängig vom Mandanten, weil kein Aufrufer `locale`
 * mitschrieb. `resolveLocale()` (i18n/resolve.ts) gewichtet das Cookie (aus
 * genau diesem `profiles.locale` gespiegelt) VOR dem Mandanten-Standard —
 * ein frisch angelegter Nutzer eines bosnisch-Standard-Mandanten sah dadurch
 * dauerhaft Deutsch, nicht nur einmalig. `ignoreDuplicates: true` bleibt
 * unverändert (nur INSERT, nie ein Überschreiben einer bereits bestehenden,
 * ggf. selbst gewählten Locale eines Bestandsnutzers).
 */
async function ensureProfile(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  email: string,
  fullName?: string,
  locale?: Locale,
) {
  await supabase
    .from("profiles")
    .upsert(
      { id: userId, email, full_name: fullName ?? null, ...(locale ? { locale } : {}) },
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

  // IP-basiert, da vor dem Login noch kein Nutzer/Mandant bekannt ist —
  // schützt gegen Passwort-Brute-Force (Security-Fix 11.07.2026).
  if (!(await checkRateLimit("auth-login", { maxRequests: 10, windowSeconds: 60 }))) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  // Zusätzlich pro Zielkonto (Security-Fix 01.08.2026, security-reviewer-
  // Audit MITTEL): das IP-Limit allein schützt nicht gegen verteilten
  // Brute-Force über viele IPs gegen dasselbe Konto. Schlüssel ist ein
  // sha256-Hash der normalisierten E-Mail, keine PII im rate_limits-Schlüssel.
  if (parsed.success) {
    const emailKey = createHash("sha256")
      .update(parsed.data.email.trim().toLowerCase())
      .digest("hex");
    if (
      !(await checkRateLimit("auth-login-email", {
        maxRequests: 5,
        windowSeconds: 300,
        extraKey: emailKey,
      }))
    ) {
      return { error: RATE_LIMIT_MESSAGE };
    }
  }

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user) {
    return { error: "E-Mail oder Passwort falsch." };
  }

  // getTenant() vorgezogen (vor ensureProfile() statt erst kurz vor dem
  // Redirect unten) — liefert die Locale für eine neu angelegte profiles-Zeile
  // (Bugfix 02.08.2026, siehe Kopfkommentar zu ensureProfile()). Kein
  // zusätzlicher DB-Zugriff, da React-cache()-gebunden (s. Kommentar unten).
  const tenant = await getTenant();
  await ensureProfile(
    supabase,
    data.user.id,
    data.user.email ?? parsed.data.email,
    undefined,
    resolveTenantEmailLocale(tenant?.settings.default_locale),
  );

  // Performance-Fix (19.07.2026, Josips Fund: Anmeldung immer noch langsam
  // trotz getAuthUser()-Fix): redirect("/") lief für Mandanten-Logins immer
  // über app/page.tsx, das seinerseits sofort auf /dashboard weiterleitet —
  // ein zusätzlicher kompletter Request/Middleware/getUser()-Rundlauf für
  // eine Zwischenseite, die nie etwas anzeigt. getTenant() liest hier bereits
  // gecacht aus dem Middleware-Header (kein DB-Zugriff, s. tenant/context.ts)
  // und entscheidet identisch zu app/page.tsx — auf dem Portal-Host bleibt
  // `tenant` null (kein x-tenant-data-Header dort), redirect("/") also
  // unverändert (Middleware schreibt "/" dort transparent auf /portal um).
  //
  // BUGFIX (22.07.2026, Josips Fund: Login dauert 20+ Sekunden): ein direkter
  // redirect() HIER, in einer per useActionState/<form action={fn}> JS-
  // gebundenen Server Action, lief serverseitig immer in unter 1,5 Sekunden
  // (per fetch() UND per rohem, React-losem <form>-POST in einem isolierten
  // iframe verifiziert — 873 ms bzw. 1,3 s bis zur fertigen Dashboard-
  // Antwort). Die exakt gleiche Anmeldung über das echte, React-gebundene
  // Formular auf der Login-Seite brauchte reproduzierbar 20+ Sekunden — der
  // Server war also nie das Problem. Next.js' Client-Runtime behandelt einen
  // während einer Server Action geworfenen redirect() offenbar über einen
  // Pfad, der auf dieser (Cloudflare/OpenNext-)Plattform sehr langsam wird
  // (der End-Redirect landete beim finalen Dokument sogar mit
  // `redirectCount: 0` statt 1 — kein sauberer Redirect-Follow). Umgangen,
  // indem die Aktion das Ziel nur als Daten zurückgibt; die Navigation
  // übernimmt die Client-Komponente selbst (siehe login/page.tsx), außerhalb
  // von Next' eigener Redirect-Sonderbehandlung für Server Actions.
  return { error: null, redirectTo: tenant ? "/dashboard" : "/" };
}

export async function signUpWithPassword(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  if (!(await checkRateLimit("auth-signup", { maxRequests: 5, windowSeconds: 300 }))) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  // Design-Block 6 (13.07.2026, AdminEinstellungen.dc.html "Selbstregistrierung
  // erlauben"): löst die bisher offene Frage in (auth)/login/page.tsx ("soll
  // Selbstregistrierung ganz entfallen oder abschaltbar bleiben?") — statt
  // hart zu entfernen, ist sie jetzt pro Mandant abschaltbar (Default weiterhin
  // an, unverändertes Verhalten für alle bisherigen Mandanten ohne das Feld).
  const tenant = await getTenant();
  if (!tenant) {
    return { error: "Kein Mandant zu diesem Host gefunden." };
  }
  if (tenant.settings.self_signup_enabled === false) {
    return { error: "Die Registrierung ist für diesen Mandanten deaktiviert." };
  }

  const parsed = passwordSignUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    fullName: formData.get("fullName"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }

  // UMBAU (19.07.2026, Josips Auftrag "alle E-Mails diesem Layout anpassen" —
  // gleiches Muster wie bei Passwort-Reset/Magic-Link oben): `supabase.auth.
  // signUp()` verschickte die Bestätigungsmail bisher DIREKT über Supabase
  // mit dessen unmarkierter Standardvorlage (dieselbe Lücke, bestätigt über
  // den Hinweistext "Bitte E-Mail-Postfach zur Bestätigung prüfen" auf
  // /registrieren — Bestätigung ist für dieses Projekt also aktiv Pflicht).
  // `admin.auth.admin.generateLink({type:"signup"})` legt das Konto genauso
  // an (inkl. Passwort/Name), verschickt dabei aber KEINE Mail — wir
  // verschicken sie stattdessen selbst über `confirmSignup()`.
  const redirectBase = tenantOrigin(tenant);
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "signup",
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      redirectTo: `${redirectBase}/auth/callback`,
    },
  });
  if (error) {
    return { error: "Registrierung fehlgeschlagen: " + translateAuthError(error) };
  }
  if (!data?.properties?.action_link || !data.user) {
    return { error: "Registrierung fehlgeschlagen. Bitte versuche es erneut." };
  }

  // Admin-Client statt der bisherigen ensureProfile(supabase, …) mit dem
  // anfrage-gebundenen Client: signUp() legt an dieser Stelle noch KEINE
  // Session an (Bestätigung steht ja noch aus), `profiles_own`-RLS
  // (`id = auth.uid()`) würde den Upsert also ohnehin verwerfen — genau wie
  // vorher schon, nur unbemerkt, weil `ensureProfile()` Fehler verschluckt.
  // Der Login NACH der Bestätigung (`signInWithPassword()` oben) ruft
  // `ensureProfile()` ohnehin erneut auf und legt die Zeile dann mit echter
  // Session an; dieser Aufruf hier ist rein ein zusätzliches, jetzt
  // zuverlässiges Sicherheitsnetz, keine neue Anforderung.
  // Locale-Quelle laut Plan (Abschnitt 6, C5a): Mandanten-Standardsprache,
  // nicht die individuelle profiles.locale des Empfängers. Vorgezogen (stand
  // bisher erst nach dem Upsert) — Bugfix 02.08.2026 (siehe Kopfkommentar zu
  // ensureProfile()): dieselbe Locale muss jetzt auch in die neue Zeile,
  // sonst greift wieder der harte `profiles.locale`-Spalten-Default `'de'`.
  const locale = resolveTenantEmailLocale(tenant.settings.default_locale);
  await admin
    .from("profiles")
    .upsert(
      { id: data.user.id, email: parsed.data.email, full_name: parsed.data.fullName, locale },
      { onConflict: "id", ignoreDuplicates: true },
    );

  const html = await confirmSignup({
    tenantName: tenant.name,
    recipientName: parsed.data.fullName,
    confirmUrl: data.properties.action_link,
    accentColor: tenant.branding?.color_primary,
    locale,
  });
  const tSubject = await getTranslations({ locale, namespace: "email" });
  const sendResult = await sendEmail({
    to: parsed.data.email,
    subject: tSubject("confirmSignup.subject", { tenantName: tenant.name }),
    html,
    tenant: { name: tenant.name },
  });
  if (!sendResult.success) {
    return {
      error: "Konto wurde angelegt, die Bestätigungsmail konnte aber nicht verschickt werden. Bitte kontaktiere den Support.",
    };
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
  // Zusätzlich zum Supabase-eigenen SMTP-Rate-Limit (siehe import.ts-Fix) —
  // verhindert, dass eine einzelne IP fremde Postfächer mit Magic Links flutet.
  if (!(await checkRateLimit("auth-magic-link", { maxRequests: 5, windowSeconds: 300 }))) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  const parsed = magicLinkSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }

  // BUGFIX (Phase 5, Block 8, 12.07.2026): hing vorher an der globalen
  // Build-Time-Variable NEXT_PUBLIC_SITE_URL (fest auf die alte Domain
  // akademie.calltalent.ai eingebacken, siehe .env.production) statt am
  // tatsächlichen Mandanten-Host - vierter Fund derselben Fehlerklasse wie
  // in stripe/checkout.ts, stripe/portal.ts und users/import.ts (siehe
  // src/lib/tenant/url.ts). Für den Mandanten "calltalent" wäre der Magic-
  // Link-Rücksprung auf einer falschen/nicht mehr existierenden Domain
  // gelandet - der bislang EINZIGE funktionierende Erstanmeldeweg für
  // importierte Nutzer (siehe Josips Fund zum fehlenden Passwort-Setzen-
  // Screen) wäre damit ebenfalls kaputt gewesen.
  const tenant = await getTenant();
  const redirectBase = tenant ? tenantOrigin(tenant) : (process.env.NEXT_PUBLIC_SITE_URL ?? "");

  // UMBAU (19.07.2026, Josips Auftrag "alle E-Mails diesem Layout anpassen"):
  // `signInWithOtp()` verschickte die Mail bisher DIREKT über Supabase — mit
  // Supabases eigener, unmarkierter Standardvorlage statt unseres gebrandeten
  // Layouts. Gleiches Muster wie `buildSetPasswordLink()` in `users/import.ts`:
  // Link selbst über die Admin-API erzeugen (verschickt dabei KEINE Mail),
  // dann über unsere eigene `sendEmail()`+`magicLinkEmail()` verschicken.
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: parsed.data.email,
    options: { redirectTo: `${redirectBase}/auth/callback` },
  });
  if (error) {
    return { error: "Versand fehlgeschlagen: " + translateAuthError(error) };
  }
  if (!data?.properties?.action_link) {
    return { error: "Versand fehlgeschlagen. Bitte versuche es erneut." };
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("full_name")
    .eq("email", parsed.data.email)
    .maybeSingle();

  // Locale-Quelle laut Plan (Abschnitt 6, C5a): Mandanten-Standardsprache,
  // nicht die individuelle profiles.locale des Empfängers. Kein Mandant
  // (Portal-Host) -> DEFAULT_LOCALE, wie schon der bisherige "Calltalent"-Fallback.
  const locale = resolveTenantEmailLocale(tenant?.settings.default_locale);
  const html = await magicLinkEmail({
    tenantName: tenant?.name ?? "Calltalent",
    recipientName: profile?.full_name ?? undefined,
    loginUrl: data.properties.action_link,
    accentColor: tenant?.branding?.color_primary,
    locale,
  });
  const tSubject = await getTranslations({ locale, namespace: "email" });
  const sendResult = await sendEmail({
    to: parsed.data.email,
    subject: tSubject("magicLinkEmail.subject", { tenantName: tenant?.name ?? "Calltalent" }),
    html,
    tenant: { name: tenant?.name ?? "Calltalent" },
  });
  if (!sendResult.success) {
    return { error: "Versand fehlgeschlagen. Bitte versuche es später erneut." };
  }

  return { error: null, success: true };
}

/**
 * NEU (Phase 5, Block 8, 12.07.2026 — Josips Fund: es gab überhaupt keine
 * Möglichkeit, ein erstes Passwort zu setzen, weder für eingeladene/
 * importierte Nutzer noch als "Passwort vergessen"-Weg, obwohl `/login` und
 * `/profil` bereits beide darauf verwiesen). Führt auf
 * `/auth/callback?next=/passwort-setzen` (bestehende Route, tauscht den Code
 * gegen eine Session und leitet dann weiter, siehe auth/callback/route.ts).
 *
 * UMBAU (19.07.2026, Josips Auftrag "alle E-Mails diesem Layout anpassen"):
 * lief vorher über `supabase.auth.resetPasswordForEmail()` — verschickte
 * damit Supabases eigene, unmarkierte Standardvorlage statt unseres
 * gebrandeten Layouts (dieselbe Lücke wie beim Magic-Link, siehe
 * `signInWithMagicLink()` oben). Jetzt exakt dasselbe Muster wie
 * `buildSetPasswordLink()` in `users/import.ts`: Link selbst über
 * `admin.auth.admin.generateLink({type:"recovery"})` erzeugen (verschickt
 * dabei KEINE Mail), dann über unsere eigene `sendEmail()`+`passwordReset()`
 * verschicken.
 *
 * Der komplette Mailversand steht bewusst in einem eigenen try/catch, der
 * NICHTS nach außen durchlässt: weder ein "E-Mail existiert nicht" noch ein
 * technischer Fehler dürfen die Rückmeldung verändern (E-Mail-Enumeration-
 * Schutz, unverändert gegenüber der bisherigen `resetPasswordForEmail()`-
 * Variante — die gab bei unbekannter Adresse ebenfalls keinen Fehler zurück).
 */
export async function requestPasswordReset(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  if (!(await checkRateLimit("auth-password-reset", { maxRequests: 5, windowSeconds: 300 }))) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  const parsed = passwordResetRequestSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }

  const tenant = await getTenant();
  const redirectBase = tenant ? tenantOrigin(tenant) : (process.env.NEXT_PUBLIC_SITE_URL ?? "");

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.generateLink({
      type: "recovery",
      email: parsed.data.email,
      options: { redirectTo: `${redirectBase}/auth/callback?next=/passwort-setzen` },
    });
    if (!error && data?.properties?.action_link) {
      const { data: profile } = await admin
        .from("profiles")
        .select("full_name")
        .eq("email", parsed.data.email)
        .maybeSingle();

      // Locale-Quelle laut Plan (Abschnitt 6, C5a): Mandanten-Standardsprache,
      // nicht die individuelle profiles.locale des Empfängers.
      const locale = resolveTenantEmailLocale(tenant?.settings.default_locale);
      const html = await passwordReset({
        tenantName: tenant?.name ?? "Calltalent",
        recipientName: profile?.full_name ?? undefined,
        resetUrl: data.properties.action_link,
        accentColor: tenant?.branding?.color_primary,
        locale,
      });
      const tSubject = await getTranslations({ locale, namespace: "email" });
      await sendEmail({
        to: parsed.data.email,
        subject: tSubject("passwordReset.subject", { tenantName: tenant?.name ?? "Calltalent" }),
        html,
        tenant: { name: tenant?.name ?? "Calltalent" },
      });
    }
  } catch {
    // Absichtlich verschluckt — siehe Kopfkommentar (Enumeration-Schutz).
  }

  // Absichtlich IMMER Erfolg zurückgeben (siehe Kommentar oben) - ein
  // tatsächlicher Versandfehler (SMTP down o. Ä.) ist hier kein Nutzer-
  // Problem, das eine andere Rückmeldung rechtfertigen würde.
  return { error: null, success: true };
}

/**
 * Setzt ein neues Passwort - braucht eine bereits aktive Session aus dem
 * Recovery-Link (via /auth/callback hergestellt). `updateUser()` arbeitet
 * auf der aktuellen Session, kein separates Token/Code nötig.
 */
export async function setNewPassword(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = newPasswordSchema.safeParse({ password: formData.get("password") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      error: "Sitzung abgelaufen oder ungültig. Bitte fordere einen neuen Link über „Passwort vergessen“ an.",
    };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return { error: "Passwort konnte nicht gesetzt werden: " + translateAuthError(error) };
  }

  // getTenant() hier neu (Bugfix 02.08.2026, siehe Kopfkommentar zu
  // ensureProfile()) — für importierte/eingeladene Erstnutzer, die ihr erstes
  // Passwort über diesen Weg setzen, braucht die neu angelegte profiles-Zeile
  // die Mandanten-Standardsprache statt des harten Spalten-Defaults `'de'`.
  const tenant = await getTenant();
  await ensureProfile(
    supabase,
    user.id,
    user.email ?? "",
    undefined,
    resolveTenantEmailLocale(tenant?.settings.default_locale),
  );
  // BUGFIX (22.07.2026): gleicher Grund wie bei signInWithPassword() oben —
  // redirect() direkt aus einer JS-gebundenen Server Action heraus ist auf
  // dieser Plattform der langsame Pfad. Ziel als Daten zurückgeben, Client
  // navigiert selbst (new-password-form.tsx).
  return { error: null, redirectTo: "/" };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
