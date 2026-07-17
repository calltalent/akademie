import { describe, expect, it } from "vitest";
import {
  buildRecordingFilename,
  classifyMediaError,
  formatDuration,
  formatDurationPrecise,
  formatFileSize,
  getMilestoneMessage,
  getRecordingStoppedMessage,
  getUploadQuartileMessage,
  HARD_LIMIT_S,
  NO_AUDIO_TRACK_ERROR_NAME,
  ONE_MINUTE_LEFT_S,
  pickSupportedMimeType,
  WARNING_THRESHOLD_S,
} from "./recorder";

describe("pickSupportedMimeType", () => {
  it("liefert den ersten unterstützten Typ in Präferenz-Reihenfolge", () => {
    const supported = new Set(["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"]);
    expect(pickSupportedMimeType((t) => supported.has(t))).toBe("video/webm;codecs=vp8,opus");
  });

  it("bevorzugt vp9 vor vp8, wenn beide unterstützt werden", () => {
    const supported = new Set(["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus"]);
    expect(pickSupportedMimeType((t) => supported.has(t))).toBe("video/webm;codecs=vp9,opus");
  });

  it("fällt auf video/mp4 zurück, wenn nur das unterstützt wird", () => {
    expect(pickSupportedMimeType((t) => t === "video/mp4")).toBe("video/mp4");
  });

  it("liefert null, wenn nichts unterstützt wird", () => {
    expect(pickSupportedMimeType(() => false)).toBeNull();
  });

  it("nutzt ohne Override typeof MediaRecorder — wirft in jsdom keinen ReferenceError", () => {
    expect(() => pickSupportedMimeType()).not.toThrow();
    expect(pickSupportedMimeType()).toBeNull();
  });
});

describe("formatDuration", () => {
  it("formatiert Sekunden als mm:ss mit führenden Nullen", () => {
    expect(formatDuration(0)).toBe("00:00");
    expect(formatDuration(5)).toBe("00:05");
    expect(formatDuration(65)).toBe("01:05");
    expect(formatDuration(599)).toBe("09:59");
  });

  it("funktioniert über 60 Minuten hinaus", () => {
    expect(formatDuration(3661)).toBe("61:01");
  });

  it("klemmt negative/ungültige Werte auf 0", () => {
    expect(formatDuration(-5)).toBe("00:00");
    expect(formatDuration(NaN)).toBe("00:00");
  });

  it("rundet auf ganze Sekunden ab (kein Aufrunden)", () => {
    expect(formatDuration(59.9)).toBe("00:59");
  });
});

describe("formatDurationPrecise", () => {
  it("zeigt eine Nachkommastelle (Zehntelsekunden)", () => {
    expect(formatDurationPrecise(0)).toBe("00:00.0");
    expect(formatDurationPrecise(1.3)).toBe("00:01.3");
    expect(formatDurationPrecise(65.9)).toBe("01:05.9");
  });

  it("unterscheidet zwei Zeiten, die formatDuration identisch abrunden würde", () => {
    // Josips Fund (18.07.2026): 1,1s und 1,9s zeigten mit formatDuration()
    // beide "00:01" (beide floor(x) === 1) — mit einer Nachkommastelle sind
    // sie unterscheidbar.
    expect(formatDuration(1.1)).toBe(formatDuration(1.9));
    expect(formatDurationPrecise(1.1)).not.toBe(formatDurationPrecise(1.9));
    expect(formatDurationPrecise(1.1)).toBe("00:01.1");
    expect(formatDurationPrecise(1.9)).toBe("00:01.9");
  });

  it("rundet auf die nächste Zehntelsekunde (nicht ab)", () => {
    expect(formatDurationPrecise(1.35)).toBe("00:01.4");
    expect(formatDurationPrecise(1.34)).toBe("00:01.3");
  });

  it("trägt bei .95+ korrekt in die nächste Sekunde über", () => {
    expect(formatDurationPrecise(1.96)).toBe("00:02.0");
  });

  it("klemmt negative/ungültige Werte auf 0", () => {
    expect(formatDurationPrecise(-5)).toBe("00:00.0");
    expect(formatDurationPrecise(NaN)).toBe("00:00.0");
  });

  it("funktioniert über 60 Minuten hinaus", () => {
    expect(formatDurationPrecise(3661.2)).toBe("61:01.2");
  });
});

describe("formatFileSize", () => {
  it("zeigt Bytes ohne Nachkommastelle", () => {
    expect(formatFileSize(500)).toBe("500 B");
  });

  it("wechselt zu KB/MB/GB", () => {
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatFileSize(2 * 1024 * 1024 * 1024)).toBe("2.0 GB");
  });

  it("klemmt negative/ungültige Werte auf 0", () => {
    expect(formatFileSize(-10)).toBe("0 B");
    expect(formatFileSize(NaN)).toBe("0 B");
  });
});

describe("buildRecordingFilename", () => {
  it("baut aufnahme-<mode>-<zeitstempel>.webm aus einem festen Datum", () => {
    const fixed = new Date(2026, 6, 17, 9, 5, 3); // 17.07.2026, 09:05:03 (lokal)
    expect(buildRecordingFilename("screen", fixed)).toBe("aufnahme-screen-20260717-090503.webm");
    expect(buildRecordingFilename("webcam", fixed)).toBe("aufnahme-webcam-20260717-090503.webm");
  });
});

