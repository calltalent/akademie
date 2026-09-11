import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { getServerEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { processNextCourseGenJob } from "@/lib/generator/process";
import { processNextShiftPlanJob } from "@/lib/calendar/ai/process";
import { processNextHolidayResearchJob } from "@/lib/calendar/ai/holidays/process";
import { AFFILIATE_CLICK_RETENTION_DAYS, processAffiliateQueue } from "@/lib/affiliate/process";

/**
 * Kurs-Generator — Cron-Prozess-Endpunkt (Phase 3, Block 5). Wird vom
 * Cloudflare Cron Trigger aufgerufen (siehe wrangler.jsonc), NICHT von
 * einer normalen Nutzer-Session — deshalb KEIN Supabase-Auth, sondern ein
 * geteiltes Geheimnis per Header (`x-cron-secret`). Führt GENAU EINEN
 * Zustandsübergang der Job-Warteschlange aus (src/lib/generator/process.ts).
 *
 * AFFILIATE (Block B4, PLAN_Affiliate-System.md 6.5 und 9.7): seit B4 hängt
 * an demselben Tick zusätzlich `processAffiliateQueue()` als VIERTE
 * Warteschlange sowie — davon getrennt — der Löschlauf
 * `affiliate_clicks_purge()`. Ein zweiter Cron-Trigger wird bewusst NICHT
 * angelegt: `wrangler.jsonc` hat genau einen (alle zwei Minuten), der über
 * das Service Binding `SELF` läuft (`custom-worker.ts`); ein zweiter holte die
 * dort dokumentierte 522-Fehlerklasse zurück.
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

/**
 * Stapelgröße des Klick-Löschlaufs. 20 000 Zeilen alle zwei Minuten sind
 * 14,4 Mio. am Tag — ein Rückstand baut sich damit über Stunden ab, ohne dass
 * eine einzelne Anweisung die Tabelle lange sperrt oder das Zeitlimit des
 * Workers reißt. EIN Stapel je Tick genügt; eine Wiederholschleife im selben
 * Request wäre riskant und ist nicht nötig (Vorgabe aus der B3-Migration
 * `20260911120000_affiliate_tracking.sql`).
 */
const AFFILIATE_CLICK_PURGE_BATCH = 20_000;

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
    // Drei unabhängige Warteschlangen (kind='course_gen'/'shift_plan'/
    // 'holiday_research'), EIN Schritt/Lauf je Aufruf UND je Warteschlange —
    // alle drei teilen sich den Cron-Tick (alle 2 Min., wrangler.jsonc),
    // aber niemals eine Job-Zeile (Filter über `kind`), daher unabhängig
    // voneinander sicher.
    const [courseGenResult, shiftPlanResult, holidayResearchResult, affiliateResult] =
      await Promise.all([
        processNextCourseGenJob(),
        processNextShiftPlanJob(),
        processNextHolidayResearchJob(),
        // Affiliate B4 (Plan 9.7): die vierte Warteschlange. Wie die drei
        // anderen über eine eigene Tabelle isoliert (`affiliate_events`) —
        // sie teilen sich den Tick, aber niemals eine Zeile. Der Lauf hat ein
        // eigenes Zeitbudget von 8 Sekunden und wirft NIE (er fängt intern
        // ab), damit ein Affiliate-Fehler die drei KI-Warteschlangen im selben
        // `Promise.all` nicht mitreißt; überschreitet er das Budget, bricht er
        // zwischen zwei Schritten ab und meldet `truncated: true`.
        processAffiliateQueue(),
      ]);

    // Klick-Löschlauf, NEBEN dem `Promise.all` und nicht darin (B3-Korrektur,
    // Befund 4 in `20260911120000_affiliate_tracking.sql`): die drei
    // KI-Warteschlangen sind Job-Warteschlangen mit je einem Schritt pro Tick,
    // dies hier ist ein Aufräumlauf ohne Job-Zeile. Eigener try/catch und ein
    // eigenes Feld in der Antwort, damit ein Fehlschlag weder die
    // Warteschlangen mitreißt noch unsichtbar bleibt.
    //
    // Warum zusätzlich, obwohl `processAffiliateQueue()` in Schritt 5 denselben
    // Löschlauf ruft: Schritt 5 ist der LETZTE der fünf und fällt genau dann
    // aus, wenn der Lauf am 8-Sekunden-Budget abbricht — also bei Last, wenn
    // die Klicktabelle am schnellsten wächst. Die 90-Tage-Frist ist eine
    // Rechtspflicht (Art. 5 Abs. 1 lit. e DSGVO) und darf nicht von der
    // Auslastung der Ereignis-Warteschlange abhängen. Der doppelte Lauf ist
    // folgenlos: der zweite Stapel findet schlicht keine fälligen Zeilen mehr.
    //
    // Nur `error.code` ins Log, nie die Rohmeldung (CLAUDE.md §2.11).
    let affiliateClicksPurged: number | null = null;
    try {
      const { data, error } = await createAdminClient().rpc("affiliate_clicks_purge", {
        p_retention_days: AFFILIATE_CLICK_RETENTION_DAYS,
        p_limit: AFFILIATE_CLICK_PURGE_BATCH,
      });
      if (error) {
        console.error(
          `[ki/process] affiliate_clicks_purge fehlgeschlagen (Code ${error.code ?? "unbekannt"}).`,
        );
      } else {
        affiliateClicksPurged = typeof data === "number" ? data : 0;
      }
    } catch (e) {
      console.error(
        "[ki/process] affiliate_clicks_purge unerwartet fehlgeschlagen:",
        e instanceof Error ? e.message : "unbekannt",
      );
    }

    return NextResponse.json({
      courseGen: courseGenResult,
      shiftPlan: shiftPlanResult,
      holidayResearch: holidayResearchResult,
      affiliate: affiliateResult,
      // `null` heißt: der Löschlauf ist gescheitert (Grund steht im Log),
      // nicht „nichts zu löschen" — das wäre `0`.
      affiliateClicksPurged,
    });
  } catch (e) {
    console.error("[ki/process] Unerwarteter Fehler:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Verarbeitung fehlgeschlagen." }, { status: 500 });
  }
}
