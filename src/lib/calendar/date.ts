/**
 * Reine Datumsfunktionen für den Schichtplan-Kalender (Block S1, 07.08.2026).
 *
 * KEIN Datums-/Kalender-Package (kein date-fns, kein dayjs, kein
 * react-day-picker, kein react-big-calendar — CLAUDE.md-Feature-Vorgabe).
 * Formatierung ausschließlich über die eingebaute `Intl`-API mit expliziter
 * Zeitzone `Europe/Berlin`, unabhängig davon, in welcher Zeitzone der
 * Server/Client tatsächlich läuft (Vercel/Cloudflare-Worker laufen i. d. R.
 * in UTC — ohne explizite Zeitzone würde "heute" auf dem Server einen
 * anderen Tag ergeben als für einen Nutzer in Deutschland).
 *
 * Alle Funktionen arbeiten mit `Date`-Instanzen, die einen konkreten
 * UTC-Zeitpunkt repräsentieren (wie jeder aus der DB gelesene `timestamptz`-
 * Wert) — "Berlin-lokaler Tag/Uhrzeit" ist nur eine Lese-/Rechenperspektive
 * auf denselben Zeitpunkt, nie ein eigener Datentyp.
 *
 * Zeitumstellung: `addDays()`/`startOfIsoWeek()` rechnen bewusst NICHT mit
 * "+24h in Millisekunden" (das würde an Umstellungstagen die Uhrzeit
 * verschieben), sondern zonen-bewusst über das Standard-Verfahren
 * "Wall-Zeit-Ziel bestimmen → durch einen Korrekturdurchlauf den passenden
 * UTC-Zeitpunkt dafür finden" (`zonedTimeToUtc()`), das auch date-fns-tz und
 * vergleichbare Bibliotheken intern verwenden. Getestet gegen beide
 * Umstellungstage 2026 in `date.test.ts` (29.03. Sommerzeit-Beginn, 23h-Tag;
 * 25.10. Winterzeit-Beginn, 25h-Tag).
 */

export const CALENDAR_TIME_ZONE = "Europe/Berlin";

type ZonedParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/** Zerlegt einen UTC-Zeitpunkt in seine Kalender-/Uhrzeit-Bestandteile in `timeZone`. */
function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(date);
  const map: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = Number(part.value);
  }
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    // `h23` liefert für Mitternacht laut ICU-Konvention teils "24" statt "0"
    // in manchen Node-/ICU-Versionen — auf 0-23 normalisieren.
    hour: map.hour === 24 ? 0 : map.hour,
    minute: map.minute,
    second: map.second,
  };
}

/**
 * Findet den UTC-Zeitpunkt, der in `timeZone` genau der angegebenen
 * Wanduhrzeit (Jahr/Monat/Tag/Stunde/Minute/Sekunde) entspricht.
 * Standard-Korrekturverfahren: zuerst so tun, als wäre die Wanduhrzeit
 * bereits UTC (erste Schätzung), dann die tatsächliche Zeitzonenverschiebung
 * für DIESEN Zeitpunkt ermitteln und die Schätzung um die Differenz
 * korrigieren. Für Europe/Berlin (fester Versatz von UTC+1/UTC+2 ohne
 * untertägige Sprünge außerhalb der zwei Umstellungsstunden) reicht ein
 * einziger Korrekturdurchlauf.
 */
function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const zoned = getZonedParts(new Date(utcGuess), timeZone);
  const zonedAsUtc = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second);
  const driftMs = zonedAsUtc - utcGuess;
  return new Date(utcGuess - driftMs);
}

/** Kalender-Wochentag (ISO: Montag=1 … Sonntag=7) einer y/m/d-Kombination — zeitzonenunabhängig, reine Kalenderarithmetik. */
function isoWeekday(year: number, month: number, day: number): number {
  const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0=So … 6=Sa
  return jsDay === 0 ? 7 : jsDay;
}