describe("getMilestoneMessage", () => {
  it("meldet nichts, solange keine Schwelle überschritten wird", () => {
    expect(getMilestoneMessage(0, 10)).toBeNull();
    expect(getMilestoneMessage(100, 200)).toBeNull();
  });

  it("meldet alle 5 Minuten (generisch) unterhalb der 15-Minuten-Warnung", () => {
    expect(getMilestoneMessage(299, 300)).toBe("5 Minuten aufgenommen.");
    expect(getMilestoneMessage(599, 600)).toBe("10 Minuten aufgenommen.");
  });

  it("meldet bei 15 Minuten den spezifischeren Warntext statt des generischen 5-Minuten-Texts", () => {
    expect(getMilestoneMessage(WARNING_THRESHOLD_S - 1, WARNING_THRESHOLD_S)).toBe(
      "15 Minuten aufgenommen — noch 5 Minuten bis zum Limit.",
    );
  });

  it("meldet 1 Minute vor dem Hard-Limit", () => {
    expect(getMilestoneMessage(ONE_MINUTE_LEFT_S - 1, ONE_MINUTE_LEFT_S)).toBe(
      "Noch 1 Minute bis zum Aufnahmelimit.",
    );
  });

  it("meldet nichts erneut, wenn dieselbe Schwelle nicht neu überschritten wird", () => {
    expect(getMilestoneMessage(300, 300)).toBeNull();
  });

  it("überspringt übersprungene Schwellen korrekt (z. B. Tab-Drosselung, B8) — meldet die höchste erreichte", () => {
    // Von 250s direkt auf 950s (z. B. nach langer Hintergrund-Drosselung):
    // 1-Minuten-Schwelle (1140) noch nicht erreicht, 15-Minuten-Schwelle (900)
    // wurde übersprungen -> genau diese eine Meldung, kein Duplikat.
    expect(getMilestoneMessage(250, 950)).toBe("15 Minuten aufgenommen — noch 5 Minuten bis zum Limit.");
  });
});

describe("getRecordingStoppedMessage", () => {
  it("formatiert Minuten und Sekunden aus", () => {
    expect(getRecordingStoppedMessage(0)).toBe("Aufnahme beendet, 0 Minuten 0 Sekunden.");
    expect(getRecordingStoppedMessage(125)).toBe("Aufnahme beendet, 2 Minuten 5 Sekunden.");
    expect(getRecordingStoppedMessage(HARD_LIMIT_S)).toBe("Aufnahme beendet, 20 Minuten 0 Sekunden.");
  });

  it("rundet auf ganze Sekunden", () => {
    expect(getRecordingStoppedMessage(59.6)).toBe("Aufnahme beendet, 1 Minuten 0 Sekunden.");
  });
});

describe("getUploadQuartileMessage", () => {
  it("meldet nur an 25/50/75/100, sonst null", () => {
    expect(getUploadQuartileMessage(0, 10)).toBeNull();
    expect(getUploadQuartileMessage(20, 24)).toBeNull();
    expect(getUploadQuartileMessage(20, 25)).toBe("Video-Upload: 25 Prozent.");
    expect(getUploadQuartileMessage(40, 50)).toBe("Video-Upload: 50 Prozent.");
    expect(getUploadQuartileMessage(70, 75)).toBe("Video-Upload: 75 Prozent.");
    expect(getUploadQuartileMessage(90, 100)).toBe("Video vollständig hochgeladen.");
  });

  it("meldet die höchste überschrittene Schwelle, wenn mehrere übersprungen werden", () => {
    expect(getUploadQuartileMessage(10, 100)).toBe("Video vollständig hochgeladen.");
  });
});

describe("classifyMediaError", () => {
  it("erkennt den B3-Sonderfall (Bildschirmaufnahme ohne Mikrofon-Ton)", () => {
    const error = new Error("no audio");
    error.name = NO_AUDIO_TRACK_ERROR_NAME;
    expect(classifyMediaError(error).message).toMatch(/Mikrofon/);
  });

  it("erkennt NotAllowedError (Berechtigung verweigert)", () => {
    const error = new Error("denied");
    error.name = "NotAllowedError";
    expect(classifyMediaError(error).message).toMatch(/Zugriff verweigert/);
  });

  it("erkennt NotFoundError (kein Gerät)", () => {
    const error = new Error("none");
    error.name = "NotFoundError";
    expect(classifyMediaError(error).message).toMatch(/kein Aufnahmegerät gefunden|Aufnahmegerät gefunden/);
  });

  it("erkennt NotReadableError (Gerät belegt)", () => {
    const error = new Error("busy");
    error.name = "NotReadableError";
    expect(classifyMediaError(error).message).toMatch(/bereits von einer anderen Anwendung/);
  });

  it("liefert eine generische Meldung für unbekannte Fehler", () => {
    expect(classifyMediaError(new Error("irgendwas")).message).toBe(
      "Aufnahme konnte nicht gestartet werden. Bitte versuche es erneut.",
    );
    expect(classifyMediaError("kein Error-Objekt").message).toBe(
      "Aufnahme konnte nicht gestartet werden. Bitte versuche es erneut.",
    );
  });
});
