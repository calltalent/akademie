"use server";

import { revalidatePath } from "next/cache";
import { requireShiftPlannerTenant } from "@/lib/calendar/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import { translateDbError } from "@/lib/errors/db";
import { genericErrorMessage } from "@/lib/errors/generic";
import { updateAiJob } from "@/lib/ai/usage";
import { parseTenantHolidayRegions, type CalendarHolidayRegionCode } from "@/lib/calendar/schema";
import { REGION_LABELS } from "@/lib/calendar/ai/holidays/prompt";
import {
  holidayApplySchema,
  holidayResearchOutputSchema,
  holidayResearchRequestSchema,
  type HolidayApplyInput,
} from "@/lib/calendar/ai/holidays/schema";

/**
 * Server Actions für die KI-Feiertagsrecherche (Block S5b, 08.08.2026).
 * Gleiches Grundmuster wie `src/lib/calendar/ai/actions.ts` (S4-Vorbild):
 * `"use server"` -> Tenant-/Rollen-Prüfung -> zod `safeParse` -> Schreiben
 * mit `.eq("tenant_id", …)` -> `translateDbError` -> `revalidatePath`.
 *
 * ADMIN-ONLY (bereits entschiedene Frage, architect-Plan Abschnitt 5.1):
 * `requireShiftPlannerTenant()` lässt auch Projektleiter durch (S3-
 * Zugangsgate), JEDE Funktion hier prüft `isAdmin` deshalb zusätzlich
 * EXPLIZIT — Projektleiter kommen an die KI-Feiertagsrecherche nicht heran.
 * Die serverseitige RLS-Verengung (`ai_jobs_staff_select`/`_insert` auf
 * `calendar_is_admin(tenant_id)`, Migration `20260808120000_
 * calendar_holiday_research.sql`) ist die zweite, verbindliche
 * Verteidigungslinie gegen einen direkten Supabase-Client-Zugriff eines
 * `trainer`-Kontos.
 */

const ADMIN_PATH = "/admin/schichtplanung";
const LEARN_PATH = "/schichtplan";
const NOT_ADMIN_MESSAGE = "Nur Inhaber und Administratoren dürfen die KI-Feiertagsrecherche verwenden.";

type StartResult = { ok: true; jobId: string } | { ok: false; error: string };
type ApplyFailure = { rowId: string; label: string; error: string };
type ApplyResult =
  | { ok: true; created: number; skipped: number; failures: ApplyFailure[] }
  | { ok: false; error: string };
type DeleteResult = { ok: true } | { ok: false; error: string };

/**
 * Startet einen KI-Feiertagsrecherche-Lauf: legt einen `ai_jobs`-Eintrag
 * (`kind:"holiday_research"`, `status:"queued"`) an, den der Cron-Prozess-
 * Endpunkt (`/api/admin/ki/process`, `processNextHolidayResearchJob()`)
 * beim nächsten Tick aufgreift. KEIN synchroner Claude-Aufruf hier
 * (Workers-Laufzeit-Risiko, gleiche Architekturentscheidung wie bei der
 * KI-Schichtplanung).
 *
 * Nimmt vom Client NUR `year` entgegen — die Regionen werden SERVERSEITIG
 * aus `tenant.settings.shift_calendar_holiday_regions` gelesen, NIE vom
 * Client übernommen (architect-Plan Abschnitt 5.1, Punkt 4).
 */
