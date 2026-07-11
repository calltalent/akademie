import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

const BOM = "﻿";

describe("toCsv", () => {
  it("erzeugt eine einfache Tabelle ohne Sonderzeichen", () => {
    const csv = toCsv(
      ["Kurs", "Eingeschrieben"],
      [
        ["Einsteiger-Kurs", 12],
        ["Fortgeschritten", 5],
      ],
    );
    expect(csv).toBe(
      `${BOM}Kurs,Eingeschrieben\r\nEinsteiger-Kurs,12\r\nFortgeschritten,5`,
    );
  });

  it("schließt ein Feld mit Komma in Anführungszeichen ein", () => {
    const csv = toCsv(["Name"], [["Nachname, Vorname"]]);
    expect(csv).toBe(`${BOM}Name\r\n"Nachname, Vorname"`);
  });

  it("verdoppelt Anführungszeichen innerhalb eines Felds", () => {
    const csv = toCsv(["Titel"], [['Der "beste" Kurs']]);
    expect(csv).toBe(`${BOM}Titel\r\n"Der ""beste"" Kurs"`);
  });

  it("liefert bei leerem Datensatz nur BOM + Kopfzeile", () => {
    const csv = toCsv(["Kurs", "Eingeschrieben"], []);
    expect(csv).toBe(`${BOM}Kurs,Eingeschrieben`);
  });

  it("schließt ein Feld mit Zeilenumbruch in Anführungszeichen ein", () => {
    const csv = toCsv(["Feedback"], [["Zeile 1\nZeile 2"]]);
    expect(csv).toBe(`${BOM}Feedback\r\n"Zeile 1\nZeile 2"`);
  });
});
