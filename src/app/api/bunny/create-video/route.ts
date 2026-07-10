import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaffTenant } from "@/lib/auth/staff";
import { createBunnyVideo, generateTusCredentials } from "@/lib/bunny/client";

const bodySchema = z.object({
  title: z.string().min(1).max(300),
});

/**
 * Legt ein Video-Objekt in Bunny an und liefert signierte TUS-Upload-
 * Credentials zurück. Der eigentliche Datei-Upload geht danach vom Browser
 * DIREKT an Bunny (video.bunnycdn.com/tusupload) — nicht durch diese Route.
 *
 * Zugriffsschutz: requireStaffTenant() (Sicherheitsregel: nur Staff darf
 * Inhalte hochladen, RLS auf `lessons` gilt zusätzlich beim späteren
 * Speichern der video_bunny_id über Server Action).
 */
export async function POST(request: Request) {
  try {
    await requireStaffTenant();
  } catch (e) {
    const message = e instanceof Error ? e.message : "Kein Zugriff.";
    return NextResponse.json({ error: message }, { status: 403 });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }

  try {
    const video = await createBunnyVideo(parsed.data.title);
    const { libraryId, expirationTime, signature } = generateTusCredentials(video.guid);

    return NextResponse.json({
      videoId: video.guid,
      libraryId,
      expirationTime,
      signature,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unbekannter Fehler.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
