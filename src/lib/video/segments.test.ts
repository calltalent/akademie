import { describe, expect, it } from "vitest";
import {
  coversFullDuration,
  createInitialSegments,
  MIN_SEGMENT_LENGTH_S,
  neighborBounds,
  normalizeSegments,
  parseTimecode,
  removeSegment,
  setSegmentBound,
  sortSegments,
  splitSegment,
  totalDurationS,
} from "./segments";
import type { Segment } from "./segments";

describe("createInitialSegments", () => {
  it("liefert ein Segment über die volle Dauer", () => {
    expect(createInitialSegments(120)).toEqual([{ id: "seg-0", startS: 0, endS: 120 }]);
  });

  it("klemmt eine negative Dauer auf 0", () => {
    expect(createInitialSegments(-5)).toEqual([{ id: "seg-0", startS: 0, endS: 0 }]);
  });
});

describe("sortSegments", () => {
  it("sortiert nach Startzeit, ohne Werte zu verändern", () => {
    const input: Segment[] = [
      { id: "b", startS: 10, endS: 20 },
      { id: "a", startS: 0, endS: 5 },
    ];
    expect(sortSegments(input)).toEqual([
      { id: "a", startS: 0, endS: 5 },
      { id: "b", startS: 10, endS: 20 },
    ]);
  });

  it("verändert das Eingabe-Array nicht (neue Referenz)", () => {
    const input: Segment[] = [{ id: "a", startS: 5, endS: 10 }];
    const result = sortSegments(input);
    expect(result).not.toBe(input);
  });

  it("lässt Null-Länge/verkehrte Reihenfolge unangetastet (nur normalizeSegments filtert)", () => {
    const input: Segment[] = [{ id: "a", startS: 10, endS: 5 }];
    expect(sortSegments(input)).toEqual(input);
  });
});

describe("normalizeSegments", () => {
  it("kappt ein Ende, das über die Dauer hinausragt", () => {
    const result = normalizeSegments([{ id: "a", startS: 0, endS: 999 }], 100);
    expect(result).toEqual([{ id: "a", startS: 0, endS: 100 }]);
  });

  it("kappt einen Start unter 0", () => {
    const result = normalizeSegments([{ id: "a", startS: -10, endS: 50 }], 100);
    expect(result).toEqual([{ id: "a", startS: 0, endS: 50 }]);
  });

  it("verwirft Segmente mit Null-Länge", () => {
    const result = normalizeSegments(
      [
        { id: "a", startS: 10, endS: 10 },
        { id: "b", startS: 20, endS: 30 },
      ],
      100,
    );
    expect(result).toEqual([{ id: "b", startS: 20, endS: 30 }]);
  });

  it("verwirft Segmente in verkehrter Reihenfolge (Ende < Start)", () => {
    const result = normalizeSegments(
      [
        { id: "a", startS: 50, endS: 10 },
        { id: "b", startS: 20, endS: 30 },
      ],
      100,
    );
    expect(result).toEqual([{ id: "b", startS: 20, endS: 30 }]);
  });

  it("führt echt überlappende Segmente zusammen (nimmt die ID des früheren)", () => {
    const result = normalizeSegments(
      [
        { id: "a", startS: 0, endS: 10 },
        { id: "b", startS: 5, endS: 20 },
      ],
      100,
    );
    expect(result).toEqual([{ id: "a", startS: 0, endS: 20 }]);
  });

  it("führt mehrfach verkettete Überlappungen in einem Rutsch zusammen", () => {
    const result = normalizeSegments(
      [
        { id: "a", startS: 0, endS: 10 },
        { id: "b", startS: 8, endS: 15 },
        { id: "c", startS: 12, endS: 25 },
      ],
      100,
    );
    expect(result).toEqual([{ id: "a", startS: 0, endS: 25 }]);
  });

  it("lässt exakt aneinanderstoßende Segmente getrennt (kein Merge bei Start === vorheriges Ende)", () => {
    const result = normalizeSegments(
      [
        { id: "a", startS: 0, endS: 10 },
        { id: "b", startS: 10, endS: 20 },
      ],
      100,
    );
    expect(result).toEqual([
      { id: "a", startS: 0, endS: 10 },
      { id: "b", startS: 10, endS: 20 },
    ]);
  });

  it("sortiert unsortierte Eingabe vor der Zusammenführung", () => {
    const result = normalizeSegments(
      [
        { id: "b", startS: 50, endS: 60 },
        { id: "a", startS: 0, endS: 10 },
      ],
      100,
    );
    expect(result).toEqual([
      { id: "a", startS: 0, endS: 10 },
      { id: "b", startS: 50, endS: 60 },
    ]);
  });

  it("liefert ein leeres Array, wenn alle Segmente ungültig sind", () => {
    expect(normalizeSegments([{ id: "a", startS: 10, endS: 10 }], 100)).toEqual([]);
  });
});

