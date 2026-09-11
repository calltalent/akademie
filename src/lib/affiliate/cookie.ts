import { TRACKING_COOKIES_ON_CONSENT } from "@/lib/consent/schema";

/**
 * Affiliate-System, Block B3 — die Optionen des Attributions-Cookies an genau
 * EINER Stelle (PLAN_Affiliate-System.md 4.1, 4.2 Schritt 8, G11,
 * Prüfliste 11.8/11.13).
 *
 * Warum eine eigene Datei für fünf Felder: das Cookie wird an mindestens drei
 * Stellen angefasst — der Klick-Endpunkt setzt es, der Widerruf der
 * Einwilligung löscht es (`src/lib/consent/actions.ts`), und ein späterer
 * Block wird es beim Abmelden oder beim Programmwechsel erneuern. Ein Cookie,
 * das an einer Stelle mit `path: "/"` gesetzt und an einer anderen ohne Pfad
 * gelöscht wird, verschwindet nicht; ein Widerruf, nach dem das
 * Attributions-Cookie weiterläuft, ist kein Widerruf. Deshalb eine Quelle.
 *
 * Rein, ohne I/O: hier wird nichts gesetzt und nichts gelesen, es entstehen
 * nur Optionsobjekte. Das Setzen passiert auf der `NextResponse` des
 * Endpunkts (Plan 4.2: kein Eingriff in `src/middleware.ts`).
 */

/**
 * Der Name steht in `TRACKING_COOKIES_ON_CONSENT` (consent/schema.ts) und
 * wird von dort geholt, nicht hier wiederholt. Das ist die Rückverbindung,
 * die der Kommentar in B2 angekündigt hat: die Liste der Träger, die bei
 * Ablehnung und Widerruf verschwinden müssen, ist die maßgebliche Stelle.
 * Ein zweites Literal hier hieße, dass ein künftig umbenanntes Cookie noch
 * gesetzt, aber nicht mehr gelöscht würde — und der Compiler sagte nichts.
 */
export const AFFILIATE_COOKIE_NAME = TRACKING_COOKIES_ON_CONSENT[0];

/**
 * Pfad. „/" ist notwendig, nicht bequem: der Funnel läuft über `/kurs/…`,
 * `/kaufen/…`, `/registrieren` und `/anmelden`, und das Cookie wird auf
 * `/api/aff/k` gesetzt. Mit dem Vorgabepfad des Setzers („/api/aff") käme es
 * auf keiner einzigen dieser Seiten je wieder an. Gelöscht wird mit demselben
 * Pfad, sonst trifft die Löschung ein anderes Cookie als das gesetzte.
 */
export const AFFILIATE_COOKIE_PATH = "/";

/**
 * Harte Grenzen der Laufzeit. Die Obergrenze von 365 Tagen ist dieselbe wie
 * im Schema (`cookieTtlDays: intField("Gültigkeit der Zuordnung", 1, 365)`,
 * schema.ts) und steht hier ein zweites Mal, weil der Wert aus der
 * Programmzeile in der Datenbank kommt: ein Datensatz, der per
 * `service_role` oder aus einer älteren Migration mit 36500 in der Spalte
 * steht, dürfte kein Jahrhundert-Cookie erzeugen. Prüfliste 11.8 verlangt
 * den Check ausdrücklich.
 */
export const AFFILIATE_COOKIE_MIN_TTL_DAYS = 1;
export const AFFILIATE_COOKIE_MAX_TTL_DAYS = 365;

const SECONDS_PER_DAY = 86_400;

/**
 * Die Optionen, die `cookies().set()` bzw. `NextResponse.cookies.set()`
 * annimmt. Eigener Typ statt des `ResponseCookie` aus den Next.js-Interna:
 * der Import zöge ein Framework-Typmodul in eine sonst framework-freie Datei,
 * und die vier festen Felder sind hier als Literaltypen mehr wert — sie
 * machen ein versehentliches `sameSite: "none"` an der Aufrufstelle zu einem
 * Compilerfehler statt zu einem Betriebsbefund.
 */
export type AffiliateCookieOptions = {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: typeof AFFILIATE_COOKIE_PATH;
  maxAge: number;
};

/**
 * Laufzeit in Sekunden aus `affiliate_programs.cookie_ttl_days`, beschnitten
 * auf [1, 365] Tage. Ein unbrauchbarer Wert (`NaN`, negativ, Bruchzahl) fällt
 * auf die UNTERGRENZE, nicht auf einen Mittelwert: bei einer kaputten
 * Einstellung ist die kurze Zuordnung die richtige Richtung — sie kostet im
 * schlimmsten Fall eine späte Provision, die lange hinterlässt dagegen ein
 * Cookie, das der Besucher nicht mehr erwartet.
 */
