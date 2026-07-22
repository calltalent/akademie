import { describe, expect, it } from "vitest";
import { blockSchema, blocksSchema, courseCategorySchema, createEmptyBlock, courseSchema } from "./schema";

describe("blockSchema", () => {
  it("akzeptiert einen gültigen Text-Block", () => {
    const block = createEmptyBlock("text");
    expect(blockSchema.safeParse(block).success).toBe(true);
  });

  it("lehnt unbekannten Block-Typ ab", () => {
    const result = blockSchema.safeParse({ id: crypto.randomUUID(), type: "unbekannt" });
    expect(result.success).toBe(false);
  });

  it("akzeptiert ein Array gemischter Blöcke", () => {
    const blocks = [createEmptyBlock("callout"), createEmptyBlock("video")];
    expect(blocksSchema.safeParse(blocks).success).toBe(true);
  });

  it("entfernt <script> und Event-Handler-Attribute aus Text-Block-HTML (Stored-XSS-Fix)", () => {
    const block = {
      ...createEmptyBlock("text"),
      html: '<p onclick="alert(1)">Hallo</p><script>alert(2)</script>',
    };
    const result = blockSchema.safeParse(block);
    expect(result.success).toBe(true);
    if (result.success && result.data.type === "text") {
      expect(result.data.html).not.toContain("<script");
      expect(result.data.html).not.toContain("onclick");
      expect(result.data.html).toContain("Hallo");
    }
  });

  it("behält erlaubte Formatierungs-Tags in Text-Block-HTML", () => {
    const block = { ...createEmptyBlock("text"), html: "<p><strong>Fett</strong> und <em>kursiv</em></p>" };
    const result = blockSchema.safeParse(block);
    expect(result.success).toBe(true);
    if (result.success && result.data.type === "text") {
      expect(result.data.html).toContain("<strong>Fett</strong>");
    }
  });
});

describe("courseSchema", () => {
  it("lehnt ungültige Slugs ab (Großbuchstaben/Leerzeichen)", () => {
    expect(
      courseSchema.safeParse({ title: "Test", slug: "Ungültiger Slug" }).success,
    ).toBe(false);
  });

  it("akzeptiert gültigen Slug", () => {
    expect(
      courseSchema.safeParse({ title: "Test", slug: "mein-kurs-1" }).success,
    ).toBe(true);
  });
});

describe("courseCategorySchema", () => {
  it("lehnt leeren Namen ab", () => {
    expect(courseCategorySchema.safeParse({ name: "" }).success).toBe(false);
    expect(courseCategorySchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("trimmt Whitespace", () => {
    const result = courseCategorySchema.safeParse({ name: "  Vertrieb  " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe("Vertrieb");
  });

  it("lehnt Namen über 60 Zeichen ab", () => {
    expect(courseCategorySchema.safeParse({ name: "a".repeat(61) }).success).toBe(false);
  });
});
