import { describe, expect, it } from "vitest";
import { signPayload } from "./deliver";

/**
 * Testvektor unabhängig erzeugt (`node -e "require('crypto').createHmac
 * ('sha256','secret').update('...').digest('hex')"`, siehe PHASENSTATUS.md
 * Block 7) — kein echtes Secret, keine Kundendaten (CLAUDE.md §2.6).
 */
describe("signPayload", () => {
  it("erzeugt eine HMAC-SHA256-Hex-Signatur gegen einen bekannten Testvektor", () => {
    const signature = signPayload("secret", '{"event":"user.created"}');
    expect(signature).toBe("e851f51160ef29a5847ccec510a3d5b801d448e9f8d769e8484a75fb4b9f6947");
  });

  it("liefert 64 Hex-Zeichen (SHA-256)", () => {
    expect(signPayload("secret", "hallo")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("liefert unterschiedliche Signaturen für unterschiedliche Secrets", () => {
    const body = '{"event":"order.paid"}';
    expect(signPayload("secret-a", body)).not.toBe(signPayload("secret-b", body));
  });

  it("liefert unterschiedliche Signaturen für unterschiedliche Bodies", () => {
    expect(signPayload("secret", "a")).not.toBe(signPayload("secret", "b"));
  });

  it("ist deterministisch für denselben Secret+Body", () => {
    const body = '{"event":"lesson.completed"}';
    expect(signPayload("secret", body)).toBe(signPayload("secret", body));
  });
});
