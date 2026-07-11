import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Phase 3, Block 7 — API-Key- und Webhook-Secret-Erzeugung. Reine,
 * testbare Funktionen (kein I/O, kein Zugriff auf Env/Secrets), analog zu
 * `dispatch.ts` `signPayload()` — bewusst KEIN `import "server-only"`
 * (bricht sonst `keys.test.ts` unter Vitest, siehe Kommentar in
 * dispatch.ts). Unbedenklich, da diese Datei selbst keine Geheimnisse
 * enthält, nur Zufallswerte erzeugt/hasht.
 *
 * Format `ct_live_<32 Hex>` (Architekturentscheidung architect-Plan
 * 11.07.2026): Klartext wird ausschließlich im Moment der Erzeugung an den
 * Aufrufer zurückgegeben (Server Action zeigt ihn genau einmal in der UI),
 * gespeichert wird NUR der sha256-Hash (`api_keys.key_hash`).
 */
const API_KEY_PREFIX = "ct_live_";

export function generateApiKey(): { plaintext: string; hash: string } {
  const random = randomBytes(16).toString("hex"); // 32 Hex-Zeichen
  const plaintext = `${API_KEY_PREFIX}${random}`;
  return { plaintext, hash: hashApiKey(plaintext) };
}

export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/**
 * Zeitkonstanter Hash-Vergleich (gleiches Muster wie
 * `timingSafeSecretEqual()` in `src/app/api/admin/ki/process/route.ts`) —
 * liefert `false` statt zu werfen, wenn die Längen nicht übereinstimmen
 * (kann bei korrupten/manipulierten Eingaben vorkommen).
 */
export function hashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Zufälliges Webhook-Secret (Klartext, einmalig angezeigt — analog zum API-Key). */
export function generateWebhookSecret(): string {
  return randomBytes(24).toString("hex");
}
