import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import {
  AFFILIATE_VAT_VALIDITY_DAYS,
  isEuCountry,
  normalizeVatId,
  vatIdCountryMatches,
} from "@/lib/affiliate/tax";
import type { AffiliateVatCheckLog, AffiliateVatCheckResult } from "@/lib/affiliate/types";

/**
 * Affiliate-System, Block B8 — USt-IdNr.-PRÜFUNG GEGEN VIES
 * (PLAN_Affiliate-System.md 7.5, 7.4; CLAUDE.md §2.11/§2.15).
 *
 * ## FAIL-CLOSED, UND ZWAR ANDERS ALS ALLES ANDERE IM PROJEKT
 *
 * Der Rate-Limiter (`src/lib/security/rate-limit.ts`) ist fail-OPEN: fällt er
 * aus, kommt der Nutzer durch, weil eine gesperrte Anmeldung schlimmer wäre
 * als eine ungezählte. Hier gilt das Gegenteil, und die Umkehrung ist
 * beabsichtigt:
 *
 *   Ist der EU-Dienst nicht erreichbar, bleibt der Status `unchecked`, und
 *   `resolveAffiliateTaxMode()` blockiert die Auszahlung.
 *
 * Eine Nummer, die fälschlich als gültig geführt wird, führt zu einem falschen
 * Reverse Charge. Die Folge ist nicht ein unbequemer Nutzer, sondern die
 * Steuerschuld nach § 14c UStG plus Zinsen — bei jeder betroffenen Gutschrift
 * erneut, rückwirkend, und niemand merkt es bis zur Betriebsprüfung. Eine um
 * einen Tag verzögerte Auszahlung merkt der Partner sofort und kann sie
 * ansprechen. Deshalb ist `unchecked` hier NIE ein Zwischenwert, den ein
 * späterer Zweig noch zu `valid` aufwertet: alles, was nicht eine ausdrücklich
 * mit „gültig" beantwortete Anfrage ist, ist `unchecked` oder `invalid`.
 *
 * ## DAS PROTOKOLL IST DER NACHWEIS
 *
 * `vat_check_log` nimmt die ROHE Antwort auf. Das ist kein Debug-Log, sondern
 * der Beleg gegenüber der Finanzverwaltung, dass zum Zeitpunkt X mit Ergebnis
 * Y geprüft wurde. Es widerspricht CLAUDE.md §2.11 NICHT: verboten ist der
 * Klartext im LOGSTROM (`console.*`, Serverlogs), nicht die fachlich
 * vorgeschriebene Aufbewahrung in einer Spalte, die hinter RLS liegt, die nur
 * `service_role` schreibt (Guard `affiliate_billing_guard()`) und die der
 * Audit-Redaktor ohnehin nie ausgibt. Was in `console.error` geht, ist
 * ausschließlich Länderkennzeichen, HTTP-Status und Ergebnis — nie die Nummer.
 */

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Zeitlimit wie bei der Webhook-Zustellung (`src/lib/webhooks/deliver-attempt.ts`).
 * Der EU-Dienst antwortet regelmäßig in unter einer Sekunde, ist aber
 * bekanntermaßen tageweise überlastet; ohne `AbortController` hinge der
 * Auszahlungslauf an einer fremden Infrastruktur.
 */
export const AFFILIATE_VIES_TIMEOUT_MS = 5000;

/** Der REST-Endpunkt aus 7.5. Kein Pfadbestandteil stammt aus einer Eingabe (siehe `buildViesUrl`). */
export const AFFILIATE_VIES_BASE_URL =
  "https://ec.europa.eu/taxation_customs/vies/rest-api/ms";

/**
 * Obergrenze für die gespeicherte Rohantwort. Der Dienst liefert einige
 * hundert Byte; die Grenze steht gegen eine fehlgeleitete Antwort (Proxy-
 * Fehlerseite, HTML) die sonst als jsonb in jeder Profilzeile läge.
 */
const VIES_LOG_MAX_CHARS = 4000;

// --- Normalisierung -----------------------------------------------------

