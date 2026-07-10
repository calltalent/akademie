import "server-only";
import { createHash } from "node:crypto";
import { getServerEnv } from "@/lib/env";

/**
 * Bunny Stream (Video-Hosting). API-Key/Library-ID nur serverseitig
 * (Sicherheitsregel CLAUDE.md §2.2). Videodateien selbst laufen NIE über
 * unseren Server — der Browser lädt per TUS direkt zu Bunny hoch
 * (Sicherheitsregel §1.3: niemals Videodateien in Supabase Storage, und
 * hier zusätzlich: auch nicht über unseren eigenen Next.js-Server, um
 * Bandbreite/Timeouts zu vermeiden).
 */

function bunnyConfig() {
  const env = getServerEnv();
  if (!env.BUNNY_STREAM_LIBRARY_ID || !env.BUNNY_STREAM_API_KEY) {
    throw new Error("Bunny Stream ist nicht konfiguriert (.env prüfen).");
  }
  return {
    libraryId: env.BUNNY_STREAM_LIBRARY_ID,
    apiKey: env.BUNNY_STREAM_API_KEY,
    cdnHostname: env.BUNNY_STREAM_CDN_HOSTNAME ?? null,
  };
}

export async function createBunnyVideo(title: string): Promise<{ guid: string }> {
  const { libraryId, apiKey } = bunnyConfig();

  const response = await fetch(`https://video.bunnycdn.com/library/${libraryId}/videos`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      AccessKey: apiKey,
    },
    body: JSON.stringify({ title }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Bunny „Create Video" fehlgeschlagen: ${text}`);
  }

  return response.json();
}

export function generateTusCredentials(videoId: string) {
  const { libraryId, apiKey } = bunnyConfig();
  // Mindestens 1h Puffer laut Bunny-Doku, wir geben 24h für große Uploads.
  const expirationTime = Math.floor(Date.now() / 1000) + 86400;
  const signature = createHash("sha256")
    .update(`${libraryId}${apiKey}${expirationTime}${videoId}`)
    .digest("hex");

  return { libraryId, expirationTime, signature };
}

export async function deleteBunnyVideo(videoId: string): Promise<void> {
  const { libraryId, apiKey } = bunnyConfig();
  await fetch(`https://video.bunnycdn.com/library/${libraryId}/videos/${videoId}`, {
    method: "DELETE",
    headers: { AccessKey: apiKey },
  });
}

/** Für den Player — Library-ID ist keine geheime Information (steckt ohnehin in jeder Embed-URL). */
export function getPlayerConfig() {
  const { libraryId } = bunnyConfig();
  return { libraryId };
}
