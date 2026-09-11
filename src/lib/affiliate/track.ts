import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  affiliatePartnerCodeSchema,
  affiliateReferralTokenSchema,
  AFFILIATE_CAMPAIGN_PATTERN,
} from "@/lib/affiliate/schema";
import { buildClickDedupKey, hashClickIp } from "@/lib/affiliate/hash";
import { classifyUserAgent, detectClickBot, readClickSignals } from "@/lib/affiliate/bot";
import { affiliateCookieMaxAge } from "@/lib/affiliate/cookie";
import type { AffiliateOverwritePolicy } from "@/lib/affiliate/types";

/**
 * Affiliate-System, Block B3 — die Schreibseite des Klick-Endpunkts
 * (PLAN_Affiliate-System.md 4.2 Schritte 3 bis 7, 3.6, 3.7, 3.14,
 * Grundsatzentscheidungen G11/G18, Prüfliste 11.2/11.3/11.10/11.11/11.12/11.15).
 *
 * `src/app/api/aff/k/route.ts` ist die HTTP-Schale: Query prüfen, Ziel
 * bestimmen, Antwort bauen, Cookie setzen. Alles, was die Datenbank berührt,
 * steht hier — aus demselben Grund wie bei `bind.ts`: der Endpunkt ist
 * öffentlich und unauthentifiziert, und jede Zeile, die er schreibt, ist
 * später Grundlage einer Geldbuchung. Diese Trennung macht den
 * Autorisierungspfad an EINER Stelle nachlesbar.
 *
 * ## Warum `createAdminClient()` (CLAUDE.md §2.10, Plan 11.10)
 *
 * `affiliate_clicks`, `affiliate_referrals` und `affiliate_daily_stats` haben
 * für `anon` und `authenticated` `revoke all` plus eine Deny-Policy auf jeden
 * Schreibzugriff (Migration 20260911120000, Abschnitte 1–4 und 6). Es gibt
 * keinen Weg, der ohne `service_role` schreibt — und das ist der Zweck: wer
 * diese Zeilen selbst schreiben könnte, hinge fremde Bestellungen an einen
 * Partner seiner Wahl.
 *
 * Die vorgelagerte Autorisierung ist deshalb hier im Code, und sie ist
 * bewusst klein: der Mandant kommt AUSSCHLIESSLICH aus dem
 * Middleware-Header (`getTenant()` in der Route, nie aus der Anfrage), und
 * jede einzelne Abfrage trägt `.eq("tenant_id", …)`. Ein Partnercode aus
 * einem fremden Mandanten findet damit nichts. Zusätzlich binden die
 * zusammengesetzten Fremdschlüssel `(x_id, tenant_id)` jede geschriebene
 * Zeile schon in der Datenbank an denselben Mandanten — eine falsche
 * `program_id` scheitert am Schlüssel, nicht erst an einer Bedingung, die
 * jemand später umformuliert (CLAUDE.md §2.15).
 *
 * ## Warum die Klickaufnahme eine RPC ist und keine drei Anweisungen
 *
 * `public.affiliate_record_click()` (Migration 20260911120000, Abschnitt 5.2)
 * bündelt Tagesobergrenze, Entdopplung und Fortschreibung der Tageszähler in
 * EINEM Rundlauf. Zwei Gründe, beide harte:
 *
 *   1. Die Obergrenze aus Plan 4.2 Schritt 6 ist ein Lesen-und-dann-Schreiben.
 *      Im Anwendungscode läge zwischen beiden ein Netzweg; zwei gleichzeitige
 *      Klicks läsen denselben Stand.
 *   2. Der Schreibvorgang liegt ausdrücklich VOR der Antwort (Plan 4.2,
 *      letzter Absatz) — `ctx.waitUntil()` gibt es in diesem Projekt nicht,
 *      `custom-worker.ts:59` entfernt den `ctx`-Parameter sogar. Jeder
 *      zusätzliche Rundlauf ist deshalb unmittelbar Antwortzeit des
 *      Besuchers. Drei Anweisungen wären drei Rundläufe.
 *
 * ## Rundläufe je Klick (Abnahmebedingung B3: < 200 ms Serverzeit)
 *
 *   Lesephase   1 Wandzeit-Rundlauf. Programm, Partner und — nur bei
 *               vorliegender Einwilligung und vorhandenem `ct_aff` — die
 *               bestehende Zuordnung laufen über `Promise.all()`
 *               NEBENEINANDER. Sie hängen nicht voneinander ab.
 *   Schreibphase 2 Rundläufe im Normalfall: `affiliate_record_click()`, dann
 *               der INSERT der Referral-Zeile. Nacheinander, weil die
 *               Referral-Zeile die `click_id` aus der RPC trägt.
 *   Zusatz      1 weiterer Rundlauf NUR, wenn eine bestehende Zuordnung
 *               abgelöst wird (`superseded`) — der seltene Fall des
 *               wiederkehrenden Besuchers mit zweitem Partnerlink.
 *
 * Macht 3 im Normalfall, 4 beim Partnerwechsel, 2 für Bot/Sperrliste/Deckel
 * und 1, wenn Code, Partner oder Programm nicht passen.
 *
 * ## Warum kein `select("*")`
 *
 * Das SELECT-Recht auf `affiliate_partners` und `affiliate_programs` ist ein
 * SPALTEN-Grant (Migration 20260910120000). `select("*")` bricht dort mit
 * 42501 ab, sobald jemand dieselbe Abfrage später mit dem Session-Client
 * wiederverwendet. Jede Abfrage benennt ihre Spalten — und holt ohnehin nur,
 * was sie braucht.
 *
 * ## Cloudflare Workers
 *
 * Kein `node:crypto`, kein `fs`, keine Arbeit nach der Antwort. Zufall und
 * Hash kommen aus Web Crypto (`crypto.getRandomValues`, und in `hash.ts`
 * `crypto.subtle`).
 *
 * Wirft nie. Ein Klick, der nicht gezählt werden kann, kostet eine Provision;
 * ein Klick, der in einer Fehlerseite endet, kostet den Kunden.
 */