export type AffiliateVatIdParts = {
  /**
   * Länderpräfix der Nummer, z. B. `AT`.
   *
   * Es ist NICHT zwangsläufig `profile.country` — und genau daraus entstand
   * Befund 6 der Abnahme B8/B9: die Abweichung stand hier als Kommentar, und
   * kein Konsument verglich die beiden. Verglichen wird jetzt in
   * `vatIdCountryMatches()` (tax.ts), und `refreshPartnerVatCheck()` unten
   * lässt eine Nummer aus dem falschen Land gar nicht erst auf `valid` laufen.
   */
  country_code: string;
  /** Der Teil hinter dem Präfix. */
  number: string;
  /** Beides zusammen, ohne Trennzeichen, in Großbuchstaben. */
  normalized: string;
};

/**
 * Zerlegt eine eingegebene USt-IdNr. `null` heißt: die Eingabe ist keine
 * USt-IdNr. — nicht „vielleicht doch". Die Prüfung läuft ausschließlich gegen
 * diese normalisierte Form, und `buildViesUrl()` setzt nur noch geprüfte
 * Bestandteile in den Pfad ein (keine Konkatenation ungeprüfter Eingaben in
 * eine URL).
 */
export function parseVatId(raw: string | null | undefined): AffiliateVatIdParts | null {
  // Muster und Normalisierung stehen in `tax.ts` — dort, wo auch der
  // Ländervergleich steht. Zwei Kopien desselben Musters wären zwei Stellen,
  // an denen eine Landesregel später nachgezogen werden müsste.
  const normalized = normalizeVatId(raw);
  if (normalized === null) return null;

  return {
    country_code: normalized.slice(0, 2),
    number: normalized.slice(2),
    normalized,
  };
}

/** Der Abfragepfad. Beide Bestandteile stammen aus `parseVatId()`, sind also `[A-Z0-9]`. */
export function buildViesUrl(parts: AffiliateVatIdParts): string {
  return `${AFFILIATE_VIES_BASE_URL}/${parts.country_code}/vat/${parts.number}`;
}

// --- Ergebnis -----------------------------------------------------------

/**
 * Warum das Ergebnis so ausfiel. Steht im Protokoll und in der Oberfläche;
 * `service_unreachable` und `service_error` sind die beiden Fälle, in denen
 * der Partner nichts falsch gemacht hat und die Prüfung schlicht wiederholt
 * werden muss.
 */
export const AFFILIATE_VIES_REASONS = [
  "valid",
  "format_invalid",
  "country_not_supported",
  "not_registered",
  "service_unreachable",
  "service_error",
  "unexpected_response",
  "manual_override",
  /** Nummer und Profilland passen nicht zusammen (Abnahme B8/B9, Befund 6). */
  "country_mismatch",
] as const;
export type AffiliateViesReason = (typeof AFFILIATE_VIES_REASONS)[number];

export type AffiliateVatCheckOutcome = {
  result: AffiliateVatCheckResult;
  reason: AffiliateViesReason;
  /** ISO-Zeitstempel der Prüfung — auch bei `unchecked`, sonst fehlt der Versuch im Nachweis. */
  checked_at: string;
  /** Wird unverändert nach `affiliate_billing_profiles.vat_check_log` geschrieben. */
  log: AffiliateVatCheckLog;
};

/**
 * Die Fehlerkennungen, mit denen VIES sagt „ich konnte gerade nicht" statt
 * „die Nummer gibt es nicht". Sie führen zu `unchecked`, niemals zu `invalid`
 * — eine überlastete Bundesbehörde ist kein Beweis gegen den Partner.
 */
const VIES_UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  "SERVICE_UNAVAILABLE",
  "MS_UNAVAILABLE",
  "MS_MAX_CONCURRENT_REQ",
  "GLOBAL_MAX_CONCURRENT_REQ",
  "TIMEOUT",
  "SERVER_BUSY",
]);

/** Kürzt die Rohantwort auf eine speicherbare Größe, ohne sie zu verfälschen. */
function clipRawResponse(raw: unknown): unknown {
  let serialized: string;
  try {
    serialized = JSON.stringify(raw) ?? "null";
  } catch {
    return { truncated: true, note: "Antwort war nicht serialisierbar." };
  }
  if (serialized.length <= VIES_LOG_MAX_CHARS) return raw;
  return { truncated: true, body: serialized.slice(0, VIES_LOG_MAX_CHARS) };
}

type ViesFetch = (input: string, init: RequestInit) => Promise<Response>;

