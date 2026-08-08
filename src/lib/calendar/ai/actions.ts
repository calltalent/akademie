"use server";

import { revalidatePath } from "next/cache";
import { requireShiftPlannerTenant } from "@/lib/calendar/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import { translateDbError } from "@/lib/errors/db";
import { genericErrorMessage } from "@/lib/errors/generic";
import { updateAiJob } from "@/lib/ai/usage";
import { berlinDateTimeToUtc, buildWeeklySeries, formatDayLabel } from "@/lib/calendar/date";
import {
  shiftPlanApplySchema,
  shiftPlanOutputSchema,
  shiftPlanRequestSchema,
  type ShiftPlanApplyInput,
  type ShiftPlanRequestInput,
} from "@/lib/calendar/ai/schema";

/**
 * Server Actions für die KI-Schichtplanung (Block S4, 08.08.2026). Gleiches
 * Grundmuster wie `src/lib/calendar/actions.ts`: `"use server"` -> Tenant-/
 * Rollen-Prüfung -> zod `safeParse` -> Schreiben mit `.eq("tenant_id", …)`
 * -> `translateDbError` -> `revalidatePath`.
 *
 * ADMIN-ONLY (bereits entschiedene Frage, siehe PHASENSTATUS.md/architect-
 * Plan): `requireShiftPlannerTenant()` lässt auch Projektleiter durch (S3-
 * Zugangsgate), JEDE Funktion hier prüft `isAdmin` deshalb zusätzlich
 * EXPLIZIT — Projektleiter kommen an die KI-Planung nicht heran, auch wenn
 * sie das Zugangsgate technisch passieren. Der Reiter "KI-Planung" ist
 * ohnehin nicht in `PLANNER_TAB_IDS` (schichtplanung-tabs.tsx), diese
 * serverseitige Prüfung ist die zweite, verbindliche Verteidigungslinie.
 */

const ADMIN_PATH = "/admin/schichtplanung";
const LEARN_PATH = "/schichtplan";
const NOT_ADMIN_MESSAGE = "Nur Inhaber und Administratoren dürfen die KI-Planung verwenden.";

type StartResult = { ok: true; jobId: string } | { ok: false; error: string };
type ApplyFailure = { rowId: string; label: string; error: string };
type ApplyResult =
  | { ok: true; created: number; skipped: number; failures: ApplyFailure[] }
  | { ok: false; error: string };
type DeleteResult = { ok: true } | { ok: false; error: string };

