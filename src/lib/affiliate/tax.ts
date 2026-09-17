import type {
  AffiliateEntityKind,
  AffiliateTaxMode,
  AffiliateVatCheckResult,
} from "@/lib/affiliate/types";

/**
 * Affiliate-System, Block B8 — STEUERMODUS UND STEUERBETRAG als REINE
 * Funktionen (PLAN_Affiliate-System.md 7.4, G12; CLAUDE.md §3.4).
 *
 * Kein `server-only`, kein Supabase, kein `Date.now()` — gleiche Bauart wie
 * `compute.ts` und `statement.ts`. Der Steuermodus entscheidet über einen
 * Steuerausweis; ein Ausweis, den man nur mit Datenbank und Systemuhr
 * nachrechnen kann, ist bei einer Betriebsprüfung nicht nachrechenbar.
 *
 * ## ZWEI FÄLLE BLOCKIEREN, UND DAS IST DER ZWECK DER DATEI
 *
 * Die Tabelle in 7.4 hat sechs Zeilen, aber nur VIER Steuermodi. Die zwei
 * übrigen Fälle liefern keinen Modus, sondern eine Blockade:
 *
 *   - EU ≠ DE, Unternehmen, ohne gültige und aktuelle USt-IdNr.: ohne
 *     geprüfte Nummer ist Reverse Charge nicht belegbar. Wer trotzdem „netto,
 *     Steuerschuldnerschaft des Leistungsempfängers" auf den Beleg schreibt,
 *     schuldet die ausgewiesene bzw. nicht abgeführte Steuer nach § 14c UStG —
 *     das ist teurer als eine um Tage verzögerte Auszahlung.
 *   - Privatperson, jedes Land: eine Gutschrift nach § 14 Abs. 2 UStG setzt
 *     einen UNTERNEHMER als Leistenden voraus. An einen Nichtunternehmer ist
 *     sie keine Gutschrift im umsatzsteuerlichen Sinn, sondern ein Papier, das
 *     so aussieht. Wie mit Privatpersonen umgegangen wird, ist eine
 *     kaufmännische Entscheidung (Plan 12.4) und ausdrücklich keine, die diese
 *     Datei still trifft.
 *   - NACHGETRAGEN (Abnahme B8/B9, Befund 6): USt-IdNr. aus einem anderen Land
 *     als dem des Profils. Bis dahin entschied allein das frei eingetragene
 *     Land über die Rechtsfolge, während die geprüfte Nummer aus einem
 *     beliebigen anderen Land stammen durfte — in beide Richtungen ein
 *     § 14c-Fall. Siehe `vatIdCountryMatches()`.
 *
 * Deshalb ist der Rückgabewert eine unterschiedene Vereinigung und kein
 * `AffiliateTaxMode | null`: ein `null` hätte an der Aufrufstelle zu einem
 * `?? "regular"` eingeladen, und genau dieses Fallback wäre der Fehler.
 *
 * ## DIE PROVISION IST NETTO, DIE STEUER KOMMT OBEN DRAUF
 *
 * Die Provision ist auf den Nettoumsatz des Händlers gerechnet (5.1) und damit
 * das NETTO-Honorar des Partners. `tax_cents` wird also AUF `subtotal_cents`
 * addiert, nie herausgerechnet. Wer das umdreht, zahlt dauerhaft 19 % zu wenig
 * aus oder weist eine Steuer aus, die nie abgeführt wurde.
 */

// --- Ländermengen -------------------------------------------------------

/** Das Inland. Eigene Konstante, damit die Regel nicht als Literal verstreut. */
export const AFFILIATE_TAX_HOME_COUNTRY = "DE";

/** Umsatzsteuersatz des Inlands in Basispunkten (19 %, G12: keine Prozente als Float). */
export const AFFILIATE_TAX_REGULAR_RATE_BP = 1900;

