import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaffTenant } from "@/lib/auth/staff";
import { createBunnyVideo, generateTusCredentials } from "@/lib/bunny/client";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import { verifySameOrigin, CSRF_REJECT_MESSAGE } from "@/lib/security/origin";
import { translateDbError } from "@/lib/errors/db";

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
  // CSRF-Fix (08.08.2026): reine Cookie-Session-Autorisierung ohne
  // Signatur-/Secret-Header, siehe src/lib/security/origin.ts-Dateikopf.
  if (!verifySameOrigin(request)) {
    return NextResponse.json({ error: CSRF_REJECT_MESSAGE }, { status: 403 });
  }

  let ctx: Awaited<ReturnType<typeof requireStaffTenant>>;
  try {
    ctx = await requireStaffTenant();
  } catch (e) {
    const message = e instanceof Error ? e.message : "Kein Zugriff.";
    return NextResponse.json({ error: message }, { status: 403 });
  }

  // Pro Mandant — jeder Aufruf legt ein kostenpflichtiges Bunny-Video an.
  if (
    !(await checkRateLimit("bunny-create-video", {
      maxRequests: 30,
      windowSeconds: 3600,
      extraKey: ctx.tenant.id,
    }))
  ) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
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

    // Mandantenbindung (Security-Fix 11.07.2026): ohne diese Zeile könnte
    // saveLessonBlocks (courses/actions.ts) nicht prüfen, ob eine
    // bunnyVideoId wirklich dem eigenen Mandanten gehört.
    const { error: bindError } = await ctx.supabase.from("bunny_videos").insert({
      tenant_id: ctx.tenant.id,
      video_id: video.guid,
      created_by: ctx.user.id,
    });
    if (bindError) {
      // Video existiert bei Bunny bereits, aber ohne DB-Zuordnung — lieber
      // hart fehlschlagen als eine unverknüpfte Video-ID ausliefern.
      await import("@/lib/bunny/client").then((m) => m.deleteBunnyVideo(video.guid));
      return NextResponse.json(
        { error: "Video konnte nicht zugeordnet werden: " + translateDbError(bindError) },
        { status: 500 },
      );
    }

    return NextResponse.json({
      videoId: video.guid,
      libraryId,
      expirationTime,
      signature,
    });
  } catch (e) {
    // e.message kann eine rohe Bunny-API-Antwort enthalten (siehe
    // bunny/client.ts, technisch/englisch) — Detail nur loggen, Nutzer
    // bekommt einen klaren deutschen Satz.
    console.error("[bunny/create-video] Video konnte nicht angelegt werden.", {
      tenantId: ctx.tenant.id,
      error: e instanceof Error ? e.message : e,
    });
    return NextResponse.json({ error: "Video konnte nicht angelegt werden. Bitte versuche es erneut." }, { status: 502 });
  }
}
