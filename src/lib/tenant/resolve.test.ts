import { describe, expect, it } from "vitest";
import {
  extractTenantSlugFromHost,
  TENANT_HOSTNAME_PATTERN,
  TENANT_SLUG_PATTERN,
} from "./resolve";

/**
 * H36 (Analyse 09.09.2026): `resolveTenantByHost` baute den PostgREST-Filter
 * per Zeichenkette aus dem `Host`-Kopf zusammen, ohne ein einziges Zeichen zu
 * pruefen. In der `.or()`-Syntax trennen Komma und Punkt die Bedingungen, ein
 * eingeschleustes Komma erweitert also den Filter. Die Abfrage laeuft ueber
 * `createAdminClient()` und damit an RLS vorbei.
 *
 * Getestet werden die beiden Muster und die Slug-Extraktion. Die Abfrage
 * selbst braucht einen Supabase-Admin-Client und gehoert in die
 * RLS-Negativtestsuite (Analyse M12), nicht hierher.
 */
describe("TENANT_SLUG_PATTERN", () => {
  it("akzeptiert gueltige DNS-Bezeichnungen", () => {
    for (const slug of ["demo", "demo-blau", "a", "kunde123", "a".repeat(63)]) {
      expect(TENANT_SLUG_PATTERN.test(slug)).toBe(true);
    }
  });

  it("lehnt die Trennzeichen der Filtersyntax ab", () => {
    for (const slug of [
      "demo,id.not.is.null",
      "demo.blau",
      "demo)",
      "demo(",
      'demo"',
      "demo id",
      "",
      "a".repeat(64),
    ]) {
      expect(TENANT_SLUG_PATTERN.test(slug)).toBe(false);
    }
  });
});

describe("TENANT_HOSTNAME_PATTERN", () => {
  it("akzeptiert echte Hostnamen", () => {
    for (const host of [
      "academy.calltalent.ai",
      "salestalent.app",
      "demo.localhost",
      "localhost",
    ]) {
      expect(TENANT_HOSTNAME_PATTERN.test(host)).toBe(true);
    }
  });

  it("lehnt Komma, Klammern und Leerzeichen ab", () => {
    for (const host of [
      "academy.calltalent.ai,id.not.is.null",
      "academy.calltalent.ai)",
      "academy calltalent ai",
      "",
    ]) {
      expect(TENANT_HOSTNAME_PATTERN.test(host)).toBe(false);
    }
  });
});

describe("extractTenantSlugFromHost", () => {
  it("liest den Slug aus dem Dev- und dem Produktionsschema", () => {
    expect(extractTenantSlugFromHost("demo.localhost")).toBe("demo");
    expect(extractTenantSlugFromHost("demo.localhost:3000")).toBe("demo");
    expect(extractTenantSlugFromHost("demo.calltalent.ai")).toBe("demo");
  });

  it("liefert null, wo kein Subdomain-Schema greift", () => {
    expect(extractTenantSlugFromHost("calltalent.ai")).toBeNull();
    expect(extractTenantSlugFromHost("foo.bar.calltalent.ai")).toBeNull();
    expect(extractTenantSlugFromHost("salestalent.app")).toBeNull();
  });

  it("gibt einen praeparierten Host unveraendert weiter, das Muster faengt ihn", () => {
    // Die Extraktion selbst filtert nicht (bewusst, sie kennt die
    // Filtersyntax nicht). Der Schutz liegt in TENANT_SLUG_PATTERN.
    const boesartig = extractTenantSlugFromHost("demo,id.not.is.null.localhost");
    expect(boesartig).toBe("demo,id.not.is.null");
    expect(TENANT_SLUG_PATTERN.test(boesartig!)).toBe(false);
  });
});
