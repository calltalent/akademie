import "server-only";
import { getServerEnv } from "@/lib/env";

/**
 * Affiliate-System, Block B3 — IP-Hash mit Tagessalz und der Dedup-Schlüssel
 * der Klicktabelle (PLAN_Affiliate-System.md 3.6, 4.2 Schritt 6,
 * Prüfliste 11.2/11.6).
 *
 * ## Die Roh-IP wird nirgends gespeichert
 *
 * `affiliate_clicks` hat keine IP-Spalte, sondern `ip_hash`. Der Klick-
 * Endpunkt ist öffentlich und wird von jedem Partnerlink getroffen; eine
 * Tabelle mit IP-Adressen aller Besucher aller Mandanten wäre ein
 * Personendatenbestand, für den es keinen Zweck gibt. Gebraucht wird nur
 * zweierlei: „war das derselbe Absender wie vor fünf Minuten?" (Dedup) und
 * „kommen auffällig viele Klicks aus derselben Quelle?" (Betrugsheuristik).
 * Beides beantwortet ein Hash.
 *
 * ## Woher das Salz kommt — und warum es geheim sein MUSS
 *
 * Der IPv4-Raum hat 2^32 Adressen. Wer das Salz kennt, rechnet ihn in
 * Sekunden durch und hat aus jedem `ip_hash` die Klartext-IP zurück. Ein
 * Hash ohne geheimes Salz ist bei diesem Wertebereich also keine
 * Pseudonymisierung, sondern eine Kodierung. Das Salz besteht deshalb aus
 * zwei Teilen mit zwei verschiedenen Aufgaben:
 *
 *   1. `SUPABASE_SERVICE_ROLE_KEY` — der geheime Teil. Er liegt
 *      ausschließlich in der Worker-Umgebung, erreicht nie ein Client-Bundle
 *      (CLAUDE.md §2.2, abgesichert durch das `import "server-only"` oben)
 *      und ist aus dem HMAC nicht rekonstruierbar. Er wird über ein festes
 *      Domänenpräfix abgeleitet, damit derselbe Schlüssel für Klick-Hash,
 *      Zustimmungsnachweis (`src/lib/consent/actions.ts:77-90`) und
 *      Formular-Token (`src/lib/contact/form-token.ts:33-44`) drei
 *      verschiedene, nicht gegeneinander austauschbare Schlüssel ergibt.
 *      Bewusst KEIN neues Secret: jedes zusätzliche Secret ist eines, das
 *      beim nächsten Umzug vergessen wird — und ein vergessenes Salz ändert
 *      hier still jeden Hash.
 *   2. Das UTC-Datum `JJJJMMTT` — der NICHT geheime Teil. Es ist kein
 *      Schutz, sondern Rotation: nach Mitternacht UTC ergibt dieselbe IP
 *      einen anderen Hash, und die Zeilen der Vortage lassen sich selbst mit
 *      dem Schlüssel nicht mehr über Tage hinweg zu einem Bewegungsprofil
 *      verketten. Der Preis ist, dass Dedup und Heuristik am Tageswechsel
 *      neu beginnen — der Dedup-Zeitraum ist ohnehin nur eine Stunde
 *      (Plan 3.6), also kostet das nichts.
 *
 * Das ist der Unterschied zum Zustimmungsnachweis: dort ist das Salz
 * absichtlich STATISCH, weil ein Nachweis nach Art. 7 Abs. 1 DSGVO, der nach
 * 24 Stunden nicht mehr überprüfbar ist, keiner ist (Plan 11.6). Hier ist das
 * Gegenteil richtig.
 *
 * ## Web Crypto, kein `node:crypto`
 *
 * `crypto.subtle` ist der einzige gangbare Weg. `node:crypto` hat den Build
 * dieses Projekts schon einmal gebrochen: der Webpack-Fallback von
 * `npm run build` (nötig wegen des Turbopack-SSR-Chunk-Bugs mit
 * `@opennextjs/cloudflare`) bricht beim Bündeln von `node:crypto` hart ab
 * („UnhandledSchemeError"), siehe den Kopfkommentar von
 * `src/lib/webhooks/events.ts`. Cloudflare Workers stellen Web Crypto als
 * Standard bereit, Node ab 20 ebenfalls — die Tests dieser Datei laufen
 * deshalb per Docblock in der node-Umgebung statt in jsdom.
 *
 * Kein `Date.now()` in dieser Datei: jeder Zeitpunkt wird hereingereicht,
 * wie im Rechenkern (`compute.ts`). Ein Hash, den man nur mit der Systemuhr
 * nachrechnen kann, ist im Streitfall nicht nachrechenbar.
 */

/** Domänenpräfix des Klick-Hashes — trennt ihn von jeder anderen Verwendung des Schlüssels. */
const IP_HASH_DOMAIN = "calltalent:affiliate-ip";

/** Domänenpräfix des Dedup-Schlüssels. */
const DEDUP_DOMAIN = "calltalent:affiliate-click-dedup";

/**
 * Steht der Dedup-Schlüssel für einen Klick ohne IP. Folge: alle Klicks
 * desselben Partners mit derselben UA-Klasse in derselben Stunde fallen dann
 * auf EINE Zeile zusammen (`on conflict do nothing`).
 *
 * Das ist die bewusst gewählte Richtung. Ohne IP lässt sich ein wiederholter
 * Abruf von einem echten zweiten Besucher nicht unterscheiden, und eine
 * Klickzahl, die zu hoch ist, ist schlimmer als eine, die zu niedrig ist:
 * `affiliate_clicks` ist Prüfpfad, nicht Statistikquelle (Plan 3.6), und an
 * der Klickzeile hängt kein Geld — die Referral-Zeile entsteht in Schritt 7
 * unabhängig davon, ob der Klick-Insert in einen Konflikt lief.
 */
