import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { AI_MODELS, PLAN_AI_LIMITS } from "@/lib/ai/config";
import { computeCost, remainingQuota } from "@/lib/ai/quota";

type QuotaKind = "tutor" | "course_gen";

const KIND_TO_COLUMN: Record<QuotaKind, "tutor_answers" | "course_gens"> = {
  tutor: "tutor_answers",
  course_gen: "course_gens",
};

const KIND_TO_LIMIT_KEY: Record<QuotaKind, "tutorAnswers" | "courseGens"> = {
  tutor: "tutorAnswers",
  course_gen: "courseGens",
};

/** Erster des laufenden Monats als ISO-Datum (yyyy-mm-dd) — Format der `usage_counters.month`-Spalte. */
function currentMonthIso(): string {
  const d = new Date();
  d.setUTCDate(1);
  return d.toISOString().slice(0, 10);
}

/**
 * VERTRAG für JEDEN künftigen KI-Aufrufpfad (Blöcke 2-7, CLAUDE.md §3.7:
 * "KI-Verbrauch: jeder Claude-Aufruf schreibt ai_jobs/tutor_messages mit
 * Tokens und Kosten; Monats-Kontingente über usage_counters durchsetzen.").
 *
 * `enforceQuota()` MUSS aufgerufen werden, BEVOR der eigentliche Claude-/
 * Voyage-Aufruf startet — nicht danach, nicht "parallel", nicht optional.
 * `increment_usage` (Migration `20260711140000_ai_quota.sql`) erhöht den
 * Zähler NUR wenn noch Kontingent frei ist — das ist die einzige Stelle,
 * an der das Limit tatsächlich hart durchgesetzt wird. Ein KI-Aufruf ohne
 * vorheriges `enforceQuota()` umgeht das Kontingent vollständig.
 *
 * Verbindliches Muster für künftige Blöcke (Block 4/Tutor, Block 5/Kurs-
 * Generator):
 *   const quota = await enforceQuota(tenantId, "tutor");
 *   if (!quota.allowed) {
 *     // Nutzer freundlich informieren ("Kontingent aufgebraucht"), KEIN
 *     // createAnthropicClient()-Aufruf.
 *     return ...;
 *   }
 *   // Erst JETZT den eigentlichen Claude-/Voyage-Aufruf starten.
 *
 * Warum über den Admin-Client: `usage_counters` hat laut 0001_init.sql nur
 * `usage_staff_select` (Lesen) — keine INSERT/UPDATE-Policy für irgendeine
 * Rolle, normale Nutzer (auch Staff) dürfen NIE direkt schreiben. Die RPC
 * `increment_usage` ist `security definer` mit Grants nur für `service_role`
 * — über den regulären RLS-Client ist sie gar nicht aufrufbar.
 *
 * Fail-CLOSED bei technischem RPC-Fehler (bewusst das Gegenteil von
 * `src/lib/security/rate-limit.ts`, das fail-open ist): ein Ausfall des
 * Rate-Limiters darf legitime Nutzer nicht aussperren, aber ein Ausfall der
 * Kontingent-Prüfung darf keine unbegrenzten, kostenpflichtigen KI-Aufrufe
 * durchlassen — die Risiken sind hier gegensätzlich.
 */
export async function enforceQuota(
  tenantId: string,
  kind: QuotaKind,
): Promise<{ allowed: boolean; remaining: number }> {
  const admin = createAdminClient();

  const { data: tenantRow, error: tenantError } = await admin
    .from("tenants")
    .select("plan")
    .eq("id", tenantId)
    .maybeSingle();

  if (tenantError || !tenantRow) {
    console.error(
      "[ai/usage] enforceQuota: Mandant nicht gefunden",
      tenantId,
      tenantError?.message,
    );
    return { allowed: false, remaining: 0 };
  }

  const plan = tenantRow.plan as keyof typeof PLAN_AI_LIMITS;
  // Fail-safe: unbekannter/neuer Plan-Wert -> striktestes Kontingent (trial)
  // statt Absturz oder unbegrenztem Zugriff.
  const limits = PLAN_AI_LIMITS[plan] ?? PLAN_AI_LIMITS.trial;
  const limit = limits[KIND_TO_LIMIT_KEY[kind]];

  const { data: allowed, error: rpcError } = await admin.rpc("increment_usage", {
    p_tenant: tenantId,
    p_kind: kind,
    p_limit: limit,
  });

  if (rpcError) {
    console.error("[ai/usage] increment_usage-RPC fehlgeschlagen:", rpcError.message);
    return { allowed: false, remaining: 0 };
  }

  // Aktuellen Stand nachladen für eine korrekte "remaining"-Angabe (auch im
  // Sperrfall, damit die UI z. B. "20 von 20" statt nur "gesperrt" zeigen
  // kann). Zweite, unkritische Lese-Anfrage — die Durchsetzung selbst ist
  // bereits mit der RPC oben abgeschlossen.
  const column = KIND_TO_COLUMN[kind];
  const { data: usageRow } = await admin
    .from("usage_counters")
    .select(column)
    .eq("tenant_id", tenantId)
    .eq("month", currentMonthIso())
    .maybeSingle();

  const used = (usageRow as unknown as Record<string, number> | null)?.[column] ?? 0;
  return { allowed: allowed === true, remaining: remainingQuota(used, limit) };
}