describe("totalDurationS", () => {
  it("summiert mehrere Segmentlängen", () => {
    expect(
      totalDurationS([
        { id: "a", startS: 0, endS: 10 },
        { id: "b", startS: 20, endS: 45 },
      ]),
    ).toBe(35);
  });

  it("liefert 0 für eine leere Liste", () => {
    expect(totalDurationS([])).toBe(0);
  });
});

describe("coversFullDuration", () => {
  it("erkennt ein einzelnes Segment über die volle Dauer", () => {
    expect(coversFullDuration([{ id: "a", startS: 0, endS: 100 }], 100)).toBe(true);
  });

  it("erkennt Volldeckung durch mehrere lückenlos aneinanderstoßende Segmente", () => {
    expect(
      coversFullDuration(
        [
          { id: "a", startS: 0, endS: 50 },
          { id: "b", startS: 50, endS: 100 },
        ],
        100,
      ),
    ).toBe(true);
  });

  it("toleriert kleine Mess-/Rundungsabweichungen an den Rändern", () => {
    expect(coversFullDuration([{ id: "a", startS: 0.2, endS: 99.8 }], 100, 0.5)).toBe(true);
  });

  it("erkennt fehlende Deckung am Anfang", () => {
    expect(coversFullDuration([{ id: "a", startS: 5, endS: 100 }], 100)).toBe(false);
  });

  it("erkennt fehlende Deckung am Ende", () => {
    expect(coversFullDuration([{ id: "a", startS: 0, endS: 90 }], 100)).toBe(false);
  });

  it("erkennt eine Lücke in der Mitte (Mittelschnitt vorgenommen)", () => {
    expect(
      coversFullDuration(
        [
          { id: "a", startS: 0, endS: 30 },
          { id: "b", startS: 40, endS: 100 },
        ],
        100,
      ),
    ).toBe(false);
  });

  it("liefert false für eine leere Segmentliste", () => {
    expect(coversFullDuration([], 100)).toBe(false);
  });
});

describe("splitSegment", () => {
  it("teilt ein Segment an gültiger Position in zwei Segmente", () => {
    const result = splitSegment([{ id: "a", startS: 0, endS: 100 }], "a", 40, ["a1", "a2"]);
    expect(result).toEqual([
      { id: "a1", startS: 0, endS: 40 },
      { id: "a2", startS: 40, endS: 100 },
    ]);
  });

  it("behält die Position der geteilten Zeile in der Liste bei", () => {
    const result = splitSegment(
      [
        { id: "x", startS: 0, endS: 10 },
        { id: "a", startS: 10, endS: 100 },
      ],
      "a",
      40,
      ["a1", "a2"],
    );
    expect(result).toEqual([
      { id: "x", startS: 0, endS: 10 },
      { id: "a1", startS: 10, endS: 40 },
      { id: "a2", startS: 40, endS: 100 },
    ]);
  });

  it("ist ein No-Op (identische Referenz) für eine unbekannte ID", () => {
    const input: Segment[] = [{ id: "a", startS: 0, endS: 100 }];
    expect(splitSegment(input, "missing", 40, ["a1", "a2"])).toBe(input);
  });

  it("ist ein No-Op, wenn die Position außerhalb des Segments liegt", () => {
    const input: Segment[] = [{ id: "a", startS: 10, endS: 20 }];
    expect(splitSegment(input, "a", 50, ["a1", "a2"])).toBe(input);
  });

  it("ist ein No-Op, wenn die Position zu nah an der Startgrenze liegt (Mindestlänge)", () => {
    const input: Segment[] = [{ id: "a", startS: 0, endS: 100 }];
    expect(splitSegment(input, "a", MIN_SEGMENT_LENGTH_S / 2, ["a1", "a2"])).toBe(input);
  });

  it("ist ein No-Op, wenn die Position zu nah an der Endgrenze liegt (Mindestlänge)", () => {
    const input: Segment[] = [{ id: "a", startS: 0, endS: 100 }];
    expect(splitSegment(input, "a", 100 - MIN_SEGMENT_LENGTH_S / 2, ["a1", "a2"])).toBe(input);
  });

  it("erlaubt eine Position genau an der Mindestlänge-Grenze", () => {
    const result = splitSegment([{ id: "a", startS: 0, endS: 10 }], "a", MIN_SEGMENT_LENGTH_S, ["a1", "a2"]);
    expect(result).toEqual([
      { id: "a1", startS: 0, endS: MIN_SEGMENT_LENGTH_S },
      { id: "a2", startS: MIN_SEGMENT_LENGTH_S, endS: 10 },
    ]);
  });
});

describe("removeSegment", () => {
  it("entfernt das Segment mit der angegebenen ID", () => {
    const result = removeSegment(
      [
        { id: "a", startS: 0, endS: 10 },
        { id: "b", startS: 10, endS: 20 },
      ],
      "a",
    );
    expect(result).toEqual([{ id: "b", startS: 10, endS: 20 }]);
  });

  it("lässt die Liste unverändert (inhaltlich), wenn die ID nicht existiert", () => {
    const input: Segment[] = [{ id: "a", startS: 0, endS: 10 }];
    expect(removeSegment(input, "missing")).toEqual(input);
  });

  it("kann alle Segmente entfernen (Invariante 'mindestens 1' ist Sache der UI, nicht dieser Funktion)", () => {
    expect(removeSegment([{ id: "a", startS: 0, endS: 10 }], "a")).toEqual([]);
  });
});

