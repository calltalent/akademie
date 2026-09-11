"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenant } from "@/lib/tenant/context";
import { isAffiliateEnabled } from "@/lib/tenant/types";
import { writeAuditEntry } from "@/lib/affiliate/audit";
import { normalizeIp } from "@/lib/affiliate/hash";
import {
  AFFILIATE_PARTNER_CODE_PATTERN,
  affiliatePartnerApplicationSchema,
} from "@/lib/affiliate/schema";
import type { AffiliateApplicationActionState } from "@/lib/affiliate/state";
import type { AffiliateApplicationField } from "@/lib/affiliate/types";
import { verifyContactFormToken } from "@/lib/contact/form-token";
import {
  CONTACT_HONEYPOT_FIELD,
  CONTACT_TOKEN_FIELD,
  containsMarkup,
  countLinks,
} from "@/lib/contact/patterns";
import { getServerEnv } from "@/lib/env";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import {
  TURNSTILE_FAILED_MESSAGE,
  TURNSTILE_RESPONSE_FIELD,
  verifyTurnstile,
} from "@/lib/security/turnstile";

/**
 * Affiliate-System, Block B7-B — die Schutzschichten der öffentlichen
 * Bewerbung unter `/partnerprogramm` (PLAN_Affiliate-System.md 8.3, 11.3,
 * 11.6, 11.7, 11.9, 11.10, 11.15; CLAUDE.md §2.7).
 *
 * Dies ist das einzige Formular des Affiliate-Moduls, das ohne Konto
 * erreichbar ist. Es schreibt eine Zeile in `affiliate_partners` und damit in
 * eine Tabelle, an der später Geld hängt — es bekommt deshalb dieselbe
 * Staffelung wie das Kontaktformular nach dem Spam-Vorfall vom 24.08.2026
 * (`src/lib/contact/actions.ts:33-57`), die billigen Schichten zuerst, damit
 * ein Bot gar nicht erst Datenbank- und Cloudflare-Kosten verursacht:
 *
 *   0. Origin-Prüfung (fail-closed)
 *   1. Honeypot                     -> STILL als Erfolg quittiert
 *   2. Zeitfalle (signiertes Token) -> STILL als Erfolg quittiert
 *   3. Rate-Limits: IP 5/300 s, global 300/3600 s, Mandant 30/3600 s
 *   4. Cloudflare Turnstile, sobald konfiguriert (fail-open bei Ausfall)
 *   5. zod (`affiliatePartnerApplicationSchema`) inkl. Link-/Markup-Sperre
 *      für die Namensfelder
 *   6. Rate-Limit je gehashter Bewerber-Adresse 3/3600 s
 *   7. Inhaltsprüfung der Freitext-Antworten gegen die Felder des Programms
 *
 * SCHICHT 1 UND 2 MELDEN DENSELBEN ERFOLGSTEXT WIE EIN MENSCH. Eine sichtbare
 * Ablehnung ist für den Betreiber eines Bots die Rückmeldung, mit der er sein
 * Muster anpasst; er soll nicht erfahren, dass er erkannt wurde. Dasselbe gilt
 * für eine bereits vorhandene Bewerbung (Plan 11.15): auch sie bekommt den
 * Erfolgstext, sonst wäre das Formular ein Orakel darüber, wer sich bei diesem
 * Mandanten schon beworben hat.
 *
 * EIN EINZIGER FEHLERTEXT FÜR JEDEN GRUND, AUS DEM ES DIESE SEITE NICHT GIBT
 * (`APPLICATION_CLOSED`). Kein Mandant, Modul aus, Programm nie angelegt,
 * `visibility='private'`, Programm im Entwurf oder pausiert — alles dieselbe
 * Antwort. Unterschiedliche Texte wären genau das Orakel, das die Seite selbst
 * durch ihr 404 vermeidet (8.3): aus ihnen ließe sich ablesen, welcher Mandant
 * ein Partnerprogramm betreibt. Deshalb ruft diese Datei auch NICHT
 * `requireAffiliateProgram()` (access.ts) auf — dessen Meldungen sind für
 * angemeldete Manager gedacht und unterscheiden „kein Mandant" von „Modul
 * nicht aktiviert".
 *
 * WARUM `createAdminClient()` (Plan 11.10). Der Bewerber hat kein Konto, also
 * keine Sitzung und keine Rolle; `anon` hat auf `affiliate_partners` weder
 * SELECT noch INSERT (Migration 20260910120000, Abschnitt 4). Die
 * Mandantenbindung kommt NICHT aus dem Formular, sondern aus `getTenant()`,
 * also aus dem von middleware.ts gesetzten Request-Header — ein Bewerber kann
 * sich damit keinen fremden Mandanten aussuchen. Geschrieben wird ausschließlich
 * eine `pending`-Zeile; gelesen werden ausschließlich Spalten, die die Seite
 * ohnehin anzeigt.
 *
 * ABWEICHUNG VOM PLAN, BEGRÜNDET: `approval_mode = 'auto'` führt hier NICHT
 * zur sofortigen Freischaltung. Der Plan legt die Bedeutung des Modus nirgends
 * fest (er kommt außer in der Tabellendefinition nicht vor), und nach
 * CLAUDE.md §4.5 gilt dann die einfachste Lösung: eine öffentliche Bewerbung
 * entsteht immer als unbewertete `pending`-Zeile. Eine automatische Freigabe
 * über ein anonym erreichbares Formular wäre die einzige Stelle im Modul, an
 * der ein Fremder ohne menschliche Entscheidung zum aktiven Partner mit
 * Provisionsanspruch würde — und sie umginge die Selbstfreigabesperre G15,
 * weil niemand entscheidet. Wer den Modus einführen will, tut das im
 * Manager-Pfad, wo ein Mensch haftet.
 */

