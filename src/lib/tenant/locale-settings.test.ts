import { describe, expect, it } from "vitest";
import { parseTenantLocaleSettings } from "@/lib/tenant/locale-settings";

/**
 * i18n Block B5 (PLAN_Mehrsprachigkeit-i18n.md Abschnitt 4): Server Action
 * updateTenantSettings() (lib/tenant/actions.ts) hat "use server" und kann
 * deshalb keine testbaren Nicht-Funktions-Exporte haben — die eigentliche
 * Validierung lebt deshalb hier, gleiches Test-Muster wie
 * courses/schema.test.ts (zod-Schema direkt importiert, kein Supabase-/
 * next-headers-Mocking nötig).
 */
describe("parseTenantLocaleSettings", () => {
  it("akzeptiert eine gültige, in sich konsistente Auswahl", () => {
    const result = parseTenantLocaleSettings({
      defaultLocaleRaw: "bs",
      enabledLocalesRaw: ["de", "bs"],
    });
    expect(result).toEqual({ ok: true, defaultLocale: "bs", enabledLocales: ["de", "bs"] });
  });

  it("lehnt ein unbekanntes Standardsprachen-Kürzel ab", () => {
    const result = parseTenantLocaleSettings({
      defaultLocaleRaw: "fr",
      enabledLocalesRaw: ["de"],
    });
    expect(result.ok).toBe(false);
  });

  it("lehnt ein unbekanntes Kürzel in der Freischaltung ab", () => {
    const result = parseTenantLocaleSettings({
      defaultLocaleRaw: "de",
      enabledLocalesRaw: ["de", "fr"],
    });
    expect(result.ok).toBe(false);
  });

  it("lehnt eine Standardsprache ab, die nicht Teil der freigeschalteten Menge ist", () => {
    // "bs" wird bewusst NICHT in enabledLocalesRaw mitgeschickt.
    const result = parseTenantLocaleSettings({
      defaultLocaleRaw: "bs",
      enabledLocalesRaw: ["de"],
    });
    expect(result).toEqual({ ok: false, error: "Die Standardsprache muss auch freigeschaltet sein." });
  });

  it('erzwingt "de" in der Freischaltung, auch wenn es im Formular fehlt (Deutsch nie abwählbar)', () => {
    const result = parseTenantLocaleSettings({
      defaultLocaleRaw: "de",
      enabledLocalesRaw: ["bs"], // "de" absichtlich weggelassen
    });
    expect(result).toEqual({ ok: true, defaultLocale: "de", enabledLocales: ["de", "bs"] });
  });

  it("dedupliziert Mehrfachnennungen in der Freischaltung", () => {
    const result = parseTenantLocaleSettings({
      defaultLocaleRaw: "de",
      enabledLocalesRaw: ["de", "de", "bs", "bs"],
    });
    expect(result).toEqual({ ok: true, defaultLocale: "de", enabledLocales: ["de", "bs"] });
  });

  it("lehnt einen leeren Standardsprachen-Wert ab (z. B. fehlendes Formularfeld)", () => {
    const result = parseTenantLocaleSettings({
      defaultLocaleRaw: "",
      enabledLocalesRaw: ["de", "bs"],
    });
    expect(result.ok).toBe(false);
  });
});
