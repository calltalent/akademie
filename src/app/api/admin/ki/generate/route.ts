import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaffTenant } from "@/lib/auth/staff";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import { validateGeneratorUpload, extractTextFromPdf } from "@/lib/generator/extract";
import { courseGenInputSchema } from "@/lib/generator/schema";

/**
 * Kurs-Generator — Upload-Endpunkt (Phase 3, Block 5). Nimmt eine PDF-Datei
 * per multipart/form-data entgegen, extrahiert serverseitig den Text
 * (siehe Abweichungs-Begründung in src/lib/generator/extract.ts) und legt
 * einen `ai_jobs`-Eintrag (`kind='course_gen'`, `status='queued'`) an. Die
 * eigentliche, mehrstufige Claude-Generierung läuft asynchron über den
 * geschützten Cron-Prozess-Endpunkt (src/app/api/admin/ki/process/route.ts).
 */
const titleSchema = z.string().trim().max(300).optional();

export async function POST(request: Request) {
  let ctx: Awaited<ReturnType<typeof requireStaffTenant>>;
  try {
    ctx = await requireStaffTenant();
  } catch (e) {
    const message = e instanceof Error ? e.message : "Kein Zugriff.";
    return NextResponse.json({ error: message }, { status: 403 });
  }

  // Feature-Gate strikt === true — gleiches Vertragsmuster wie
  // payments_enabled (Stripe)/tutor_enabled (Tutor-Chat).
  if (ctx.tenant.settings.course_generator_enabled !== true) {
    return NextResponse.json(
      { error: "Der KI-Kursgenerator ist für diese Akademie nicht aktiviert." },
      { status: 403 },
    );
  }

  // Pro Mandant — jeder Aufruf startet einen kostenpflichtigen Claude-Job.
  if (
    !(await checkRateLimit("ki-generate", {
      maxRequests: 5,
      windowSeconds: 3600,
      extraKey: ctx.tenant.id,
    }))
  ) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage (kein multipart/form-data)." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Keine Datei erhalten." }, { status: 400 });
  }

  // Serverseitige Typ-/Größen-Whitelist (Sicherheitsregel, nicht nur Client).
  const uploadCheck = validateGeneratorUpload({ type: file.type, size: file.size });
  if (!uploadCheck.ok) {
    return NextResponse.json({ error: uploadCheck.error }, { status: 400 });
  }

  const titleParsed = titleSchema.safeParse(formData.get("title") ?? undefined);
  const titleHint = titleParsed.success ? titleParsed.data : undefined;

  // "Zielkurs"-Auswahl (Design-Import AdminKiGenerator.dc.html, 19.07.2026):
  // leer/"new" = neuen Kurs anlegen (bisheriges Verhalten). Serverseitig
  // gegen den Mandanten geprüft, statt der Client-Auswahl blind zu
  // vertrauen (Eingabegrenze, CLAUDE.md §2.3) — sonst könnte ein
  // manipulierter Aufruf versuchen, Module an einen fremden Kurs
  // anzuhängen.
  const targetCourseIdRaw = formData.get("targetCourseId");
  let targetCourseId: string | undefined;
  if (typeof targetCourseIdRaw === "string" && targetCourseIdRaw && targetCourseIdRaw !== "new") {
    const { data: targetCourse } = await ctx.supabase
      .from("courses")
      .select("id")
      .eq("id", targetCourseIdRaw)
      .eq("tenant_id", ctx.tenant.id)
      .maybeSingle();
    if (!targetCourse) {
      return NextResponse.json({ error: "Zielkurs nicht gefunden." }, { status: 400 });
    }
    targetCourseId = targetCourse.id;
  }

  let extraction: { text: string; truncated: boolean };
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    extraction = await extractTextFromPdf(bytes);
  } catch (e) {
    console.error("[ki/generate] PDF-Extraktion fehlgeschlagen:", e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: "Text konnte nicht aus der Datei extrahiert werden (evtl. ein reines Bild-PDF ohne Textlayer)." },
      { status: 422 },
    );
  }

  const input = courseGenInputSchema.safeParse({
    sourceText: extraction.text,
    sourceFilename: file.name.slice(0, 300),
    titleHint,
    targetCourseId,
  });
  if (!input.success) {
    return NextResponse.json({ error: "Dokumentinhalt konnte nicht verarbeitet werden." }, { status: 422 });
  }

  // Insert über den regulären, RLS-gescopten Client (Staff-Insert-Policy
  // ai_jobs_staff_insert, 0001_init.sql) — kein Admin-Client nötig für die
  // Anlage; nur für spätere Status-Übergänge (src/lib/generator/process.ts).
  const { data: job, error: insertError } = await ctx.supabase
    .from("ai_jobs")
    .insert({
      tenant_id: ctx.tenant.id,
      kind: "course_gen",
      status: "queued",
      input: input.data,
      output: { step: 0 },
      tokens_in: 0,
      tokens_out: 0,
      created_by: ctx.user.id,
    })
    .select("id")
    .single();
  if (insertError || !job) {
    console.error("[ki/generate] ai_jobs-Insert fehlgeschlagen:", insertError?.message);
    return NextResponse.json({ error: "Auftrag konnte nicht angelegt werden." }, { status: 500 });
  }

  return NextResponse.json({ jobId: job.id, truncated: extraction.truncated });
}
