import { getTenant } from "@/lib/tenant/context";
import { createClient } from "@/lib/supabase/server";
import { PLAN_AI_LIMITS } from "@/lib/ai/config";
import { remainingQuota } from "@/lib/ai/quota";

const PLAN_LABEL: Record<string, string> = {
  trial: "Trial",
  komplett: "Komplett",
  enterprise: "Enterprise",
};

/** Erster des laufenden Monats als ISO-Datum (yyyy-mm-dd) — Format der `usage_counters.month`-Spalte. */
function currentMonthIso(): string {
  const d = new Date();
  d.setUTCDate(1);
  return d.toISOString().slice(0, 10);
}

/**
 * KI-Kontingent-Kachel (Phase 3, Block 1, SPEC 4.2 `/admin`). Server
 * Component, keine Interaktivität nötig — lädt die Daten selbst.
 *
 * Liest NUR den eigenen Mandanten: `tenant.id` kommt ausschließlich aus
 * `getTenant()` (Server-Kontext, middleware.ts -> x-tenant-id-Header), niemals
 * aus Client-Eingabe. Regulärer RLS-Client genügt — `usage_staff_select`
 * (0001_init.sql, Zeilen 577-578) erlaubt Staff das Lesen der
 * usage_counters-Zeilen des eigenen Mandanten; zusätzlich explizites
 * `.eq("tenant_id", tenant.id)` als Defense-in-Depth (gleiches Muster wie
 * reporting/queries.ts, admin/abgaben, admin/zahlungen).
 *
 * Barrierefreiheit (CLAUDE.md §3.4): Fortschritt als Text UND Balken, nicht
 * ausschließlich Farbe — `role="progressbar"` mit aria-valuenow/-min/-max
 * und sichtbarem Zahlentext; "Kontingent aufgebraucht" steht auch als Text
 * da, nicht nur als rote Einfärbung.
 */
export async function AiQuotaCard() {
  const tenant = await getTenant();
  if (!tenant) return null;

  const supabase = await createClient();
  const { data: usageRow } = await supabase
    .from("usage_counters")
    .select("tutor_answers, course_gens")
    .eq("tenant_id", tenant.id)
    .eq("month", currentMonthIso())
    .maybeSingle();

  const limits = PLAN_AI_LIMITS[tenant.plan];
  const tutorUsed = usageRow?.tutor_answers ?? 0;
  const courseGenUsed = usageRow?.course_gens ?? 0;

  return (
    <section
      aria-labelledby="ai-quota-heading"
      className="flex flex-col gap-4 rounded-lg border p-5"
      style={{ borderRadius: "var(--radius)" }}
    >
      <h2 id="ai-quota-heading" className="text-lg font-medium">
        KI-Kontingent (dieser Monat)
      </h2>
      <QuotaRow label="Tutor-Antworten" used={tutorUsed} limit={limits.tutorAnswers} />
      <QuotaRow label="Kursgenerierungen" used={courseGenUsed} limit={limits.courseGens} />
      <p className="text-sm text-gray-500">
        Plan: {PLAN_LABEL[tenant.plan] ?? tenant.plan} — Kontingent setzt sich monatlich zurück.
      </p>
    </section>
  );
}

function QuotaRow({ label, used, limit }: { label: string; used: number; limit: number }) {
  const remaining = remainingQuota(used, limit);
  const exhausted = remaining === 0;
  const pct = limit <= 0 ? 0 : Math.min(100, Math.round((used / limit) * 100));

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span>{label}</span>
        <span className={exhausted ? "font-medium text-red-700" : "text-gray-700"}>
          {used} / {limit}
          {exhausted ? " — Kontingent aufgebraucht" : ""}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-label={`${label}: ${used} von ${limit} verwendet`}
        className="h-2 w-full overflow-hidden rounded-full bg-gray-100"
      >
        <div
          className="h-full"
          style={{
            width: `${pct}%`,
            backgroundColor: exhausted ? "#b91c1c" : "var(--color-primary)",
          }}
        />
      </div>
    </div>
  );
}
