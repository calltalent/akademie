import { describe, expect, it } from "vitest";
import { resolveEnabledLocales } from "@/i18n/config";
import { resolveLocale } from "@/i18n/resolve";

const ALL: ("de" | "bs")[] = ["de", "bs"];

describe("resolveLocale — Auflösungskette (Plan Abschnitt 1)", () => {
  it("Stufe 1: Cookie gewinnt, wenn freigeschaltet", () => {
    expect(
      resolveLocale({
        cookie: "bs",
        tenantDefault: "de",
        acceptLanguage: "de-DE",
        enabledLocales: ALL,
      }),
    ).toBe("bs");
  });

  it("Stufe 2: ohne Cookie zählt der Mandanten-Standard", () => {
    expect(
      resolveLocale({
        cookie: null,
        tenantDefault: "bs",
        acceptLanguage: "de-DE",
        enabledLocales: ALL,
      }),
    ).toBe("bs");
  });

  it("Stufe 3: ohne Cookie/Mandanten-Standard zählt Accept-Language", () => {
    expect(
      resolveLocale({
        cookie: null,
        tenantDefault: null,
        acceptLanguage: "bs-BA,bs;q=0.9,de;q=0.5",
        enabledLocales: ALL,
      }),
    ).toBe("bs");
  });

  it("Stufe 4: ohne jeden Treffer bleibt es bei \"de\"", () => {
    expect(
      resolveLocale({
        cookie: null,
        tenantDefault: null,
        acceptLanguage: null,
        enabledLocales: ALL,
      }),
    ).toBe("de");
  });

  it("gesperrte Cookie-Sprache fällt durch statt zu brechen (nie Fehler/leere Seite)", () => {
    // "bs" ist ein unterstütztes, aber vom Mandanten NICHT freigeschaltetes Kürzel.
    expect(
      resolveLocale({
        cookie: "bs",
        tenantDefault: "de",
        acceptLanguage: null,
        enabledLocales: ["de"],
      }),
    ).toBe("de");
  });

  it("fällt für jede Stufe einzeln durch, wenn enabledLocales sie ausschließt", () => {
    expect(
      resolveLocale({
        cookie: "bs",
        tenantDefault: "bs",
        acceptLanguage: "bs-BA",
        enabledLocales: ["de"],
      }),
    ).toBe("de");
  });

  it("ignoriert ein nicht unterstütztes Cookie-Kürzel (z. B. \"fr\") und fällt durch", () => {
    expect(
      resolveLocale({
        cookie: "fr",
        tenantDefault: "de",
        acceptLanguage: null,
        enabledLocales: ALL,
      }),
    ).toBe("de");
  });

  it("\"de\" ist nie sperrbar — auch bei enabledLocales=[] bleibt \"de\" erreichbar", () => {
    expect(
      resolveLocale({
        cookie: "de",
        tenantDefault: null,
        acceptLanguage: null,
        enabledLocales: [],
      }),
    ).toBe("de");
  });
});

describe("resolveEnabledLocales — Mandanten-Freischaltung (Plan Abschnitt 3.3)", () => {
  it("leeres/fehlendes enabled_locales ergibt effektiv [\"de\"]", () => {
    expect(resolveEnabledLocales({})).toEqual(["de"]);
    expect(resolveEnabledLocales({ enabled_locales: [] })).toEqual(["de"]);
  });

  it("unbekanntes Kürzel wird ignoriert, bekannte bleiben erhalten", () => {
    expect(resolveEnabledLocales({ enabled_locales: ["bs", "fr", "xx"] })).toEqual(["de", "bs"]);
  });

  it("dedupliziert und behält \"de\" immer an erster Stelle, auch wenn es explizit doppelt vorkommt", () => {
    expect(resolveEnabledLocales({ enabled_locales: ["de", "bs", "bs"] })).toEqual(["de", "bs"]);
  });

  it("verwirft nicht-string- oder nicht-array-Eingaben defensiv statt zu werfen", () => {
    expect(resolveEnabledLocales({ enabled_locales: "bs" })).toEqual(["de"]);
    expect(resolveEnabledLocales({ enabled_locales: [42, null, "bs"] })).toEqual(["de", "bs"]);
  });
});