/**
 * Schreibt einen `ai_jobs`-Eintrag (Tokens, Kosten, Status) — Protokollpflicht
 * aus CLAUDE.md §3.7. MUSS NACH einem abgeschlossenen (erfolgreichen oder
 * fehlgeschlagenen) KI-Aufruf laufen, NACHDEM `enforceQuota()` bereits das
 * Kontingent geprüft/erhöht hat (siehe Vertrag oben).
 *
 * Admin-Client nötig: `ai_jobs` hat laut 0001_init.sql nur
 * `ai_jobs_staff_select`/`ai_jobs_staff_insert` (Staff darf lesen/anlegen).
 * Für asynchrone Jobs (Block 5, Kurs-Generator: queued -> running -> done)
 * fehlt jedoch jede UPDATE-Policy — ein Status-Übergang nach der Anlage kann
 * über den regulären RLS-Client also nie geschrieben werden. Diese Funktion
 * läuft deshalb durchgehend über den Admin-Client (Insert UND Update),
 * analog `certificates/issue.ts`.
 */
export async function recordAiJob(params: {
  tenantId: string;
  // "translation" (Stufe 3, Untertitel DE+EN, Plan `calm-watching-dewdrop.md`):
  // ensureEnglishCaption() (src/lib/video/translate-captions.ts) protokolliert
  // damit die claude-haiku-Kosten der VTT-Übersetzung. Erfordert die
  // CHECK-Constraint-Erweiterung in supabase/migrations/
  // 20260717120000_ai_jobs_kind_translation.sql (0001_init.sql bleibt
  // unverändert, CLAUDE.md §3) — OHNE angewendete Migration schlägt der
  // INSERT an der DB-Constraint fehl und recordAiJob() loggt das fail-soft
  // (siehe unten), statt zu werfen.
  // "shift_plan" (Block S4, 08.08.2026, KI-Schichtplanung): erlaubt seit der
  // S1-Migration (`ai_jobs_kind_check`, supabase/migrations/
  // 20260807142619_shift_calendar.sql) — kein neuer Migrationsbedarf hier.
  // `startShiftPlanJob()` (src/lib/calendar/ai/actions.ts) legt den Job
  // aktuell direkt per Insert an (nicht über `recordAiJob()`, analog
  // `api/admin/ki/generate/route.ts` beim Kurs-Generator) — die Erweiterung
  // hier hält den Typ trotzdem vollständig, falls ein künftiger Aufrufer
  // `recordAiJob()` direkt nutzt.
  // "holiday_research" (Block S5b, 08.08.2026, KI-Feiertagsrecherche):
  // erlaubt seit Migration `20260808120000_calendar_holiday_research.sql`
  // (`ai_jobs_kind_check` erweitert, `ai_jobs_staff_select`/`_insert`
  // zusätzlich auf `calendar_is_admin(tenant_id)` verengt). Gleiche Lage wie
  // "shift_plan": `startHolidayResearchJob()` (src/lib/calendar/ai/
  // holidays/actions.ts) legt den Job direkt per Insert an, nicht über
  // `recordAiJob()` — Erweiterung hier hält den Typ vollständig.
  kind:
    | "course_gen"
    | "quiz_gen"
    | "transcript"
    | "summary"
    | "embed"
    | "translation"
    | "shift_plan"
    | "holiday_research";
  model: string;
  tokensIn: number;
  tokensOut: number;
  status: "queued" | "running" | "done" | "error";
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  createdBy?: string;
}): Promise<void> {
  const admin = createAdminClient();
  const cost = computeCost(params.model, params.tokensIn, params.tokensOut);

  const { error } = await admin.from("ai_jobs").insert({
    tenant_id: params.tenantId,
    kind: params.kind,
    status: params.status,
    input: params.input ?? {},
    output: params.output ?? null,
    model: params.model,
    tokens_in: params.tokensIn,
    tokens_out: params.tokensOut,
    cost_usd: cost,
    error: params.error ?? null,
    created_by: params.createdBy ?? null,
  });

  if (error) {
    // Fail-soft wie der Mailversand in certificates/issue.ts: ein
    // Protokollierfehler darf den bereits erfolgten/abgeschlossenen
    // KI-Aufruf nicht rückgängig machen — trotzdem laut geloggt, damit
    // Kosten-/Protokolllücken auffallen.
    console.error("[ai/usage] recordAiJob fehlgeschlagen:", error.message);
  }
}

