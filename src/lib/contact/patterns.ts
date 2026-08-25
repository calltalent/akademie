/**
 * Gemeinsame Bausteine des Kontaktformular-Bot-Schutzes, die BEIDE Seiten
 * brauchen: die Feldnamen der beiden versteckten Felder (Client-Formular +
 * Server Action) und die Link-/Markup-Erkennung (schema.ts läuft in beiden
 * Umgebungen). Bewusst getrennt von `spam.ts` — die dortige
 * Phrasen-/Punkteliste ist die eigentliche Heuristik und soll nicht im
 * Client-Bundle landen, wo ein Spammer sie auslesen und gezielt umgehen
 * könnte.
 *
 * Hintergrund und Anlass: siehe Kopf von `spam.ts`.
 */

/** Name des versteckten Honeypot-Felds. Menschen sehen/füllen es nie. */
export const CONTACT_HONEYPOT_FIELD = "website";

/** Name des Felds mit dem signierten Zeitstempel (siehe form-token.ts). */
export const CONTACT_TOKEN_FIELD = "formToken";

/** Schneller als das kann ein Mensch fünf Felder nicht ausfüllen. */
export const CONTACT_MIN_FILL_SECONDS = 3;

/** Danach gilt ein Formular als veraltet (Seite neu laden). */
export const CONTACT_MAX_FORM_AGE_SECONDS = 3 * 60 * 60;

/**
 * E-Mail-Adressen zuerst entfernen: `name@firma.de` enthält sonst mit
 * `firma.de` einen scheinbaren Link, obwohl eine zweite Kontaktadresse in
 * der Nachricht völlig legitim ist.
 */
const EMAIL_PATTERN = /[^\s@<>()[\]]+@[^\s@<>()[\]]+\.[a-z]{2,}/gi;

/**
 * Zwei Varianten: explizites Schema/`www.` (immer ein Link) und blanke
 * Domains mit den TLDs, die in Formular-Spam praktisch ausschließlich
 * vorkommen (inkl. `.app` — genau die Domain aus dem Vorfall).
 */
const URL_PATTERN =
  /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.(?:com|net|org|info|biz|io|co|ru|cn|xyz|top|club|online|site|shop|store|link|click|app|dev|de|at|ch|uk|eu)\b(?:\/\S*)?/gi;

/** HTML-Tags und BBCode — in einem Namensfeld oder Fließtext nie legitim. */
const MARKUP_PATTERN = /<[a-z/][^>]*>|\[\/?(?:url|link|img|b|i|u)\b[^\]]*\]/i;

/** Zählt Links in einem Text, E-Mail-Adressen ausgenommen. */
export function countLinks(text: string): number {
  const withoutEmails = text.replace(EMAIL_PATTERN, " ");
  return withoutEmails.match(URL_PATTERN)?.length ?? 0;
}

/** Enthält der Wert einen Link? (für Namensfelder: hartes Ausschlusskriterium) */
export function containsLink(value: string): boolean {
  return countLinks(value) > 0;
}

export function containsMarkup(value: string): boolean {
  return MARKUP_PATTERN.test(value);
}
