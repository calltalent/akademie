import "server-only";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CsvRow } from "@/lib/users/csv";
import { sendEmail } from "@/lib/email/client";
import { welcomeInvite } from "@/lib/email/templates";
import { resolveTenantEmailLocale, type Locale } from "@/i18n/config";
import { DEFAULT_BRANDING, type PublicTenant } from "@/lib/tenant/types";
import { dispatchWebhookEvent } from "@/lib/webhooks/dispatch";
import { tenantOrigin } from "@/lib/tenant/url";
import { translateAuthError } from "@/lib/auth/errors";
import { translateDbError } from "@/lib/errors/db";

export type ImportRowResult = {
  email: string;
  status: "created" | "linked" | "error";
  message?: string;
  /** Neu (Phase 2, Block 1): ob die Willkommensmail erfolgreich verschickt wurde. */
  emailSent: boolean;
  /**
   * Neu (Phase 3, Block 7, Bugfix Cowork-Verifikation 11.07.2026): die
   * `profiles.id`/`auth.users.id` des angelegten/verknüpften Nutzers.
   * Fehlte bisher komplett im Rückgabewert, obwohl `userId` innerhalb der
   * Funktion längst bekannt war — ohne dieses Feld hätte `POST
   * /api/v1/users` keine ID zurückliefern können, mit der ein externer
   * Integrator anschließend sinnvoll `POST /api/v1/enrollments` aufrufen
   * kann (Josips Testfund: Antwort enthielt nur `email`/`status`). Optional,
   * da bei `status: "error"` keine ID existiert. Bestehende Aufrufer
   * (CSV-Import-UI) ignorieren das neue Feld einfach, kein Verhalten
   * geändert.
   */
  userId?: string;
};

export type ImportSummary = {
  total: number;
  created: number;
  linked: number;
  errors: number;
  elapsedMs: number;
  results: ImportRowResult[];
};

/**
 * Nur die Felder, die importUsers() für die Willkommensmail braucht — kein
 * voller PublicTenant-Zwang an den Aufrufer. `settings` NEU (i18n Block
 * C5a): Mandanten-Standardsprache für die Willkommensmail.
 */
export type ImportTenant = Pick<PublicTenant, "id" | "name" | "slug" | "custom_domain" | "branding" | "settings">;

/**
 * Bulk-Import via service_role — UMGEHT RLS bewusst (siehe admin.ts).
 * Aufrufer MUSS vorher requireAdminTenant() geprüft haben (owner/admin only,
 * gemäß memberships_admin_write-Policy).
 *
 * DoD (SPEC.md): 100 Nutzer < 30 s → Zeilen werden in Batches parallel
 * verarbeitet statt seriell, um die Auth-API-Latenz zu amortisieren.
 *
 * WICHTIG (Bugfix 11.07.2026, gefunden bei Josips Test): `inviteUserByEmail`
 * verschickt pro Zeile eine echte E-Mail über Supabase Auth — das Standard-
 * SMTP von Supabase hat ein sehr niedriges eingebautes Rate-Limit
 * ("email rate limit exceeded"), das schon bei 2-3 Zeilen zuschlägt und die
 * 30-Sekunden/100-Nutzer-DoD unmöglich macht. Fix: Konto-Anlage von
 * E-Mail-Versand entkoppelt — `createUser()` legt den Auth-Nutzer OHNE Mail
 * an (kein Rate-Limit).
 *
 * NACHGEHOLT (Phase 2, Block 1): die eigentliche Willkommensmail wird jetzt
 * über Resend verschickt (src/lib/email/client.ts), aber bewusst NICHT im
 * kritischen Batch-Pfad, der die 30-Sekunden-DoD erfüllen muss. Erst NACHDEM
 * alle Konten angelegt sind, werden die Mails für alle neu angelegten
 * ("created") Zeilen gemeinsam über Promise.allSettled verschickt — parallel
 * statt seriell, und fail-soft (sendEmail() wirft nie), sodass ein
 * einzelner langsamer/fehlschlagender Mailversand weder den Import verzögert
 * (kein Warten pro Zeile) noch den Import zum Scheitern bringt. Für Zeilen
 * mit Status "linked" (Nutzer existierte bereits) wird bewusst KEINE
 * Willkommensmail verschickt — die Person hat vermutlich schon einen Zugang.
 */
