import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { getServerEnv } from "@/lib/env";
import { processNextCourseGenJob } from "@/lib/generator/process";
import { processNextShiftPlanJob } from "@/lib/calendar/ai/process";

/**
 * Kurs-Generator — Cron-Prozess-Endpunkt (Phase 3, Block 5). Wird vom
 * Cloudflare Cron Trigger aufgerufen (siehe wrangler.jsonc), NICHT von
 * einer normalen Nutzer-Session — deshalb KEIN Supabase-Auth, sondern ein
 * geteiltes Geheimnis per Header (`x-cron-secret`). Führt GENAU EINEN
 * Zustandsübergang der Job-Warteschlange aus (src/lib/generator/process.ts).
 *
 * Zeitkonstanter Vergleich (analog zum Signaturprüfungs-Stil in
 * src/app/api/stripe/webhook/route.ts, dort per Stripe-SDK-HMAC; hier ein
 * einfaches geteiltes Geheimnis statt einer Signatur, deshalb manueller
 * `timingSafeEqual()`-Vergleich über SHA-256-Hashes fester Länge — das
 * vermeidet sowohl Timing-Seitenkanäle als auch den Absturz von
 * `timingSafeEqual()` bei unterschiedlich langen Eingaben). Das erwartete
 * Secret erscheint NIE in einer Fehlermeldung oder einem Log.
 */
function timingSafeSecretEqual(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a).digest();
  const hashB = createHash("sha256").update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

export async function POST(request: Request) {
  const expectedSecret = getServerEnv().CRON_PROCESS_SECRET;
  if (!expectedSecret) {
    console.error("[ki/process] CRON_PROCESS_SECRET ist nicht gesetzt - Endpunkt deaktiviert.");
    return NextResponse.json({ error: "Nicht konfiguriert." }, { status: 500 });
  }

  const providedSecret = request.headers.get("x-cron-secret");
  if (!providedSecret || !timingSafeSecretEqual(providedSecret, expectedSecret)) {
    console.error("[ki/process] Ungültiges oder fehlendes Secret.");
    return NextResponse.json({ error: "Nicht autorisiert." }, { status: 401 });
  }

  try {
    // Zwei unabhängige Warteschlangen (kind='course_gen'/'shift_plan'), EIN
    // Schritt/Lauf je Aufruf UND je Warteschlange — beide teilen sich den
    // Cron-Tick (alle 2 Min., wrangler.jsonc), aber niemals eine Job-Zeile
    // (Filter über `kind`), daher unabhängig voneinander sicher.
    const [courseGenResult, shiftPlanResult] = await Promise.all([
      processNextCourseGenJob(),
      processNextShiftPlanJob(),
    ]);
    return NextResponse.json({ courseGen: courseGenResult, shiftPlan: shiftPlanResult });
  } catch (e) {
    console.error("[ki/process] Unerwarteter Fehler:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Verarbeitung fehlgeschlagen." }, { status: 500 });
  }
}