describe("setSegmentBound", () => {
  it("setzt den Start eines Segments", () => {
    const result = setSegmentBound([{ id: "a", startS: 0, endS: 100 }], "a", "start", 25);
    expect(result).toEqual([{ id: "a", startS: 25, endS: 100 }]);
  });

  it("setzt das Ende eines Segments", () => {
    const result = setSegmentBound([{ id: "a", startS: 0, endS: 100 }], "a", "end", 80);
    expect(result).toEqual([{ id: "a", startS: 0, endS: 80 }]);
  });

  it("lässt andere Segmente unverändert", () => {
    const result = setSegmentBound(
      [
        { id: "a", startS: 0, endS: 10 },
        { id: "b", startS: 10, endS: 20 },
      ],
      "b",
      "start",
      15,
    );
    expect(result).toEqual([
      { id: "a", startS: 0, endS: 10 },
      { id: "b", startS: 15, endS: 20 },
    ]);
  });

  it("erzwingt keine Validierung — ein zwischenzeitlich ungültiger Wert bleibt bestehen", () => {
    const result = setSegmentBound([{ id: "a", startS: 0, endS: 10 }], "a", "start", 999);
    expect(result).toEqual([{ id: "a", startS: 999, endS: 10 }]);
  });
});

describe("neighborBounds", () => {
  it("liefert 0/durationS ohne Nachbarn (einziges Segment)", () => {
    expect(neighborBounds([{ id: "a", startS: 0, endS: 100 }], "a", 100)).toEqual({
      minStartS: 0,
      maxEndS: 100,
    });
  });

  it("begrenzt auf das Ende des vorherigen und den Start des nächsten Segments", () => {
    // Fund im Code-Review (18.07.2026): ohne diese Begrenzung kann ein
    // Segment über eine Lücke hinweg ins Nachbarsegment hineinragen —
    // normalizeSegments() merged dann still, der dazwischenliegende
    // entfernte Bereich verschwindet kommentarlos.
    const segments: Segment[] = [
      { id: "a", startS: 0, endS: 8 },
      { id: "b", startS: 10, endS: 20 },
    ];
    expect(neighborBounds(segments, "a", 20)).toEqual({ minStartS: 0, maxEndS: 10 });
    expect(neighborBounds(segments, "b", 20)).toEqual({ minStartS: 8, maxEndS: 20 });
  });

  it("funktioniert unabhängig von der Array-Reihenfolge (sortiert intern)", () => {
    const segments: Segment[] = [
      { id: "b", startS: 10, endS: 20 },
      { id: "a", startS: 0, endS: 8 },
    ];
    expect(neighborBounds(segments, "a", 20)).toEqual({ minStartS: 0, maxEndS: 10 });
  });

  it("liefert 0/durationS für eine unbekannte id", () => {
    expect(neighborBounds([{ id: "a", startS: 0, endS: 10 }], "missing", 10)).toEqual({
      minStartS: 0,
      maxEndS: 10,
    });
  });

  it("berücksichtigt bei drei Segmenten nur die direkten Nachbarn", () => {
    const segments: Segment[] = [
      { id: "a", startS: 0, endS: 5 },
      { id: "b", startS: 7, endS: 12 },
      { id: "c", startS: 15, endS: 20 },
    ];
    expect(neighborBounds(segments, "b", 20)).toEqual({ minStartS: 5, maxEndS: 15 });
  });
});

describe("parseTimecode", () => {
  it("parst mm:ss", () => {
    expect(parseTimecode("05:30")).toBe(330);
  });

  it("parst m:ss ohne führende Null", () => {
    expect(parseTimecode("5:03")).toBe(303);
  });

  it("parst h:mm:ss", () => {
    expect(parseTimecode("1:02:03")).toBe(3723);
  });

  it("parst gebrochene Sekunden", () => {
    expect(parseTimecode("00:12.5")).toBe(12.5);
  });

  it("liefert null für leeren Text", () => {
    expect(parseTimecode("")).toBeNull();
    expect(parseTimecode("   ")).toBeNull();
  });

  it("liefert null für Sekunden/Minuten >= 60", () => {
    expect(parseTimecode("00:60")).toBeNull();
    expect(parseTimecode("60:00")).toBeNull();
  });

  it("liefert null für nicht interpretierbaren Text", () => {
    expect(parseTimecode("abc")).toBeNull();
    expect(parseTimecode("12")).toBeNull();
    expect(parseTimecode("1:2:3:4")).toBeNull();
  });

  it("liefert null für negative Werte", () => {
    expect(parseTimecode("-1:00")).toBeNull();
  });
});