const NO_IP_MARKER = "no-ip";

let cached: { day: string; key: CryptoKey } | null = null;

/** Hex-Darstellung eines Signatur-/Digest-Ergebnisses. */
function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * UTC-Datum als `JJJJMMTT`. Ausdrücklich UTC und nicht Ortszeit: Worker
 * laufen in wechselnden Regionen, und ein Salz, das je nach ausführender
 * Region rotiert, macht denselben Klick zu zwei verschiedenen Zeilen.
 */
export function utcDayStamp(at: Date): string {
  return at.toISOString().slice(0, 10).replace(/-/g, "");
}

/** UTC-Stunde als `JJJJMMTTHH` — das Dedup-Fenster aus Plan 3.6. */
export function utcHourStamp(at: Date): string {
  const iso = at.toISOString();
  return `${iso.slice(0, 10).replace(/-/g, "")}${iso.slice(11, 13)}`;
}

/**
 * Der Tagesschlüssel, zwischengespeichert. Der Cache hängt am Datum: läuft
 * ein Worker über Mitternacht durch, wird der Schlüssel neu abgeleitet statt
 * still der von gestern weiterbenutzt.
 */
async function ipHashKey(day: string): Promise<CryptoKey> {
  if (cached?.day === day) return cached.key;
  const secret = new TextEncoder().encode(
    `${IP_HASH_DOMAIN}:${day}:${getServerEnv().SUPABASE_SERVICE_ROLE_KEY}`,
  );
  const key = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  cached = { day, key };
  return key;
}

/**
 * Bringt eine IP aus einem Kopf in eine Form, die zweimal gleich aussieht.
 *
 * Ohne das wäre der Dedup löchrig: `cf-connecting-ip` und der erste Eintrag
 * aus `x-forwarded-for` schreiben dieselbe Adresse unterschiedlich —
 * IPv6-Hexziffern mal groß, mal klein, und eine IPv4-Adresse über eine
 * IPv6-Strecke als `::ffff:203.0.113.7`. Drei Schreibweisen derselben
 * Adresse ergäben drei Hashes und damit drei Klickzeilen.
 *
 * Bewusst keine weitergehende Kanonisierung von IPv6 (Nullgruppen-Kürzung):
 * sie wäre eine eigene, fehleranfällige Implementierung für einen Gewinn, den
 * niemand messen kann — die Adresse kommt in dieser Umgebung immer aus
 * derselben Quelle und damit in derselben Form.
 */
export function normalizeIp(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) return null;
  // IPv4-mapped IPv6 auf die IPv4-Form zurückführen.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(trimmed);
  return mapped ? mapped[1] : trimmed;
}

/**
 * HMAC-SHA-256 der IP mit dem Tagessalz, als Hex. Gibt `null` zurück, wenn
 * keine IP vorliegt — `affiliate_clicks.ip_hash` ist nullable, und ein Hash
 * über einen leeren String wäre ein konstanter Wert, der wie eine echte
 * Adresse aussähe und alle IP-losen Klicks zu einem Absender verschmölze.
 */
export async function hashClickIp(ip: string | null | undefined, at: Date): Promise<string | null> {
  const normalized = normalizeIp(ip);
  if (normalized === null) return null;
  const signature = await crypto.subtle.sign(
    "HMAC",
    await ipHashKey(utcDayStamp(at)),
    new TextEncoder().encode(normalized),
  );
  return toHex(signature);
}

/** Eingabe des Dedup-Schlüssels, Plan 3.6: `sha256(partner|ip_hash|ua_family|JJJJMMTTHH)`. */
export type ClickDedupInput = {
  partnerId: string;
  /** Ergebnis von `hashClickIp()`; `null`, wenn keine IP vorlag. */
  ipHash: string | null;
  /** Ergebnis von `classifyUserAgent()` (bot.ts). */
  uaFamily: string;
  at: Date;
};

/**
 * Der Wert für `affiliate_clicks.dedup_key`. Die Deduplizierung ist damit ein
 * Constraint (`unique (tenant_id, dedup_key)` plus `on conflict do nothing`)
 * und keine Abfrage — ein Statement statt Vorab-SELECT und Wettlauf.
 *
 * SHA-256 und kein HMAC: hier ist nichts zu schützen. Der Schlüssel enthält
 * bereits den geheim gesalzenen `ip_hash`; die übrigen Bestandteile sind eine
 * Partner-UUID, eine UA-Klasse aus einer Liste von neun Werten und eine
 * Stunde. Ein zweiter geheimer Schlüssel darüber schützte nichts und machte
 * die Zeile nur bei einer Schlüsselrotation unerklärlich.
 *
 * Die Trennzeichen sind „|", die Bestandteile sind Hex, UUID, eine Klasse aus
 * einer festen Liste und eine Ziffernfolge — keiner davon kann ein „|"
 * enthalten, also kann kein Wert in den nächsten überlaufen.
 */
export async function buildClickDedupKey(input: ClickDedupInput): Promise<string> {
  const parts = [
    DEDUP_DOMAIN,
    input.partnerId,
    input.ipHash ?? NO_IP_MARKER,
    input.uaFamily,
    utcHourStamp(input.at),
  ];
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts.join("|")));
  return toHex(digest);
}