/**
 * Die 27 Mitgliedstaaten der EU (Stand 2026), ISO-3166-1 alpha-2.
 *
 * `EL` steht mit in der Menge, weil der VIES-Dienst Griechenland unter diesem
 * Präfix führt, während ISO-3166 `GR` verlangt — ein Abrechnungsprofil kann
 * nach einer Übernahme aus der USt-IdNr. beides enthalten, und ein
 * griechischer Partner darf nicht an einer Schreibweise scheitern.
 *
 * `GB` und `XI` stehen bewusst NICHT hier. `XI` (Nordirland) gehört seit dem
 * Brexit nur noch für WAREN zum EU-Mehrwertsteuergebiet; eine Vermittlungs-
 * leistung ist eine sonstige Leistung, für sie ist Nordirland Drittland. Ein
 * `XI`-Partner fällt damit in `non_eu` — richtig, aber nur, solange niemand
 * `XI` „der Vollständigkeit halber" in diese Liste nachträgt.
 */
const EU_COUNTRIES: ReadonlySet<string> = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "EL", "ES", "FI", "FR",
  "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT",
  "RO", "SE", "SI", "SK",
]);

/** Gehört das Land zum EU-Mehrwertsteuergebiet für sonstige Leistungen? */
export function isEuCountry(country: string | null | undefined): boolean {
  if (typeof country !== "string") return false;
  return EU_COUNTRIES.has(country.trim().toUpperCase());
}

/**
 * Gültigkeitsdauer einer VIES-Prüfung in Tagen (7.5). Eine ältere Prüfung
 * zählt wie keine: eine USt-IdNr. kann jederzeit erlöschen, und der Nachweis
 * über den Zeitpunkt der Prüfung ist genau das, was die Finanzverwaltung sehen
 * will. `vies.ts` liest denselben Wert hier — es gibt nur eine Frist.
 */
export const AFFILIATE_VAT_VALIDITY_DAYS = 90;

const MS_PER_DAY = 86_400_000;

// --- USt-IdNr.: Schreibweise und Länderpräfix ---------------------------

/**
 * Eine USt-IdNr. besteht aus zwei Buchstaben Länderpräfix und 2 bis 12
 * alphanumerischen Zeichen. Leerzeichen, Punkte, Schrägstriche und Bindestriche
 * sind Schreibweise, nicht Inhalt.
 *
 * Das Muster steht HIER und nicht in `vies.ts`, obwohl es dort gebraucht wird:
 * `vies.ts` ist `server-only`, diese Datei ist rein. Zwei Muster für dieselbe
 * Sache wären zwei Stellen, an denen später eine Landesregel nachgezogen
 * werden müsste — `parseVatId()` baut deshalb auf dieser Funktion auf.
 */
const VAT_ID_PATTERN = /^[A-Z]{2}[0-9A-Z]{2,12}$/;

/** Normalisierte Form (Großbuchstaben, ohne Trennzeichen) oder `null`. */
export function normalizeVatId(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const normalized = raw.replace(/[\s.\-/]/g, "").toUpperCase();
  return VAT_ID_PATTERN.test(normalized) ? normalized : null;
}

/**
 * Griechenland führt VIES unter `EL`, ISO-3166 unter `GR`. Beide meinen
 * dasselbe Land, und ein griechischer Partner darf nicht an der Schreibweise
 * scheitern — dieselbe Gleichsetzung wie in `EU_COUNTRIES`.
 */
function canonicalCountry(code: string): string {
  return code === "EL" ? "GR" : code;
}

/**
 * Gehört die USt-IdNr. zum Land des Abrechnungsprofils (7.4/7.5)?
 *
 * DIESE FRAGE ENTSCHEIDET ÜBER EINEN STEUERAUSWEIS. Ohne sie bestimmt allein
 * das vom Partner frei eingetragene Land die Rechtsfolge, während die geprüfte
 * Nummer aus einem ganz anderen Land stammen darf:
 *
 *   - `country = IT`, `vat_id = DE…`: VIES bestätigt die deutsche Nummer, der
 *     EU-Zweig liefert Reverse Charge — für einen Leistenden, der im Inland
 *     umsatzsteuerlich registriert ist. Der Umsatz ist in Deutschland
 *     steuerbar, es hätten 19 % ausgewiesen werden müssen.
 *   - `country = DE`, `vat_id = ATU…`: der Inlandszweig weist 19 % aus, wo
 *     Reverse Charge richtig gewesen wäre.
 *
 * Beide Richtungen sind § 14c-Fälle, und beide entstehen still. `false` heißt
 * hier deshalb immer „nicht verwendbar", nie „vielleicht doch".
 */
