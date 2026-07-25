import { Sparkles, Wand2 } from "lucide-react";
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
 *
 * Redesign (25.07.2026, Josips Auftrag "smarter und schöner"): die Karte
 * hatte weder `bg-white` noch eigene Design-Tokens — nur generische
 * Tailwind-Grautöne (`bg-gray-100`, `text-gray-500`) auf dem Seiten-
 * hintergrund `#F4F5FA`. Der Balken-Track (`bg-gray-100` ≈ `#F3F4F6`) war
 * dadurch bei 0 % praktisch unsichtbar — zwei fast identische Hellgrautöne
 * übereinander. Jetzt weiße Karte + Icon-Chip + Balken-Track `#EEF0F7` mit
 * sichtbarem Kontrast, gleiche Werte-/Farblogik wie vorher (`remainingQuota`,
 * `PLAN_AI_LIMITS`) — reine Optik, keine Logikänderung.
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
      className="flex flex-col gap-5 rounded-[14px] border bg-white p-6 sm:p-7"
      style={{ borderColor: "#E7E8F2" }}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 flex-none items-center justify-center rounded-[10px]"
          style={{ background: "#EEF0FA", color: "#5663AE" }}
        >
          <Sparkles size={18} />
        </span>
        <div>
          <h2 id="ai-quota-heading" className="text-[17px] font-bold" style={{ color: "#1A1A2E" }}>
            KI-Kontingent
          </h2>
          <p className="text-[13px]" style={{ color: "#A9AAC4" }}>
            Dieser Monat
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <QuotaRow icon="chat" label="Tutor-Antworten" used={tutorUsed} limit={limits.tutorAnswers} />
        <QuotaRow icon="wand" label="Kursgenerierungen" used={courseGenUsed} limit={limits.courseGens} />
      </div>

      <p className="text-[13px]" style={{ color: "#A9AAC4" }}>
        <span
          className="inline-flex rounded-lg px-2.5 py-1 text-[12.5px] font-bold"
          style={{ color: "#5663AE", background: "#EEF0FA" }}
        >
          {PLAN_LABEL[tenant.plan] ?? tenant.plan}
        </span>{" "}
        · Kontingent setzt sich monatlich zurück
      </p>
    </section>
  );
}

function QuotaRow({
  icon,
  label,
  used,
  limit,
}: {
  icon: "chat" | "wand";
  label: string;
  used: number;
  limit: number;
}) {
  const remaining = remainingQuota(used, limit);
  const exhausted = remaining === 0;
  const pct = limit <= 0 ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const Icon = icon === "chat" ? Sparkles : Wand2;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4 text-sm">
        <span className="flex items-center gap-2 font-semibold" style={{ color: "#3E3F66" }}>
          <Icon size={14} aria-hidden="true" style={{ color: "#A9AAC4" }} />
          {label}
        </span>
        <span
          className="font-bold tabular-nums"
          style={{ color: exhausted ? "#B14A4A" : "#1A1A2E" }}
        >
          {used} / {limit}
          {exhausted ? " — aufgebraucht" : ""}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-label={`${label}: ${used} von ${limit} verwendet`}
        className="h-2 w-full overflow-hidden rounded-full"
        style={{ background: "#EEF0F7" }}
      >
        <div
          className="h-full rounded-full transition-[width]"
          style={{
            width: `${Math.max(pct > 0 ? 3 : 0, pct)}%`,
            backgroundColor: exhausted ? "#B14A4A" : "#5663AE",
          }}
        />
      </div>
    </div>
  );
}
