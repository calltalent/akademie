/**
 * Affiliate-System, Block B3 — Bot- und Einbettungsfilter des Klick-Endpunkts
 * (PLAN_Affiliate-System.md 4.2 Schritt 4, 3.6, Prüfliste 11.7).
 *
 * Das Ziel ist ausdrücklich NICHT Vollständigkeit. Eine vollständige
 * Bot-Erkennung gibt es nicht, und jeder Versuch in diese Richtung kostet
 * irgendwann einen echten Besucher seine Zuordnung. Der Zweck ist enger und
 * erreichbar: ein Abruf, der gar keine Seitennavigation eines Menschen ist,
 * darf keine Provisionszuordnung auslösen. Solche Abrufe sind der Alltag —
 * jede Link-Vorschau in WhatsApp, Slack, Signal oder Teams holt die URL ab,
 * jeder Mail-Scanner eines Unternehmenspostfachs öffnet enthaltene Links, und
 * jeder Prefetch eines Browsers oder Suchvorschlags lädt das Ziel auf Verdacht.
 *
 * Was ohne diesen Filter passiert, ist kein theoretischer Schaden:
 *
 *   - Ein Partner postet seinen Link in eine große Gruppe. Die Vorschau
 *     erzeugt einen Klick, das Cookie liegt im Scanner, nicht im Browser des
 *     Interessenten — die Klickzahl steigt, die Umsatzquote fällt, und der
 *     Partner hält die Statistik für kaputt.
 *   - Cookie-Stuffing: eine fremde Seite bindet den Partnerlink als
 *     `<img src="…/api/aff/k?c=…">` oder als verstecktes `<iframe>` ein und
 *     setzt damit jedem ihrer Besucher das Attributions-Cookie, ohne dass
 *     dieser je auf etwas geklickt hätte. Der Request kommt dabei mit einem
 *     echten Browser-User-Agent und ist über die UA-Liste NICHT zu erkennen —
 *     er verrät sich ausschließlich darüber, dass er keine Dokument-
 *     Navigation ist. Genau dafür sind die Prüfungen (b) und (c) da, und
 *     deshalb sind sie nicht optional.
 *
 * Ein Treffer verhindert nicht den Klickeintrag: die Zeile wird mit
 * `is_bot = true` geschrieben (sie ist der Prüfpfad und die Betrugsbasis),
 * aber es entsteht keine Referral-Zeile und kein Cookie (Plan 4.2 Schritt 4).
 *
 * Rein und ohne I/O. `Headers` ist Web-Standard und in Cloudflare Workers wie
 * in Node vorhanden; `readClickSignals()` liest nur, es findet kein Zugriff
 * auf `next/headers` statt — damit bleibt die Datei ohne Mock testbar.
 */

/**
 * Die UA-Liste aus Plan 4.2 Schritt 4a, wörtlich und in dieser Reihenfolge.
 * Bewusst Teilzeichenketten und keine exakten Namen: „bot" trifft Googlebot,
 * Bingbot, Twitterbot, Discordbot und tausend selbstgebaute; eine Liste
 * konkreter Produktnamen wäre am Tag ihrer Fertigstellung veraltet.
 *
 * `preview` und `monitor` sind die beiden, die den eigentlichen Fall treffen:
 * Link-Vorschau und Uptime-Prüfung.
 */
export const BOT_USER_AGENT_PATTERN =
  /bot|crawl|spider|preview|monitor|headless|curl|wget|python-requests|facebookexternalhit|slackbot/i;

/**
 * Prefetch-Marker. NICHT im Plan, hier ergänzt (11.09.2026): Chrome
 * (`Sec-Purpose: prefetch`), Firefox (`X-Moz: prefetch`) und ältere Fassungen
 * (`Purpose: prefetch`) laden Links auf Verdacht vor, und zwar mit
 * `Sec-Fetch-Dest: document` und `Sec-Fetch-Mode: navigate` — die drei
 * Prüfungen des Plans erkennen sie deshalb nicht. Ein vorgeladener Link, den
 * der Nutzer nie öffnet, ist aber genau der Abruf, den dieser Filter
 * fernhalten soll. Die Ergänzung läuft ALS LETZTE Prüfung, damit die drei
 * Prüfungen des Plans unverändert entscheiden, was sie entscheiden.
 */
export const PREFETCH_MARKER_PATTERN = /prefetch|prerender|preview/i;

/**
 * Die Kopfzeilen, aus denen entschieden wird. Ein eigener, flacher Typ statt
 * `Request`/`Headers`, damit jeder Fall in einem Test als Objektliteral
 * dasteht und lesbar bleibt; `readClickSignals()` ist die Brücke zur Route.
 */
export type ClickRequestSignals = {
  userAgent: string | null;
  accept: string | null;
  secFetchDest: string | null;
  secFetchMode: string | null;
  /** `Sec-Purpose`, ersatzweise `Purpose` oder `X-Moz`. */
  secPurpose: string | null;
};

/** Warum ein Abruf nicht als menschliche Navigation gilt. */
export const CLICK_BOT_REASONS = [
  /** Gar kein User-Agent — kein Browser lässt ihn weg. */
  "missing_user_agent",
  /** Plan 4.2 Schritt 4a. */
  "user_agent",
  /** Plan 4.2 Schritt 4b: kein `text/html` im `Accept` — also kein Dokumentabruf. */
  "accept",
  /** Plan 4.2 Schritt 4c: Fetch-Metadata sagt „kein Dokument" oder „keine Navigation". */
  "fetch_metadata",
  /** Ergänzung: der Browser lädt den Link nur auf Verdacht vor. */
  "prefetch",
] as const;
export type ClickBotReason = (typeof CLICK_BOT_REASONS)[number];