export async function startHolidayResearchJob(input: { year: number }): Promise<StartResult> {
  try {
    const { tenant, user, supabase, isAdmin } = await requireShiftPlannerTenant();
    if (!isAdmin) return { ok: false, error: NOT_ADMIN_MESSAGE };

    if (
      !(await checkRateLimit("ki-holidays", {
        maxRequests: 3,
        windowSeconds: 86400,
        extraKey: tenant.id,
      }))
    ) {
      return { ok: false, error: RATE_LIMIT_MESSAGE };
    }

    // zod-Validierung NUR für `year` — `regions` ist kein Client-Feld
    // (siehe Dateikopf-Kommentar). `.pick()` wiederverwendet exakt denselben
    // Jahres-Validator wie holidayResearchRequestSchema, statt ihn zu
    // duplizieren.
    const parsedYear = holidayResearchRequestSchema.pick({ year: true }).safeParse(input);
    if (!parsedYear.success) {
      return { ok: false, error: parsedYear.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }

    const regions = parseTenantHolidayRegions(tenant.settings.shift_calendar_holiday_regions ?? []);
    if (regions.length === 0) {
      return { ok: false, error: "Für diese Akademie ist noch keine Region ausgewählt." };
    }

    const scopedInput = holidayResearchRequestSchema.parse({ year: parsedYear.data.year, regions });

    const { data: job, error } = await supabase
      .from("ai_jobs")
      .insert({
        tenant_id: tenant.id,
        kind: "holiday_research",
        status: "queued",
        input: scopedInput,
        output: {},
        tokens_in: 0,
        tokens_out: 0,
        created_by: user.id,
      })
      .select("id")
      .single();
    if (error || !job) {
      return { ok: false, error: error ? translateDbError(error) : "Auftrag konnte nicht angelegt werden." };
    }

    revalidatePath(ADMIN_PATH);
    return { ok: true, jobId: job.id };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

/**
 * Übernahme ausgewählter Entwurfszeilen als echte `calendar_absences`
 * (`kind:'holiday'`). KERNANFORDERUNG (wie beim S4-Vorbild): jede Zeile
 * EINZELN einfügen und Fehler je Zeile sammeln, statt die ganze Übernahme
 * an einer einzigen fehlgeschlagenen Zeile scheitern zu lassen — KEIN
 * `try` um die ganze Schleife, KEIN früher `return`.
 */
export async function applyHolidayResearch(jobId: string, rows: HolidayApplyInput): Promise<ApplyResult> {
  try {
    const { tenant, user, supabase, isAdmin } = await requireShiftPlannerTenant();
    if (!isAdmin) return { ok: false, error: NOT_ADMIN_MESSAGE };

    const parsedRows = holidayApplySchema.safeParse(rows);
    if (!parsedRows.success) {
      return { ok: false, error: parsedRows.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }

    const { data: job } = await supabase
      .from("ai_jobs")
      .select("id, status, output")
      .eq("id", jobId)
      .eq("tenant_id", tenant.id)
      .eq("kind", "holiday_research")
      .maybeSingle();
    if (!job) return { ok: false, error: "Auftrag nicht gefunden." };
    if (job.status !== "done") return { ok: false, error: "Dieser Auftrag ist noch nicht abgeschlossen." };

    const parsedOutput = holidayResearchOutputSchema.safeParse(job.output ?? {});
    if (!parsedOutput.success || !parsedOutput.data.draft) {
      return { ok: false, error: "Der gespeicherte Entwurf ist beschädigt." };
    }
    const output = parsedOutput.data;
    const draft = output.draft!;

    const draftRowsById = new Map(draft.rows.map((r) => [r.id, r]));
    const alreadyApplied = new Set(output.appliedRowIds);

    type ResolvedRow = { id: string; region: CalendarHolidayRegionCode; date: string; name: string };
    const toInsert: ResolvedRow[] = [];
    let skipped = 0;

    for (const clientRow of parsedRows.data) {
      // region kommt NIE vom Client — Auflösung ausschließlich über die
      // gespeicherte Entwurfszeile (siehe schema.ts-Dateikopf).
      const draftRow = draftRowsById.get(clientRow.id);
      if (!draftRow) continue; // Kein Treffer -> verwerfen.
      if (alreadyApplied.has(clientRow.id)) {
        skipped++; // Doppelklick-Schutz.
        continue;
      }
      toInsert.push({
        id: clientRow.id,
        region: draftRow.region,
        date: clientRow.date,
        name: clientRow.name,
      });
    }

    if (toInsert.length === 0) {
      return { ok: true, created: 0, skipped, failures: [] };
    }

    const failures: ApplyFailure[] = [];
    const createdRowIds: string[] = [];
    let created = 0;
    const nowIso = new Date().toISOString();

    // EINE ZEILE = EIN .insert(), KEIN try um die ganze Schleife, KEIN
    // früher return (Kernanforderung).
    for (const row of toInsert) {
      const regionLabel = REGION_LABELS[row.region];
      const label = `${row.name} (${regionLabel}), ${row.date}`;

      const { error } = await supabase.from("calendar_absences").insert({
        tenant_id: tenant.id,
        worker_id: null,
        kind: "holiday",
        starts_on: row.date,
        ends_on: row.date,
        note: `${row.name} (${regionLabel})`,
        status: "approved",
        created_by: user.id,
        decided_by: user.id,
        decided_at: nowIso,
      });
      if (error) {
        failures.push({ rowId: row.id, label, error: translateDbError(error) });
        continue;
      }
      createdRowIds.push(row.id);
      created++;
    }

    if (createdRowIds.length > 0) {
      const newOutput = holidayResearchOutputSchema.parse({
        draft,
        appliedRowIds: Array.from(new Set([...output.appliedRowIds, ...createdRowIds])),
        appliedAt: new Date().toISOString(),
      });
      // ai_jobs hat KEINE UPDATE-Policy für irgendeine Rolle (siehe
      // src/lib/ai/usage.ts-Dateikopf) — updateAiJob() läuft bewusst über
      // den Admin-Client, `jobId` ist bereits oben tenant-geprüft.
      await updateAiJob(jobId, { output: newOutput });
    }

    revalidatePath(ADMIN_PATH);
    revalidatePath(LEARN_PATH);

    return { ok: true, created, skipped, failures };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

/** Löscht einen KI-Feiertagsrecherche-Auftrag (Entwurf + Audit-Spur), NICHT bereits daraus übernommene calendar_absences (die sind ab ihrer Anlage eigenständige Zeilen, gleiches Prinzip wie deleteShiftPlanJob()). */
export async function deleteHolidayResearchJob(jobId: string): Promise<DeleteResult> {
  try {
    const { tenant, supabase, isAdmin } = await requireShiftPlannerTenant();
    if (!isAdmin) return { ok: false, error: NOT_ADMIN_MESSAGE };

    const { data: job } = await supabase
      .from("ai_jobs")
      .select("id")
      .eq("id", jobId)
      .eq("tenant_id", tenant.id)
      .eq("kind", "holiday_research")
      .maybeSingle();
    if (!job) return { ok: false, error: "Auftrag nicht gefunden." };

    // ai_jobs hat laut 0001_init.sql KEINE DELETE-Policy für irgendeine
    // Rolle — Admin-Client wie updateAiJob() (usage.ts), `jobId` ist oben
    // bereits tenant-geprüft (gleiches Vorgehen wie deleteShiftPlanJob()).
    const admin = createAdminClient();
    const { error } = await admin
      .from("ai_jobs")
      .delete()
      .eq("id", jobId)
      .eq("tenant_id", tenant.id)
      .eq("kind", "holiday_research");
    if (error) return { ok: false, error: translateDbError(error) };

    revalidatePath(ADMIN_PATH);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}
