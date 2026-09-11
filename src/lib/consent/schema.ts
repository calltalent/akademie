import { z } from "zod";

/**
 * Affiliate-Modul, Block B2 "Einwilligung" (PLAN_Affiliate-System.md
 * Abschnitt 10/B2, 10.09.2026). Schemata und Konstanten der
 * Tracking-Einwilligung.
 *
 * Warum eine eigene Datei neben `actions.ts`: eine Datei mit `"use server"`
 * darf laut Next.js ausschließlich async Server Actions exportieren, kein
 * zod-Schema und keine Konstante als Laufzeitwert. Genau dieselbe Trennung
 * gibt es bereits bei `src/lib/settings/{schema,actions}.ts` und
 * `src/lib/marketplace/{schema,actions}.ts`. `read.ts` und `actions.ts`
 * teilen sich damit denselben Cookie-Namen und dasselbe Nutzlast-Schema —
 * zwei Kopien wären genau die Art Abweichung, die man erst bemerkt, wenn eine
 * Einwilligung ins Leere läuft.
 *
 * Gegenstand ist genau eine Kategorie: das Attributions-Cookie `ct_aff` des
 * Partnerprogramms (Plan 4.1). Kein allgemeines Cookie-Banner, keine
 * Marketing-/Statistik-Kategorien — die gibt es in diesem Produkt nicht, und
 * eine leere Kategorie anzubieten wäre irreführend.
 */

/**
 * `affiliate` ist bewusst die einzige Kategorie und spiegelt die
 * check-Bedingung von `tracking_consents.category` (Migration
 * 20260910120100). Eine zweite Kategorie braucht denselben Schritt in beiden
 * Dateien — deshalb steht sie hier als Enum und nicht als freier String.
 */
export const consentCategorySchema = z.enum(["affiliate"]);
export type ConsentCategory = z.infer<typeof consentCategorySchema>;

/**
 * Drei Entscheidungen, wortgleich mit `tracking_consents.decision`:
 * `granted` = zugestimmt, `denied` = abgelehnt (aktive Entscheidung gegen das
 * Cookie), `withdrawn` = eine frühere Zustimmung widerrufen. `denied` und
 * `withdrawn` wirken technisch gleich; sie bleiben getrennt, weil Art. 7
 * Abs. 3 DSGVO den Widerruf als eigenen Vorgang kennt und ein Nachweis, der
 * beides vermischt, die Frage „gab es je eine Einwilligung?" nicht mehr
 * beantworten kann.
 */
export const consentDecisionSchema = z.enum(["granted", "denied", "withdrawn"]);
export type ConsentDecision = z.infer<typeof consentDecisionSchema>;

/** Wortgleich mit `tracking_consents.subject_kind`. */
export const consentSubjectKindSchema = z.enum(["anon", "user"]);
export type ConsentSubjectKind = z.infer<typeof consentSubjectKindSchema>;

/**
 * Opake Consent-ID: 16 Zufallsbytes als Hex. Sie ist der `subject_key` einer
 * anonymen Einwilligung und verbindet spätere Zeilen desselben Besuchers zu
 * einer Kette (Zustimmung → Widerruf), ohne irgendetwas über ihn auszusagen.
 * Bewusst keine UUID: eine UUID sieht aus wie ein Fremdschlüssel auf ein
 * Konto und lädt genau zu der Verknüpfung ein, die hier nicht stattfinden
 * soll.
 */
export const consentIdSchema = z.string().regex(/^[0-9a-f]{32}$/);

/** Name des Einwilligungs-Cookies (Plan 11.13). */
export const TRACKING_CONSENT_COOKIE = "ct_consent";

/**
 * Sechs Monate. Danach wird die Frage erneut gestellt — eine Einwilligung,
 * die Jahre später noch wirkt, ist keine informierte mehr. Die Obergrenze
 * ist bewusst kürzer als die 365 Tage des Sprach-Cookies
 * (`NEXT_LOCALE_COOKIE_OPTIONS`, src/lib/account/actions.ts:139-146), das
 * keine Rechtsfolge trägt.
 */
export const TRACKING_CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 182;

