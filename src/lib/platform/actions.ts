"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/platform/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import {
  createTenantSchema,
  updateTenantSchema,
  tenantCustomDomainSchema,
  tenantBrandingSchema,
  tenantLogoUrlSchema,
  tenantLoginContentSchema,
} from "@/lib/platform/schema";
import { buildSetPasswordLink, findUserByEmail, type ImportTenant } from "@/lib/users/import";
import { sendEmail } from "@/lib/email/client";
import { welcomeInvite } from "@/lib/email/templates";
import { translateDbError } from "@/lib/errors/db";
import { translateAuthError } from "@/lib/auth/errors";
import { genericErrorMessage } from "@/lib/errors/generic";

/**
 * Server Actions fuer das Betreiber-Portal: Mandant anlegen/bearbeiten
 * (Phase 4, Block 2).
 *
 * `tenants`-RLS (0001_init.sql Zeile 439-443) erlaubt SELECT/UPDATE nur
 * Mandanten-Mitgliedern und hat GAR KEINE INSERT-Policy — laut
 * Schema-Kommentar "Anlegen nur ueber service_role (Betreiber-Portal)".
 * Platform-Admins sind keine Mandanten-Mitglieder (siehe
 * src/lib/platform/auth.ts). Beide Actions pruefen deshalb zuerst
 * `requirePlatformAdmin()` (Zugriffskontrolle ueber den Session-Client),
 * fuehren die eigentliche Query aber ausschliesslich ueber
 * `createAdminClient()` (service_role) aus — der Session-Client aus
 * `requirePlatformAdmin()` wuerde an der RLS scheitern.
 *
 * WICHTIG: `redirect()` (next/navigation) wird hier bewusst NICHT
 * aufgerufen — Next.js implementiert Redirects ueber einen internen
 * Kontrollfluss-Wurf (eine spezielle Exception), der von einem umgebenden
 * try/catch sonst als regulaerer Fehler abgefangen wuerde. `createTenant`
 * liefert bei Erfolg stattdessen `{ok:true→error:null,success:true,id,slug}`
 * zurueck — der Redirect zur Detailseite passiert client-seitig in
 * `neu/page.tsx` per `useRouter()` in einem `useEffect`. `deleteTenant`
 * folgt seit 26.07.2026 (Josips Fund: "Löschen dauert sehr lange") demselben
 * Muster — siehe dortiger Kommentar zur Vorgeschichte (serverseitiges
 * `redirect()` war hier zwischenzeitlich die einzige Ausnahme).
 */

export type PlatformActionState = {
  error: string | null;
  success?: boolean;
  id?: string;
  slug?: string;
  /** NEU (Phase 5, Block 8, 12.07.2026): Rückmeldung zur optionalen Inhaber-Einladung. */
  ownerInviteError?: string;
};

function errorState(e: unknown): PlatformActionState {
  return { error: genericErrorMessage(e) };
}

