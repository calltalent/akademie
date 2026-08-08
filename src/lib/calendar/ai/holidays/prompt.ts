import { buildHolidays, type CalendarHolidayCountry } from "@/lib/calendar/holidays";
import type { CalendarHolidayRegionCode } from "@/lib/calendar/schema";
import type { HolidayCheck, HolidayConflict, HolidayModelHoliday } from "@/lib/calendar/ai/holidays/schema";

/**
 * KI-Feiertagsrecherche (Block S5b, 08.08.2026) — reine, testbare
 * Prompt-/Mapping-/Abgleichs-/Konflikt-Funktionen, KEIN `server-only`, KEIN
 * I/O (gleiche Trennung wie `src/lib/calendar/ai/prompt.ts` (S4-Vorbild),
 * ausgelagert aus `pipeline.ts`, das über `createAnthropicClient()`
 * transitiv `server-only` zieht).
 *
 * DATENMINIMIERUNG (WICHTIG, SPEC §12/DSGVO Art. 5 Abs. 1 lit. c): der
 * Prompt enthält AUSSCHLIESSLICH Jahr und Regionscodes aus dem
 * geschlossenen Enum `CALENDAR_HOLIDAY_REGIONS` — kein Mandantenname,
 * keine E-Mail, keine UUID, kein Freitextfeld. Anders als beim
 * S4-Vorbild gibt es hier NICHTS Unvertrauenswürdiges einzubetten (das
 * Auslöse-Formular hat kein Freitextfeld) — die Angriffsfläche für
 * Prompt-Injection ist damit ENTFERNT statt nur GEMINDERT, deshalb kein
 * `UNTRUSTED_DATA_INSTRUCTION`-Marker nötig (architect-Plan Abschnitt 10,
 * Risiko 5).
 *
 * ROLLE VON `buildHolidays()` (holidays.ts): NICHT Prompt-Zutat (sonst
 * schreibt das Modell nur ab, kein echter Prüfwert), sondern NACHGELAGERTER
 * Abgleich über `crossCheckHolidays()`, siehe dort.
 */

// --- Regionsbeschriftungen (Deutsch, deckt sich mit messages/de.json
// admin.shiftCalendar.absences.region.*, S5a) --------------------------------

export const REGION_LABELS: Record<CalendarHolidayRegionCode, string> = {
  DE: "Deutschland",
  AT: "Österreich",
  CH: "Schweiz",
  HR: "Kroatien",
  RS: "Serbien",
  BA_FBIH: "Bosnien und Herzegowina — Föderation BiH",
  BA_RS: "Bosnien und Herzegowina — Republika Srpska",
  BA_BRCKO: "Bosnien und Herzegowina — Brčko-Distrikt",
};

const HOLIDAY_COUNTRY_REGIONS: readonly CalendarHolidayCountry[] = ["DE", "AT", "CH"];

function isHolidayCountryRegion(region: CalendarHolidayRegionCode): region is CalendarHolidayCountry {
  return (HOLIDAY_COUNTRY_REGIONS as readonly string[]).includes(region);
}

/** "2026-10-03" -> "03.10." — für den Klartext-Hinweis in crossCheckHolidays(). */
function formatGermanShortDate(isoDate: string): string {
  const [, month, day] = isoDate.split("-");
  return `${day}.${month}.`;
}

// --- Prompt-Bau (an Claude gesendet) ----------------------------------------

const JSON_ONLY_INSTRUCTION =
  "Antworte AUSSCHLIESSLICH mit einem einzigen gültigen JSON-Objekt, ohne Markdown-Codeblock, ohne Erklärung davor oder danach.";

export type HolidayResearchPromptContext = {
  year: number;
  regions: CalendarHolidayRegionCode[];
};

/**
 * System-/User-Prompt für den einstufigen KI-Feiertagsrecherche-Vorschlag.
 * Enthält für JEDE angeforderte Region den Klarnamen (`REGION_LABELS`) und
 * einen ausdrücklichen Satz, der `RS` (Staat Serbien) von `BA_RS`
 * (Republika Srpska, BiH-Entität) unterscheidet — Verwechslungsgefahr laut
 * architect-Plan Abschnitt 1.
 */