// --- Texte (deutsch, gehen unverändert an den Bewerber) -----------------

/**
 * Der EINE Text für „diese Bewerbung ist nicht möglich" — siehe Kopf. Bewusst
 * ohne Grund und ohne Namen des Mandanten.
 */
const APPLICATION_CLOSED =
  "Für diese Akademie können derzeit keine Bewerbungen entgegengenommen werden.";

/** Technischer Fehlschlag. Nie `error.message` (CLAUDE.md §2.11). */
const APPLICATION_FAILED =
  "Die Bewerbung konnte nicht gesendet werden. Bitte versuche es später erneut.";

/** Formular älter als drei Stunden: neu laden, dann klappt es. */
const FORM_EXPIRED = "Das Formular ist abgelaufen. Bitte lade die Seite neu und sende erneut.";

/**
 * Die angezeigte Fassung der Bedingungen passt nicht mehr zur gespeicherten.
 * Eine Zustimmung zu einem Text, den der Bewerber nie gesehen hat, wäre kein
 * Nachweis nach Art. 7 Abs. 1 DSGVO — hier ist Neuladen die einzige richtige
 * Antwort.
 */
const TERMS_CHANGED =
  "Die Partnerbedingungen haben sich geändert. Bitte lade die Seite neu und prüfe sie erneut.";

/** Fail-closed wie `verifySameOrigin()` (security/origin.ts). */
const ORIGIN_REJECTED = "Anfrage abgelehnt (ungültiger Origin).";

// --- Grenzwerte ---------------------------------------------------------

/** Plan 8.3, Schicht 3, erste Ebene. */
const IP_LIMIT = { maxRequests: 5, windowSeconds: 300 } as const;

/**
 * Zweite Ebene, über ALLE Mandanten. Nicht im Plan, aber ausdrücklich im
 * Auftrag zu B7-B: der verteilte Bot aus dem Vorfall vom 24.08.2026 kam mit je
 * einem Treffer von vier verschiedenen IPs — ein reines IP-Limit greift gegen
 * ihn nie. 300/Stunde liegt weit über jedem realen Bewerbungsaufkommen.
 */
