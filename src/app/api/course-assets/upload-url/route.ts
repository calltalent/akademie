import { NextResponse } from "next/server";
import { requireStaffTenant } from "@/lib/auth/staff";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import { imageUploadUrlRequestSchema } from "@/lib/courses/asset-upload-schema";

/** Nur druckbare, dateisystemsichere Zeichen — Rest wird durch "_" ersetzt. */
function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 150);
  return cleaned.length > 0 ? cleaned : "datei";
}

/**
 * Signierte Upload-URL für Kurs-Bilder (öffentlicher Bucket `course-assets`,
 * Migration 20260710214020: Pfadkonvention {tenant_id}/..., RLS-Policy
 * `course_assets_staff_write` bindet Schreiben an
 * `member_role(...) in ('owner','admin','trainer')` — exakt der Kreis, den
 * `requireStaffTenant()`/`is_staff()` prüft (siehe pg_proc `is_staff`).
 *
 * Anders als bei `/api/submissions/upload-url`: KEIN `{user_id}`-Pfadsegment
 * — die Schreib-Policy dieses Buckets prüft nur den Mandanten-Ordner, nicht
 * den hochladenden Nutzer (Kursbilder gehören dem Kurs, nicht der Person).
 *
 * Der eigentliche Datei-Upload geht danach vom Browser DIREKT zu Supabase
 * Storage (`uploadToSignedUrl`, siehe `image-upload.tsx`) — nicht durch
 * diese Route.
 */
export async function POST(request: Request) {
  let ctx: Awaited<ReturnType<typeof requireStaffTenant>>;
  try {
    ctx = await requireStaffTenant();
  } catch (e) {
    const message = e instanceof Error ? e.message : "Kein Zugriff.";
    return NextResponse.json({ error: message }, { status: 403 });
  }

  if (
    !(await checkRateLimit("course-asset-upload-url", {
      maxRequests: 40,
      windowSeconds: 3600,
      extraKey: ctx.tenant.id,
    }))
  ) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
  }

  const json = await request.json().catch(() => null);
  const parsed = imageUploadUrlRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }

  const safeName = sanitizeFileName(parsed.data.fileName);
  const path = `${ctx.tenant.id}/${crypto.randomUUID()}-${safeName}`;

  const { data, error } = await ctx.supabase.storage.from("course-assets").createSignedUploadUrl(path);
  if (error || !data) {
    // error.message ist eine rohe Supabase-Storage-Meldung (technisch/
    // englisch) — Detail nur loggen, Nutzer bekommt einen klaren deutschen
    // Satz.
    if (error) {
      console.error("[course-assets/upload-url] Upload-URL konnte nicht erzeugt werden.", {
        tenantId: ctx.tenant.id,
        error: error.message,
      });
    }
    return NextResponse.json({ error: "Upload-URL konnte nicht erzeugt werden." }, { status: 502 });
  }

  return NextResponse.json({ path: data.path, token: data.token });
}