export async function importUsers(
  tenant: ImportTenant,
  rows: CsvRow[],
): Promise<ImportSummary> {
  const started = Date.now();
  const admin = createAdminClient();
  const results: ImportRowResult[] = [];

  // Bugfix (02.08.2026, Josips Fund: Mandanten-Standardsprache Bosnisch
  // gesetzt, importierte Nutzer sahen trotzdem Deutsch) — `profiles.locale`
  // hat einen harten Spalten-Default `'de'` (0001_init.sql), an die
  // Mandanten-Standardsprache weitergereicht werden muss, siehe
  // importOneUser() unten.
  const locale = resolveTenantEmailLocale(tenant.settings.default_locale);

  const BATCH_SIZE = 10;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map((row) => importOneUserWithRetry(admin, tenant.id, row, locale)),
    );
    results.push(...batchResults);
  }

  // rows[i] <-> results[i]: Reihenfolge bleibt erhalten, da jeder Batch
  // seriell an `results` angehängt wird und Promise.all innerhalb eines
  // Batches die Eingabereihenfolge der Ausgabe beibehält.
  await Promise.allSettled(
    results.map((result, i) => {
      if (result.status !== "created") return Promise.resolve();
      return sendWelcomeMail(admin, tenant, result, rows[i]);
    }),
  );

  return {
    total: results.length,
    created: results.filter((r) => r.status === "created").length,
    linked: results.filter((r) => r.status === "linked").length,
    errors: results.filter((r) => r.status === "error").length,
    elapsedMs: Date.now() - started,
    results,
  };
}

/**
 * Mutiert `result.emailSent` in place — fail-soft, wirft nie (sendEmail()
 * garantiert das bereits).
 *
 * BUGFIX (Phase 5, Block 8, 12.07.2026 — Josips Fund): der "Anmelden"-Button
 * zeigte bisher auf die reine `/login`-URL. Das Konto wird aber bewusst OHNE
 * Passwort angelegt (siehe importOneUser() oben, `createUser()` ohne
 * `password`-Feld) — ein neu importierter Nutzer hatte also gar keine
 * Möglichkeit, sich anzumelden, außer den (im E-Mail-Text nur beiläufig
 * erwähnten) Magic-Link-Weg zu erraten. Fix: `generateLink({type:
 * "recovery"})` erzeugt denselben Link-Typ, den auch die neue "Passwort
 * vergessen"-Seite verschickt (siehe auth/actions.ts requestPasswordReset())
 * - führt beim Klick über /auth/callback direkt zu /passwort-setzen. WICHTIG:
 * das ist ein reiner API-Aufruf, der KEINE E-Mail verschickt (anders als
 * `inviteUserByEmail`, das am Anfang dieser Datei wegen Supabase's SMTP-
 * Rate-Limit bewusst verworfen wurde) - der Link wird stattdessen in UNSERE
 * eigene Resend-Mail eingebettet, das Rate-Limit-Problem bleibt also
 * vermieden, auch bei 100 Zeilen im selben Batch.
 */
async function sendWelcomeMail(
  admin: ReturnType<typeof createAdminClient>,
  tenant: ImportTenant,
  result: ImportRowResult,
  row: CsvRow,
): Promise<void> {
  const loginUrl = await buildSetPasswordLink(admin, tenant, result.email);
  const accentColor = tenant.branding?.color_primary ?? DEFAULT_BRANDING.color_primary;
  // Locale-Quelle laut Plan (Abschnitt 6, C5a): Mandanten-Standardsprache,
  // nicht die individuelle profiles.locale des Empfängers.
  const locale = resolveTenantEmailLocale(tenant.settings.default_locale);

  const html = await welcomeInvite({
    tenantName: tenant.name,
    recipientName: row.fullName,
    loginUrl,
    accentColor,
    locale,
  });
  const tSubject = await getTranslations({ locale, namespace: "email" });

  const sendResult = await sendEmail({
    to: result.email,
    subject: tSubject("welcomeInvite.subject", { tenantName: tenant.name }),
    html,
    tenant: { name: tenant.name },
  });

  result.emailSent = sendResult.success;
}

