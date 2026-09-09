// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

/**
 * `crypto.subtle` (Web Crypto) ist in der jsdom-Standardumgebung von Vitest
 * nicht vorhanden, in Node und in Cloudflare Workers (der Ziel-Laufzeit)
 * dagegen schon — deshalb läuft diese Datei per Docblock oben in der
 * node-Umgebung.
 *
 * `@/lib/env` wird gemockt, damit der Test kein echtes
 * `SUPABASE_SERVICE_ROLE_KEY` in der Umgebung braucht (CLAUDE.md §2.6:
 * keine Secrets in Tests) — geprüft wird die Signatur-/Zeitlogik, nicht die
 * Env-Validierung.
 */
vi.mock("@/lib/env", () => ({
  getServerEnv: () => ({ SUPABASE_SERVICE_ROLE_KEY: "test-schluessel-nur-fuer-vitest" }),
}));

const { issueContactFormToken, verifyContactFormToken } = await import("./form-token");
const { CONTACT_MAX_FORM_AGE_SECONDS, CONTACT_MIN_FILL_SECONDS } = await import("./patterns");

const NOW = 1_800_000_000_000;

describe("Kontaktformular-Zeitfalle", () => {
  it("akzeptiert ein Token, das lange genug ausgefüllt wurde", async () => {
    const token = await issueContactFormToken(NOW);
    expect(await verifyContactFormToken(token, NOW + (CONTACT_MIN_FILL_SECONDS + 5) * 1000)).toBe(
      "ok",
    );
  });

  it("erkennt Absenden in Sekundenbruchteilen als maschinell", async () => {
    const token = await issueContactFormToken(NOW);
    expect(await verifyContactFormToken(token, NOW + 500)).toBe("too-fast");
  });

  it("erkennt ein veraltetes Formular", async () => {
    const token = await issueContactFormToken(NOW);
    expect(
      await verifyContactFormToken(token, NOW + (CONTACT_MAX_FORM_AGE_SECONDS + 60) * 1000),
    ).toBe("expired");
  });

  it("weist fehlende, unsinnige und gefälschte Token ab", async () => {
    const validAge = NOW + (CONTACT_MIN_FILL_SECONDS + 5) * 1000;

    expect(await verifyContactFormToken(undefined, validAge)).toBe("invalid");
    expect(await verifyContactFormToken(null, validAge)).toBe("invalid");
    expect(await verifyContactFormToken("", validAge)).toBe("invalid");
    expect(await verifyContactFormToken("1799999999", validAge)).toBe("invalid");
    // Plausibler Zeitstempel, frei erfundene Signatur.
    expect(await verifyContactFormToken(`1799999999.${"a".repeat(64)}`, validAge)).toBe("invalid");
  });

  it("erkennt einen manipulierten Zeitstempel bei gültiger Signatur", async () => {
    const token = await issueContactFormToken(NOW);
    const [, signature] = token.split(".");
    const backdated = `${Math.floor(NOW / 1000) - 600}.${signature}`;

    expect(await verifyContactFormToken(backdated, NOW + 500)).toBe("invalid");
  });
});
