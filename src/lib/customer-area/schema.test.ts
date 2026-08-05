import { describe, expect, it } from "vitest";
import { customerAreaItemSchema, customerAreaGroupNameSchema, customerAreaMemberIdsSchema } from "./schema";
import { trainerSchema } from "@/lib/settings/schema";

/**
 * Verifikationsplan Abschnitt 9.1 (Plan
 * verwende-den-planungs-agenten-sequential-frost.md): kind-abhängige
 * Pflichtfelder, `url`-Schema, `icon`-Whitelist, `visibility`-Default,
 * `userIds`-Obergrenze, Trainer-Schema (E-Mail/fehlende Kontaktfelder).
 */
describe("customerAreaItemSchema", () => {
  it("verlangt title+url für kind=link, lehnt ohne beides ab", () => {
    const missingBoth = customerAreaItemSchema.safeParse({ kind: "link" });
    expect(missingBoth.success).toBe(false);

    const missingUrl = customerAreaItemSchema.safeParse({ kind: "link", title: "YouTube" });
    expect(missingUrl.success).toBe(false);

    const ok = customerAreaItemSchema.safeParse({ kind: "link", title: "YouTube", url: "https://youtube.com/@calltalent" });
    expect(ok.success).toBe(true);
  });

  it("verlangt trainerId für kind=contact", () => {
    const missing = customerAreaItemSchema.safeParse({ kind: "contact" });
    expect(missing.success).toBe(false);
    if (!missing.success) {
      expect(missing.error.issues.some((i) => i.path[0] === "trainerId")).toBe(true);
    }

    const ok = customerAreaItemSchema.safeParse({ kind: "contact", trainerId: "8f14e45f-ceea-467e-9575-01c6d3f1b6c8" });
    expect(ok.success).toBe(true);
  });

  it("verlangt title für kind=announcement", () => {
    const missing = customerAreaItemSchema.safeParse({ kind: "announcement" });
    expect(missing.success).toBe(false);

    const ok = customerAreaItemSchema.safeParse({ kind: "announcement", title: "Neues Angebot" });
    expect(ok.success).toBe(true);
  });

  it("url-Schema weist javascript:-URLs ab", () => {
    const result = customerAreaItemSchema.safeParse({
      kind: "link",
      title: "Böser Link",
      url: "javascript:alert(1)",
    });
    expect(result.success).toBe(false);
  });

  it("url-Schema akzeptiert interne Pfade (/pfad)", () => {
    const result = customerAreaItemSchema.safeParse({ kind: "link", title: "Kontakt", url: "/kontakt" });
    expect(result.success).toBe(true);
  });

  it("url-Schema akzeptiert http(s)-Links", () => {
    const result = customerAreaItemSchema.safeParse({
      kind: "link",
      title: "Drive-Ordner",
      url: "https://drive.google.com/drive/folders/abc",
    });
    expect(result.success).toBe(true);
  });

  it("icon akzeptiert nur Werte aus der Whitelist", () => {
    const invalid = customerAreaItemSchema.safeParse({
      kind: "link",
      title: "Link",
      url: "https://example.com",
      icon: "<svg onload=alert(1)>",
    });
    expect(invalid.success).toBe(false);

    const valid = customerAreaItemSchema.safeParse({
      kind: "link",
      title: "Link",
      url: "https://example.com",
      icon: "folder",
    });
    expect(valid.success).toBe(true);
  });

  it("visibility ist standardmäßig 'all', wenn nicht angegeben", () => {
    const result = customerAreaItemSchema.safeParse({ kind: "announcement", title: "Aktion" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.visibility).toBe("all");
      expect(result.data.groupIds).toEqual([]);
      expect(result.data.userIds).toEqual([]);
    }
  });

  it("lehnt mehr als 500 userIds ab", () => {
    const tooMany = Array.from({ length: 501 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const result = customerAreaItemSchema.safeParse({
      kind: "announcement",
      title: "Aktion",
      visibility: "restricted",
      userIds: tooMany,
    });
    expect(result.success).toBe(false);
  });

  it("akzeptiert genau 500 userIds", () => {
    const exactly500 = Array.from({ length: 500 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const result = customerAreaItemSchema.safeParse({
      kind: "announcement",
      title: "Aktion",
      visibility: "restricted",
      userIds: exactly500,
    });
    expect(result.success).toBe(true);
  });

  it("lehnt mehr als 50 groupIds ab", () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => `00000000-0000-4000-9000-${String(i).padStart(12, "0")}`);
    const result = customerAreaItemSchema.safeParse({
      kind: "link",
      title: "Link",
      url: "/intern",
      visibility: "restricted",
      groupIds: tooMany,
    });
    expect(result.success).toBe(false);
  });

  it("itemDate verlangt das Format JJJJ-MM-TT", () => {
    const invalid = customerAreaItemSchema.safeParse({ kind: "announcement", title: "Aktion", itemDate: "05.08.2026" });
    expect(invalid.success).toBe(false);

    const valid = customerAreaItemSchema.safeParse({ kind: "announcement", title: "Aktion", itemDate: "2026-08-05" });
    expect(valid.success).toBe(true);
  });
});

describe("customerAreaGroupNameSchema", () => {
  it("lehnt leeren Namen ab", () => {
    expect(customerAreaGroupNameSchema.safeParse("").success).toBe(false);
    expect(customerAreaGroupNameSchema.safeParse("   ").success).toBe(false);
  });

  it("akzeptiert einen normalen Gruppennamen", () => {
    expect(customerAreaGroupNameSchema.safeParse("Geschäftsführung").success).toBe(true);
  });
});

describe("customerAreaMemberIdsSchema", () => {
  it("lehnt mehr als 500 Mitglieder je Gruppe ab", () => {
    const tooMany = Array.from({ length: 501 }, (_, i) => `00000000-0000-4000-a000-${String(i).padStart(12, "0")}`);
    expect(customerAreaMemberIdsSchema.safeParse(tooMany).success).toBe(false);
  });

  it("akzeptiert eine leere Liste (Gruppe ohne Mitglieder)", () => {
    expect(customerAreaMemberIdsSchema.safeParse([]).success).toBe(true);
  });
});

describe("trainerSchema (settings/schema.ts) — Kontaktfelder für Kunden-Area-Ansprechpartner", () => {
  it("akzeptiert ein Trainerprofil ganz ohne phone/email", () => {
    const result = trainerSchema.safeParse({ name: "Maria Muster" });
    expect(result.success).toBe(true);
  });

  it("lehnt eine ungültige E-Mail-Adresse ab", () => {
    const result = trainerSchema.safeParse({ name: "Maria Muster", email: "keine-email" });
    expect(result.success).toBe(false);
  });

  it("akzeptiert eine gültige E-Mail-Adresse und Telefonnummer", () => {
    const result = trainerSchema.safeParse({
      name: "Maria Muster",
      email: "maria@calltalent.ai",
      phone: "+49 30 1234567",
    });
    expect(result.success).toBe(true);
  });
});