/**
 * Erzeugt einen funktionierenden Erstanmelde-Link (Passwort setzen) für
 * einen frisch angelegten, passwortlosen Nutzer. Fail-soft: schlägt
 * `generateLink()` fehl (z. B. transienter Auth-API-Fehler), fällt die
 * Funktion auf die reine Login-URL zurück, statt die gesamte Willkommensmail
 * scheitern zu lassen - dann landet der Nutzer eben auf /login und muss
 * dort selbst "Passwort vergessen" nutzen (funktioniert seit demselben
 * Block, s. o.), statt gar keine Mail zu bekommen.
 *
 * EXPORTIERT (Phase 5, Block 8, 12.07.2026): wird jetzt auch von
 * `platform/actions.ts` (Mandanten-Inhaber-Einladung beim Anlegen eines
 * neuen Mandanten) wiederverwendet — derselbe Bedarf (passwortloses Konto,
 * echter Erstanmelde-Link), kein Grund für eine zweite Implementierung.
 */
export async function buildSetPasswordLink(
  admin: ReturnType<typeof createAdminClient>,
  tenant: ImportTenant,
  email: string,
): Promise<string> {
  const fallback = `${tenantOrigin(tenant)}/login`;
  try {
    const { data, error } = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: `${tenantOrigin(tenant)}/auth/callback?next=/passwort-setzen` },
    });
    if (error || !data?.properties?.action_link) return fallback;
    return data.properties.action_link;
  } catch {
    return fallback;
  }
}

/**
 * Ein Retry bei transienten Fehlern (z. B. "fetch failed" unter paralleler
 * Last, beobachtet bei Josips 100-Zeilen-Test am 11.07.2026 — 1 von 100
 * Zeilen). Sicher wiederholbar, weil alle Schreibvorgänge in importOneUser
 * idempotent sind (createUser fällt bei bereits existierendem Nutzer auf
 * den "linked"-Pfad zurück, memberships/enrollments sind Upserts).
 */
async function importOneUserWithRetry(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  row: CsvRow,
  locale: Locale,
): Promise<ImportRowResult> {
  const first = await importOneUser(admin, tenantId, row, locale);
  if (first.status !== "error") return first;
  await new Promise((resolve) => setTimeout(resolve, 300));
  return importOneUser(admin, tenantId, row, locale);
}

/**
 * Phase 3, Block 7: jetzt EXPORTIERT — wird von `POST /api/v1/users`
 * wiederverwendet (kleine, dokumentierte Abweichung vom Plan-Wortlaut
 * "keine bestehende Logik ändern", technisch zwingend und risikoarm: nur
 * `export` ergänzt, kein Verhalten geändert, siehe PHASENSTATUS.md Block 7).
 *
 * `locale` optional (Bugfix 02.08.2026, siehe Kopfkommentar zu
 * importUsers()): der REST-API-Aufrufer (`POST /api/v1/users`) kennt nur
 * `tenantId`, nicht die volle `tenant.settings` — ein zusätzlicher DB-Zugriff
 * allein für dieses Feld auf einem API-Schreibpfad wäre unverhältnismäßig,
 * bleibt dort deshalb bewusst beim bisherigen Verhalten (Spalten-Default
 * `'de'`). Der CSV-Bulk-Import (`importUsers()` oben) hat den Mandanten
 * ohnehin schon geladen und reicht die Locale durch.
 */
