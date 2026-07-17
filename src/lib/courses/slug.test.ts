import { describe, expect, it } from "vitest";
import { slugify, stripDiacritics } from "./slug";

describe("stripDiacritics", () => {
  it("entfernt kombinierende Akzentzeichen nach NFKD-Normalisierung", () => {
    expect(stripDiacritics("Kase".normalize("NFKD"))).toBe("Kase");
    expect(stripDiacritics("é".normalize("NFKD"))).toBe("e");
  });
});

describe("slugify", () => {
  it("wandelt Umlaute in ihre Grundform um (ä/ö/ü)", () => {
    expect(slugify("Müller König")).toBe("muller-konig");
    expect(slugify("Käse und Öl")).toBe("kase-und-ol");
  });

  it("ersetzt ß durch einen Bindestrich (kein ss-Mapping)", () => {
    expect(slugify("Straße")).toBe("stra-e");
    expect(slugify("Führung süß")).toBe("fuhrung-su");
  });

  it("ersetzt Sonderzeichen und Leerzeichen durch Bindestriche", () => {
    expect(slugify("Hello World 123")).toBe("hello-world-123");
    expect(slugify("Ärger!?")).toBe("arger");
  });

  it("entfernt führende und abschließende Bindestriche", () => {
    expect(slugify("---abc---")).toBe("abc");
  });

  it('liefert den Fallback "kurs" bei leerem Rest', () => {
    expect(slugify("")).toBe("kurs");
    expect(slugify("   ")).toBe("kurs");
    expect(slugify("!!! ---")).toBe("kurs");
  });

  it("kürzt auf maximal 80 Zeichen", () => {
    const long = "a".repeat(200);
    expect(slugify(long).length).toBe(80);
  });
});
