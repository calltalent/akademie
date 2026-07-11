import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import { uploadUrlRequestSchema } from "@/lib/submissions/schema";

/** Nur druckbare, dateisystemsichere Zeichen — Rest wird durch "_" ersetzt. */
function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 150);
  return cleaned.length > 0 ? cleaned : "datei";
}

/**
 * Signierte Upload-URL für Kursabgaben (privater Bucket `submissions`,
 * Migration 20260710233735: Pfadkonvention {tenant_id}/{user_id}/...,
 * Storage-Policy `submissions_own_all` bindet Schreiben/Lesen an
 * `(storage.foldername(name))[2] = auth.uid()::text`). `tenant_id`/`user_id`
 * kommen AUSSCHLIESSLICH aus dem Server-Kontext (Host-Auflösung + Session),
 * NIE aus dem Request-Body — der Client kann den Pfad nicht beeinflussen.
 *
 * Zugriffsschutz: jedes angemeldete Mandantenmitglied darf hochladen (kein
 * Staff-Gate, anders als /api/bunny/create-video — Lernende reichen hier
 * ihre eigenen Abgaben ein). Mitgliedschaft wird wie in src/lib/auth/staff.ts
 * über die RPC `member_role` geprüft, nur ohne Rollen-Einschränkung.
 *
 * Der eigentliche Datei-Upload geht danach vom Browser DIREKT zu Supabase
 * Storage (`uploadToSignedUrl`) — nicht durch diese Route.
 */
export async function POST(request: Request) {
  const tenant = await getTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Kein Mandant zu diesem Host gefunden." }, { status: 404 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  }

  if (
    !(await checkRateLimit("submission-upload-url", {
      maxRequests: 20,
      windowSeconds: 3600,
      extraKey: user.id,
    }))
  ) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
  }

  const { data: role } = await supabase.rpc("member_role", { t: tenant.id });
  if (!role) {
    return NextResponse.json({ error: "Kein Zugriff — keine Mitgliedschaft in diesem Mandanten." }, { status: 403 });
  }

  const json = await request.json().catch(() => null);
  const parsed = uploadUrlRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }

  const safeName = sanitizeFileName(parsed.data.fileName);
  const path = `${tenant.id}/${user.id}/${crypto.randomUUID()}-${safeName}`;

  const { data, error } = await supabase.storage.from("submissions").createSignedUploadUrl(path);
  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Upload-URL konnte nicht erzeugt werden." },
      { status: 502 },
    );
  }

  return NextResponse.json({ path: data.path, token: data.token, signedUrl: data.signedUrl });
}