export function buildHolidayResearchPrompt(context: HolidayResearchPromptContext): { system: string; user: string } {
  const regionLines = context.regions.map((code) => `- ${code}: ${REGION_LABELS[code]}`).join("\n");

  const system = `Du bist ein Experte für gesetzliche Feiertage in Europa, insbesondere im DACH-Raum und auf dem Westbalkan. Recherchiere die gesetzlichen Feiertage der genannten Regionen für das genannte Jahr.

REGIONEN (Code: Klarname):
${regionLines}

WICHTIGER HINWEIS ZUR VERWECHSLUNGSGEFAHR: "RS" ist der ISO-3166-1-alpha-2-Code des Staates Serbien (Republik Serbien). "BA_RS" ist dagegen die Republika Srpska, eine der beiden Entitäten INNERHALB des Staates Bosnien und Herzegowina, mit einem eigenen, eigenständigen Feiertagsregime — NICHT identisch mit Serbien. Verwechsle diese beiden Codes NICHT und übernimm für "BA_RS" keinesfalls die Feiertage Serbiens.

REGELN:
1. Nenne für JEDE genannte Region ausschließlich die landesweit bzw. entitätsweit gültigen gesetzlichen Feiertage des angegebenen Jahres — keine regionalen oder kommunalen Feiertage einzelner Bundesländer, Kantone, Woiwodschaften oder Gemeinden.
2. Verwende im Feld "region" AUSSCHLIESSLICH die genannten Regionscodes exakt wie oben angegeben (z. B. "DE", "BA_RS") — erfinde keine neuen Codes und keine Ländercodes, die nicht in der Liste stehen.
3. Jedes Datum im Format "yyyy-mm-dd", innerhalb des Jahres ${context.year}.
4. "name" ist die übliche deutsche oder landessprachliche Bezeichnung des Feiertags, höchstens 120 Zeichen.
5. Wenn du für eine Region kein verlässliches Wissen hast, lasse sie eher aus, als einen Feiertag zu erfinden — beschreibe die Lücke ehrlich im Feld "notes".

${JSON_ONLY_INSTRUCTION}
Format: {"holidays": [{"region": "DE", "date": "yyyy-mm-dd", "name": string}], "notes": string (optional)}`;

  const user = `Recherchiere die gesetzlichen Feiertage für das Jahr ${context.year} für folgende Regionen: ${context.regions.join(", ")}.`;

  return { system, user };
}

// --- Zuordnung Modellcode -> Entwurfszeile (per Code, nicht per KI) --------

export type HolidayMappedRow = { id: string; region: CalendarHolidayRegionCode; date: string; name: string };

/**
 * Übernimmt eine Modell-Feiertagszeile 1:1 in eine Entwurfszeile (anders als
 * beim S4-Vorbild gibt es kein Pseudonym aufzulösen — der Regionscode IST
 * bereits der Zielwert). Eine Zeile mit einem Regionscode, der nicht Teil
 * der ANGEFORDERTEN Regionen ist (Claude antwortet z. B. mit einer nicht
 * gewählten Region, obwohl der Code selbst gültig ist), wird VERWORFEN und
 * in `unresolvedNotes` protokolliert, statt den ganzen Lauf zu verwerfen —
 * exakt das Muster von `mapDraftRows()` (S4-Vorbild, `calendar/ai/
 * prompt.ts`) bei unbekannten Pseudonymen.
 */
export function mapHolidayDraftRows(
  modelHolidays: HolidayModelHoliday[],
  requestedRegions: CalendarHolidayRegionCode[],
): { rows: HolidayMappedRow[]; unresolvedNotes: string[] } {
  const requestedSet = new Set(requestedRegions);
  const rows: HolidayMappedRow[] = [];
  const unresolvedNotes: string[] = [];

  for (const holiday of modelHolidays) {
    if (!requestedSet.has(holiday.region)) {
      unresolvedNotes.push(`Nicht angeforderte Region „${holiday.region}“ — Zeile verworfen.`);
      continue;
    }
    rows.push({
      id: crypto.randomUUID(),
      region: holiday.region,
      date: holiday.date,
      name: holiday.name,
    });
  }

  return { rows, unresolvedNotes };
}