export type AffiliateViesCheckOptions = {
  now?: Date;
  /** Einspritzpunkt für den Test; im Betrieb das globale `fetch`. */
  fetchImpl?: ViesFetch;
  timeoutMs?: number;
};

/**
 * Fragt eine USt-IdNr. beim EU-Dienst ab (7.5).
 *
 * Wirft NIE. Jeder denkbare Ausgang endet in einem der drei Ergebnisse, und
 * das ist die Bedingung dafür, dass der Auszahlungslauf nicht an einer
 * fremden Infrastruktur abbricht:
 *
 *   `valid`     — der Dienst hat ausdrücklich mit „gültig" geantwortet.
 *   `invalid`   — die Eingabe ist keine USt-IdNr., trägt ein Präfix, das VIES
 *                 nicht kennt, oder der Dienst kennt die Nummer nicht.
 *   `unchecked` — ALLES andere: Zeitlimit, Netzfehler, HTTP-Fehler, nicht
 *                 lesbares JSON, fehlendes Gültigkeitsfeld, Überlastmeldung.
 *
 * Der letzte Fall ist der wichtige. Ein `?? false` beim Auslesen des
 * Gültigkeitsfelds hätte eine unverständliche Antwort still zu „ungültig"
 * gemacht (ärgerlich, aber harmlos); ein `?? true` hätte sie zu „gültig"
 * gemacht — das ist der § 14c-Fall, und deshalb steht die Prüfung auf
 * `=== true` / `=== false` und sonst `unchecked`.
 */