// --- Ergebnisformen -----------------------------------------------------

/**
 * Warum ein Klick so geendet ist, wie er geendet ist. Ausschließlich für
 * Tests und ein späteres, sparsames Logging — NIE für die Antwort: der
 * Besucher bekommt in jedem dieser Fälle dieselbe Weiterleitung, und eine
 * unterscheidbare Antwort wäre ein Orakel für gültige Partnercodes
 * (CLAUDE.md §2.15, Plan 11.15).
 */
export const TRACK_CLICK_OUTCOMES = [
  /** Kein aktiver Partner mit diesem Code in einem aktiven Programm. */
  "no-partner",
  /** Bot, Einbettung oder Prefetch (bot.ts) — Klickzeile ja, Zuordnung nein. */
  "bot",
  /** Referrer steht auf `affiliate_programs.referrer_blocklist` (Plan 4.2 Schritt 5). */
  "blocked-referrer",
  /** Tagesobergrenze je Partner erreicht (Plan 4.2 Schritt 6, G18) — nichts geschrieben. */
  "capped",
  /** Gültige Zuordnung vorhanden und `overwrite_policy = 'deny'` (Plan 4.2 Schritt 7a). */
  "kept-existing",
  /** Neue Referral-Zeile entstanden. */
  "attributed",
  /** Technischer Fehler; es ist nichts oder nur der Klick entstanden. */
  "error",
] as const;
export type TrackClickOutcome = (typeof TRACK_CLICK_OUTCOMES)[number];