export function vatIdCountryMatches(
  vatId: string | null | undefined,
  country: string | null | undefined,
): boolean {
  const normalized = normalizeVatId(vatId);
  if (normalized === null) return false;
  const profileCountry = typeof country === "string" ? country.trim().toUpperCase() : "";
  if (profileCountry === "") return false;
  return canonicalCountry(normalized.slice(0, 2)) === canonicalCountry(profileCountry);
}

// --- Eingabe und Ergebnis ----------------------------------------------

/**
 * Genau die Felder aus `affiliate_billing_profiles` (3.13), die den
 * Steuermodus bestimmen — kein `Pick<>` über die ganze Zeile. IBAN,
 * `paypal_email` und `tax_number` gehen den Steuermodus nichts an und haben
 * damit auch in dieser Eingabe nichts verloren; so kann kein späterer
 * Aufrufer sie versehentlich durch eine reine Rechenfunktion schleifen.
 */
export type AffiliateTaxProfileInput = {
  entity_kind: AffiliateEntityKind | null;
  /** ISO-3166-1 alpha-2, Großbuchstaben (DB-CHECK `^[A-Z]{2}$`). */
  country: string | null;
  /** § 19 UStG. */
  small_business: boolean;
  vat_id: string | null;
  vat_check_result: AffiliateVatCheckResult | null;
  /** ISO-Zeitstempel der letzten VIES-Prüfung. */
  vat_checked_at: string | null;
};

/**
 * Warum keine Auszahlung entsteht. Der Partner sieht in seinem Bereich genau
 * diesen Grund als `role="alert"`, der Admin denselben unter „Nicht
 * auszahlbar" (7.1) — beide Seiten lesen denselben Schlüssel, damit
 * Rückfragen nicht an zwei verschiedenen Formulierungen desselben Problems
 * hängen.
 */
export const AFFILIATE_TAX_BLOCK_REASONS = [
  "entity_kind_missing",
  "country_missing",
  "private_entity",
  "eu_vat_missing",
  "vat_country_mismatch",
] as const;
export type AffiliateTaxBlockReason = (typeof AFFILIATE_TAX_BLOCK_REASONS)[number];

/**
 * Der Hinweistext, der nach § 14 Abs. 4 UStG auf der Gutschrift stehen MUSS.
 *
 * Bewusst hier und nicht in `messages/de.json`: das ist kein Oberflächentext,
 * sondern Belegtext. Eine Gutschrift ist ein Steuerdokument des deutschen
 * Rechtsträgers; der Hinweis auf Reverse Charge oder § 19 UStG ist eine
 * Pflichtangabe mit festem Wortlaut und wird nicht mit der Anzeigesprache des
 * Betrachters umgeschaltet. Übersetzt wird die BESCHRIFTUNG des Steuermodus in
 * der Oberfläche (`messageKey`), nie der Belegtext.
 */
export type AffiliateTaxResolution =
  | {
      ok: true;
      tax_mode: AffiliateTaxMode;
      tax_rate_bp: number;
      /** Pflichtangabe auf dem Beleg, fester deutscher Wortlaut. */
      documentHint: string;
      /** Schlüssel für die Beschriftung in der Oberfläche (i18n). */
      messageKey: string;
    }
  | { ok: false; reason: AffiliateTaxBlockReason };

/** Die vier Modi mit ihrem Satz, ihrem Belegtext und ihrem Anzeigeschlüssel. */
const TAX_MODES: Record<
  AffiliateTaxMode,
  { tax_rate_bp: number; documentHint: string; messageKey: string }
