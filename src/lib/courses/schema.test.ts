import { describe, expect, it } from "vitest";
import { blockSchema, blocksSchema, createEmptyBlock, courseSchema } from "./schema";

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
