import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaffTenant } from "@/lib/auth/staff";
import { courseGenOutputSchema } from "@/lib/generator/schema";

/**
 * Kurs-Generator — Status-/Polling-Endpunkt (Phase 3, Block 5). Liefert
 * Fortschritt + (bei `status='done'`) den fertigen Entwurf für die
 * Admin-Vorschau. Tenant-/Ownership-Prüfung wie überall: RLS
 * (`ai_jobs_staff_select`) UND expliziter `tenant_id`-Filter als
 * Defense-in-Depth — kein fremder Mandant darf über eine erratene Job-ID
 * pollen.
 */
const querySchema = z.object({ jobId: z.string().uuid("Ungültige Auftrags-ID.") });

export async function GET(request: Request) {
  let ctx: Awaited<ReturnType<typeof requireStaffTenant>>;
  try {
    ctx = await requireStaffTenant();
  } catch (e) {
    const message = e instanceof Error ? e.message : "Kein Zugriff.";
    return NextResponse.json({ error: message }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({ jobId: searchParams.get("jobId") });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Ungültige Anfrage." }, { status: 400 });
  }

  const { data: job, error } = await ctx.supabase
    .from("ai_jobs")
    .select("id, status, output, error, updated_at")
    .eq("id", parsed.data.jobId)
    .eq("tenant_id", ctx.tenant.id)
    .eq("kind", "course_gen")
    .maybeSingle();
  if (error || !job) {
    return NextResponse.json({ error: "Auftrag nicht gefunden." }, { status: 404 });
  }

  const outputParsed = courseGenOutputSchema.safeParse(job.output ?? {});
  const step = outputParsed.success ? outputParsed.data.step : 0;
  const outlineTitle = outputParsed.success ? (outputParsed.data.outline?.title ?? null) : null;
  const draft = outputParsed.success && job.status === "done" ? (outputParsed.data.draft ?? null) : null;

  return NextResponse.json({
    jobId: job.id,
    status: job.status as "queued" | "running" | "done" | "error",
    step,
    outlineTitle,
    draft,
    error: job.status === "error" ? job.error : null,
    updatedAt: job.updated_at,
  });
}