> = {
  regular: {
    tax_rate_bp: AFFILIATE_TAX_REGULAR_RATE_BP,
    documentHint: "Gutschrift gemäß § 14 Abs. 2 UStG",
    messageKey: "affiliate.tax.modeRegular",
  },
  small_business: {
    tax_rate_bp: 0,
    documentHint: "Kein Ausweis der Umsatzsteuer gemäß § 19 UStG.",
    messageKey: "affiliate.tax.modeSmallBusiness",
  },
  reverse_charge: {
    tax_rate_bp: 0,
    documentHint:
      "Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge), Art. 196 MwStSystRL.",
    messageKey: "affiliate.tax.modeReverseCharge",
  },
  non_eu: {
    tax_rate_bp: 0,
    documentHint: "Nicht im Inland steuerbare Leistung.",
    messageKey: "affiliate.tax.modeNonEu",
  },
};

/**
 * Der Pflichthinweis zu einem EINGEFRORENEN Steuermodus — ohne jeden Bezug auf
 * ein Abrechnungsprofil (7.4; Abnahme B8/B9, Befund 10).
 *
 * Der Belegtext gehört zum Beleg, nicht zum heutigen Stand des Profils. Wer ihn
 * für ein fehlendes PDF neu aus dem Profil ableitet, bekommt ihn nach 90 Tagen
 * gar nicht mehr: die VIES-Prüfung altert von selbst, `resolveAffiliateTaxMode()`
 * liefert dann `eu_vat_missing`, und ein gültiger, nummerierter Beleg mit
 * zehnjähriger Aufbewahrungsfrist bliebe dauerhaft ohne Darstellung. Dieselbe
 * Falle greift, wenn der Partner umzieht oder seine Rechtsform berichtigt.
 *
 * Deshalb: der Modus steht auf der Auszahlungszeile, der Text folgt aus dem
 * Modus, und zwar für immer aus diesem einen Nachschlagewerk.
 */
export function taxHintForMode(mode: AffiliateTaxMode): string {
  return TAX_MODES[mode].documentHint;
}

function resolved(mode: AffiliateTaxMode): AffiliateTaxResolution {
  const entry = TAX_MODES[mode];
  return {
    ok: true,
    tax_mode: mode,
    tax_rate_bp: entry.tax_rate_bp,
    documentHint: entry.documentHint,
    messageKey: entry.messageKey,
  };
}

/**
 * Ist die VIES-Prüfung gültig UND jünger als 90 Tage (7.4/7.5)?
 *
 * Fail-closed in jedem Zweig: ein unlesbarer Zeitstempel, ein Zeitstempel aus
 * der Zukunft (Uhrenversatz oder Manipulation) und ein fehlender Zeitstempel
 * führen alle zu `false`. Nur `valid` zählt — `unchecked` ist ausdrücklich
 * NICHT „wahrscheinlich in Ordnung": der Dienst war nicht erreichbar, und
 * daraus eine Steuerbefreiung abzuleiten ist genau der § 14c-Fall.
 */
export function hasCurrentVatCheck(
  profile: Pick<
    AffiliateTaxProfileInput,
    "country" | "vat_id" | "vat_check_result" | "vat_checked_at"
  >,
  now: Date,
): boolean {
  if (profile.vat_check_result !== "valid") return false;
  if (typeof profile.vat_id !== "string" || profile.vat_id.trim() === "") return false;
  // Eine geprüfte Nummer aus einem anderen Land als dem des Profils belegt für
  // dieses Profil nichts (siehe `vatIdCountryMatches()`). Die Prüfung steht
  // zusätzlich hier und nicht nur in `resolveAffiliateTaxMode()`, damit sie
  // auch ein künftiger zweiter Aufrufer mitbekommt.
  if (!vatIdCountryMatches(profile.vat_id, profile.country)) return false;
  if (typeof profile.vat_checked_at !== "string") return false;

  const checkedAt = Date.parse(profile.vat_checked_at);
  if (!Number.isFinite(checkedAt)) return false;

  const ageMs = now.getTime() - checkedAt;
  if (ageMs < 0) return false;
  return ageMs <= AFFILIATE_VAT_VALIDITY_DAYS * MS_PER_DAY;
}