/** Berlin-lokales Datum als "yyyy-mm-dd" (für Gruppierung von Schichten je Kalendertag). */
export function isoDateString(date: Date): string {
  const p = getZonedParts(date, CALENDAR_TIME_ZONE);
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/**
 * Montag 00:00 Uhr Berlin-Zeit der ISO-Woche, die `date` enthält — als
 * UTC-Zeitpunkt. Rechnet über Berlin-Kalendertage (nicht UTC-Tage), damit
 * der Wochenanfang für den Nutzer immer korrekt "Montag" ist, unabhängig
 * davon, welcher UTC-Kalendertag zum selben Zeitpunkt gerade läuft.
 */
export function startOfIsoWeek(date: Date): Date {
  const p = getZonedParts(date, CALENDAR_TIME_ZONE);
  const daysSinceMonday = isoWeekday(p.year, p.month, p.day) - 1;
  const mondayUtcDayMs = Date.UTC(p.year, p.month - 1, p.day) - daysSinceMonday * 86_400_000;
  const mondayDayOnly = new Date(mondayUtcDayMs);
  return zonedTimeToUtc(
    mondayDayOnly.getUTCFullYear(),
    mondayDayOnly.getUTCMonth() + 1,
    mondayDayOnly.getUTCDate(),
    0,
    0,
    0,
    CALENDAR_TIME_ZONE,
  );
}

/**
 * `date` um `days` Berlin-Kalendertage verschoben, bei GLEICHER Berlin-
 * Wanduhrzeit (z. B. 08:00 Berlin + 1 Tag = 08:00 Berlin am Folgetag — auch
 * an einem Umstellungstag, an dem das in UTC-Millisekunden KEINE 24h sind).
 */
export function addDays(date: Date, days: number): Date {
  const p = getZonedParts(date, CALENDAR_TIME_ZONE);
  const shiftedDayOnlyMs = Date.UTC(p.year, p.month - 1, p.day) + days * 86_400_000;
  const shiftedDayOnly = new Date(shiftedDayOnlyMs);
  return zonedTimeToUtc(
    shiftedDayOnly.getUTCFullYear(),
    shiftedDayOnly.getUTCMonth() + 1,
    shiftedDayOnly.getUTCDate(),
    p.hour,
    p.minute,
    p.second,
    CALENDAR_TIME_ZONE,
  );
}

/** ISO-8601-Wochennummer (1–53) des Berlin-Kalendertags von `date`. Klassischer Algorithmus (Donnerstag-Regel). */
export function isoWeekNumber(date: Date): number {
  const p = getZonedParts(date, CALENDAR_TIME_ZONE);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

export type WeekGridDay = { date: Date; isoDate: string };

/** 7 Tage (Montag…Sonntag) ab `weekStart` (Ergebnis von `startOfIsoWeek()`), je mit UTC-Zeitpunkt (Berlin-Mitternacht) und Gruppierungsschlüssel. */
export function buildWeekGrid(weekStart: Date): WeekGridDay[] {
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    return { date, isoDate: isoDateString(date) };
  });
}

/** "Montag, 10. August" — für den sprechenden `aria-label` je Schicht/Tag (Barrierefreiheit, CLAUDE.md §3.4). */
export function formatDayLabel(date: Date, locale = "de-DE"): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: CALENDAR_TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}

/** "10. August" ohne Wochentag — für kompakte Spaltenköpfe. */
export function formatShortDayLabel(date: Date, locale = "de-DE"): string {
  return new Intl.DateTimeFormat(locale, { timeZone: CALENDAR_TIME_ZONE, day: "numeric", month: "long" }).format(date);
}

/** "08:00" im 24h-Format, Berlin-Zeit. */
export function formatTime(date: Date, locale = "de-DE"): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: CALENDAR_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

/** "08:00–16:00" — für die sichtbare Karten-Beschriftung (der gesprochene aria-label-Text baut die Komponente per i18n-Vorlage mit "bis" statt Gedankenstrich, siehe messages/de.json learn.shiftCalendar). */
export function formatTimeRange(startsAt: Date, endsAt: Date, locale = "de-DE"): string {
  return `${formatTime(startsAt, locale)}–${formatTime(endsAt, locale)}`;
}

/** Minuten zwischen zwei Zeitpunkten (kann negativ sein, wenn `b` vor `a` liegt) — reine Instant-Differenz, zeitzonenunabhängig. */
export function minutesBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 60_000;
}

/** Ob zwei Zeitpunkte auf denselben Berlin-Kalendertag fallen. */
export function isSameBerlinDay(a: Date, b: Date): boolean {
  return isoDateString(a) === isoDateString(b);
}

// =====================================================================
// Block S2 (08.08.2026) — Ergänzungen für Admin-Schicht-CRUD und
// Zeitfenster-Serienanlage. Bestehende Funktionen oben UNVERÄNDERT.
// =====================================================================