export type ClickBotVerdict =
  | { isBot: false; reason: null }
  | { isBot: true; reason: ClickBotReason };

const HUMAN: ClickBotVerdict = Object.freeze({ isBot: false, reason: null });

function flag(reason: ClickBotReason): ClickBotVerdict {
  return { isBot: true, reason };
}

/** Leerer oder nur aus Leerzeichen bestehender Kopf zählt als „nicht gesetzt". */
function value(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Entscheidet, ob dieser Abruf eine Provisionszuordnung auslösen darf.
 *
 * Reihenfolge wie im Plan (a, b, c), die Prefetch-Ergänzung dahinter. Sie
 * ändert am Ergebnis nichts — jede Prüfung setzt dasselbe `isBot: true` —,
 * sondern nur daran, welcher Grund in `affiliate_clicks` landet und damit
 * später erklärbar macht, warum eine Klickzahl von der Zuordnungszahl
 * abweicht.
 */
export function detectClickBot(signals: ClickRequestSignals): ClickBotVerdict {
  const userAgent = value(signals.userAgent);
  if (userAgent === null) return flag("missing_user_agent");
  if (BOT_USER_AGENT_PATTERN.test(userAgent)) return flag("user_agent");

  // (b) Ein Dokumentabruf verlangt immer `text/html`. Ein `<img>` schickt
  // `image/…,*/*`, ein `fetch()` ohne eigenen Kopf `*/*`, curl ebenfalls
  // `*/*` — keiner davon enthält `text/html`. Ein fehlender `Accept` zählt
  // wie „enthält kein text/html": kein Browser navigiert ohne ihn.
  const accept = value(signals.accept);
  if (accept === null || !accept.toLowerCase().includes("text/html")) {
    return flag("accept");
  }

  // (c) Fetch-Metadata. Beide Köpfe sind optional (ältere Browser schicken
  // sie nicht), deshalb wird nur ein GESETZTER Wert bewertet — ein fehlender
  // Kopf darf einem echten Besucher nicht die Zuordnung kosten. Ist er
  // gesetzt, ist er verlässlich: er wird vom Browser vergeben, nicht von der
  // einbettenden Seite, und lässt sich aus JavaScript nicht setzen.
  const dest = value(signals.secFetchDest)?.toLowerCase() ?? null;
  if (dest !== null && dest !== "document") return flag("fetch_metadata");
  const mode = value(signals.secFetchMode)?.toLowerCase() ?? null;
  if (mode !== null && mode !== "navigate") return flag("fetch_metadata");

  const purpose = value(signals.secPurpose);
  if (purpose !== null && PREFETCH_MARKER_PATTERN.test(purpose)) return flag("prefetch");

  return HUMAN;
}

/**
 * Liest die fünf Werte aus den Kopfzeilen eines Requests. Die drei
 * Prefetch-Schreibweisen werden hier zu einem Wert zusammengezogen, damit
 * `detectClickBot()` nur eine Regel kennt.
 */
export function readClickSignals(headers: Headers): ClickRequestSignals {
  return {
    userAgent: headers.get("user-agent"),
    accept: headers.get("accept"),
    secFetchDest: headers.get("sec-fetch-dest"),
    secFetchMode: headers.get("sec-fetch-mode"),
    secPurpose: headers.get("sec-purpose") ?? headers.get("purpose") ?? headers.get("x-moz"),
  };
}

/**
 * Grobe Klasse des User-Agents für `affiliate_clicks.ua_family` (Plan 3.6:
 * „grobe Klasse, nie der volle User-Agent") und als Bestandteil des
 * Dedup-Schlüssels (`hash.ts`).
 *
 * Der vollständige User-Agent wird NIRGENDS gespeichert. Er ist zusammen mit
 * der IP ein brauchbarer Geräte-Fingerabdruck; eine Klasse aus einer festen,
 * kurzen Liste ist es nicht. Bewusst ohne Version und ohne Betriebssystem —
 * beides erhöht nur die Unterscheidbarkeit und wird für nichts gebraucht.
 *
 * Die Reihenfolge der Prüfungen ist nicht beliebig: jeder Chromium-Browser
 * trägt „Safari" im UA, Edge zusätzlich „Chrome", Opera und Samsung ebenfalls.
 * Vom Speziellen zum Allgemeinen, sonst heißt alles „safari".
 */
export function classifyUserAgent(raw: string | null | undefined): string {
  const ua = value(raw);
  if (ua === null) return "none";
  if (BOT_USER_AGENT_PATTERN.test(ua)) return "bot";
  if (/edg(?:e|a|ios)?\//i.test(ua)) return "edge";
  if (/opr\/|opera/i.test(ua)) return "opera";
  if (/samsungbrowser/i.test(ua)) return "samsung";
  if (/firefox\/|fxios\//i.test(ua)) return "firefox";
  if (/chrome\/|crios\//i.test(ua)) return "chrome";
  if (/safari\//i.test(ua)) return "safari";
  return "other";
}