export type TrackClickResult = {
  outcome: TrackClickOutcome;
  /**
   * Das Token für `?aff=` und für das Cookie. `null` heißt: keine Zuordnung,
   * die Route hängt nichts an und setzt nichts.
   */
  token: string | null;
  /**
   * `affiliate_programs.cookie_ttl_days` — roh, NICHT beschnitten: die Route
   * gibt den Wert unverändert an `affiliateCookieOptions()` (cookie.ts)
   * weiter, und dort sitzt die Beschneidung auf [1, 365] Tage. Eine zweite
   * Beschneidung hier wäre eine zweite Stelle, an der die Grenze abweichen
   * kann. `null` heißt: es ist kein Cookie zu setzen.
   */
  cookieTtlDays: number | null;
  /**
   * Das Cookie bleibt unverändert (Plan 4.2 Schritt 7a): die bestehende
   * Zuordnung gilt weiter, ein erneutes `Set-Cookie` würde nur die Laufzeit
   * verlängern und damit die Zusage gegenüber dem ERSTEN Partner dehnen.
   */
  keepCookie: boolean;
  /** Für den Prüfpfad und die E2E-Abnahme; die Antwort ändert sich dadurch nie. */
  isBot: boolean;
};

export type TrackClickInput = {
  /** Aus `getTenant()`, also aus dem Middleware-Header — nie aus der Anfrage. */
  tenantId: string;
  /** Partnercode aus `?c=`, bereits durch `affiliateClickQuerySchema` gelaufen. */
  code: string;
  /** Kampagne aus `?cam=`, bereits geprüft; `null`, wenn nicht gesetzt. */
  campaign: string | null;
  /** Interner Zielpfad aus `click-target.ts` — immer relativ, nie eine URL. */
  landingPath: string;
  /** Die Kopfzeilen der Anfrage (User-Agent, Accept, Referer, CF-Kopfzeilen). */
  headers: Headers;
  /**
   * Wert des `ct_aff`-Cookies oder `null`. Die Route liest ihn NUR bei
   * vorliegender Einwilligung, siehe `consentGranted`.
   */
  existingToken: string | null;
  /** Ergebnis von `isConsentGranted()` (src/lib/consent/read.ts). */
  consentGranted: boolean;
  /** Ein Zeitpunkt für den ganzen Vorgang — kein `Date.now()` in dieser Datei. */
  at: Date;
};

/** Das Nichts-passiert-Ergebnis; jeder Abbruch endet hier. */
function nothing(outcome: TrackClickOutcome, isBot = false): TrackClickResult {
  return { outcome, token: null, cookieTtlDays: null, keepCookie: false, isBot };
}

// --- Zeilentypen --------------------------------------------------------
//
// Lokal und nicht in `types.ts`: `affiliate_clicks`, `affiliate_referrals`
// und `affiliate_daily_stats` haben dort (Block B1) keine Zeilentypen, und
// `types.ts` gehört in diesem Block einem anderen Arbeitsschritt. Gebraucht
// wird ohnehin nur der Ausschnitt, den die jeweilige Spaltenliste holt.

/** Spalten der Programmzeile, die dieser Ablauf braucht — nie mehr. */
const PROGRAM_COLUMNS = "id, status, cookie_ttl_days, overwrite_policy, referrer_blocklist";

type ProgramRow = {
  id: string;
  status: string;
  cookie_ttl_days: number;
  overwrite_policy: AffiliateOverwritePolicy;
  referrer_blocklist: string[] | null;
};

/**
 * Spalten der Partnerzeile. `program_id` wird mitgelesen und gegen die
 * Programmzeile geprüft, obwohl es je Mandant nur EIN Programm gibt
 * (`unique (tenant_id)` in 20260910120000): die Spalte existiert genau
 * deshalb überall, damit ein zweites Programm später kein Schema-Umbau wird —
 * dann muss dieser Abgleich schon stehen.
 */
const PARTNER_COLUMNS = "id, program_id, status";

type PartnerRow = { id: string; program_id: string; status: string };

/** Spalten der bestehenden Zuordnung (Plan 4.2 Schritt 7a). */
const REFERRAL_COLUMNS = "id, program_id, status, expires_at";

type ReferralRow = {
  id: string;
  program_id: string;
  status: string;
  expires_at: string;
};

