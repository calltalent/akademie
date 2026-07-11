import { describe, expect, it } from "vitest";
import { parseVttToPlainText } from "./vtt";

describe("parseVttToPlainText", () => {
  it("liefert leeren String für leere/undefinierte Eingabe", () => {
    expect(parseVttToPlainText("")).toBe("");
    expect(parseVttToPlainText("   \n\n  ")).toBe("");
  });

  it("extrahiert Fließtext aus einer Standard-VTT mit numerischen Cue-IDs", () => {
    const vtt = [
      "WEBVTT",
      "",
      "1",
      "00:00:00.000 --> 00:00:02.500",
      "Hallo und willkommen",
      "",
      "2",
      "00:00:02.500 --> 00:00:05.000",
      "zu dieser Lektion.",
      "",
    ].join("\n");
    expect(parseVttToPlainText(vtt)).toBe("Hallo und willkommen zu dieser Lektion.");
  });

  it("funktioniert ohne WEBVTT-Kopfzeile und ohne Cue-Nummern", () => {
    const vtt = [
      "00:00:00.000 --> 00:00:02.000",
      "Erster Satz.",
      "",
      "00:00:02.000 --> 00:00:04.000",
      "Zweiter Satz.",
    ].join("\n");
    expect(parseVttToPlainText(vtt)).toBe("Erster Satz. Zweiter Satz.");
  });

  it("verarbeitet Zeitstempel mit Stunden-Anteil", () => {
    const vtt = ["WEBVTT", "", "01:02:03.000 --> 01:02:05.000", "Spät im Video."].join("\n");
    expect(parseVttToPlainText(vtt)).toBe("Spät im Video.");
  });

  it("entfernt benannte (nicht-numerische) Cue-Identifikatoren vor Zeitstempeln", () => {
    const vtt = [
      "WEBVTT",
      "",
      "cue-intro",
      "00:00:00.000 --> 00:00:02.000",
      "Intro-Text.",
    ].join("\n");
    expect(parseVttToPlainText(vtt)).toBe("Intro-Text.");
  });

  it("entfernt einfache Inline-Tags (<v>, <b>, <i>)", () => {
    const vtt = [
      "WEBVTT",
      "",
      "1",
      "00:00:00.000 --> 00:00:02.000",
      "<v Sprecher>Das ist <b>wichtig</b> und <i>betont</i>.",
    ].join("\n");
    expect(parseVttToPlainText(vtt)).toBe("Das ist wichtig und betont.");
  });

  it("reduziert aufeinanderfolgende identische Zeilen (Karaoke-Wiederholung) auf eine", () => {
    const vtt = [
      "WEBVTT",
      "",
      "1",
      "00:00:00.000 --> 00:00:01.000",
      "Hallo Welt",
      "",
      "2",
      "00:00:01.000 --> 00:00:02.000",
      "Hallo Welt",
      "",
      "3",
      "00:00:02.000 --> 00:00:03.000",
      "Neuer Satz",
    ].join("\n");
    expect(parseVttToPlainText(vtt)).toBe("Hallo Welt Neuer Satz");
  });

  it("überspringt NOTE-Kommentarzeilen", () => {
    const vtt = [
      "WEBVTT",
      "",
      "NOTE Dies ist ein Kommentar",
      "",
      "1",
      "00:00:00.000 --> 00:00:02.000",
      "Sichtbarer Text.",
    ].join("\n");
    expect(parseVttToPlainText(vtt)).toBe("Sichtbarer Text.");
  });

  it("liefert leeren String bei kaputter/unvollständiger VTT ohne Cue-Inhalt", () => {
    const vtt = "WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.000\n";
    expect(parseVttToPlainText(vtt)).toBe("");
  });

  it("normalisiert Windows-Zeilenumbrüche (\\r\\n)", () => {
    const vtt = "WEBVTT\r\n\r\n1\r\n00:00:00.000 --> 00:00:01.000\r\nText mit CRLF.\r\n";
    expect(parseVttToPlainText(vtt)).toBe("Text mit CRLF.");
  });
});