function embeddedOne<T>(value: T[] | T | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/**
 * Startet einen KI-Schichtplan-Lauf: legt einen `ai_jobs`-Eintrag
 * (`kind:"shift_plan"`, `status:"queued"`) an, den der Cron-Prozess-
 * Endpunkt (`/api/admin/ki/process`, `processNextShiftPlanJob()`) beim
 * nächsten Tick aufgreift. KEIN synchroner Claude-Aufruf hier (Workers-
 * Laufzeit-Risiko, siehe Architekturentscheidung im S4-Bauauftrag).
 */
export async function startShiftPlanJob(input: ShiftPlanRequestInput): Promise<StartResult> {
  try {
    const { tenant, user, supabase, isAdmin } = await requireShiftPlannerTenant();
    if (!isAdmin) return { ok: false, error: NOT_ADMIN_MESSAGE };

    if (
      !(await checkRateLimit("ki-shift-plan", {
        maxRequests: 5,
        windowSeconds: 3600,
        extraKey: tenant.id,
      }))
    ) {
      return { ok: false, error: RATE_LIMIT_MESSAGE };
    }

    const parsed = shiftPlanRequestSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }
    const data = parsed.data;

    const { data: project } = await supabase
      .from("calendar_projects")
      .select("id, status")
      .eq("id", data.projectId)
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    if (!project) return { ok: false, error: "Projekt nicht gefunden." };
    if (project.status !== "active") return { ok: false, error: "Dieses Projekt ist nicht mehr aktiv." };

    // Arbeiter-Menge SERVERSEITIG schneiden — der Client bestimmt NIE allein,
    // wer geplant wird (S3-Lehre: projektbezogen prüfen, nicht die
    // Client-Liste blind übernehmen).
    const { data: memberRows } = await supabase
      .from("calendar_project_members")
      .select("worker_id")
      .eq("tenant_id", tenant.id)
      .eq("project_id", data.projectId)
      .in("worker_id", data.workerIds);
    const memberWorkerIds = (memberRows ?? []).map((r) => r.worker_id as string);

    let scopedWorkerIds: string[] = [];
    if (memberWorkerIds.length > 0) {
      const { data: activeWorkers } = await supabase
        .from("calendar_workers")
        .select("id")
        .eq("tenant_id", tenant.id)
        .eq("status", "active")
        .in("id", memberWorkerIds);
      scopedWorkerIds = (activeWorkers ?? []).map((w) => w.id as string);
    }
    if (scopedWorkerIds.length === 0) {
      return { ok: false, error: "Keiner der gewählten Arbeiter ist aktives Mitglied dieses Projekts." };
    }

    const scopedInput = shiftPlanRequestSchema.parse({ ...data, workerIds: scopedWorkerIds });

    const { data: job, error } = await supabase
      .from("ai_jobs")
      .insert({
        tenant_id: tenant.id,
        kind: "shift_plan",
        status: "queued",
        input: scopedInput,
        output: {},
        tokens_in: 0,
        tokens_out: 0,
        created_by: user.id,
      })
      .select("id")
      .single();
    if (error || !job) return { ok: false, error: error ? translateDbError(error) : "Auftrag konnte nicht angelegt werden." };

    revalidatePath(ADMIN_PATH);
    return { ok: true, jobId: job.id };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

/**
 * Übernahme ausgewählter Entwurfszeilen als echte `calendar_shifts`.
 * KERNANFORDERUNG (S4-Bauauftrag): jede Zeile EINZELN einfügen und Fehler
 * je Zeile sammeln, statt die ganze Übernahme an einer einzigen
 * Überlappung scheitern zu lassen — KEIN `try` um die ganze Schleife, KEIN
 * früher `return`.
 */
export async function applyShiftPlan(jobId: string, rows: ShiftPlanApplyInput): Promise<ApplyResult> {
  try {
    const { tenant, user, supabase, isAdmin } = await requireShiftPlannerTenant();
    if (!isAdmin) return { ok: false, error: NOT_ADMIN_MESSAGE };

    const parsedRows = shiftPlanApplySchema.safeParse(rows);
    if (!parsedRows.success) {
      return { ok: false, error: parsedRows.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }

    const { data: job } = await supabase
      .from("ai_jobs")
      .select("id, status, input, output")
      .eq("id", jobId)
      .eq("tenant_id", tenant.id)
      .eq("kind", "shift_plan")
      .maybeSingle();
    if (!job) return { ok: false, error: "Auftrag nicht gefunden." };
    if (job.status !== "done") return { ok: false, error: "Dieser Auftrag ist noch nicht abgeschlossen." };

    const parsedOutput = shiftPlanOutputSchema.safeParse(job.output ?? {});
    const parsedInput = shiftPlanRequestSchema.safeParse(job.input);
    if (!parsedOutput.success || !parsedOutput.data.draft || !parsedInput.success) {
      return { ok: false, error: "Der gespeicherte Entwurf ist beschädigt." };
    }
    const output = parsedOutput.data;
    const draft = output.draft!;
    const input = parsedInput.data;

    const draftRowsById = new Map(draft.rows.map((r) => [r.id, r]));
    const alreadyApplied = new Set(output.appliedRowIds);

    type ResolvedRow = {
      id: string;
      workerId: string;
      date: string;
      startTime: string;
      endTime: string;
      breakMinutes: number;
      note?: string;
    };
    const toInsert: ResolvedRow[] = [];
    let skipped = 0;

    for (const clientRow of parsedRows.data) {
      // workerId kommt NIE vom Client — Auflösung ausschließlich über die
      // gespeicherte Entwurfszeile (siehe schema.ts-Dateikopf).
      const draftRow = draftRowsById.get(clientRow.id);
      if (!draftRow) continue; // Kein Treffer -> verwerfen.
      if (alreadyApplied.has(clientRow.id)) {
        skipped++; // Doppelklick-Schutz.
        continue;
      }
      toInsert.push({
        id: clientRow.id,
        workerId: draftRow.workerId,
        date: clientRow.date,
        startTime: clientRow.startTime,
        endTime: clientRow.endTime,
        breakMinutes: clientRow.breakMinutes,
        note: draftRow.note,
      });
    }

    if (toInsert.length === 0) {
      return { ok: true, created: 0, skipped, failures: [] };
    }

    // Anzeigenamen NUR für den Ergebnisbericht dieser (bereits als Admin
    // bestätigten) Aktion geladen — kein Datenminimierungs-Konflikt wie beim
    // Prompt-Kontext (dort geht es um KI-Sichtbarkeit, hier um die
    // Admin-eigene Übernahme-Quittung).
    const uniqueWorkerIds = Array.from(new Set(toInsert.map((r) => r.workerId)));
    const { data: workerProfileRows } = await supabase
      .from("calendar_workers")
      .select("id, profiles(full_name, email)")
      .eq("tenant_id", tenant.id)
      .in("id", uniqueWorkerIds);
    const workerLabelById = new Map<string, string>();
    for (const w of workerProfileRows ?? []) {
      const profile = embeddedOne(
        w.profiles as { full_name: string | null; email: string } | { full_name: string | null; email: string }[] | null,
      );
      workerLabelById.set(w.id as string, profile ? profile.full_name || profile.email : "—");
    }

    // Erneute Gültigkeitsprüfung gegen den AKTUELLEN Stand (zwischen
    // Generierung und Übernahme können Stunden liegen), NICHT gegen den
    // Entwurfszeitpunkt.
    const { data: projectRow } = await supabase
      .from("calendar_projects")
      .select("status")
      .eq("tenant_id", tenant.id)
      .eq("id", input.projectId)
      .maybeSingle();
    const projectStillActive = projectRow?.status === "active";

    const { data: memberRows } = await supabase
      .from("calendar_project_members")
      .select("worker_id")
      .eq("tenant_id", tenant.id)
      .eq("project_id", input.projectId)
      .in("worker_id", uniqueWorkerIds);
    const memberWorkerIdSet = new Set((memberRows ?? []).map((m) => m.worker_id as string));

    const { data: activeWorkerRows } = await supabase
      .from("calendar_workers")
      .select("id")
      .eq("tenant_id", tenant.id)
      .eq("status", "active")
      .in("id", uniqueWorkerIds);
    const activeWorkerIdSet = new Set((activeWorkerRows ?? []).map((w) => w.id as string));

    const failures: ApplyFailure[] = [];
    const createdRowIds: string[] = [];
    let created = 0;

    // EINE ZEILE = EIN .insert(), KEIN try um die ganze Schleife, KEIN
    // früher return (Kernanforderung).
    for (const row of toInsert) {
      const dayLabel = formatDayLabel(berlinDateTimeToUtc(row.date, "00:00"));
      const label = `${workerLabelById.get(row.workerId) ?? "—"}, ${dayLabel}, ${row.startTime}–${row.endTime} Uhr`;

      if (!projectStillActive) {
        failures.push({ rowId: row.id, label, error: "Das Projekt ist nicht mehr aktiv." });
        continue;
      }
      if (!memberWorkerIdSet.has(row.workerId) || !activeWorkerIdSet.has(row.workerId)) {
        failures.push({ rowId: row.id, label, error: "Dieser Arbeiter ist nicht mehr aktives Mitglied des Projekts." });
        continue;
      }

      const [{ startsAt, endsAt }] = buildWeeklySeries(row.date, row.startTime, row.endTime, 1);
      const { error } = await supabase.from("calendar_shifts").insert({
        tenant_id: tenant.id,
        worker_id: row.workerId,
        project_id: input.projectId,
        slot_id: null,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        break_minutes: row.breakMinutes,
        status: "planned",
        source: "ai",
        note: row.note ?? null,
        created_by: user.id,
      });
      if (error) {
        failures.push({ rowId: row.id, label, error: translateDbError(error) });
        continue;
      }
      createdRowIds.push(row.id);
      created++;
    }

    if (createdRowIds.length > 0) {
      const newOutput = shiftPlanOutputSchema.parse({
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

/** Löscht einen KI-Schichtplan-Auftrag (Entwurf + Audit-Spur), NICHT bereits daraus übernommene calendar_shifts (die sind ab ihrer Anlage eigenständige Zeilen, gleiches Prinzip wie deleteDraft() im Kurs-Generator). */
export async function deleteShiftPlanJob(jobId: string): Promise<DeleteResult> {
  try {
    const { tenant, supabase, isAdmin } = await requireShiftPlannerTenant();
    if (!isAdmin) return { ok: false, error: NOT_ADMIN_MESSAGE };

    const { data: job } = await supabase
      .from("ai_jobs")
      .select("id")
      .eq("id", jobId)
      .eq("tenant_id", tenant.id)
      .eq("kind", "shift_plan")
      .maybeSingle();
    if (!job) return { ok: false, error: "Auftrag nicht gefunden." };

    // ABWEICHUNG (technisch nötig, siehe PHASENSTATUS.md): ai_jobs hat laut
    // 0001_init.sql KEINE DELETE-Policy für irgendeine Rolle — ein Löschen
    // über den regulären Tenant-Client liefe wegen RLS still ins Leere (0
    // betroffene Zeilen, kein Fehler zurückgegeben). Admin-Client wie
    // updateAiJob() (usage.ts), `jobId` ist oben bereits tenant-geprüft.
    const admin = createAdminClient();
    const { error } = await admin
      .from("ai_jobs")
      .delete()
      .eq("id", jobId)
      .eq("tenant_id", tenant.id)
      .eq("kind", "shift_plan");
    if (error) return { ok: false, error: translateDbError(error) };

    revalidatePath(ADMIN_PATH);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}
