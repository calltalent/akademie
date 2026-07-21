import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/platform/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import { imageUploadUrlRequestSchema } from "@/lib/courses/asset-upload-schema";

/** Nur druckbare, dateisystemsichere Zeichen — Rest wird durch "_" ersetzt. */
function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 150);
  return cleaned.length > 0 ? cleaned : "datei";
}

/**
 * Signierte Upload-URL für Mandanten-Logos (19.07.2026, Josips Auftrag
 * "Logo-Upload des Mandanten"). Eigene Route statt Wiederverwendung von
 * `/api/course-assets/upload-url` — jene ist über `requireStaffTenant()`
 * gegated (Mitgliedschaft im Mandanten), ein Betreiber-Portal-Platform-Admin
 * ist aber i. A. KEIN Mitglied des Mandanten, dessen Logo er gerade pflegt.
 * Diese Route prüft stattdessen `requirePlatformAdmin()` und erzeugt die
 * signierte URL über den Admin-Client (service_role, umgeht die
 * mitgliedschaftsgebundene `course_assets_staff_write`-Policy) — exakt das
 * Muster, das `lib/platform/actions.ts` für alle Mandanten-Schreibzugriffe
 * bereits nutzt. Gleicher Ziel-Bucket (`course-assets`) und dieselbe
 * `{tenant_id}/...`-Pfadkonvention wie beim staff-eigenen Upload, damit
 * keine zweite Storage-Struktur entsteht.
 */
export async function POST(request: Request) {
  try {
    await requirePlatformAdmin();
  } catch (e) {
    const message = e instanceof Error ? e.message : "Kein Zugriff.";
    return NextResponse.json({ error: message }, { status: 403 });
  }

  const json = await request.json().catch(() => null);
  const parsed = z
    .object({
      tenantId: z.string().uuid(),
      fileName: imageUploadUrlRequestSchema.shape.fileName,
      fileSize: imageUploadUrlRequestSchema.shape.fileSize,
      mimeType: imageUploadUrlRequestSchema.shape.mimeType,
    })
    .safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }

  if (
    !(await checkRateLimit("tenant-logo-upload-url", {
      maxRequests: 40,
      windowSeconds: 3600,
      extraKey: parsed.data.tenantId,
    }))
  ) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
  }

  const safeName = sanitizeFileName(parsed.data.fileName);
  const path = `${parsed.data.tenantId}/${crypto.randomUUID()}-${safeName}`;

  const admin = createAdminClient();
  const { data, error } = await admin.storage.from("course-assets").createSignedUploadUrl(path);
  if (error || !data) {
    if (error) {
      console.error("[tenant-logo/upload-url] Upload-URL konnte nicht erzeugt werden.", {
        tenantId: parsed.data.tenantId,
        error: error.message,
      });
    }
    return NextResponse.json({ error: "Upload-URL konnte nicht erzeugt werden." }, { status: 502 });
  }

  return NextResponse.json({ path: data.path, token: data.token });
}