export async function createTenant(
  _prevState: PlatformActionState,
  formData: FormData,
): Promise<PlatformActionState> {
  try {
    const { user } = await requirePlatformAdmin();

    // Rate-Limit analog Block 7/Phase 3 (checkRateLimit()-Muster,
    // src/lib/security/rate-limit.ts): service_role-Schreibzugriff, pro
    // Platform-Admin statt IP (extraKey: user.id) begrenzt, da alle
    // Platform-Admins ueber dieselbe Verwaltungsoberflaeche gehen.
    if (
      !(await checkRateLimit("platform-create-tenant", {
        maxRequests: 20,
        windowSeconds: 3600,
        extraKey: user.id,
      }))
    ) {
      return { error: RATE_LIMIT_MESSAGE };
    }

    const parsed = createTenantSchema.safeParse({
      name: formData.get("name"),
      slug: formData.get("slug"),
      plan: formData.get("plan"),
      ownerEmail: formData.get("ownerEmail") ?? "",
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("tenants")
      .insert({
        name: parsed.data.name,
        slug: parsed.data.slug,
        plan: parsed.data.plan,
      })
      .select("id, slug")
      .single();

    if (error) {
      // 23505 = unique_violation (Postgres) — hier nur ueber tenants.slug
      // moeglich (custom_domain wird bei der Anlage noch nicht gesetzt).
      if (error.code === "23505") {
        return { error: "Subdomain bereits vergeben." };
      }
      return { error: "Anlegen fehlgeschlagen: " + translateDbError(error) };
    }

    revalidatePath("/portal/mandanten");

    // NEU (Phase 5, Block 8, 12.07.2026 — Josips Fund: "nach dem Anlegen des
    // Mandanten gibt es keine Option, um ein Passwort für den Mandanten
    // anzulegen"). Bewusst NACH dem erfolgreichen Tenant-Insert und ohne
    // dessen Erfolg zu gefährden — der Mandant existiert so oder so, die
    // Inhaber-Einladung ist best-effort (Fehler landet in `ownerInviteError`,
    // blockiert aber nicht `success`). Kein Passwort wird hier serverseitig
    // gesetzt/generiert (Sicherheitsregel-Geist: Claude/Server erzeugt und
    // kennt nie das tatsächliche Nutzerpasswort) — stattdessen exakt derselbe
    // Mechanismus wie beim CSV-Import (siehe users/import.ts): Konto ohne
    // Passwort anlegen, dann einen echten, einmaligen Passwort-setzen-Link
    // per E-Mail zuschicken.
    let ownerInviteError: string | undefined;
    if (parsed.data.ownerEmail) {
      ownerInviteError = await inviteTenantOwner(admin, {
        id: data.id,
        slug: data.slug,
        name: parsed.data.name,
      }, parsed.data.ownerEmail);
    }

    return { error: null, success: true, id: data.id, slug: data.slug, ownerInviteError };
  } catch (e) {
    return errorState(e);
  }
}

/**
 * Legt (oder verknüpft, falls die E-Mail bereits ein Konto hat) den
 * Mandanten-Inhaber an und verschickt die Einladung. Gibt bei Erfolg
 * `undefined` zurück, sonst eine Nutzertext-Fehlermeldung — wirft nie
 * (Aufrufer behandelt das als optionalen, nicht-blockierenden Schritt).
 */
async function inviteTenantOwner(
  admin: ReturnType<typeof createAdminClient>,
  tenant: { id: string; slug: string; name: string },
  ownerEmail: string,
): Promise<string | undefined> {
  try {
    let userId: string;
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: ownerEmail,
      email_confirm: true,
    });
    if (created?.user) {
      userId = created.user.id;
    } else {
      const existing = await findUserByEmail(admin, ownerEmail);
      if (!existing) {
        return createError ? translateAuthError(createError) : "Inhaber-Konto konnte nicht angelegt werden.";
      }
      userId = existing.id;
    }

    await admin.from("profiles").upsert(
      { id: userId, email: ownerEmail },
      { onConflict: "id", ignoreDuplicates: true },
    );

    const { error: membershipError } = await admin.from("memberships").upsert(
      { tenant_id: tenant.id, user_id: userId, role: "owner", status: "active" },
      { onConflict: "tenant_id,user_id" },
    );
    if (membershipError) return translateDbError(membershipError);

    const importTenant: ImportTenant = {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      custom_domain: null,
      branding: {},
    };
    const loginUrl = await buildSetPasswordLink(admin, importTenant, ownerEmail);
    const html = welcomeInvite({ tenantName: tenant.name, loginUrl });
    const sendResult = await sendEmail({
      to: ownerEmail,
      subject: `Willkommen bei ${tenant.name}`,
      html,
      tenant: { name: tenant.name },
    });
    if (!sendResult.success) {
      // sendResult.error kann eine rohe, technische/englische Resend-API-
      // Meldung sein (siehe email/client.ts) — Detail nur loggen, Nutzer
      // bekommt einen klaren deutschen Satz.
      console.error("[platform/actions] Einladungsmail konnte nicht verschickt werden.", {
        tenantId: tenant.id,
        error: sendResult.error,
      });
      return "Einladungsmail konnte nicht verschickt werden.";
    }

    return undefined;
  } catch (e) {
    // e.message kann eine rohe/technische Meldung sein (z. B. aus
    // buildSetPasswordLink) — Detail nur loggen, Nutzer bekommt einen
    // klaren deutschen Satz.
    console.error("[platform/actions] Unerwarteter Fehler bei der Inhaber-Einladung.", {
      tenantId: tenant.id,
      error: e instanceof Error ? e.message : e,
    });
    return "Unbekannter Fehler bei der Inhaber-Einladung.";
  }
}