const GLOBAL_LIMIT = { maxRequests: 300, windowSeconds: 3600 } as const;

/** Dritte Ebene, je Mandant (Plan 8.3). */
const TENANT_LIMIT = { maxRequests: 30, windowSeconds: 3600 } as const;

/** Vierte Ebene, je gehashter Bewerber-Adresse (Plan 8.3). */
const EMAIL_LIMIT = { maxRequests: 3, windowSeconds: 3600 } as const;

/**
 * Ab so vielen Links gilt eine Freitext-Antwort als maschinell. Derselbe
 * Schwellwert wie im Kontaktformular (`contact/spam.ts:116-119`). Antworten
 * auf ein Feld der Art `url` sind davon ausgenommen — dort IST ein Link die
 * verlangte Eingabe, und ein Bewerber, der seinen Kanal nennt, ist kein Bot.
 */
const MAX_LINKS_IN_ANSWER = 3;

/** Domänenpräfix des Zustimmungsnachweises (Plan 11.6, statisches Salz). */
const TERMS_IP_HASH_DOMAIN = "calltalent:affiliate-terms-ip";

// --- Hilfsfunktionen (alle modul-intern: eine "use server"-Datei darf nur
//     async Funktionen exportieren) -------------------------------------

/**
 * Same-Origin-Prüfung für eine Server Action.
 *
 * ABWEICHUNG MIT GRUND: `verifySameOrigin()` (`src/lib/security/origin.ts`)
 * erwartet ein `Request`-Objekt. Eine Server Action bekommt keines, und ein
 * künstlich gebautes hilft nicht — `Host` ist ein verbotener Header-Name nach
 * Fetch-Standard und würde beim Konstruieren stillschweigend verworfen, die
 * Prüfung liefe also immer ins `!host`-fail-closed. Übernommen ist deshalb die
 * REGEL, nicht der Aufruf: `Origin`-Host muss gleich `Host` sein, ein
 * fehlender Header gilt als verdächtig. Next.js prüft dasselbe bereits selbst
 * für Server Actions (CLAUDE.md §2.9); diese Zeilen sind die ausdrückliche
 * zweite Linie, die auch dann steht, wenn jemand die Action später hinter
 * einen eigenen Route Handler hängt.
 */
async function sameOrigin(): Promise<boolean> {
  const h = await headers();
  const origin = h.get("origin");
  const host = h.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Die Absender-IP, wie sie auch der Rate-Limiter und der Klick-Endpunkt lesen. */
async function requestIp(): Promise<string | null> {
  const h = await headers();
  return normalizeIp(h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0] ?? null);
}

/** Hex-Darstellung eines Digest-/Signatur-Ergebnisses. */
function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Schlüssel des Adress-Rate-Limits. SHA-256 ohne Salz genügt: der Wert steht
 * nur in `rate_limits` und dient allein dem Zählen, damit keine Klartext-
 * Adresse in den Schlüssel gerät (gleiches Muster wie `contact-form-email`).
 *
 * Web Crypto statt `node:crypto`: Letzteres hat den Webpack-Fallback dieses
 * Projekts schon einmal gebrochen („UnhandledSchemeError", siehe Kopf von
 * `src/lib/affiliate/hash.ts`).
 */
async function hashEmailForRateLimit(email: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email)));
}

/**
 * Der Zustimmungsnachweis (`affiliate_partners.terms_accepted_ip_hash`,
 * Plan 3.3/11.6). STATISCHES, domänenpräfixiertes Salz aus dem ohnehin
 * serverseitigen `SUPABASE_SERVICE_ROLE_KEY` — anders als beim Klick-Hash, der
 * täglich rotiert: ein Nachweis nach Art. 7 Abs. 1 DSGVO, der nach 24 Stunden
 * nicht mehr überprüfbar ist, ist keiner. Die IP selbst wird nirgends
 * gespeichert.
 */
