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

/**
 * Phase 3, Block 6 (Auto-Transkript + Kapitel + Zusammenfassung).
 * Stößt Bunnys native Transcribe-AI an (Whisper-basiert, 0,10 $/Sprachminute,
 * STT-Entscheidung siehe PHASENSTATUS.md). Bewusst OHNE `generateTitle`/
 * `generateDescription`/`generateMoments`/`targetLanguages` — nicht von SPEC
 * gefordert, spart Kosten (Auftrag).
 *
 * Wertet die Response NICHT aus: aus der Bunny-Doku war nicht abschließend
 * klar, ob der Aufruf synchron eine Bestätigung liefert oder nur den Job
 * anstößt (siehe PHASENSTATUS.md, Block-6-Plan) — der Aufrufer verlässt sich
 * ausschließlich auf den späteren `Status: 9`-Webhook bzw. den manuellen
 * `refreshLessonTranscript()`-Ersatzweg, nie auf diese Response selbst.
 */
export async function triggerTranscription(
  videoId: string,
  opts: { generateChapters?: boolean; sourceLanguage?: string } = {},
): Promise<void> {
  const { libraryId, apiKey } = bunnyConfig();

  const response = await fetch(
    `https://video.bunnycdn.com/library/${libraryId}/videos/${videoId}/transcribe`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        AccessKey: apiKey,
      },
      body: JSON.stringify({
        generateChapters: opts.generateChapters ?? true,
        sourceLanguage: opts.sourceLanguage ?? "de",
      }),
    },
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Bunny „Transcribe Video" fehlgeschlagen: ${text}`);
  }
}

export type BunnyChapter = { title: string; start: number; end: number };
export type BunnyCaption = { srclang: string; label: string };
export type BunnyVideoDetails = {
  length: number;
  chapters: BunnyChapter[];
  captions: BunnyCaption[];
};

/** Liefert u. a. `length` (Sekunden), `chapters`, `captions` — genutzt von src/lib/video/transcript.ts. */
export async function getBunnyVideo(videoId: string): Promise<BunnyVideoDetails> {
  const { libraryId, apiKey } = bunnyConfig();

  const response = await fetch(`https://video.bunnycdn.com/library/${libraryId}/videos/${videoId}`, {
    headers: { Accept: "application/json", AccessKey: apiKey },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Bunny „Get Video" fehlgeschlagen: ${text}`);
  }
  const data = (await response.json()) as {
    length?: number;
    chapters?: BunnyChapter[];
    captions?: BunnyCaption[];
  };

  return {
    length: typeof data.length === "number" ? data.length : 0,
    chapters: Array.isArray(data.chapters) ? data.chapters : [],
    captions: Array.isArray(data.captions) ? data.captions : [],
  };
}

/**
 * UNSICHERHEITSPUNKT (dokumentiert wie in PHASENSTATUS.md Block-6-Plan
 * verlangt): die exakte URL, unter der Bunny die generierte VTT-
 * Untertiteldatei ausliefert, war aus der Doku nicht abschließend zu
 * bestimmen. Angenommen wird das gängige Bunny-Stream-CDN-Muster
 * `https://{cdnHostname}/{videoId}/captions/{srclang}.vtt` (analog zur
 * bestehenden `BUNNY_STREAM_CDN_HOSTNAME`-Verwendung für die HLS-Wiedergabe).
 * MUSS beim ersten echten transkribierten Test-Video verifiziert werden —
 * falls falsch, liefert der `fetch()` in transcript.ts einen Fehlerstatus,
 * der dort bereits abgefangen wird (kein Absturz, nur fehlendes Transkript).
 */
export function getCaptionVttUrl(videoId: string, srclang: string): string | null {
  const { cdnHostname } = bunnyConfig();
  if (!cdnHostname) return null;
  return `https://${cdnHostname}/${videoId}/captions/${srclang}.vtt`;
}

/**
 * Stufe 3 „Untertitel DE + EN" (Plan `calm-watching-dewdrop.md`). Lädt eine
 * fertige VTT-Untertitelspur zu einem bereits transkribierten Bunny-Video
 * hoch — genutzt von `ensureEnglishCaption()` (src/lib/video/
 * translate-captions.ts), um die per claude-haiku übersetzte EN-Spur
 * neben der von Bunny erzeugten DE-Spur einzuhängen. Laut Bunny-Doku ein
 * Upsert pro `srclang`: ein erneuter Aufruf mit gleichem `srclang`
 * überschreibt die vorhandene Spur statt einen Duplikat-Fehler zu werfen —
 * relevant für die Idempotenz-Betrachtung in `ensureEnglishCaption()`
 * (benignes TOCTOU, siehe dortiger Kommentar).
 *
 * Base64-Falle: `captionsFile` muss laut Bunny-Doku Base64-kodiert sein.
 * `btoa()` wirft bei Nicht-Latin1-Zeichen (deutsche VTT enthalten ä/ö/ü/ß)
 * bzw. verstümmelt sie in manchen Runtimes lautlos — `Buffer.from(vttText,
 * "utf8").toString("base64")` kodiert stattdessen die tatsächlichen
 * UTF-8-Bytes korrekt. Cloudflare-Workers-Kompatibilität: `nodejs_compat` ist
 * an, diese Datei nutzt bereits `node:crypto` (`createHash` oben) — `Buffer`
 * steht über denselben Compat-Layer zur Verfügung.
 */
export async function addCaption(
  videoId: string,
  srclang: string,
  label: string,
  vttText: string,
): Promise<void> {
  const { libraryId, apiKey } = bunnyConfig();

  const captionsFile = Buffer.from(vttText, "utf8").toString("base64");

  const response = await fetch(
    `https://video.bunnycdn.com/library/${libraryId}/videos/${videoId}/captions/${srclang}`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        AccessKey: apiKey,
      },
      body: JSON.stringify({ srclang, label, captionsFile }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Bunny „Add Caption" fehlgeschlagen: ${text}`);
  }
}
