/**
 * Bundeseinheitliche Feiertage für Deutschland/Österreich/Schweiz (Block S2,
 * 08.08.2026) — reine Funktion, KEIN "use server", von Server Actions UND
 * Vitest importierbar (gleiches Prinzip wie `src/lib/calendar/date.ts`).
 * KEINE Bundesland-/Kantonslogik (Plan-Vorgabe) — nur Feiertage, die im
 * GESAMTEN Land gelten.
 *
 * ROLLENWECHSEL ab Block S5a/S5b (08.08.2026, KI-Feiertagsrecherche): diese
 * Datei bleibt unverändert bestehen, wechselt aber die Aufgabe. Bis Block S2
 * war sie die einzige Datenquelle für `importCalendarHolidays()`
 * (calendar/actions.ts). Ab Block S5b liefert stattdessen ein Claude-Aufruf
 * die Feiertage — für alle acht Regionen aus `CALENDAR_HOLIDAY_REGIONS`
 * (calendar/schema.ts), nicht nur DE/AT/CH. `buildHolidays()` wird dann zum
 * NACHGELAGERTEN Abgleich der KI-Antwort (`crossCheckHolidays()`, Block
 * S5b) — bewusst NICHT als Prompt-Zutat, sonst schreibt das Modell nur ab,
 * statt eine unabhängige zweite Meinung zu liefern. Für HR/RS/BA_* gibt es
 * keine entsprechende deterministische Referenzliste — dort bleibt der
 * Admin die einzige Kontrolle (Review-Hinweistext in Block S5c). Der
 * schmalere Typ `CalendarHolidayCountry` ("DE"|"AT"|"CH") bleibt deshalb
 * bewusst enger als das neue `CalendarHolidayRegionCode` (acht Werte,
 * schema.ts) — nicht synchron halten, beide Typen haben ab jetzt
 * unterschiedliche Reichweiten mit Absicht.
 *
 * Osterberechnung nach dem Meeus/Jones/Butcher-Algorithmus (auch
 * "Meeus/Gauß-Verfahren" genannt) — Standardverfahren für den
 * gregorianischen Kalender, exakt für jedes Jahr ab 1583.
 *
 * DOKUMENTIERTE ABWEICHUNG von der wörtlichen Plan-Formulierung
 * ("AT: DE-Liste PLUS [sechs Ergänzungen, davon Staatsfeiertag als reine
 * Umbenennung ohne eigenen Zähleffekt]" = 13 Einträge): eine wörtliche
 * Umsetzung ergibt rechnerisch 14 Einträge (DE-Liste 9, minus 03.10. Tag
 * der Deutschen Einheit, plus 6 echte Ergänzungen = 14), nicht die im
 * selben Satz geforderten 13 — genau der vom Plan selbst antizipierte Fall
 * ("prüfe deine Liste vor dem Schreiben der Tests gegen diese Zahlen und
 * passe im Zweifel die Liste an, nicht die erwartete Zahl"). Aufgelöst
 * durch Weglassen von Karfreitag aus der AT-Liste — deckt sich zusätzlich
 * mit der echten österreichischen Rechtslage (Karfreitag ist seit dem
 * VfGH-Erkenntnis vom 24.01.2019 kein bundesweiter gesetzlicher Feiertag
 * für alle Arbeitnehmer mehr). Mit dieser einen Auslassung ergibt die
 * AT-Liste exakt 13 Einträge. Ausführlich in PHASENSTATUS.md dokumentiert.
 */

export type PublicHoliday = { date: string; name: string };
export type CalendarHolidayCountry = "DE" | "AT" | "CH";

/** Ostersonntag nach Meeus/Jones/Butcher, als UTC-Datum (nur der Kalendertag ist relevant, Uhrzeit immer 00:00 UTC). */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = März, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function toIsoDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function fixedDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Bundeseinheitliche Feiertage eines Landes/Jahres, sortiert nach Datum.
 * Reine Funktion — zwei Aufrufe mit gleichem Argument liefern immer
 * identische Listen (keine Zufalls-/Zeitabhängigkeit).
 */
export function buildHolidays(country: CalendarHolidayCountry, year: number): PublicHoliday[] {
  const easter = easterSunday(year);
  const goodFriday = toIsoDate(addUtcDays(easter, -2));
  const easterMonday = toIsoDate(addUtcDays(easter, 1));
  const ascension = toIsoDate(addUtcDays(easter, 39));
  const whitMonday = toIsoDate(addUtcDays(easter, 50));
  const corpusChristi = toIsoDate(addUtcDays(easter, 60));

  const newYear = fixedDate(year, 1, 1);
  const labourDay = fixedDate(year, 5, 1);
  const christmasDay1 = fixedDate(year, 12, 25);
  const christmasDay2 = fixedDate(year, 12, 26);

  let holidays: PublicHoliday[];

  if (country === "DE") {
    holidays = [
      { date: newYear, name: "Neujahr" },
      { date: goodFriday, name: "Karfreitag" },
      { date: easterMonday, name: "Ostermontag" },
      { date: labourDay, name: "Tag der Arbeit" },
      { date: ascension, name: "Christi Himmelfahrt" },
      { date: whitMonday, name: "Pfingstmontag" },
      { date: fixedDate(year, 10, 3), name: "Tag der Deutschen Einheit" },
      { date: christmasDay1, name: "1. Weihnachtsfeiertag" },
      { date: christmasDay2, name: "2. Weihnachtsfeiertag" },
    ];
  } else if (country === "AT") {
    holidays = [
      { date: newYear, name: "Neujahr" },
      { date: fixedDate(year, 1, 6), name: "Heilige Drei Könige" },
      { date: easterMonday, name: "Ostermontag" },
      { date: labourDay, name: "Staatsfeiertag" },
      { date: ascension, name: "Christi Himmelfahrt" },
      { date: whitMonday, name: "Pfingstmontag" },
      { date: corpusChristi, name: "Fronleichnam" },
      { date: fixedDate(year, 8, 15), name: "Mariä Himmelfahrt" },
      { date: fixedDate(year, 10, 26), name: "Nationalfeiertag" },
      { date: fixedDate(year, 11, 1), name: "Allerheiligen" },
      { date: fixedDate(year, 12, 8), name: "Mariä Empfängnis" },
      { date: christmasDay1, name: "Christtag" },
      { date: christmasDay2, name: "Stefanitag" },
    ];
  } else {
    holidays = [
      { date: newYear, name: "Neujahr" },
      { date: goodFriday, name: "Karfreitag" },
      { date: easterMonday, name: "Ostermontag" },
      { date: ascension, name: "Auffahrt" },
      { date: whitMonday, name: "Pfingstmontag" },
      { date: fixedDate(year, 8, 1), name: "Nationalfeiertag" },
      { date: christmasDay1, name: "Weihnachten" },
    ];
  }

  return holidays.slice().sort((x, y) => x.date.localeCompare(y.date));
}