async function hashTermsIp(ip: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(
      `${TERMS_IP_HASH_DOMAIN}:${getServerEnv().SUPABASE_SERVICE_ROLE_KEY}`,
    ),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ip)));
}

/**
 * Speicherform der Bewerber-Adresse nach Plan 3.3: `lower(trim(...))`, Suffix
 * nach `+` entfernt. Bewusst NICHT `normalizeAffiliateEmail()`
 * (`attribution.ts`): die Funktion entfernt zusätzlich Punkte in
 * Gmail-Adressen, weil sie für den VERGLEICH beim Selbstkauf-Abgleich gebaut
 * ist. Für die gespeicherte Adresse wäre das falsch — an sie geht die
 * Antwortmail, und `max.muster@gmail.com` zu `maxmuster@gmail.com` zu
 * verkürzen änderte den Empfänger sichtbar.
 */
function storedEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const plus = local.indexOf("+");
  return plus < 0 ? email : `${local.slice(0, plus)}${email.slice(at)}`;
}

/**
 * Ableitung eines Partnercodes aus dem Namen, wenn der Bewerber keinen Wunsch
 * geäußert hat oder sein Wunsch vergeben ist. Ergebnis erfüllt immer
 * `AFFILIATE_PARTNER_CODE_PATTERN` (3–32 Zeichen), damit der CHECK der
 * Tabelle nie aus einem Namen heraus verletzt werden kann.
 */
function codeFromName(displayName: string): string {
  const base = displayName
    .toLowerCase()
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss")
    .normalize("NFD")
    // Kombinierende Akzente entfernen (é -> e), bevor sie zu "-" würden.
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return base.length >= 3 ? base : "partner";
}