/**
 * Der Steuermodus aus dem Abrechnungsprofil (7.4). Nie frei wählbar, und auf
 * dem Auszahlungssatz eingefroren — ein Profilwechsel nach der Freigabe ändert
 * einen erzeugten Beleg nicht mehr.
 *
 * Reihenfolge der Prüfungen ist Absicht: erst die Vollständigkeit, dann die
 * Privatperson (sie blockiert in JEDEM Land, also vor jeder Länderfrage), dann
 * die drei Ländermengen. Wer die Länderfrage vorzöge, gäbe einer deutschen
 * Privatperson `regular` und stellte ihr eine Gutschrift mit Steuerausweis aus.
 */
export function resolveAffiliateTaxMode(
  profile: AffiliateTaxProfileInput,
  now: Date = new Date(),
): AffiliateTaxResolution {
  if (profile.entity_kind === null) return { ok: false, reason: "entity_kind_missing" };

  // Fall 6 der Tabelle: Privatperson, jedes Land — blockierend, nicht warnend.
  if (profile.entity_kind === "private") return { ok: false, reason: "private_entity" };

  const country =
    typeof profile.country === "string" ? profile.country.trim().toUpperCase() : "";
  if (country === "") return { ok: false, reason: "country_missing" };

  // Länderpräfix der USt-IdNr. gegen das Land des Profils (7.5). Nur für
  // EU-Länder: außerhalb der EU ist die Leistung ohnehin nicht im Inland
  // steuerbar, und ein Drittlandpartner, der in das Feld seine nationale
  // Steuernummer geschrieben hat, darf daran nicht scheitern. Innerhalb der EU
  // entscheidet genau dieser Vergleich zwischen Reverse Charge und 19 %.
  if (
    isEuCountry(country) &&
    typeof profile.vat_id === "string" &&
    profile.vat_id.trim() !== "" &&
    !vatIdCountryMatches(profile.vat_id, country)
  ) {
    return { ok: false, reason: "vat_country_mismatch" };
  }

  if (country === AFFILIATE_TAX_HOME_COUNTRY) {
    // Fälle 1 und 2: Inland. Der Kleinunternehmer weist keine Steuer aus,
    // bekommt aber sehr wohl eine Gutschrift — nur eben ohne Steuerzeile.
    return resolved(profile.small_business ? "small_business" : "regular");
  }

  if (isEuCountry(country)) {
    // Fall 3 oder Fall 5 — und diese eine Verzweigung ist der ganze
    // Unterschied zwischen einem korrekten Reverse Charge und § 14c UStG.
    return hasCurrentVatCheck(profile, now)
      ? resolved("reverse_charge")
      : { ok: false, reason: "eu_vat_missing" };
  }

  // Fall 4: Drittland, Unternehmen. Der Leistungsort liegt beim Empfänger
  // (§ 3a Abs. 2 UStG), die Leistung ist im Inland nicht steuerbar.
  return resolved("non_eu");
}

// --- Steuerbetrag -------------------------------------------------------

export type AffiliateTaxAmounts = {
  subtotal_cents: number;
  tax_rate_bp: number;
  tax_cents: number;
  total_cents: number;
};