/**
 * NACHGEHOLT in Block 5 (Kurs-Generator, Phase 3): `recordAiJob()` kann nur
 * INSERTen (Job-Anlage). Die Kurs-Generator-Zustandsmaschine
 * (src/lib/generator/process.ts) braucht zusätzlich Status-ÜBERGÄNGE für
 * einen bereits angelegten Job (queued -> running -> done/error, Fortschritt
 * in `output`) — dafür gibt es laut 0001_init.sql keine UPDATE-Policy für
 * irgendeine Rolle (siehe Dateikopf-Kommentar zu `recordAiJob()`), deshalb
 * ausschließlich über den Admin-Client, fail-soft geloggt wie die übrigen
 * Funktionen dieser Datei.
 *
 * Vertrag: `tokensIn`/`tokensOut`, falls übergeben, sind die NEUEN
 * GESAMTWERTE des Jobs (nicht Deltas/Zuwächse) — der Aufrufer ist für das
 * Aufsummieren über mehrere Pipeline-Schritte hinweg verantwortlich (liest
 * den bisherigen `tokens_in`/`tokens_out`-Stand vor dem Aufruf und addiert
 * die neuen Werte des gerade abgeschlossenen Schritts). `cost_usd` wird nur
 * neu berechnet, wenn sowohl `model` als auch beide Token-Werte im selben
 * Aufruf mitgegeben werden (sonst bleibt der bisherige `cost_usd`-Stand
 * unangetastet, z. B. bei einem reinen Fehler-Update ohne Token-Verbrauch).
 */
export async function updateAiJob(
  jobId: string,
  params: {
    status?: "queued" | "running" | "done" | "error";
    output?: Record<string, unknown>;
    tokensIn?: number;
    tokensOut?: number;
    error?: string;
    model?: string;
  },
): Promise<void> {
  const admin = createAdminClient();

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (params.status !== undefined) update.status = params.status;
  if (params.output !== undefined) update.output = params.output;
  if (params.error !== undefined) update.error = params.error;
  if (params.model !== undefined) update.model = params.model;
  if (params.tokensIn !== undefined) update.tokens_in = params.tokensIn;
  if (params.tokensOut !== undefined) update.tokens_out = params.tokensOut;
  if (params.model !== undefined && params.tokensIn !== undefined && params.tokensOut !== undefined) {
    update.cost_usd = computeCost(params.model, params.tokensIn, params.tokensOut);
  }

  const { error } = await admin.from("ai_jobs").update(update).eq("id", jobId);
  if (error) {
    // Fail-soft wie recordAiJob(): ein Protokollierfehler darf den bereits
    // abgeschlossenen Pipeline-Schritt nicht rückgängig machen — trotzdem
    // laut geloggt, damit Kosten-/Protokolllücken auffallen.
    console.error("[ai/usage] updateAiJob fehlgeschlagen:", error.message);
  }
}

/**
 * NACHGEHOLT in Block 4 (Tutor-Chat, Phase 3): war in Block 1 bewusst nur
 * als TODO vorgemerkt (siehe Git-Historie), weil die Funktionsform vom
 * damals noch nicht existierenden RAG-/Eskalations-Entwurf abhing.
 *
 * `recordTutorMessage()` schreibt eine Nutzer- ODER Assistenten-Nachricht in
 * `tutor_messages` (Protokollpflicht CLAUDE.md §3.7). Admin-Client nötig:
 * `tutor_messages` hat laut 0001_init.sql nur `tutor_msg_own_select`
 * (Lesen), `tutor_msg_own_insert` (Einfügen NUR für `role = 'user'` durch
 * den einloggten Nutzer selbst) und `tutor_msg_staff_select` — keine Policy
 * erlaubt das Einfügen einer `role = 'assistant'`-Zeile über den regulären
 * RLS-Client. Diese Funktion läuft deshalb für BEIDE Rollen einheitlich über
 * den Admin-Client (ein Pfad statt zwei, keine Sonderbehandlung im Aufrufer
 * src/lib/tutor/actions.ts nötig).
 *
 * Kosten werden ausschließlich für die Assistenten-Antwort ungleich null
 * sein (der eigentliche Claude-Aufruf) — bei der Nutzer-Nachricht werden
 * `tokensIn`/`tokensOut` als `0` übergeben, `computeCost()` liefert dafür
 * `0`. Modell ist bewusst fest `AI_MODELS.haiku` (SPEC §6: "Tutor-Chat |
 * claude-haiku"), nicht als Parameter — der Tutor nutzt laut CLAUDE.md §1.6
 * kein anderes Modell.
 */
export async function recordTutorMessage(params: {
  tenantId: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  sourceLessons?: string[];
  tokensIn: number;
  tokensOut: number;
}): Promise<void> {
  const admin = createAdminClient();
  const cost = computeCost(AI_MODELS.haiku, params.tokensIn, params.tokensOut);

  const { error } = await admin.from("tutor_messages").insert({
    tenant_id: params.tenantId,
    conversation_id: params.conversationId,
    role: params.role,
    content: params.content,
    source_lessons: params.sourceLessons ?? [],
    tokens_in: params.tokensIn,
    tokens_out: params.tokensOut,
    cost_usd: cost,
  });

  if (error) {
    // Fail-soft wie recordAiJob()/sendEmail(): ein Protokollierfehler darf
    // die bereits erfolgte Tutor-Antwort nicht rückgängig machen — trotzdem
    // laut geloggt, damit Kosten-/Protokolllücken auffallen.
    console.error("[ai/usage] recordTutorMessage fehlgeschlagen:", error.message);
  }
}