/** Rückgabe von `public.affiliate_record_click()`. */
type RecordClickRow = {
  click_id: string | null;
  counted: boolean;
  deduped: boolean;
  capped: boolean;
};

// --- Kopfzeilen auswerten (rein, kein I/O) ------------------------------

/**
 * Die Absender-IP. Dieselbe Reihenfolge wie `security/rate-limit.ts:21-23`
 * und `consent/actions.ts:182`: hinter Cloudflare ist `cf-connecting-ip` die
 * verlässliche Quelle, `x-forwarded-for` der Rückfall für die lokale
 * Entwicklung. Nur der ERSTE Eintrag — alles danach hat der Client selbst
 * angehängt.
 *
 * Die Adresse verlässt diese Funktion nur als Eingabe für `hashClickIp()`;
 * gespeichert wird ausschließlich der HMAC (Plan 3.6).
 */
export function readClientIp(headers: Headers): string | null {
  const direct = headers.get("cf-connecting-ip");
  if (direct && direct.trim().length > 0) return direct.trim();
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded && forwarded.length > 0 ? forwarded : null;
}

/**
 * Cloudflares Länderkennung. `XX` (unbekannt) und `T1` (Tor) sind keine
 * Länder und werden verworfen, statt als solche in der Auswertung zu landen;
 * die Spalte hat einen CHECK auf `^[A-Z]{2}$`, ein anderer Wert ließe den
 * gesamten Klick-INSERT scheitern (23514) — die Prüfung hier ist also nicht
 * Kosmetik, sondern verhindert, dass eine fremde Kopfzeile den Klick killt.
 */
export function readCountry(headers: Headers): string | null {
  const raw = headers.get("cf-ipcountry")?.trim().toUpperCase();
  if (!raw || raw === "XX" || raw === "T1" || !/^[A-Z]{2}$/.test(raw)) return null;
  return raw;
}

/**
 * Nur der Host des Referrers, nie die volle URL (Plan 3.6): eine
 * Referrer-URL trägt Suchbegriffe und Sitzungskennungen fremder Seiten, und
 * die brauchen wir für nichts.
 *
 * `new URL()` in try/catch, weil ein `Referer` aus fremder Hand beliebiger
 * Unsinn sein darf. Das Ergebnis wird zusätzlich gegen die Zeichenklasse der
 * Spalte geprüft (`^[a-z0-9.-]+$`, höchstens 253 Zeichen) — sonst scheiterte
 * der INSERT an einem Wert, den ein Fremder gesetzt hat.
 */
export function readReferrerHost(headers: Headers): string | null {
  const raw = headers.get("referer");
  if (!raw) return null;
  let host: string;
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host.length === 0 || host.length > 253 || !/^[a-z0-9.-]+$/.test(host)) return null;
  return host;
}

/**
 * Steht der Referrer auf der Sperrliste des Programms (Plan 4.2 Schritt 5)?
 *
 * Zusatz zum Plan, mit Anlass: geprüft wird nicht nur die Gleichheit, sondern
 * auch die Unterdomäne (`.` + Eintrag). Der Anwendungsfall der Liste sind
 * Gutschein- und Cashback-Seiten, die am Ende des Funnels die Provision
 * abschöpfen; die betreiben regelmäßig `www.`- und Länder-Unterdomänen. Eine
 * Liste, die `gutschein.example` sperrt, aber `www.gutschein.example`
 * durchlässt, wäre in genau ihrem Anwendungsfall wirkungslos — und der
 * Händler merkt es nicht, weil eine unwirksame Sperre aussieht wie eine
 * wirksame ohne Treffer.
 */
export function isBlockedReferrer(
  referrerHost: string | null,
  blocklist: readonly string[] | null | undefined,
): boolean {
  if (!referrerHost || !blocklist || blocklist.length === 0) return false;
  return blocklist.some((entry) => {
    const needle = entry.trim().toLowerCase();
    if (needle.length === 0) return false;
    return referrerHost === needle || referrerHost.endsWith(`.${needle}`);
  });
}

