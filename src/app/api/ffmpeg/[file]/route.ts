import { NextResponse } from "next/server";
import { z } from "zod";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Liefert die drei ffmpeg.wasm-Dateien für den Browser-Video-Schnitt aus
 * (Kurs-Editor, Stufe 2 „Schnitt", Plan `calm-watching-dewdrop.md`, Blocker
 * B4/B5). Quelle ist der R2-Bucket `calltalent-akademie-ffmpeg` (Bindung
 * `FFMPEG_BUCKET`, siehe wrangler.jsonc) — NICHT `public/ffmpeg/`:
 * `ffmpeg-core.wasm` ist ~30,7 MiB, Cloudflare Workers Static Assets erlauben
 * nur 25 MiB pro Datei, das hätte `npm run deploy` gebrochen.
 *
 * Ausgeliefert über eine Route DESSELBEN Workers => SAME-ORIGIN. Deshalb
 * braucht `ffmpeg-client.ts` weder CORS-Konfiguration noch den
 * `toBlobURL()`-Umweg (der sonst nötig wäre, um Cross-Origin-Fetch-
 * Beschränkungen im ffmpeg-Web-Worker zu umgehen).
 *
 * STRIKTE WHITELIST (`fileParamSchema`): der Pfadparameter wird NIEMALS
 * ungeprüft an R2 durchgereicht. Ohne diese Prüfung könnte `[file]`
 * theoretisch einen beliebigen Objekt-Schlüssel im selben Bucket ansprechen.
 *
 * BEWUSST OHNE Auth-Prüfung (`requireStaffTenant()` o. ä.): Diese drei
 * Dateien sind quelloffene, öffentlich verfügbare ffmpeg.wasm-Binärdateien
 * (keine Geheimnisse, kein Personenbezug). Eine Auth-Prüfung würde hier nur
 * Probleme verursachen: `ffmpeg.load()` lädt diese Dateien aus einem
 * dedizierten Web Worker (`classWorkerURL`, siehe `ffmpeg-client.ts`) heraus,
 * dieser Kontext sendet keine Session-Cookies mit — eine geschützte Route
 * würde dort schlicht mit 401/403 scheitern.
 *
 * Nur GET (kein Bedarf für andere Methoden — Next.js Route Handler liefern
 * für nicht implementierte Methoden automatisch 405).
 *
 * Langes `Cache-Control` (1 Jahr, `immutable`): die ~31 MB `ffmpeg-core.wasm`
 * soll Cloudflares Edge-Cache übernehmen, nicht bei jedem Trimmer-Start
 * erneut den Worker/R2 treffen (Performance-Budget CLAUDE.md §3.3).
 */

const ALLOWED_FILES = {
  "ffmpeg-core.js": "text/javascript; charset=utf-8",
  "ffmpeg-core.wasm": "application/wasm",
  "814.ffmpeg.js": "text/javascript; charset=utf-8",
} as const;

const fileParamSchema = z.enum(["ffmpeg-core.js", "ffmpeg-core.wasm", "814.ffmpeg.js"]);

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const parsed = fileParamSchema.safeParse(file);
  if (!parsed.success) {
    // Unbekannter Dateiname -> wie "nicht gefunden" behandeln, nicht als
    // 400 - ein Client, der hier landet, hat ohnehin keinen Nutzen von der
    // Unterscheidung, und wir vermeiden jede Rückmeldung darüber, WELCHE
    // anderen Objektschlüssel im Bucket existieren könnten.
    return NextResponse.json({ error: "Datei nicht gefunden." }, { status: 404 });
  }
  const filename = parsed.data;

  let object: Awaited<ReturnType<typeof getObject>>;
  try {
    object = await getObject(filename);
  } catch (e) {
    console.error(`[api/ffmpeg] R2-Zugriff fehlgeschlagen für ${filename}:`, e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Datei konnte nicht geladen werden." }, { status: 502 });
  }

  if (!object) {
    // Wenn das hier feuert, fehlt die Datei im Bucket — siehe den
    // `--remote`-Hinweis bei `getObject()` unten.
    console.error(`[api/ffmpeg] Objekt fehlt im R2-Bucket "calltalent-akademie-ffmpeg": ${filename}`);
    return NextResponse.json({ error: "Datei nicht gefunden." }, { status: 404 });
  }

  return new NextResponse(object.body, {
    status: 200,
    headers: {
      "Content-Type": ALLOWED_FILES[filename],
      "Content-Length": String(object.size),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

/**
 * Synchrones `getCloudflareContext()` ist im Request-Kontext eines Route
 * Handlers die richtige und dokumentierte Variante. Die async-Variante
 * (`{ async: true }`) ist laut OpenNext-Doku für SSG-/Build-Zeit-Kontexte
 * gedacht — hier also nicht verwenden.
 *
 * WICHTIG, WENN DIESE ROUTE 404 LIEFERT (17.07.2026, erster Live-Test — hat
 * mich Stunden gekostet, deshalb hier dokumentiert):
 *
 * `wrangler r2 object put|get` arbeitet OHNE `--remote` auf einer LOKAL
 * simulierten R2-Instanz (`.wrangler/state/`), nicht auf dem echten Bucket.
 * Der Upload meldet trotzdem "Upload complete", und ein anschließendes
 * `get` meldet "Download complete" — beides liest/schreibt nur die lokale
 * Platte. Der echte Bucket bleibt leer, die Route liefert 404, und die
 * Bindung ist dabei völlig in Ordnung.
 *
 * Erkennungsmerkmal: ohne `--remote` fehlt in der wrangler-Ausgabe das
 * Jurisdiktions-Suffix — 'in bucket "calltalent-akademie-ffmpeg"' statt
 * 'in bucket "calltalent-akademie-ffmpeg (eu)"'. Ausserdem weist wrangler
 * selbst mit "Use --remote if you want to access the remote instance"
 * darauf hin.
 *
 * Also IMMER mit `--remote --jurisdiction eu` hochladen:
 *   npx wrangler r2 object put calltalent-akademie-ffmpeg/ffmpeg-core.wasm \
 *     --file=node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm \
 *     --content-type=application/wasm --jurisdiction eu --remote
 */
async function getObject(filename: keyof typeof ALLOWED_FILES) {
  const { env } = getCloudflareContext();
  return env.FFMPEG_BUCKET.get(filename);
}