export async function checkVatIdAgainstVies(
  rawVatId: string | null | undefined,
  options: AffiliateViesCheckOptions = {},
): Promise<AffiliateVatCheckOutcome> {
  const now = options.now ?? new Date();
  const checkedAt = now.toISOString();
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as ViesFetch);
  const timeoutMs = options.timeoutMs ?? AFFILIATE_VIES_TIMEOUT_MS;

  const outcome = (
    result: AffiliateVatCheckResult,
    reason: AffiliateViesReason,
    extra: Record<string, unknown> = {},
  ): AffiliateVatCheckOutcome => ({
    result,
    reason,
    checked_at: checkedAt,
    log: { source: "vies", checked_at: checkedAt, result, reason, ...extra },
  });

  const parts = parseVatId(rawVatId);
  if (parts === null) {
    // Kein Netzaufruf: eine Zeichenkette, die keine USt-IdNr. sein kann, muss
    // man nicht in Brüssel nachfragen.
    return outcome("invalid", "format_invalid");
  }

  if (!isEuCountry(parts.country_code)) {
    // VIES kennt ausschließlich Präfixe von Mitgliedstaaten. Ein `CH…` oder
    // `XI…` ist damit abschließend keine EU-USt-IdNr. — das ist eine Aussage
    // über die Nummer, kein Ausfall des Dienstes, deshalb `invalid`.
    return outcome("invalid", "country_not_supported", { country_code: parts.country_code });
  }

  const url = buildViesUrl(parts);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    const httpStatus = response.status;
    if (!response.ok) {
      // Auch 4xx ist hier `unchecked`: ein 404 des GATEWAYS ist kein „Nummer
      // unbekannt", und die beiden auseinanderzuhalten ist nicht möglich,
      // ohne dem Antwortkörper zu vertrauen, den es bei einem Gateway-Fehler
      // gar nicht gibt.
      logViesOutcome(parts.country_code, "unchecked", httpStatus);
      return outcome("unchecked", "service_error", { http_status: httpStatus });
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      logViesOutcome(parts.country_code, "unchecked", httpStatus);
      return outcome("unchecked", "unexpected_response", { http_status: httpStatus });
    }

    const record = (body ?? {}) as Record<string, unknown>;
    const raw = clipRawResponse(body);

    const userError = typeof record.userError === "string" ? record.userError : null;
    if (userError !== null && VIES_UNAVAILABLE_CODES.has(userError.toUpperCase())) {
      logViesOutcome(parts.country_code, "unchecked", httpStatus);
      return outcome("unchecked", "service_unreachable", { http_status: httpStatus, raw });
    }

    // Der Dienst hat seine Antwortform über die Jahre zweimal geändert
    // (`valid` im REST-Endpunkt je Mitgliedstaat, `isValid` im
    // `check-vat-number`-Endpunkt). Beide werden gelesen, aber NUR als echtes
    // Boolean — ein `"true"` als Zeichenkette zählt nicht, sonst hinge der
    // Steuerausweis an einer stillen Typumwandlung.
    const validFlag =
      typeof record.valid === "boolean"
        ? record.valid
        : typeof record.isValid === "boolean"
          ? record.isValid
          : null;

    if (validFlag === true) {
      logViesOutcome(parts.country_code, "valid", httpStatus);
      return outcome("valid", "valid", { http_status: httpStatus, raw });
    }
    if (validFlag === false) {
      logViesOutcome(parts.country_code, "invalid", httpStatus);
      return outcome("invalid", "not_registered", { http_status: httpStatus, raw });
    }

    logViesOutcome(parts.country_code, "unchecked", httpStatus);
    return outcome("unchecked", "unexpected_response", { http_status: httpStatus, raw });
  } catch {
    // Zeitlimit (AbortError) und Netzfehler landen beide hier. Der Fehler
    // selbst wird NICHT protokolliert: `error.message` einer `fetch`-Ausnahme
    // trägt die vollständige URL und damit die USt-IdNr. (CLAUDE.md §2.11).
    logViesOutcome(parts.country_code, "unchecked", null);
    return outcome("unchecked", "service_unreachable", { http_status: null });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Die einzige Stelle, an der etwas über eine Prüfung ins Serverlog geht:
 * Länderkennzeichen, Ergebnis, HTTP-Status. Keine Nummer, kein Partner, kein
 * Mandant — die Zuordnung steht in `vat_check_log`, wo sie hingehört.
 */
function logViesOutcome(
  countryCode: string,
  result: AffiliateVatCheckResult,
  httpStatus: number | null,
): void {
  if (result === "valid") return;
  console.error(
    `[affiliate/vies] Prüfung ${countryCode} ergab ${result} (HTTP ${httpStatus ?? "kein Rundlauf"}).`,
  );
}

// --- Persistenz ---------------------------------------------------------

/** Genau die Spalten, die die Prüfung braucht. Nie `select("*")` (42501). */
const VIES_PROFILE_COLUMNS = "partner_id, tenant_id, country, vat_id, vat_check_result, vat_checked_at";

export type AffiliateVatRefreshResult =
  | { ok: true; outcome: AffiliateVatCheckOutcome }
  | { ok: false; reason: "profile_missing" | "vat_id_missing" | "write_failed" };

/**
 * Prüft die USt-IdNr. EINES Partners und schreibt das Ergebnis fort.
 *
 * Die Nummer wird aus der Datenbank gelesen, nie aus dem Aufruf übernommen
 * (CLAUDE.md §2.15): sonst könnte ein Formular eine fremde, gültige Nummer
 * mitschicken und sich damit den Prüfstatus für die eigene, ungültige holen.
 * Aus demselben Grund filtert die Abfrage zusätzlich zu RLS auf `tenant_id`.
 *
 * Geschrieben werden ausschließlich die drei `vat_check_*`-Spalten. Der Guard
 * `affiliate_billing_guard()` lässt sie nur für `service_role` zu — ein
 * Partner, der sich selbst auf `valid` setzen könnte, hätte sich Reverse
 * Charge und die Auszahlungsfreigabe selbst ausgestellt (3.13).
 */
export async function refreshPartnerVatCheck(
  admin: Admin,
  params: {
    tenantId: string;
    partnerId: string;
    now?: Date;
    fetchImpl?: ViesFetch;
    timeoutMs?: number;
  },
): Promise<AffiliateVatRefreshResult> {
  const { data: profile, error } = await admin
    .from("affiliate_billing_profiles")
    .select(VIES_PROFILE_COLUMNS)
    .eq("tenant_id", params.tenantId)
    .eq("partner_id", params.partnerId)
    .maybeSingle<{ vat_id: string | null; country: string | null }>();

  if (error || profile === null) return { ok: false, reason: "profile_missing" };
  if (typeof profile.vat_id !== "string" || profile.vat_id.trim() === "") {
    return { ok: false, reason: "vat_id_missing" };
  }

  /**
   * Abnahme B8/B9, Befund 6: `country` wurde hier schon immer mitgelesen und
   * nie verglichen. Eine Nummer aus einem anderen Land als dem des Profils
   * wird gar nicht erst angefragt — sie würde in Brüssel als gültig bestätigt
   * und stünde danach als `valid` auf einem Profil, für das sie nichts belegt.
   * Das Ergebnis ist `invalid` und nicht `unchecked`: es ist eine Aussage über
   * die Eingabe, kein Ausfall des Dienstes.
   */
  const outcome = vatIdCountryMatches(profile.vat_id, profile.country)
    ? await checkVatIdAgainstVies(profile.vat_id, {
        now: params.now,
        fetchImpl: params.fetchImpl,
        timeoutMs: params.timeoutMs,
      })
    : buildCountryMismatchOutcome(profile.country, params.now);

  const { error: writeError } = await admin
    .from("affiliate_billing_profiles")
    .update({
      vat_check_result: outcome.result,
      vat_checked_at: outcome.checked_at,
      vat_check_log: outcome.log,
    })
    .eq("tenant_id", params.tenantId)
    .eq("partner_id", params.partnerId);

  if (writeError) {
    console.error(
      `[affiliate/vies] Prüfergebnis konnte nicht gespeichert werden (Code ${
        (writeError as { code?: string }).code ?? "unbekannt"
      }).`,
    );
    return { ok: false, reason: "write_failed" };
  }

  return { ok: true, outcome };
}

/**
 * Das Protokollobjekt für eine Nummer, die nicht zum Land des Profils gehört.
 * Es trägt AUSSCHLIESSLICH das Länderkennzeichen des Profils, nie die Nummer —
 * dieselbe Zurückhaltung wie im Serverlog (CLAUDE.md §2.11).
 */
function buildCountryMismatchOutcome(
  profileCountry: string | null,
  now: Date | undefined,
): AffiliateVatCheckOutcome {
  const checkedAt = (now ?? new Date()).toISOString();
  return {
    result: "invalid",
    reason: "country_mismatch",
    checked_at: checkedAt,
    log: {
      source: "vies",
      checked_at: checkedAt,
      result: "invalid",
      reason: "country_mismatch",
      profile_country: profileCountry,
    },
  };
}

/**
 * Die manuelle Freigabe aus 7.5: ein Admin kann eine Nummer mit
 * PFLICHTBEGRÜNDUNG von Hand auf `valid` setzen, wenn der Dienst dauerhaft
 * ausfällt und ihm ein anderer Nachweis vorliegt (qualifizierte Bestätigung
 * des BZSt, Schriftwechsel).
 *
 * Der Vorgang erzeugt zusätzlich einen Audit-Eintrag — geschrieben von der
 * Server Action, nicht hier: diese Funktion baut nur das Protokollobjekt, und
 * genau deshalb kann sie nicht versehentlich ohne Protokoll aufgerufen werden.
 * `manual_override` bleibt für immer im Log stehen; bei einer Betriebsprüfung
 * ist der Unterschied zwischen „VIES sagte gültig" und „ein Mensch hat das
 * entschieden" die entscheidende Frage.
 */
export function buildManualOverrideLog(params: {
  actorUserId: string;
  reason: string;
  now?: Date;
  previous?: AffiliateVatCheckLog | null;
}): { log: AffiliateVatCheckLog; checked_at: string } {
  const checkedAt = (params.now ?? new Date()).toISOString();
  return {
    checked_at: checkedAt,
    log: {
      source: "manual",
      checked_at: checkedAt,
      result: "valid",
      reason: "manual_override",
      manual_override: {
        actor_user_id: params.actorUserId,
        reason: params.reason,
        at: checkedAt,
      },
      // Die letzte maschinelle Antwort bleibt daneben stehen; sie ist der
      // Grund, warum überhaupt von Hand entschieden wurde.
      previous: params.previous ?? null,
    },
  };
}

/**
 * Wann ist die nächste Prüfung fällig? Rein rechnerisch, damit der Cron-Lauf
 * und die Partneroberfläche („gültig bis …") dieselbe Frist verwenden wie
 * `hasCurrentVatCheck()` in `tax.ts` — es gibt genau eine 90-Tage-Grenze.
 */
export function vatCheckExpiresAt(checkedAt: string): Date | null {
  const parsed = Date.parse(checkedAt);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed + AFFILIATE_VAT_VALIDITY_DAYS * 86_400_000);
}
