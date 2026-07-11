import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getServerEnv } from "@/lib/env";
import { triggerTranscription } from "@/lib/bunny/client";
import { processVideoTranscript } from "@/lib/video/transcript";

/**
 * Bunny-Stream-Webhook (Phase 3, Block 6 — Auto-Transkript). Bibliotheksweiter
 * Webhook, den Josip PRODUKTIV im Bunny-Dashboard (Library-Einstellungen ->
 * Webhook-URL) einträgt — kein Deployment/keine Eintragung in diesem Block
 * (CLAUDE.md §4.6: "Nichts löschen oder deployen ohne ausdrückliche Freigabe").
 * Lokal ohne öffentlich erreichbare URL nicht testbar — Ersatzweg ist
 * `refreshLessonTranscript()` (src/lib/video/actions.ts).
 *
 * REIHENFOLGE STRENG WIE VORGEGEBEN (CLAUDE.md §2.4: "Stripe- und
 * Bunny-Webhooks: Signatur prüfen, bevor irgendetwas verarbeitet wird" —
 * exakt wie src/app/api/stripe/webhook/route.ts): (1) Rohtext lesen
 * (`request.text()`, NICHT `request.json()` — würde den exakten Byte-Body
 * fürs HMAC verlieren), (2) Signatur-Header lesen, (3) Version/Algorithmus
 * prüfen, (4) HMAC-SHA256 über den rohen Body mit
 * `BUNNY_STREAM_READONLY_API_KEY` als Schlüssel berechnen, zeitkonstanter
 * Hex-Vergleich (`timingSafeEqual`, analog
 * src/app/api/admin/ki/process/route.ts), bei Fehler -> 400, nichts
 * verarbeiten, (5) ERST DANACH `JSON.parse()` auf dem bereits gelesenen Text
 * und Verarbeitung.
 *
 * Status 3 (Finished/Encoding fertig) -> Transkription anstoßen.
 * Status 9 (CaptionsGenerated/Transkription fertig) -> Transkript/Kapitel/
 * Zusammenfassung abholen und speichern.
 * Unbekannte Video-GUID, andere Status-Werte oder ein unerwartetes
 * Body-Format: bewusst KEIN Fehler-Status (200 + No-Op) — Bunny könnte sonst
 * aggressiv wiederholen (Auftrag). Volle Fehlerdetails ausschließlich
 * serverseitig geloggt.
 */

const webhookBodySchema = z.object({
  VideoLibraryId: z.number().optional(),
  VideoGuid: z.string().min(1),
  Status: z.number(),
});

function verifySignature(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader) return false;
  const expectedHex = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  if (signatureHeader.length !== expectedHex.length || !/^[0-9a-f]+$/i.test(signatureHeader)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(expectedHex, "utf8"), Buffer.from(signatureHeader, "utf8"));
}

export async function POST(request: Request) {
  const secret = getServerEnv().BUNNY_STREAM_READONLY_API_KEY;
  if (!secret) {
    console.error("[bunny/webhook] BUNNY_STREAM_READONLY_API_KEY nicht gesetzt - Webhook deaktiviert.");
    return NextResponse.json({ error: "Nicht konfiguriert." }, { status: 500 });
  }

  const rawBody = await request.text();
  const signatureVersion = request.headers.get("x-bunnystream-signature-version");
  const signatureAlgorithm = request.headers.get("x-bunnystream-signature-algorithm");
  const signatureHeader = request.headers.get("x-bunnystream-signature");

  if (signatureVersion !== "v1" || signatureAlgorithm !== "hmac-sha256") {
    console.error("[bunny/webhook] Unbekannte/fehlende Signaturversion oder -algorithmus.");
    return NextResponse.json({ error: "Ungültige Signatur." }, { status: 400 });
  }
  if (!verifySignature(rawBody, signatureHeader, secret)) {
    console.error("[bunny/webhook] Ungültige Signatur - Event wird NICHT verarbeitet.");
    return NextResponse.json({ error: "Ungültige Signatur." }, { status: 400 });
  }

  // Ab hier ist die Signatur geprüft - erst jetzt wird irgendetwas verarbeitet.
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Ungültiger Body." }, { status: 400 });
  }

  const parsed = webhookBodySchema.safeParse(payload);
  if (!parsed.success) {
    // Unerwartetes/zukünftiges Event-Format - bewusst kein Fehler-Status
    // (siehe Dateikopf).
    console.error("[bunny/webhook] Unerwartetes Body-Format, ignoriert:", parsed.error.issues[0]?.message);
    return NextResponse.json({ received: true });
  }

  const { VideoGuid: videoId, Status: status } = parsed.data;

  try {
    if (status === 3) {
      await triggerTranscription(videoId, { generateChapters: true, sourceLanguage: "de" });
    } else if (status === 9) {
      const result = await processVideoTranscript(videoId);
      if (!result.ok) {
        console.error(`[bunny/webhook] processVideoTranscript fehlgeschlagen (${result.reason}):`, result.message);
      }
    }
    // Andere Status-Werte: bewusstes No-Op (siehe Dateikopf).
  } catch (e) {
    // Volle Fehlerdetails nur serverseitig - Bunny bekommt trotzdem 200,
    // damit kein aggressiver Retry-Sturm entsteht (Auftrag: "nicht werfen").
    const message = e instanceof Error ? e.message : "Unbekannter Fehler.";
    console.error(`[bunny/webhook] Fehler bei Status ${status} (Video ${videoId}):`, message);
  }

  return NextResponse.json({ received: true });
}