/** Sechs Zufallszeichen aus dem erlaubten Zeichenvorrat. */
function randomSuffix(): string {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Sucht einen im Mandanten freien Code. Ein Wunsch des Bewerbers gilt nur,
 * wenn er frei ist — er ist nie ein Grund, eine Bewerbung abzulehnen (siehe
 * Kommentar an `affiliatePartnerApplicationSchema`). Alle Kandidaten werden in
 * EINER Abfrage geprüft; bleibt keiner übrig, entscheidet der Zufall.
 */
async function pickFreeCode(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  wish: string | null,
  displayName: string,
): Promise<string> {
  const base = codeFromName(displayName);
  const candidates = [
    ...(wish === null ? [] : [wish]),
    base,
    `${base}-2`,
    `${base}-3`,
    `${base}-4`,
    `${base}-5`,
  ];

  const { data, error } = await admin
    .from("affiliate_partners")
    .select("code")
    .eq("tenant_id", tenantId)
    .in("code", candidates);

  // Fehler beim Lesen heißt „nichts bekannt": dann greift der Zufallscode.
  // Ein belegter Code führt ohnehin nur zu 23505, das der Aufrufer behandelt.
  const taken = new Set(
    error ? candidates : ((data ?? []) as Array<{ code: string }>).map((row) => row.code),
  );
  return candidates.find((candidate) => !taken.has(candidate)) ?? `${base}-${randomSuffix()}`;
}

/**
 * Schicht 7 — die Antworten gegen die Felder des Programms.
 *
 * Zweck ist nicht Spam-Bewertung im Sinne von `contact/spam.ts` (dessen
 * Phrasenliste würde hier falsch liegen: „Provision", „verdienen" und ein Link
 * auf den eigenen Kanal sind in einer Partnerbewerbung genau die erwartete
 * Eingabe), sondern drei harte Regeln: Pflichtfelder sind ausgefüllt,
 * `url`-Felder enthalten eine vollständige Adresse, und kein Freitext trägt
 * Markup oder eine Linkliste. Unbekannte Schlüssel fallen heraus, statt als
 * beliebiges jsonb in der Zeile zu landen.
 */
function checkAnswers(
  fields: AffiliateApplicationField[],
  answers: Record<string, string>,
): { ok: true; cleaned: Record<string, string> } | { ok: false; error: string } {
  const cleaned: Record<string, string> = {};

  for (const field of fields) {
    const value = (answers[field.key] ?? "").trim();

    if (value === "") {
      if (field.required) return { ok: false, error: `Bitte „${field.label}" ausfüllen.` };
      continue;
    }

    if (containsMarkup(value)) {
      return { ok: false, error: `„${field.label}" enthält unzulässige Zeichen.` };
    }

    if (field.type === "url") {
      let parsed: URL | null = null;
      try {
        parsed = new URL(value);
      } catch {
        parsed = null;
      }
      if (parsed === null || (parsed.protocol !== "https:" && parsed.protocol !== "http:")) {
        return {
          ok: false,
          error: `„${field.label}": bitte eine vollständige Adresse angeben, z. B. https://beispiel.de.`,
        };
      }
    } else if (countLinks(value) >= MAX_LINKS_IN_ANSWER) {
      return { ok: false, error: `„${field.label}" enthält zu viele Links.` };
    }

    cleaned[field.key] = value;
  }

  return { ok: true, cleaned };
}

/** Die Programmspalten, die diese Datei braucht — nie `select("*")` (42501). */
const APPLICATION_PROGRAM_COLUMNS =
  "id, tenant_id, status, visibility, terms_version, application_fields";

type ApplicationProgram = {
  id: string;
  tenant_id: string;
  status: string;
  visibility: string;
  terms_version: number;
  application_fields: AffiliateApplicationField[] | null;
};

// --- Die Server Action --------------------------------------------------

/**
 * Nimmt eine öffentliche Bewerbung entgegen. Einziger Export dieser Datei und
 * damit die einzige von außen aufrufbare Funktion — eine `"use server"`-Datei
 * macht jeden Export zu einem Endpunkt, deshalb liegt der Lesepfad der
 * Programmseite bewusst NICHT hier, sondern lokal in
 * `src/app/partnerprogramm/page.tsx`.
 */
export async function submitAffiliateApplication(
  _prevState: AffiliateApplicationActionState,
  formData: FormData,
): Promise<AffiliateApplicationActionState> {
  try {
    // --- Schicht 0: Origin ------------------------------------------------
    if (!(await sameOrigin())) return { error: ORIGIN_REJECTED };

    // --- Schicht 1: Honeypot ---------------------------------------------
    const honeypot = formData.get(CONTACT_HONEYPOT_FIELD);
    if (typeof honeypot === "string" && honeypot.trim() !== "") {
      console.warn("Partnerbewerbung: Honeypot ausgelöst, Anfrage verworfen.");
      return { error: null, success: true };
    }

    // --- Schicht 2: Zeitfalle --------------------------------------------
    const tokenVerdict = await verifyContactFormToken(formData.get(CONTACT_TOKEN_FIELD));
    if (tokenVerdict === "too-fast" || tokenVerdict === "invalid") {
      console.warn(`Partnerbewerbung: Zeitfalle ausgelöst (${tokenVerdict}), Anfrage verworfen.`);
      return { error: null, success: true };
    }
    if (tokenVerdict === "expired") return { error: FORM_EXPIRED };

    // --- Schicht 3: Rate-Limits ------------------------------------------
    if (!(await checkRateLimit("affiliate-apply-ip", IP_LIMIT))) {
      return { error: RATE_LIMIT_MESSAGE };
    }
    if (!(await checkRateLimit("affiliate-apply-global", { ...GLOBAL_LIMIT, extraKey: "all" }))) {
      console.warn("Partnerbewerbung: globales Stundenlimit erreicht.");
      return { error: RATE_LIMIT_MESSAGE };
    }

    // --- Gate: Mandant, Feature-Schalter, sichtbares Programm -------------
    // Ein Formular-POST erreicht diese Stelle auch dann, wenn die Seite selbst
    // längst 404 liefert. Jeder Ablehnungsgrund bekommt denselben Text (siehe
    // Kopf), und der Mandant stammt aus dem Middleware-Header, nie aus dem
    // Formular (Plan 11.10).
    const tenant = await getTenant();
    if (tenant === null || !isAffiliateEnabled(tenant)) return { error: APPLICATION_CLOSED };

    if (
      !(await checkRateLimit("affiliate-apply-tenant", { ...TENANT_LIMIT, extraKey: tenant.id }))
    ) {
      console.warn("Partnerbewerbung: Stundenlimit des Mandanten erreicht.");
      return { error: RATE_LIMIT_MESSAGE };
    }

    const admin = createAdminClient();
    const { data: programRow, error: programError } = await admin
      .from("affiliate_programs")
      .select(APPLICATION_PROGRAM_COLUMNS)
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    if (programError) {
      // Nur der SQLSTATE, nie die PostgREST-Meldung (CLAUDE.md §2.11).
      console.error("Partnerbewerbung: Programm nicht lesbar", { code: programError.code });
      return { error: APPLICATION_FAILED };
    }

    const program = (programRow ?? null) as ApplicationProgram | null;
    if (program === null || program.visibility === "private" || program.status !== "active") {
      return { error: APPLICATION_CLOSED };
    }

    // --- Schicht 4: Turnstile --------------------------------------------
    // Nach den IP-/Mandantenlimits, damit eine Flut nicht ungebremst Anfragen
    // an Cloudflares siteverify-Endpunkt auslöst. Ein UNGÜLTIGES Token wird
    // abgelehnt, ein Ausfall bei Cloudflare durchgelassen (turnstile.ts).
    if ((await verifyTurnstile(formData.get(TURNSTILE_RESPONSE_FIELD))) === "failed") {
      return { error: TURNSTILE_FAILED_MESSAGE };
    }

    // --- Schicht 5: zod ---------------------------------------------------
    const answersRaw: Record<string, string> = {};
    for (const field of program.application_fields ?? []) {
      const value = formData.get(`answer_${field.key}`);
      if (typeof value === "string") answersRaw[field.key] = value;
    }

    const parsed = affiliatePartnerApplicationSchema.safeParse({
      displayName: formData.get("displayName"),
      email: formData.get("email"),
      company: formData.get("company"),
      code: formData.get("code"),
      answers: answersRaw,
      acceptTerms: formData.get("acceptTerms"),
      termsVersion: formData.get("termsVersion"),
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }
    const input = parsed.data;

    // Zugestimmt werden kann nur der Fassung, die auch angezeigt wurde.
    if (input.termsVersion !== program.terms_version) return { error: TERMS_CHANGED };

    // Ein Wunschcode, der das Muster verletzt, ist schon im Schema
    // gescheitert; diese Zeile fängt den Fall, dass jemand das Feld leer
    // lässt und `null` durchreicht.
    const wish =
      input.code !== null && AFFILIATE_PARTNER_CODE_PATTERN.test(input.code) ? input.code : null;

    // --- Schicht 6: Rate-Limit je Adresse --------------------------------
    const email = storedEmail(input.email);
    if (
      !(await checkRateLimit("affiliate-apply-email", {
        ...EMAIL_LIMIT,
        extraKey: await hashEmailForRateLimit(email),
      }))
    ) {
      return { error: RATE_LIMIT_MESSAGE };
    }

    // --- Schicht 7: Inhalt der Antworten ---------------------------------
    const answers = checkAnswers(program.application_fields ?? [], input.answers);
    if (!answers.ok) return { error: answers.error };

    // --- Bereits vorhandene Bewerbung ------------------------------------
    // Plan 11.15: dieselbe Antwort wie eine neue Bewerbung. Die Prüfung läuft
    // VOR dem Insert, damit ein späteres 23505 eindeutig eine Codekollision
    // ist und nicht stillschweigend als Doppelbewerbung durchgeht — sonst
    // bekäme ein Bewerber, dessen Code gerade vergeben wurde, einen
    // Erfolgstext ohne gespeicherte Zeile.
    const { data: existing, error: existingError } = await admin
      .from("affiliate_partners")
      .select("id")
      .eq("tenant_id", tenant.id)
      .eq("program_id", program.id)
      .eq("applicant_email", email)
      .maybeSingle();
    if (existingError) {
      console.error("Partnerbewerbung: Bestandsprüfung fehlgeschlagen", {
        code: existingError.code,
      });
      return { error: APPLICATION_FAILED };
    }
    if (existing !== null) return { error: null, success: true };

    // --- Zeile schreiben --------------------------------------------------
    // Immer `pending`, nie mehr (siehe Kopf und
    // `affiliate_partner_insert_must_be_pending`). Der Zustimmungsnachweis
    // darf laut Guard nur `service_role` setzen — genau dieser Pfad hier.
    const ip = await requestIp();
    const row = {
      tenant_id: tenant.id,
      program_id: program.id,
      applicant_email: email,
      display_name: input.displayName,
      company: input.company,
      status: "pending" as const,
      application: answers.cleaned,
      terms_version_accepted: program.terms_version,
      terms_accepted_at: new Date().toISOString(),
      terms_accepted_ip_hash: ip === null ? null : await hashTermsIp(ip),
    };

    let partnerId: string | null = null;
    for (let attempt = 0; attempt < 2 && partnerId === null; attempt++) {
      const code =
        attempt === 0
          ? await pickFreeCode(admin, tenant.id, wish, input.displayName)
          : `${codeFromName(input.displayName)}-${randomSuffix()}`;

      const { data, error } = await admin
        .from("affiliate_partners")
        .insert({ ...row, code })
        .select("id")
        .maybeSingle();

      if (error === null) {
        partnerId = (data as { id: string } | null)?.id ?? null;
        break;
      }
      // 23505 im zweiten Anlauf bedeutet: der Zufall hat zweimal daneben
      // gegriffen oder die Adresse wurde in derselben Sekunde eingetragen.
      // Beides ist kein Fall für eine erklärende Meldung.
      if (error.code !== "23505" || attempt === 1) {
        console.error("Partnerbewerbung: Zeile nicht angelegt", { code: error.code });
        return { error: APPLICATION_FAILED };
      }
    }

    // --- Prüfpfad ---------------------------------------------------------
    // AUSDRÜCKLICHE ABWEICHUNG von der Regel „Protokollfehler = Vorgang
    // unvollständig" (audit.ts erlaubt sie, wenn sie an der Aufrufstelle
    // begründet wird): die Bewerbung IST gespeichert, samt Zustimmungsnachweis
    // in der Zeile selbst. Dem Bewerber jetzt einen Fehler zu zeigen, führte
    // zu einem zweiten Versuch, der als Doppelbewerbung ohnehin nur den
    // Erfolgstext bekäme — er würde also für etwas bestraft, das der Mandant
    // bereits hat. Protokolliert wird der Ausfall serverseitig.
    try {
      await writeAuditEntry({
        tenantId: tenant.id,
        actorKind: "system",
        entity: "partner",
        entityId: partnerId,
        action: "partner.apply",
        after: {
          // `applicant_email`, `display_name`, `company` und `application`
          // stehen auf der Redigierliste (audit.ts) und erscheinen im
          // Protokoll als "***" — hier bewusst trotzdem mitgegeben, damit der
          // Eintrag dieselbe Form hat wie der des Manager-Pfads.
          applicant_email: email,
          display_name: input.displayName,
          company: input.company,
          application: answers.cleaned,
          status: "pending",
          terms_version_accepted: program.terms_version,
        },
      });
    } catch {
      console.error("Partnerbewerbung: Prüfpfad-Eintrag nicht geschrieben.");
    }

    return { error: null, success: true };
  } catch (e) {
    // Nichts aus `e` erreicht die Oberfläche (CLAUDE.md §2.11/§2.15).
    console.error("Partnerbewerbung: unerwarteter Fehler", e instanceof Error ? e.name : "unbekannt");
    return { error: APPLICATION_FAILED };
  }
}