// --- Abgleich gegen buildHolidays() (rein, läuft NACH der Antwort) ---------

export type HolidayCheckedRow = HolidayMappedRow & { check: HolidayCheck | null };

/**
 * Setzt je Entwurfszeile `check`: für `DE`/`AT`/`CH` `"confirmed"`, wenn
 * das Datum in `buildHolidays(region, year)` steht, sonst `"unverified"`.
 * Für alle anderen Regionen (`HR`,`RS`,`BA_*`) gibt es keine deterministische
 * Referenzliste — `check: null`.
 *
 * Meldet zusätzlich Feiertage, die `buildHolidays()` für eine in den Zeilen
 * VERTRETENE `DE`/`AT`/`CH`-Region kennt, die das Modell aber ausgelassen
 * hat, als Klartext-Hinweis in `missingNotes` — bewusst NICHT automatisch
 * als Zeile ergänzt (architect-Plan Abschnitt 2, würde die Entscheidung
 * "alle Regionen laufen über die KI" unterlaufen).
 */
export function crossCheckHolidays(
  rows: HolidayMappedRow[],
  year: number,
): { rows: HolidayCheckedRow[]; missingNotes: string[] } {
  const checkedRows: HolidayCheckedRow[] = rows.map((row) => {
    if (!isHolidayCountryRegion(row.region)) {
      return { ...row, check: null };
    }
    const referenceList = buildHolidays(row.region, year);
    const confirmed = referenceList.some((h) => h.date === row.date);
    return { ...row, check: confirmed ? "confirmed" : "unverified" };
  });

  const presentCountryRegions = Array.from(
    new Set(rows.map((r) => r.region).filter(isHolidayCountryRegion)),
  );
  const missingNotes: string[] = [];
  for (const region of presentCountryRegions) {
    const referenceList = buildHolidays(region, year);
    const rowDatesForRegion = new Set(rows.filter((r) => r.region === region).map((r) => r.date));
    const missing = referenceList.filter((h) => !rowDatesForRegion.has(h.date));
    if (missing.length > 0) {
      const missingText = missing.map((h) => `${formatGermanShortDate(h.date)} ${h.name}`).join(", ");
      missingNotes.push(`Der Abgleich kennt für ${REGION_LABELS[region]} zusätzlich: ${missingText}.`);
    }
  }

  return { rows: checkedRows, missingNotes };
}

// --- Konflikterkennung (rein, läuft NACH dem Abgleich, nur serverseitig) ---

export type HolidayExistingRow = { date: string };

/**
 * Setzt `conflict` je Zeile — `outside-year` (Datum liegt nicht im
 * angeforderten Jahr) vor `existing` (für dieses Datum existiert bereits
 * eine Feiertagszeile in `calendar_absences`) vor `duplicate` (eine ANDERE
 * Zeile desselben Laufs trägt dasselbe Datum — nur die erste bleibt frei,
 * jede weitere wird `duplicate`). Konfliktzeilen werden NICHT verworfen —
 * die Review-UI zeigt sie vorab abgewählt mit Textbadge, exakt das Muster
 * von `detectConflicts()` (S4-Vorbild).
 */
export function detectHolidayConflicts(
  rows: HolidayCheckedRow[],
  context: { year: number; existingHolidays: HolidayExistingRow[] },
): (HolidayCheckedRow & { conflict: HolidayConflict | null })[] {
  const existingDates = new Set(context.existingHolidays.map((h) => h.date));
  const yearPrefix = `${context.year}-`;

  return rows.map((row, index) => {
    let conflict: HolidayConflict | null = null;

    if (!row.date.startsWith(yearPrefix)) {
      conflict = "outside-year";
    }

    if (!conflict && existingDates.has(row.date)) {
      conflict = "existing";
    }

    if (!conflict) {
      const firstIndexWithSameDate = rows.findIndex((r) => r.date === row.date);
      if (firstIndexWithSameDate !== index) {
        conflict = "duplicate";
      }
    }

    return { ...row, conflict };
  });
}