/**
 * Cookies, die beim Ablehnen oder Widerruf verschwinden müssen. Ein Widerruf,
 * nach dem das Attributions-Cookie weiterläuft, ist kein Widerruf.
 *
 * `ct_aff` steht hier als Literal, obwohl es zu Block B3 gehört: die dortige
 * `src/lib/affiliate/cookie.ts` existiert noch nicht (B2 läuft vor B3, Plan
 * 10.1). Beim Bau von B3 zeigt der Cookie-Name dort auf DIESE Liste zurück,
 * damit es genau eine Stelle gibt, an der ein neuer Träger eingetragen wird.
 */
export const TRACKING_COOKIES_ON_CONSENT = ["ct_aff"] as const;

/**
 * Nutzlast des `ct_consent`-Cookies. Kurze Schlüssel, weil das Cookie bei
 * jedem Request derselben Domain mitgeschickt wird (auch für statische
 * Dateien) und das Performance-Budget dieses Projekts eng ist
 * (CLAUDE.md §3.3):
 *
 *   v   Formatversion dieser Nutzlast (nicht die Version der Rechtstexte)
 *   cid opake Consent-ID, siehe `consentIdSchema`
 *   pol Stand der Rechtstexte bei der Entscheidung (LEGAL_LAST_UPDATED)
 *   at  Zeitpunkt der Entscheidung, ISO-8601
 *   dec Entscheidung je Kategorie
 *
 * `dec.affiliate` ist optional: ein Cookie ohne Eintrag für eine Kategorie
 * bedeutet „noch nicht entschieden", nicht „zugestimmt". Damit bleibt eine
 * später hinzukommende Kategorie abwärtskompatibel lesbar, statt ein altes
 * Cookie ungültig zu machen und alle Besucher erneut zu fragen.
 *
 * Unbekannte Zusatzfelder werden von zod stillschweigend verworfen (kein
 * `.strict()`): ein neueres Format soll auf einer älteren Instanz nicht die
 * ganze Einwilligung wertlos machen. Die Formatversion `v` fängt echte
 * Bedeutungsänderungen ab.
 */
export const consentCookieSchema = z.object({
  v: z.literal(1),
  cid: consentIdSchema,
  pol: z.string().trim().min(1).max(40),
  at: z.string().datetime(),
  dec: z.object({ affiliate: consentDecisionSchema.optional() }),
});
export type ConsentCookiePayload = z.infer<typeof consentCookieSchema>;

/** Aktuelle Formatversion, beim Schreiben verwendet. */
export const CONSENT_COOKIE_VERSION = 1 as const;

/**
 * Eingabe der Server Action `setTrackingConsent()` (CLAUDE.md §2.3: jede
 * Eingabe mit zod, auch die aus dem eigenen Dialog — eine Server Action ist
 * ein öffentlich aufrufbarer Endpunkt, kein Funktionsaufruf).
 *
 * Alle drei Entscheidungen laufen über DIESELBE Action: Ablehnen und
 * Widerrufen dürfen nicht mehr Schritte kosten als Zustimmen (Art. 7 Abs. 3
 * DSGVO). Es gibt bewusst keinen Vorgabewert für `decision` — ein
 * voreingestelltes „granted" wäre genau die Vorauswahl, die eine Einwilligung
 * unwirksam macht.
 */
export const setTrackingConsentInputSchema = z.object({
  decision: consentDecisionSchema,
  category: consentCategorySchema.default("affiliate"),
});
export type SetTrackingConsentInput = z.infer<typeof setTrackingConsentInputSchema>;

/**
 * Rückgabe von `setTrackingConsent()`. Steht hier und nicht in `actions.ts`,
 * weil eine `"use server"`-Datei keinen Typ exportieren soll, den ein
 * Aufrufer importiert (siehe Kopfkommentar oben und die Warnung in
 * src/lib/settings/actions.ts:12-17).
 *
 * `error` ist immer ein fertiger deutscher Satz für die Oberfläche, nie eine
 * rohe Fehlermeldung aus der Datenbank (CLAUDE.md §2.11).
 */
export type SetTrackingConsentResult =
  | { ok: true; decision: ConsentDecision }
  | { ok: false; error: string };

/**
 * Eine Zeile aus `public.tracking_consents`, so weit sie für die
 * Zustandsauflösung gebraucht wird (`resolveConsentRows()` in read.ts).
 * Bewusst kein zod-Schema: das sind selbst geschriebene Zeilen aus der
 * eigenen Datenbank, keine Eingabe von außen.
 */
export type TrackingConsentRow = {
  category: ConsentCategory;
  decision: ConsentDecision;
  created_at: string;
};
