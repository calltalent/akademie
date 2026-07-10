import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CsvRow } from "@/lib/users/csv";

export type ImportRowResult = {
  email: string;
  status: "created" | "linked" | "error";
  message?: string;
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
 * an (kein Rate-Limit). Die eigentliche Einladungs-Mail folgt in Phase 2
 * über Resend (siehe CLAUDE.md Stack), sobald Resend-Keys hinterlegt sind.
 */
export async function importUsers(
  tenantId: string,
  rows: CsvRow[],
): Promise<ImportSummary> {
  const started = Date.now();
  const admin = createAdminClient();
  const results: ImportRowResult[] = [];

  const BATCH_SIZE = 10;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map((row) => importOneUserWithRetry(admin, tenantId, row)),
    );
    results.push(...batchResults);
  }

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
): Promise<ImportRowResult> {
  const first = await importOneUser(admin, tenantId, row);
  if (first.status !== "error") return first;
  await new Promise((resolve) => setTimeout(resolve, 300));
  return importOneUser(admin, tenantId, row);
}

async function importOneUser(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  row: CsvRow,
): Promise<ImportRowResult> {
  try {
    let userId: string;
    let status: "created" | "linked" = "created";

    // Kein Mail-Versand hier (siehe Kommentar oben) — nur Konto-Anlage.
    // email_confirm: true, da wir den Login-/Aktivierungsweg noch nicht
    // über eine eigene Einladungs-Mail steuern (kommt mit Resend, Phase 2).
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
        return { email: row.email, status: "error", message: createError.message };
      }
      userId = existing.id;
      status = "linked";
    } else {
      return { email: row.email, status: "error", message: "Unbekannter Fehler bei Konto-Anlage." };
    }

    // profiles-Upsert (id = auth.users.id, kein RLS-Konflikt da service_role)
    // `email` ist NOT NULL im Schema — daher immer mitschreiben.
    await admin.from("profiles").upsert(
      {
        id: userId,
        email: row.email,
        full_name: row.fullName ?? null,
      },
      { onConflict: "id" },
    );

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
      return { email: row.email, status: "error", message: membershipError.message };
    }

    if (row.courseSlug) {
      const { data: course } = await admin
        .from("courses")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("slug", row.courseSlug)
        .maybeSingle();

      if (course) {
        await admin.from("enrollments").upsert(
          { tenant_id: tenantId, course_id: course.id, user_id: userId, source: "import" },
          { onConflict: "course_id,user_id", ignoreDuplicates: true },
        );
      }
    }

    return { email: row.email, status };
  } catch (e) {
    return {
      email: row.email,
      status: "error",
      message: e instanceof Error ? e.message : "Unbekannter Fehler.",
    };
  }
}

async function findUserByEmail(admin: ReturnType<typeof createAdminClient>, email: string) {
  // Supabase Admin API bietet keine direkte "get by email" Suche über alle
  // Seiten hinweg; bei üblichen Nutzerzahlen (<1000/Mandant) reicht eine
  // Einzelseiten-Abfrage mit hohem perPage-Wert für Phase 1.
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
}
