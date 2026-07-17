import { describe, expect, it } from "vitest";
import { parseVttCues, serializeVttCues } from "./vtt-cues";

describe("parseVttCues", () => {
  it("liefert ein leeres Array für leere/undefinierte Eingabe", () => {
    expect(parseVttCues("")).toEqual([]);
    expect(parseVttCues("   \n\n  ")).toEqual([]);
  });

  it("parst Cues mit numerischer ID", () => {
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
    ].join("\n");

    expect(parseVttCues(vtt)).toEqual([
      { id: "1", timing: "00:00:00.000 --> 00:00:02.500", settings: "", text: "Hallo und willkommen" },
      { id: "2", timing: "00:00:02.500 --> 00:00:05.000", settings: "", text: "zu dieser Lektion." },
    ]);
  });

  it("parst Cues ohne ID", () => {
    const vtt = [
      "WEBVTT",
      "",
      "00:00:00.000 --> 00:00:02.000",
      "Erster Satz.",
      "",
      "00:00:02.000 --> 00:00:04.000",
      "Zweiter Satz.",
    ].join("\n");

    expect(parseVttCues(vtt)).toEqual([
      { id: null, timing: "00:00:00.000 --> 00:00:02.000", settings: "", text: "Erster Satz." },
      { id: null, timing: "00:00:02.000 --> 00:00:04.000", settings: "", text: "Zweiter Satz." },
    ]);
  });

  it("trennt Cue-Settings von der Timing-Zeile", () => {
    const vtt = ["WEBVTT", "", "00:00:00.000 --> 00:00:02.000 align:start position:0%", "Text mit Settings."].join(
      "\n",
    );

    expect(parseVttCues(vtt)).toEqual([
      {
        id: null,
        timing: "00:00:00.000 --> 00:00:02.000",
        settings: "align:start position:0%",
        text: "Text mit Settings.",
      },
    ]);
  });

  it("überspringt NOTE-Blöcke, echte Cues bleiben erhalten", () => {
    const vtt = [
      "WEBVTT",
      "",
      "NOTE Dies ist ein Kommentar",
      "",
      "1",
      "00:00:00.000 --> 00:00:02.000",
      "Sichtbarer Text.",
    ].join("\n");

    expect(parseVttCues(vtt)).toEqual([
      { id: "1", timing: "00:00:00.000 --> 00:00:02.000", settings: "", text: "Sichtbarer Text." },
    ]);
  });

  it("normalisiert Windows-Zeilenumbrüche (\\r\\n)", () => {
    const vtt = "WEBVTT\r\n\r\n1\r\n00:00:00.000 --> 00:00:01.000\r\nText mit CRLF.\r\n";
    expect(parseVttCues(vtt)).toEqual([
      { id: "1", timing: "00:00:00.000 --> 00:00:01.000", settings: "", text: "Text mit CRLF." },
    ]);
  });

  it("verbindet mehrzeiligen Cue-Text mit \\n", () => {
    const vtt = ["WEBVTT", "", "00:00:00.000 --> 00:00:02.000", "Zeile eins", "Zeile zwei"].join("\n");
    expect(parseVttCues(vtt)[0].text).toBe("Zeile eins\nZeile zwei");
  });
});

describe("serializeVttCues", () => {
  it("liefert eine leere WEBVTT-Datei für ein leeres Cue-Array", () => {
    expect(serializeVttCues([])).toBe("WEBVTT\n");
  });

  it("baut aus Cues mit ID wieder eine gültige VTT-Datei", () => {
    const out = serializeVttCues([
      { id: "1", timing: "00:00:00.000 --> 00:00:02.500", settings: "", text: "Hallo und willkommen" },
    ]);
    expect(out).toBe("WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.500\nHallo und willkommen\n");
  });

  it("hängt Cue-Settings wieder an die Timing-Zeile an", () => {
    const out = serializeVttCues([
      {
        id: null,
        timing: "00:00:00.000 --> 00:00:02.000",
        settings: "align:start position:0%",
        text: "Text mit Settings.",
      },
    ]);
    expect(out).toBe("WEBVTT\n\n00:00:00.000 --> 00:00:02.000 align:start position:0%\nText mit Settings.\n");
  });
});

describe("Rundlauf parseVttCues -> serializeVttCues", () => {
  it("ist byte-identisch für Cues MIT ID", () => {
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
    ].join("\n") + "\n";

    expect(serializeVttCues(parseVttCues(vtt))).toBe(vtt);
  });

  it("ist byte-identisch für Cues OHNE ID", () => {
    const vtt =
      ["WEBVTT", "", "00:00:00.000 --> 00:00:02.000", "Erster Satz.", "", "00:00:02.000 --> 00:00:04.000", "Zweiter Satz."].join(
        "\n",
      ) + "\n";

    expect(serializeVttCues(parseVttCues(vtt))).toBe(vtt);
  });

  it("ist byte-identisch für Cues mit Settings", () => {
    const vtt =
      ["WEBVTT", "", "1", "00:00:00.000 --> 00:00:02.000 align:start position:0%", "Text mit Settings."].join("\n") +
      "\n";

    expect(serializeVttCues(parseVttCues(vtt))).toBe(vtt);
  });

  it("normalisiert CRLF-Eingabe auf LF im Rundlauf", () => {
    const vttCrlf = "WEBVTT\r\n\r\n1\r\n00:00:00.000 --> 00:00:01.000\r\nText mit CRLF.\r\n";
    const vttLf = "WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.000\nText mit CRLF.\n";

    expect(serializeVttCues(parseVttCues(vttCrlf))).toBe(vttLf);
  });

  it("erlaubt Textänderung (Übersetzung) bei unverändertem Timing (Kernfall translate-captions.ts)", () => {
    const deVtt = ["WEBVTT", "", "1", "00:00:00.000 --> 00:00:02.500", "Hallo und willkommen"].join("\n") + "\n";
    const cues = parseVttCues(deVtt);
    const translated = cues.map((cue) => ({ ...cue, text: "Hello and welcome" }));

    expect(serializeVttCues(translated)).toBe(
      "WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.500\nHello and welcome\n",
    );
  });
});