/** "yyyy-mm-dd" -> [Jahr, Monat, Tag] als Zahlen, ungeprüft (Aufrufer validiert per zod-Schema vor dem Aufruf). */
function parseIsoDate(isoDate: string): [number, number, number] {
  const [y, m, d] = isoDate.split("-").map(Number);
  return [y, m, d];
}

/** "hh:mm" -> [Stunde, Minute] als Zahlen, ungeprüft (Aufrufer validiert per zod-Schema vor dem Aufruf). */
function parseHhMm(time: string): [number, number] {
  const [h, min] = time.split(":").map(Number);
  return [h, min];
}

/**
 * Wandelt ein Berlin-lokales Datum+Uhrzeit ("yyyy-mm-dd", "hh:mm") in den
 * entsprechenden UTC-Zeitpunkt um — Kernbaustein für `createCalendarShift`/
 * `createCalendarSlots` (Formular liefert Datum+Uhrzeit getrennt als
 * `<input type="date">`/`<input type="time">`-Werte, die DB will einen
 * einzigen `timestamptz`). Nutzt dieselbe zonenbewusste Korrektur wie
 * `startOfIsoWeek()`/`addDays()` oben (`zonedTimeToUtc()`).
 */
export function berlinDateTimeToUtc(isoDate: string, timeHhMm: string): Date {
  const [year, month, day] = parseIsoDate(isoDate);
  const [hour, minute] = parseHhMm(timeHhMm);
  return zonedTimeToUtc(year, month, day, hour, minute, 0, CALENDAR_TIME_ZONE);
}

/**
 * `Date` -> immer zweistelliges "HH:MM" in Berlin-Ortszeit, unabhängig vom
 * Locale (für den `value` eines `<input type="time">` — der HTML-Standard
 * verlangt exakt dieses Format, ein Locale-abhängiges `formatTime()` wäre
 * hier riskant, siehe MDN `<input type="time">`).
 */
export function toTimeInputValue(date: Date): string {
  const p = getZonedParts(date, CALENDAR_TIME_ZONE);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** `isoDate` um `days` Berlin-Kalendertage verschoben, als "yyyy-mm-dd" (Mitternacht-Anker — an beiden deutschen Umstellungstagen unproblematisch, die Umstellung selbst liegt nachts um 02:00/03:00, nie um 00:00). */
function shiftIsoDate(isoDate: string, days: number): string {
  const [year, month, day] = parseIsoDate(isoDate);
  const anchor = zonedTimeToUtc(year, month, day, 0, 0, 0, CALENDAR_TIME_ZONE);
  return isoDateString(addDays(anchor, days));
}

/**
 * Erzeugt eine wöchentliche Terminserie für die Zeitfenster-Serienanlage
 * (`createCalendarSlots`): `weeks` Termine, jeweils 7 Berlin-Kalendertage
 * auseinander, bei GLEICHER Berlin-Wanduhrzeit (`addDays()`-Prinzip, siehe
 * oben — bleibt auch über eine Zeitumstellung hinweg wanduhrzeittreu, auch
 * wenn sich dadurch der UTC-Versatz zwischen zwei Terminen ändert).
 *
 * `endTime <= startTime` heißt Nachtschicht: das Ende liegt einen
 * Kalendertag nach dem Beginn (z. B. 22:00 -> 06:00 am Folgetag). Ein
 * Gleichstand (`endTime === startTime`) wird von den zod-Schemas bereits
 * VOR dem Aufruf abgelehnt (`calendarSlotSchema`/`calendarShiftSchema`
 * verlangen `startTime !== endTime`) — hier trotzdem als Nachtschicht
 * behandelt, falls die Funktion direkt (z. B. in einem Test) ohne
 * vorgeschaltete Validierung aufgerufen wird.
 */
export function buildWeeklySeries(
  firstDateIso: string,
  startTime: string,
  endTime: string,
  weeks: number,
): { startsAt: Date; endsAt: Date }[] {
  const isNightShift = endTime <= startTime;
  const series: { startsAt: Date; endsAt: Date }[] = [];

  for (let i = 0; i < weeks; i++) {
    const dateIso = i === 0 ? firstDateIso : shiftIsoDate(firstDateIso, i * 7);
    const startsAt = berlinDateTimeToUtc(dateIso, startTime);
    const endDateIso = isNightShift ? shiftIsoDate(dateIso, 1) : dateIso;
    const endsAt = berlinDateTimeToUtc(endDateIso, endTime);
    series.push({ startsAt, endsAt });
  }

  return series;
}