/**
 * 32 Zufallsbytes als Hex (Plan 4.2 Schritt 7b) — das Referral-Token.
 *
 * `crypto.getRandomValues` und ausdrücklich nicht `Math.random()`: an diesem
 * Wert hängt Geld. Wer ein Token erraten kann, hängt mit `?aff=<token>` jede
 * beliebige Bestellung an den zugehörigen Partner (Plan 4.4 R5). 256 Bit sind
 * dafür nicht großzügig, sondern die untere vernünftige Grenze.
 *
 * Web Crypto, kein `node:crypto` — dieselbe Begründung wie im Kopf von
 * `hash.ts`: `node:crypto` bricht den Webpack-Fallback des Builds.
 */
function newReferralToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Protokolliert einen Datenbankfehler OHNE die Nutzlast (CLAUDE.md §2.11,
 * Plan 11.11). Ausgegeben wird ausschließlich ein fester Kontext und der
 * PostgREST-Fehlercode.
 *
 * `error.message` wird bewusst NICHT ausgegeben: bei einer Constraint-
 * Verletzung auf `affiliate_referrals` trägt die Meldung den Schlüsselwert —
 * also das Referral-Token — im Klartext, und der Endpunkt läuft auf dem
 * heißesten öffentlichen Pfad des Moduls. Ein Token in einem Worker-Log ist
 * ein Inhaber-Geheimnis in einem Log.
 */
function logDbError(context: string, error: { code?: string } | null): void {
  console.error(`[affiliate/track] ${context} fehlgeschlagen (Code ${error?.code ?? "unbekannt"}).`);
}

// --- Der Ablauf ---------------------------------------------------------

/**
 * Plan 4.2 Schritte 3 bis 7. Gibt zurück, was die Route für Schritt 8
 * braucht: ein Token oder nichts.
 *
 * Reihenfolge und Abbruchpunkte sind die des Plans. Was hier NICHT passiert:
 * es gibt keinen Zweig, der eine andere Antwort erzeugt. Jeder Rückgabewert
 * führt in der Route zu derselben Weiterleitung mit demselben Status — der
 * einzige sichtbare Unterschied ist das Vorhandensein von `?aff=` und
 * `Set-Cookie`, und der ist bei einer erfolgreichen Zuordnung unvermeidbar.
 */
