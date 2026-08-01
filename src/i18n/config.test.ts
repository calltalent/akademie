import { describe, expect, it } from "vitest";
import { localeSchema } from "@/i18n/config";

/**
 * i18n Block B1 (PLAN_Mehrsprachigkeit-i18n.md Abschnitt 4): `localeSchema`
 * ist die zod-Eingabegrenze für setLocale() (lib/account/actions.ts) — der
 * Wert dort kommt direkt vom Client (<select>-Wert), CLAUDE.md §2.3 verlangt
 * zod an jeder Eingabegrenze.
 */
describe("localeSchema", () => {
  it("akzeptiert jedes unterstützte Kürzel", () => {
    expect(localeSchema.safeParse("de").success).toBe(true);
    expect(localeSchema.safeParse("bs").success).toBe(true);
  });

  it("lehnt ein unbekanntes Kürzel ab", () => {
    expect(localeSchema.safeParse("fr").success).toBe(false);
  });

  it("lehnt leeren String und Nicht-Strings ab", () => {
    expect(localeSchema.safeParse("").success).toBe(false);
    expect(localeSchema.safeParse(undefined).success).toBe(false);
    expect(localeSchema.safeParse(null).success).toBe(false);
  });
});