export function affiliateCookieMaxAge(cookieTtlDays: number): number {
  const days = Number.isFinite(cookieTtlDays)
    ? Math.min(
        Math.max(Math.trunc(cookieTtlDays), AFFILIATE_COOKIE_MIN_TTL_DAYS),
        AFFILIATE_COOKIE_MAX_TTL_DAYS,
      )
    : AFFILIATE_COOKIE_MIN_TTL_DAYS;
  return days * SECONDS_PER_DAY;
}

/**
 * Die vollständigen Optionen. Jede Wahl einzeln begründet:
 *
 * `httpOnly: true` — der Wert ist das Referral-Token, und an ihm hängt Geld.
 * Kein Skript dieser Anwendung liest es (der Endpunkt und die Server-Seiten
 * lesen es serverseitig), also gibt es keinen Grund, es JavaScript zu zeigen.
 * CLAUDE.md §2.13 verlangt es ohnehin für Tokens. Praktischer Effekt: eine
 * eingeschleuste XSS-Last kann das Token nicht auslesen und auch keines
 * setzen — ein fremder Partnercode lässt sich damit nicht unterschieben.
 *
 * `sameSite: "lax"` — die wichtigste und einzige nicht offensichtliche Wahl.
 * Ein Affiliate-Link kommt PER DEFINITION von einer fremden Seite: der
 * Besucher steht auf dem Blog, in der Mail oder im Video-Beschreibungstext
 * des Partners und navigiert von dort auf unseren Host.
 *
 *   - `"strict"` wäre hier falsch. Strict verweigert das Cookie bei jeder
 *     Anfrage, die aus einem fremden Kontext ausgelöst wurde — und das ist
 *     genau diese: die Weiterleitung von `/api/aff/k` auf `/kaufen/<slug>`
 *     und der erste Seitenaufruf danach gehören noch zur fremd angestoßenen
 *     Navigation. Das Cookie würde gesetzt, aber bei der einen Anfrage nicht
 *     mitgeschickt, bei der die Zuordnung an das Konto gebunden wird (4.3).
 *     Die Zuordnung ginge in genau dem Moment verloren, für den sie existiert.
 *   - `"none"` wäre eine Gefahr ohne Gegenwert. Es schickte das Cookie bei
 *     JEDER eingebetteten Drittanfrage mit, also auch an ein `<img>` oder
 *     ein `<iframe>` auf einer fremden Seite — dieselbe Cookie-Stuffing-
 *     Konstellation, die `bot.ts` ausdrücklich abwehrt. Kein Bestandteil
 *     dieses Ablaufs braucht das Cookie in einem Drittkontext.
 *   - `"lax"` ist das, was gebraucht wird: mitgeschickt bei Navigationen
 *     oberster Ebene per GET — der Klick auf einen Link ist genau das —,
 *     nicht bei eingebetteten Anfragen.
 *
 * `secure` nur in Produktion: die Entwicklung läuft über `http://localhost`,
 * ein `Secure`-Cookie käme dort nie an. Gleiches Muster und gleiche
 * Begründung wie `CONSENT_COOKIE_OPTIONS` (consent/actions.ts:47-57) und
 * `NEXT_LOCALE_COOKIE_OPTIONS` (account/actions.ts:139-146).
 *
 * KEIN `domain`-Attribut, also host-only. Ein Cookie auf `.calltalent.ai`
 * gälte für alle Mandanten-Subdomains gleichzeitig — eine Zuordnung, die
 * beim Händler A erworben wurde, wirkte beim Händler B. Das ist derselbe
 * Grund wie bei G11 (relativer Redirect) und bei 4.7 (der Marketplace-Host
 * bekommt dieses Cookie bewusst nicht zu sehen): mandantenübergreifende
 * Attribution darf technisch nicht möglich sein, nicht bloß unterlassen
 * werden.
 *
 * Kein `expires`: `maxAge` ist eine Dauer und damit unabhängig von einer
 * falsch gestellten Uhr auf dem Gerät des Besuchers.
 */
export function affiliateCookieOptions(cookieTtlDays: number): AffiliateCookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: AFFILIATE_COOKIE_PATH,
    maxAge: affiliateCookieMaxAge(cookieTtlDays),
  };
}

/**
 * Löschangaben. Muss denselben Namen UND denselben Pfad tragen wie beim
 * Setzen, sonst legt der Browser ein zweites, leeres Cookie an und behält das
 * alte. Siehe den entsprechenden Kommentar in `consent/actions.ts:221-226`.
 */
export const AFFILIATE_COOKIE_DELETE_OPTIONS = {
  name: AFFILIATE_COOKIE_NAME,
  path: AFFILIATE_COOKIE_PATH,
} as const;
