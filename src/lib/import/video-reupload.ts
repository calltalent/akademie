import "server-only";
import { getServerEnv } from "@/lib/env";
import { createBunnyVideo, deleteBunnyVideo } from "@/lib/bunny/client";

/**
 * Migrations-Importer (Phase 4, Block 4): Video-Reupload per Quell-URL.
 *
 * Nutzt Bunnys „Fetch"-API — Bunny lädt die Datei SERVERSEITIG direkt von
 * `sourceUrl`, unser Server sieht die Videodatei selbst nie (kein Proxy,
 * keine Timeout-/Speicherprobleme bei großen Dateien, siehe PHASENSTATUS.md
 * Block-4-Plan). `bunnyConfig()` ist hier bewusst dupliziert (nicht aus
 * src/lib/bunny/client.ts importiert, da dort nicht exportiert) — gleicher
 * Header-/Fehlerbehandlungsstil wie client.ts.
 *
 * SSRF: `sourceUrl` wird nur mit `z.string().url()` (im Import-Schema,
 * src/lib/import/course-import.ts) auf Wohlgeformtheit geprüft — bewusst
 * KEIN SSRF-Schutz nötig (anders als bei Webhook-URLs, Phase 3 Block 7):
 * nicht unser Server ruft die URL auf, sondern Bunnys eigene Infrastruktur.
 */

function bunnyConfig() {
  const env = getServerEnv();
  if (!env.BUNNY_STREAM_LIBRARY_ID || !env.BUNNY_STREAM_API_KEY) {
    throw new Error("Bunny Stream ist nicht konfiguriert (.env prüfen).");
  }
  return {
    libraryId: env.BUNNY_STREAM_LIBRARY_ID,
    apiKey: env.BUNNY_STREAM_API_KEY,
  };
}

export async function reuploadVideoFromUrl(
  sourceUrl: string,
  title: string,
): Promise<{ guid: string }> {
  // Schritt 1: leeres Bunny-Video-Objekt anlegen (wie beim normalen Upload).
  const video = await createBunnyVideo(title);
  const { libraryId, apiKey } = bunnyConfig();

  // Schritt 2: Bunny anweisen, die Datei selbst von sourceUrl zu laden.
  const response = await fetch(
    `https://video.bunnycdn.com/library/${libraryId}/videos/${video.guid}/fetch`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        AccessKey: apiKey,
      },
      body: JSON.stringify({ url: sourceUrl }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    // Rollback: das bereits angelegte, aber inhaltslose Bunny-Video wieder
    // löschen — sonst bleiben verwaiste Video-Objekte in der Bunny-Library.
    await deleteBunnyVideo(video.guid).catch(() => {});
    throw new Error(`Bunny „Fetch Video" fehlgeschlagen: ${text}`);
  }

  return { guid: video.guid };
}