export async function trackAffiliateClick(input: TrackClickInput): Promise<TrackClickResult> {
  // Zweite Linie hinter `affiliateClickQuerySchema` (CLAUDE.md §2.3/§2.12):
  // der Code geht gleich in einen Query-Builder-Filter. Das Muster ist enger
  // als die Trennzeichen der PostgREST-Filtersyntax, ein gültiger Wert kann
  // dort also keine zusätzliche Bedingung einschleusen. Vorbild: `bind.ts`
  // prüft den Token an derselben Stelle noch einmal.
  const parsedCode = affiliatePartnerCodeSchema.safeParse(input.code);
  if (!parsedCode.success) return nothing("no-partner");
  const code = parsedCode.data;

  // Die Kampagne geht ungefiltert in eine Spalte mit CHECK. Ein Wert, der das
  // Muster verletzt, ließe den gesamten Klick-INSERT scheitern (23514) —
  // deshalb hier verwerfen statt den Klick zu verlieren.
  const campaign =
    input.campaign && AFFILIATE_CAMPAIGN_PATTERN.test(input.campaign) ? input.campaign : null;

  const supabase = createAdminClient();

  try {
    // --- Schritt 3 + 7a: die Lesephase, ein Wandzeit-Rundlauf -----------
    //
    // Die drei Abfragen hängen nicht voneinander ab und laufen deshalb
    // nebeneinander. Das ist nicht nur schneller: es macht auch die Laufzeit
    // von "Code existiert nicht", "Partner gesperrt" und "Programm
    // abgeschaltet" ununterscheidbar, weil alle drei durch dieselbe
    // Abfragemenge laufen und sich nur im Ergebnis unterscheiden
    // (CLAUDE.md §2.15).
    //
    // Das Token aus dem Cookie wird NUR bei vorliegender Einwilligung
    // überhaupt gelesen (Zusatz zum Plan, mit Anlass): § 25 TDDDG erfasst
    // nicht nur das Speichern, sondern ausdrücklich auch den ZUGRIFF auf
    // Informationen in der Endeinrichtung. Ohne Einwilligung existiert
    // `ct_aff` ohnehin nicht — `consent/actions.ts` löscht es bei Ablehnung
    // und Widerruf (`TRACKING_COOKIES_ON_CONSENT`) —, die Bedingung kostet im
    // Normalfall also nichts und spart im einwilligungsfreien Pfad einen
    // Rundlauf. Bekannte, hingenommene Folge: wird der Rechtstext neu
    // datiert, gilt eine alte Zustimmung bis zur neuen Entscheidung als nicht
    // erteilt; ein zweiter Partnerlink erzeugt dann eine neue Zuordnung, auch
    // bei `overwrite_policy = 'deny'`. Das Token im `?aff=`-Parameter schlägt
    // in `resolveAttribution()` ohnehin das Cookie (R5 vor R6), das Ergebnis
    // ist also dasselbe wie bei `allow` — kein Geldverlust, nur eine
    // Abweichung von der Einstellung in einem Zeitfenster von Tagen.
    const existingTokenParsed = input.consentGranted
      ? affiliateReferralTokenSchema.safeParse(input.existingToken)
      : null;

    const [programQuery, partnerQuery, existingQuery] = await Promise.all([
      supabase
        .from("affiliate_programs")
        .select(PROGRAM_COLUMNS)
        .eq("tenant_id", input.tenantId)
        .eq("status", "active")
        .maybeSingle<ProgramRow>(),
      supabase
        .from("affiliate_partners")
        .select(PARTNER_COLUMNS)
        .eq("tenant_id", input.tenantId)
        .eq("code", code)
        .eq("status", "active")
        .maybeSingle<PartnerRow>(),
      existingTokenParsed?.success
        ? supabase
            .from("affiliate_referrals")
            .select(REFERRAL_COLUMNS)
            .eq("tenant_id", input.tenantId)
            .eq("token", existingTokenParsed.data)
            .maybeSingle<ReferralRow>()
        : Promise.resolve(null),
    ]);

    if (programQuery.error) {
      logDbError("Programm laden", programQuery.error);
      return nothing("error");
    }
    if (partnerQuery.error) {
      logDbError("Partner laden", partnerQuery.error);
      return nothing("error");
    }
    // Kein Abbruch, wenn ausgerechnet die BESTEHENDE Zuordnung nicht gelesen
    // werden konnte: der frische Klick wiegt schwerer als die Überschreibregel.
    // Die Richtung ist bewusst gewählt — der Fehlerfall verhält sich wie
    // `overwrite_policy = 'allow'`, es entsteht also eine Zuordnung statt
    // keiner. Die alte Zeile bleibt dabei `active`; das ist unschädlich, weil
    // `resolveAttribution()` nach `created_at` entscheidet und die neue Zeile
    // die jüngere ist.
    if (existingQuery?.error) {
      logDbError("Bestehende Zuordnung laden", existingQuery.error);
    }

    const program = programQuery.data;
    const partner = partnerQuery.data;

    // EIN Ausgang für alle Nicht-Treffer, und ausdrücklich ohne jeden
    // Schreibvorgang (Plan 4.2 Schritt 3). "Code existiert nicht",
    // "Partner gesperrt/abgelehnt/in Bewerbung" und "Programm im Entwurf
    // oder pausiert" sind von hier an nicht mehr unterscheidbar — auch nicht
    // an der Zahl der Datenbankzugriffe.
    if (!program || !partner || partner.program_id !== program.id) {
      return nothing("no-partner");
    }

    // --- Schritt 4 + 5: Bot, Einbettung, Sperrliste ---------------------
    const signals = readClickSignals(input.headers);
    const botVerdict = detectClickBot(signals);
    const referrerHost = readReferrerHost(input.headers);
    const blockedReferrer = isBlockedReferrer(referrerHost, program.referrer_blocklist);

    // Ein Sperrlisten-Treffer wird als `is_bot` festgehalten. Die Tabelle hat
    // keine eigene Spalte dafür (Plan 3.6), und ohne Marker sähe die Zeile
    // aus wie ein normaler Klick, zu dem rätselhafterweise keine Zuordnung
    // gehört — genau die Frage, die im Streitfall beantwortbar sein muss.
    const isBot = botVerdict.isBot || blockedReferrer;

    // --- Schritt 6: Klickzeile, Entdopplung, Tagesobergrenze ------------
    const ipHash = await hashClickIp(readClientIp(input.headers), input.at);
    const uaFamily = classifyUserAgent(signals.userAgent);
    const dedupKey = await buildClickDedupKey({
      partnerId: partner.id,
      ipHash,
      uaFamily,
      at: input.at,
    });

    // `consent_at` heißt laut Plan 3.6 "es lag eine Einwilligung vor und ein
    // Cookie DURFTE gesetzt werden" — nicht "es wurde gesetzt". Beim Bot wird
    // keines gesetzt und dürfte auch keines gesetzt werden, deshalb dort
    // `null`. Im Fall 7a (bestehende Zuordnung bleibt) bleibt der Wert
    // gesetzt: die Erlaubnis lag vor, nur die Notwendigkeit fehlte.
    const consentAt = input.consentGranted && !isBot ? input.at.toISOString() : null;

    const recorded = await supabase
      .rpc("affiliate_record_click", {
        p_tenant_id: input.tenantId,
        p_program_id: program.id,
        p_partner_id: partner.id,
        p_dedup_key: dedupKey,
        p_campaign: campaign,
        p_landing_path: input.landingPath,
        p_referrer_host: referrerHost,
        p_ua_family: uaFamily,
        p_country: readCountry(input.headers),
        p_ip_hash: ipHash,
        p_is_bot: isBot,
        p_consent_at: consentAt,
      })
      .maybeSingle<RecordClickRow>();

    if (recorded.error) {
      // Der Klick ist verloren. Kein Abbruch der Antwort: der Besucher soll
      // trotzdem auf seiner Seite landen. Eine Zuordnung entsteht hier
      // dennoch nicht — eine Referral-Zeile ohne zugehörige Klickzeile wäre
      // eine Provisionsgrundlage ohne Prüfpfad.
      logDbError("Klick aufnehmen", recorded.error);
      return nothing("error", isBot);
    }

    // Tagesobergrenze erreicht (G18): gar nichts geschrieben, nur weiter.
    if (recorded.data?.capped) return nothing("capped", isBot);

    // Bot, Einbettung, Prefetch oder Sperrliste: Klickzeile ja (sie ist der
    // Prüfpfad), Zuordnung nein, Cookie nein (Plan 4.2 Schritt 4).
    if (isBot) return nothing(blockedReferrer ? "blocked-referrer" : "bot", true);

    // --- Schritt 7a: bestehende Zuordnung, `overwrite_policy = 'deny'` --
    const existing = existingQuery?.data ?? null;
    const existingIsUsable =
      existing !== null &&
      existing.status === "active" &&
      existing.program_id === program.id &&
      Date.parse(existing.expires_at) > input.at.getTime();

    const cookieMaxAge = affiliateCookieMaxAge(program.cookie_ttl_days);

    if (existingIsUsable && program.overwrite_policy === "deny") {
      // Keine neue Zeile, kein neues Cookie — aber das bestehende Token reist
      // im `?aff=`-Parameter mit, sonst verlöre der Funnel im
      // einwilligungsfreien Pfad genau die Zuordnung, die hier geschützt
      // werden soll.
      return {
        outcome: "kept-existing",
        token: existingTokenParsed?.success ? existingTokenParsed.data : null,
        cookieTtlDays: null,
        keepCookie: true,
        isBot: false,
      };
    }

    // --- Schritt 7b: neue Zuordnung -------------------------------------
    //
    // `expires_at` kommt aus derselben Funktion wie die Cookie-Laufzeit
    // (`affiliateCookieMaxAge`, cookie.ts) — eine Quelle, damit Serverzeile
    // und Cookie nicht auseinanderlaufen können. Die Funktion beschneidet auf
    // höchstens 365 Tage; der Guard in der Datenbank lässt 366 zu, die
    // Differenz ist der Puffer für Uhrabweichung zwischen Worker und
    // Postgres (`created_at` setzt der Guard selbst auf `now()`).
    const expiresAt = new Date(input.at.getTime() + cookieMaxAge * 1000).toISOString();
    const token = newReferralToken();

    const inserted = await supabase
      .from("affiliate_referrals")
      .insert({
        tenant_id: input.tenantId,
        program_id: program.id,
        partner_id: partner.id,
        // `null`, wenn die Zeile in die Entdopplung lief (Plan 3.6): die
        // Zuordnung entsteht trotzdem. Der Zusammenhang Klick -> Zuordnung
        // ist Prüfpfad, nicht Voraussetzung — sonst verlöre der zweite
        // Besucher hinter demselben Firmen-NAT innerhalb einer Stunde seine
        // Provision.
        click_id: recorded.data?.click_id ?? null,
        token,
        campaign,
        expires_at: expiresAt,
        // `status`, `user_id` und `bound_at` werden bewusst NICHT gesetzt:
        // der Guard (`affiliate_referrals_guard()`) bricht bei jedem von der
        // Vorgabe abweichenden Wert ab, und die Kontobindung entsteht erst in
        // `bindReferral()` (Plan 4.3).
      })
      .select("id")
      .single<{ id: string }>();

    if (inserted.error) {
      logDbError("Zuordnung anlegen", inserted.error);
      return nothing("error");
    }

    // --- Schritt 7b, zweiter Teil: die alte Zuordnung ablösen -----------
    //
    // NACH dem INSERT und nicht davor oder daneben. Wäre die alte Zeile
    // schon abgelöst und der INSERT scheiterte, hätte der Besucher gar keine
    // gültige Zuordnung mehr — der Partnerwechsel kostete dann nicht den
    // ersten Partner seine Provision, sondern beide. Der Preis ist ein
    // vierter Rundlauf in genau diesem Fall.
    if (existingIsUsable && existing) {
      const superseded = await supabase
        .from("affiliate_referrals")
        .update({ status: "superseded" })
        .eq("tenant_id", input.tenantId)
        .eq("id", existing.id)
        .eq("status", "active");
      if (superseded.error) {
        // Nicht abbrechen: die neue Zuordnung steht bereits, und eine alte
        // Zeile, die `active` bleibt, ist kein Schaden — `resolveAttribution()`
        // entscheidet über `attribution_model` nach `created_at`, die neue
        // Zeile ist die jüngere.
        logDbError("Vorherige Zuordnung ablösen", superseded.error);
      }
    }

    return {
      outcome: "attributed",
      token,
      // Ohne Einwilligung kein Cookie (§ 25 TDDDG, Plan 4.2 Schritt 8). Die
      // Route entscheidet das anhand dieses Feldes; `null` heißt: nur
      // `?aff=`.
      cookieTtlDays: input.consentGranted ? program.cookie_ttl_days : null,
      keepCookie: false,
      isBot: false,
    };
  } catch {
    // Fängt alles, was kein PostgREST-Fehlerobjekt ist (Netzabbruch,
    // fehlendes Schlüsselmaterial in `hash.ts`). Ohne Meldungstext, aus
    // demselben Grund wie in `logDbError()`.
    console.error("[affiliate/track] Klickaufnahme mit unerwartetem Fehler abgebrochen.");
    return nothing("error");
  }
}
