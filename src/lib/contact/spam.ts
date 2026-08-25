import "server-only";
import { containsLink, containsMarkup, countLinks } from "@/lib/contact/patterns";

/**
 * Inhaltliche Spam-Bewertung für das öffentliche Kontaktformular (/kontakt).
 *
 * Anlass (25.08.2026, Josips Fund): über das Formular ging eine typische
 * "SEO-/Webmaster"-Spam-Anfrage ein — Vorname "Dear http://<host>/<pfad>",
 * Nachname "Administrator Gee", Nachricht "To the <host> Webmaster ...".
 * Die `rate_limits`-Tabelle belegt das Muster: vier Kontakt-Absendungen
 * seit dem 10.08.2026 von vier verschiedenen IPs, jede mit `count = 1` —
 * das bestehende IP-Rate-Limit (5 pro 5 Minuten) kann so einen verteilten
 * Bot per Definition nicht fassen. CLAUDE.md §2.7 verlangt für besonders
 * exponierte Formulare zusätzlich CAPTCHA/Honeypot.
 *
 * `server-only`, damit die Phrasenliste nicht im Client-Bundle landet — die
 * Regeln sollen nicht öffentlich nachlesbar sein. Die Funktionen bleiben
 * trotzdem rein (keine Requests, kein DB-Zugriff) und sind darüber
 * vollständig unit-testbar (spam.test.ts, `server-only` ist unter Vitest
 * auf ein leeres Stub-Modul aliasiert).
 */

/** Ab diesem Punktwert wird die Anfrage nicht zugestellt. */
export const CONTACT_SPAM_THRESHOLD = 6;

export type SpamReason =
  | "link-in-name"
  | "markup-in-name"
  | "markup-in-message"
  | "links-in-message"
  | "spam-phrases"
  | "generic-recipient";

export type SpamVerdict = {
  score: number;
  reasons: SpamReason[];
  blocked: boolean;
};

/**
 * Anrede an eine Rolle statt an einen Menschen ("Dear Webmaster", "To the
 * <domain> Administrator") — das Erkennungsmerkmal automatisierter
 * Massen-Kontaktanfragen schlechthin.
 */
const GENERIC_RECIPIENT_PATTERNS = [
  /\b(?:dear|hi|hello|greetings)\s+(?:sir|madam|owner|admin|administrator|webmaster|team)\b/i,
  /\bto\s+the\b[\s\S]{0,80}?\b(?:administrator|webmaster|owner)\b/i,
];

/**
 * Werbe-/SEO-Vokabular. Bewusst nur Punktabzug (+2 je Treffer), kein
 * Sofort-Block: ein einzelner Treffer darf eine echte Anfrage nicht
 * verwerfen.
 */
const SPAM_PHRASES = [
  "backlink",
  "back link",
  "guest post",
  "link building",
  "link exchange",
  "search engine ranking",
  "rank higher",
  "first page of google",
  "increase your traffic",
  "web design service",
  "seo service",
  "seo audit",
  "digital marketing service",
  "affiliate program",
  "make money online",
  "crypto investment",
  "bitcoin",
  "forex",
  "casino",
  "viagra",
  "cialis",
  "escort",
  "unsubscribe from this list",
  "no obligation quote",
  "click the link below",
];

/**
 * Bewertet eine Kontaktanfrage. `blocked` heißt: nicht zustellen. Der
 * Aufrufer entscheidet anhand von `reasons`, ob der Absender eine
 * korrigierbare Fehlermeldung sieht (Mensch mit Link in der Nachricht) oder
 * nicht.
 */
export function classifyContactSubmission(input: {
  firstName: string;
  lastName: string;
  subject: string;
  message: string;
}): SpamVerdict {
  const reasons: SpamReason[] = [];
  let score = 0;

  const name = `${input.firstName} ${input.lastName}`;
  if (containsLink(name) || name.includes("@")) {
    score += 6;
    reasons.push("link-in-name");
  }
  if (containsMarkup(name)) {
    score += 6;
    reasons.push("markup-in-name");
  }

  const haystack = `${input.subject}\n${input.message}`;

  if (containsMarkup(input.message)) {
    score += 5;
    reasons.push("markup-in-message");
  }

  const links = countLinks(input.message);
  // Drei Links reichen allein zum Blocken (Schwellwert 6): eine echte
  // Anfrage braucht sie praktisch nie, und wer sie doch braucht, bekommt
  // eine korrigierbare Fehlermeldung samt Support-Adresse (actions.ts).
  if (links >= 3) {
    score += 6;
    reasons.push("links-in-message");
  } else if (links === 2) {
    score += 3;
    reasons.push("links-in-message");
  } else if (links === 1) {
    score += 1;
    reasons.push("links-in-message");
  }

  if (GENERIC_RECIPIENT_PATTERNS.some((pattern) => pattern.test(haystack))) {
    score += 4;
    reasons.push("generic-recipient");
  }

  const lower = haystack.toLowerCase();
  const phraseHits = SPAM_PHRASES.filter((phrase) => lower.includes(phrase)).length;
  if (phraseHits > 0) {
    // Deckelung bei +6: eine lange Werbemail soll nicht beliebig hoch
    // punkten, der Schwellwert ist ohnehin erreicht.
    score += Math.min(phraseHits * 2, 6);
    reasons.push("spam-phrases");
  }

  return { score, reasons, blocked: score >= CONTACT_SPAM_THRESHOLD };
}
