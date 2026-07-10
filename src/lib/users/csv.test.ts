import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";

describe("parseCsv", () => {
  it("parst gültige Zeilen korrekt", () => {
    const csv = "email,full_name,course_slug\ntest@example.com,Max Mustermann,mein-kurs";
    const result = parseCsv(csv);
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toEqual([
      { email: "test@example.com", fullName: "Max Mustermann", courseSlug: "mein-kurs" },
    ]);
  });

  it("meldet fehlende Pflichtspalten", () => {
    const result = parseCsv("email\ntest@example.com");
    expect(result.errors[0]?.message).toContain("Fehlende Spalten");
  });

  it("meldet ungültige E-Mail mit Zeilennummer", () => {
    const csv = "email,full_name,course_slug\nkeine-email,Name,";
    const result = parseCsv(csv);
    expect(result.rows).toHaveLength(0);
    expect(result.errors[0]?.line).toBe(2);
  });

  it("erkennt doppelte E-Mails innerhalb der Datei", () => {
    const csv =
      "email,full_name,course_slug\na@example.com,A,\na@example.com,A2,";
    const result = parseCsv(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.errors[0]?.message).toContain("Doppelte E-Mail");
  });

  it("leere Datei liefert Fehler statt Absturz", () => {
    const result = parseCsv("");
    expect(result.errors[0]?.message).toContain("leer");
  });
});