/**
 * NEU (Phase 5, Block 8, 12.07.2026 — Josips Fund: "Es fehlt die Option zum
 * Löschen der Mandanten"). Löscht ausschließlich die `tenants`-Zeile — alle
 * ~25 abhängigen Tabellen (memberships, courses, enrollments, orders, …)
 * haben laut supabase/migrations/*.sql durchgängig `ON DELETE CASCADE` auf
 * `tenant_id` und werden von Postgres automatisch mitgelöscht. NICHT
 * mitgelöscht (bewusst außerhalb des DB-Deletes, siehe Warnhinweis im
 * Lösch-Formular): Supabase-Storage-Objekte unter `{tenant_id}/...`
 * (branding/course-assets/submissions/certificates), Bunny-CDN-Videos und
 * laufende Stripe-Abos — diese müssten separat/manuell bereinigt werden.
 *
 * Doppelte Absicherung gegen Fehlklicks: die Server Action prüft die
 * eingegebene Subdomain (`confirmSlug`) gegen die tatsächliche
 * `tenant.slug` — exakt wie beim CSV-Import/Owner-Einladung-Muster dieser
 * Datei wird nie stillschweigend geraten oder autovervollständigt.
 */
export async function deleteTenant(
  tenantId: string,
  expectedSlug: string,
  _prevState: PlatformActionState,
  formData: FormData,
): Promise<PlatformActionState> {
  // BUGFIX (26.07.2026, Josips Fund: "das Löschen dauert sehr lange, ähnlich
  // wie früher bei der Löschung von Kursen"). War bisher ein serverseitiges
  // `redirect()` DIREKT hier (siehe Git-Historie) — Fix für den damaligen
  // "weißer Bildschirm"-Fund (12.07.2026): das Lösch-Formular sitzt auf
  // genau der Seite (/portal/mandanten/[id]), deren Datensatz gerade
  // gelöscht wird, Next.js rendert die aufrufende Route nach der Server
  // Action automatisch neu (RSC-Refresh) — noch BEVOR ein client-seitiges
  // `router.push()` greifen konnte —, und das damalige `notFound()` auf
  // dieser (jetzt gelöschten) Seite blieb unter dem OpenNext-Cloudflare-
  // Adapter dabei leer statt einer sauberen 404-Seite. Ein `redirect()`
  // INNERHALB einer per `<form action={fn}>`/`useActionState` JS-gebunden
  // aufgerufenen Server Action läuft auf dieser Plattform aber reproduzierbar
  // 20+ Sekunden statt <1,5s (exakt dieselbe Fehlerklasse wie bei
  // signInWithPassword()/deleteCourse(), siehe dortige Kommentare) — genau
  // das war Josips heutiger Fund.
  //
  // Fix jetzt: `/portal/mandanten/[id]/page.tsx` wirft bei fehlendem
  // Mandanten nicht mehr `notFound()`, sondern rendert eine gewöhnliche
  // Inline-Meldung (kein Exception-Pfad mehr, der unter OpenNext bricht) —
  // der o. g. RSC-Zwischenzustand zeigt dadurch jetzt einfach kurz diese
  // Meldung, statt zu brechen. Dadurch kann hier wieder auf die schnelle,
  // rein client-seitige Navigation umgestellt werden: `{error:null,
  // success:true}` zurückgeben, `mandant-delete-form.tsx` navigiert selbst
  // per `router.push()`.
  try {
    const { user } = await requirePlatformAdmin();

    if (
      !(await checkRateLimit("platform-delete-tenant", {
        maxRequests: 10,
        windowSeconds: 3600,
        extraKey: user.id,
      }))
    ) {
      return { error: RATE_LIMIT_MESSAGE };
    }

    const confirmSlug = String(formData.get("confirmSlug") ?? "")
      .trim()
      .toLowerCase();
    if (confirmSlug !== expectedSlug) {
      return { error: "Bestätigung stimmt nicht überein — bitte die Subdomain exakt eingeben." };
    }

    const admin = createAdminClient();
    const { error } = await admin.from("tenants").delete().eq("id", tenantId);
    if (error) {
      return { error: "Löschen fehlgeschlagen: " + translateDbError(error) };
    }

    revalidatePath("/portal/mandanten");
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

export async function updateTenant(
  tenantId: string,
  _prevState: PlatformActionState,
  formData: FormData,
): Promise<PlatformActionState> {
  try {
    await requirePlatformAdmin();

    const parsed = updateTenantSchema.safeParse({
      name: formData.get("name"),
      plan: formData.get("plan"),
      status: formData.get("status"),
      customDomain: formData.get("customDomain") ?? "",
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }

    const admin = createAdminClient();
    const { error } = await admin
      .from("tenants")
      .update({
        name: parsed.data.name,
        plan: parsed.data.plan,
        status: parsed.data.status,
        custom_domain: parsed.data.customDomain,
      })
      .eq("id", tenantId);

    if (error) {
      // 23505 hier nur ueber tenants.custom_domain moeglich (slug wird beim
      // Bearbeiten nicht mehr veraendert).
      if (error.code === "23505") {
        return { error: "Domain bereits vergeben." };
      }
      return { error: "Speichern fehlgeschlagen: " + translateDbError(error) };
    }

    revalidatePath(`/portal/mandanten/${tenantId}`);
    revalidatePath("/portal/mandanten");
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

/**
 * FOLGEAUFTRAG (12.07.2026, Josip: "learning soll auch bleiben" — ein
 * Mandant soll mehrere Domains gleichzeitig bedienen können): zusätzliche
 * Domains ("Aliase") landen in tenant_domains (Migration "tenant_domains"),
 * NICHT in tenants.custom_domain — diese Spalte bleibt die eine "primäre"
 * Domain, unverändert von updateTenant() oben verwaltet. Gleiche
 * Zugriffskontrolle/Validierung wie dort (requirePlatformAdmin() +
 * tenantCustomDomainSchema, service_role fürs eigentliche Schreiben).
 */
export async function addTenantDomain(
  tenantId: string,
  _prevState: PlatformActionState,
  formData: FormData,
): Promise<PlatformActionState> {
  try {
    await requirePlatformAdmin();

    const parsed = tenantCustomDomainSchema.safeParse(formData.get("domain") ?? "");
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }
    if (parsed.data === null) {
      return { error: "Domain darf nicht leer sein." };
    }

    const admin = createAdminClient();
    const { error } = await admin
      .from("tenant_domains")
      .insert({ tenant_id: tenantId, domain: parsed.data });

    if (error) {
      // 23505: Domain bereits als Alias ODER als primäre custom_domain
      // (eines beliebigen Mandanten) vergeben — beide Spalten sind unique.
      if (error.code === "23505") {
        return { error: "Domain bereits vergeben." };
      }
      return { error: "Speichern fehlgeschlagen: " + translateDbError(error) };
    }

    revalidatePath(`/portal/mandanten/${tenantId}`);
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

/**
 * NEU (Design-Block 6, 13.07.2026, Mandanten.dc.html "Branding & Theming"):
 * erster echter Schreibweg für `tenants.branding` — vorher nur lesend
 * genutzt (siehe Schema-Kommentar). Merge-Patch auf das bestehende
 * `branding`-JSON (liest zuerst, überschreibt nur `color_primary`/`radius`,
 * lässt `logo_url`/`color_bg`/`font` unangetastet).
 */
export async function updateTenantBranding(
  tenantId: string,
  _prevState: PlatformActionState,
  formData: FormData,
): Promise<PlatformActionState> {
  try {
    await requirePlatformAdmin();

    const parsed = tenantBrandingSchema.safeParse({
      colorPrimary: formData.get("colorPrimary"),
      radius: formData.get("radius"),
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }

    const admin = createAdminClient();
    const { data: current } = await admin
      .from("tenants")
      .select("branding")
      .eq("id", tenantId)
      .maybeSingle();

    const mergedBranding = {
      ...(current?.branding ?? {}),
      color_primary: parsed.data.colorPrimary,
      radius: `${parsed.data.radius}px`,
    };

    const { error } = await admin.from("tenants").update({ branding: mergedBranding }).eq("id", tenantId);
    if (error) {
      return { error: "Speichern fehlgeschlagen: " + translateDbError(error) };
    }

    revalidatePath(`/portal/mandanten/${tenantId}`);
    revalidatePath("/portal/mandanten");
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

/**
 * Mandanten-Logo (19.07.2026, Josips Auftrag: "Option für Logo-Upload des
 * Mandanten"). Gleiches Merge-Patch-Muster wie `updateTenantBranding` (nur
 * `logo_url` betroffen, `color_primary`/`radius` bleiben unangetastet) —
 * eigene Funktion statt eines gemeinsamen Formulars, weil der Datei-Upload
 * (siehe api/portal/tenant-logo/upload-url/route.ts + ThumbnailUpload)
 * einen eigenen, sofortigen Schreib-Zyklus braucht, unabhängig vom
 * Farbe/Radius-Formular.
 */
export async function updateTenantLogoUrl(
  tenantId: string,
  url: string,
): Promise<PlatformActionState> {
  try {
    await requirePlatformAdmin();

    const parsed = tenantLogoUrlSchema.safeParse(url);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Ungültige Bild-URL." };
    }

    const admin = createAdminClient();
    const { data: current } = await admin
      .from("tenants")
      .select("branding")
      .eq("id", tenantId)
      .maybeSingle();

    const mergedBranding = { ...(current?.branding ?? {}), logo_url: parsed.data };

    const { error } = await admin.from("tenants").update({ branding: mergedBranding }).eq("id", tenantId);
    if (error) {
      return { error: "Speichern fehlgeschlagen: " + translateDbError(error) };
    }

    revalidatePath(`/portal/mandanten/${tenantId}`);
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

/**
 * Kostenpflichtige/optionale Funktionen je Mandant (25.07.2026, Josips
 * Auftrag: "wo aktiviere ich den KI-Generator, bitte im jeweiligen
 * Mandanten hinzufügen wo ich aktivieren kann"). `payments_enabled`,
 * `tutor_enabled`, `course_generator_enabled` (alle drei in
 * `lib/tenant/types.ts` typisiert und an je einer Gate-Stelle durchgesetzt:
 * `lib/stripe/checkout.ts`, `lib/tutor/actions.ts`,
 * `api/admin/ki/generate/route.ts` + `admin/ki/page.tsx`) hatten bislang
 * KEINE UI — nur direkt in der DB setzbar. Gleiches Merge-Patch-Muster wie
 * `updateTenantBranding` (aktuelle `settings` lesen, nur die drei
 * Feature-Schlüssel überschreiben, Rest unangetastet).
 *
 * Polarität beachten: `payments_enabled` ist "an, außer explizit `false`"
 * (Standard aktiv), `tutor_enabled`/`course_generator_enabled` sind "aus,
 * außer explizit `true`" (Standard inaktiv) — exakt wie in den jeweiligen
 * Gate-Stellen geprüft. Das Formular (tenant-features-form.tsx) berechnet
 * `defaultChecked` mit derselben Polarität, sonst würde der erste Speichern-
 * Klick auf einer frischen Seite den tatsächlichen Zustand stillschweigend
 * umdrehen.
 */
export async function updateTenantFeatures(
  tenantId: string,
  _prevState: PlatformActionState,
  formData: FormData,
): Promise<PlatformActionState> {
  try {
    await requirePlatformAdmin();

    const admin = createAdminClient();
    const { data: current } = await admin.from("tenants").select("settings").eq("id", tenantId).maybeSingle();

    const mergedSettings = {
      ...(current?.settings ?? {}),
      payments_enabled: formData.get("paymentsEnabled") === "on",
      tutor_enabled: formData.get("tutorEnabled") === "on",
      course_generator_enabled: formData.get("courseGeneratorEnabled") === "on",
    };

    const { error } = await admin.from("tenants").update({ settings: mergedSettings }).eq("id", tenantId);
    if (error) {
      return { error: "Speichern fehlgeschlagen: " + translateDbError(error) };
    }

    revalidatePath(`/portal/mandanten/${tenantId}`);
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

/**
 * Login-Marken-Panel (22.07.2026, Josips Auftrag: "Hintergrund-Transparenz,
 * Überschrift/Beschreibung und Copyright anpassbar machen"). Gleiches
 * Merge-Patch-Muster wie `updateTenantBranding`/`updateTenantLogoUrl` —
 * eigene Funktion, weil diese Felder eine eigene Karte im Portal bekommen
 * (siehe tenant-login-content-form.tsx), unabhängig von Farbe/Radius/Logo.
 */
export async function updateTenantLoginContent(
  tenantId: string,
  _prevState: PlatformActionState,
  formData: FormData,
): Promise<PlatformActionState> {
  try {
    await requirePlatformAdmin();

    const parsed = tenantLoginContentSchema.safeParse({
      loginBgOpacity: formData.get("loginBgOpacity"),
      loginHeading: formData.get("loginHeading"),
      loginSubheading: formData.get("loginSubheading"),
      loginCopyright: formData.get("loginCopyright"),
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }

    const admin = createAdminClient();
    const { data: current } = await admin
      .from("tenants")
      .select("branding")
      .eq("id", tenantId)
      .maybeSingle();

    const mergedBranding = {
      ...(current?.branding ?? {}),
      login_bg_opacity: parsed.data.loginBgOpacity,
      login_heading: parsed.data.loginHeading ?? null,
      login_subheading: parsed.data.loginSubheading ?? null,
      login_copyright: parsed.data.loginCopyright ?? null,
    };

    const { error } = await admin.from("tenants").update({ branding: mergedBranding }).eq("id", tenantId);
    if (error) {
      return { error: "Speichern fehlgeschlagen: " + translateDbError(error) };
    }

    revalidatePath(`/portal/mandanten/${tenantId}`);
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

/**
 * Einfacher Lösch-Button pro Zeile (kein Formular mit Validierung nötig,
 * analog dem useTransition-Muster in components/admin/membership-row-
 * actions.tsx) — daher void statt PlatformActionState.
 */
export async function removeTenantDomain(tenantId: string, domainId: string): Promise<void> {
  await requirePlatformAdmin();
  const admin = createAdminClient();
  await admin.from("tenant_domains").delete().eq("id", domainId).eq("tenant_id", tenantId);
  revalidatePath(`/portal/mandanten/${tenantId}`);
}