/**
 * `tax_cents` und `total_cents` (7.4):
 *
 * ```
 * tax_cents   = floor((subtotal_cents * tax_rate_bp + 5000) / 10000)
 * total_cents = subtotal_cents + tax_cents
 * ```
 *
 * DIES IST DIE EINZIGE STELLE IM GESAMTEN MODUL MIT KAUFMÄNNISCHER RUNDUNG.
 * Überall sonst gilt `Math.floor` (G12), weil dort eine Größe VERTEILT wird:
 * rundete man eine Provision auf, entstünde aus dem Runden selbst Geld, das
 * niemand eingenommen hat. Hier wird nichts verteilt, sondern eine ENDSUMME
 * gebildet — der Steuerbetrag zu einem feststehenden Entgelt. Das `+ 5000` vor
 * dem Abschneiden ist genau das Aufrunden ab einem halben Cent; es ist keine
 * zweite Rundungsphilosophie, sondern die vorgeschriebene für diesen einen
 * Betrag.
 *
 * Beispiel aus 7.4: `subtotal_cents = 15849`, `tax_rate_bp = 1900`
 * → `floor((15849 * 1900 + 5000) / 10000) = floor(3011,81) = 3011`
 * → 30,11 €, Gesamt 18860 = 188,60 €.
 *
 * ABWEICHUNG VOM PLANTEXT, bewusst: der Plan nennt an dieser Stelle
 * „floor(3016,31) = 3016" und „Gesamt 188,65 €". Das ist ein Zahlendreher im
 * Zwischenergebnis — 19 % von 158,49 € sind 30,1131 €, nicht 30,16 €.
 * Maßgeblich ist die Formel, nicht das nachgerechnete Beispiel; `tax.test.ts`
 * prüft deshalb 3011/18860 und hält die Abweichung fest.
 *
 * Ganzzahlbereich: `subtotal_cents` ist ein `int4` (< 2,15e9), multipliziert
 * mit höchstens 10000 ergibt das < 2,15e13 und bleibt damit weit unter
 * `Number.MAX_SAFE_INTEGER` (9,007e15) — kein BigInt nötig, anders als bei der
 * Storno-Differenz in `compute.ts`, die über zwei Beträge läuft.
 *
 * Negatives Entgelt: gibt es auf einem Beleg nicht. Ein Auszahlungssatz
 * entsteht erst ab `min_payout_cents` (7.1), ein negativer Saldo wird
 * vorgetragen (5.10). Die Funktion weist einen negativen Wert deshalb ab,
 * statt eine Rundungsrichtung zu erfinden, die niemand geprüft hat.
 */
export function computeAffiliateTax(
  subtotalCents: number,
  taxRateBp: number,
): AffiliateTaxAmounts {
  if (!Number.isInteger(subtotalCents) || subtotalCents < 0) {
    throw new Error("computeAffiliateTax: subtotal_cents muss eine ganze Zahl >= 0 sein.");
  }
  if (!Number.isInteger(taxRateBp) || taxRateBp < 0 || taxRateBp > 10_000) {
    throw new Error("computeAffiliateTax: tax_rate_bp muss ganzzahlig zwischen 0 und 10000 liegen.");
  }

  const tax = Math.floor((subtotalCents * taxRateBp + 5000) / 10_000);
  return {
    subtotal_cents: subtotalCents,
    tax_rate_bp: taxRateBp,
    tax_cents: tax,
    total_cents: subtotalCents + tax,
  };
}

/**
 * Beide Schritte in einem: Modus ableiten, dann rechnen. Der Auszahlungslauf
 * ruft genau diese Funktion — damit ist ausgeschlossen, dass irgendwo ein Satz
 * ohne den zugehörigen Modus (oder ein Modus ohne seinen Satz) verwendet wird.
 */
export type AffiliateTaxOutcome =
  | ({ ok: true; tax_mode: AffiliateTaxMode; documentHint: string; messageKey: string } & AffiliateTaxAmounts)
  | { ok: false; reason: AffiliateTaxBlockReason };

export function resolveAffiliateTax(
  profile: AffiliateTaxProfileInput,
  subtotalCents: number,
  now: Date = new Date(),
): AffiliateTaxOutcome {
  const mode = resolveAffiliateTaxMode(profile, now);
  if (!mode.ok) return mode;

  const amounts = computeAffiliateTax(subtotalCents, mode.tax_rate_bp);
  return {
    ok: true,
    tax_mode: mode.tax_mode,
    documentHint: mode.documentHint,
    messageKey: mode.messageKey,
    ...amounts,
  };
}