export async function importOneUser(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  row: CsvRow,
  locale?: Locale,
): Promise<ImportRowResult> {
  try {
    let userId: string;
    let status: "created" | "linked" = "created";

    // Kein Mail-Versand hier (siehe Kommentar oben) — nur Konto-Anlage.
    // email_confirm: true, da wir den Login-/Aktivierungsweg über die eigene
    // Willkommens-Mail (Resend, s. o.) steuern, nicht über Supabase-Auth-Mails.
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: row.email,
      email_confirm: true,
      user_metadata: row.fullName ? { full_name: row.fullName } : undefined,
    });

    if (created?.user) {
      userId = created.user.id;
    } else if (createError) {
      // Nutzer existiert bereits im Auth-System -> per E-Mail nachschlagen
      // statt Fehler zu werfen (häufiger Fall bei Re-Imports/mehreren Mandanten).
      const existing = await findUserByEmail(admin, row.email);
      if (!existing) {
        return { email: row.email, status: "error", message: translateAuthError(createError), emailSent: false };
      }
      userId = existing.id;
      status = "linked";
    } else {
      return {
        email: row.email,
        status: "error",
        message: "Unbekannter Fehler bei Konto-Anlage.",
        emailSent: false,
      };
    }

    // profiles-Upsert (id = auth.users.id, kein RLS-Konflikt da service_role)
    // `email` ist NOT NULL im Schema — daher immer mitschreiben. `locale` nur
    // bei status === "created" mitschreiben (Bugfix 02.08.2026, s. o.): dieser
    // Upsert hat kein `ignoreDuplicates`, überschreibt bei "linked" (Nutzer
    // existiert bereits, ggf. in einem anderen Mandanten oder mit selbst
    // gewählter Sprache) also tatsächlich bestehende Spalten — ein
    // Re-Import/Verknüpfen darf eine schon gewählte Locale nicht zurücksetzen.
    await admin.from("profiles").upsert(
      {
        id: userId,
        email: row.email,
        full_name: row.fullName ?? null,
        ...(status === "created" && locale ? { locale } : {}),
      },
      { onConflict: "id" },
    );

    // Block 7 (Webhooks): vor dem Upsert prüfen, ob die Mitgliedschaft
    // bereits existierte — das user.created-Event soll NUR bei
    // tatsächlicher Neuanlage der Mandanten-Mitgliedschaft feuern, nicht
    // bei jedem Re-Import/Re-Invite eines bereits bestehenden Mitglieds.
    const { data: existingMembership } = await admin
      .from("memberships")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .maybeSingle();
    const isNewMembership = !existingMembership;

    // memberships-Upsert — unique(tenant_id, user_id). Kein invited_by-Feld
    // im Schema (siehe 0001_init.sql); wer eingeladen hat, steht im
    // Server-Log der Server Action, nicht in dieser Tabelle.
    const { error: membershipError } = await admin.from("memberships").upsert(
      {
        tenant_id: tenantId,
        user_id: userId,
        role: "member",
        status: "active",
      },
      { onConflict: "tenant_id,user_id", ignoreDuplicates: false },
    );
    if (membershipError) {
      return { email: row.email, status: "error", message: translateDbError(membershipError), emailSent: false };
    }

    if (isNewMembership) {
      dispatchWebhookEvent(tenantId, "user.created", {
        user_id: userId,
        email: row.email,
        full_name: row.fullName ?? null,
      }).catch(() => {});
    }

    if (row.courseSlug) {
      const { data: course } = await admin
        .from("courses")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("slug", row.courseSlug)
        .maybeSingle();

      if (course) {
        const { error: enrollError } = await admin.from("enrollments").upsert(
          { tenant_id: tenantId, course_id: course.id, user_id: userId, source: "import" },
          { onConflict: "course_id,user_id", ignoreDuplicates: true },
        );
        if (!enrollError) {
          dispatchWebhookEvent(tenantId, "enrollment.created", {
            user_id: userId,
            course_id: course.id,
            email: row.email,
            source: "import",
          }).catch(() => {});
        }
      }
    }

    // emailSent wird erst nach dem Batch von sendWelcomeMail() gesetzt
    // (nur für status === "created"); Default hier: false.
    return { email: row.email, status, emailSent: false, userId };
  } catch (e) {
    // e.message kann eine rohe/technische Meldung sein (unerwarteter Fehler
    // irgendwo im Import-Ablauf) — Detail nur loggen, Nutzer/CSV-Bericht
    // bekommt einen klaren deutschen Satz. KEINE E-Mail-Adresse im Server-Log
    // (Security-Fix 08.08.2026, Log-Hygiene-Audit NIEDRIG) — der admin-seitige
    // CSV-Bericht (Rückgabewert unten) trägt die E-Mail bereits, ein
    // zusätzlicher Klartext-Eintrag in den Server-Logs ist unnötige PII.
    console.error("[users/import] Unerwarteter Fehler beim Import einer Zeile.", e instanceof Error ? e.message : e);
    return {
      email: row.email,
      status: "error",
      message: "Unbekannter Fehler beim Import.",
      emailSent: false,
    };
  }
}

/** EXPORTIERT (Phase 5, Block 8, 12.07.2026) — Wiederverwendung in platform/actions.ts, s. o. */
export async function findUserByEmail(admin: ReturnType<typeof createAdminClient>, email: string) {
  // Supabase Admin API bietet keine direkte "get by email" Suche über alle
  // Seiten hinweg; bei üblichen Nutzerzahlen (<1000/Mandant) reicht eine
  // Einzelseiten-Abfrage mit hohem perPage-Wert für Phase 1.
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
}
