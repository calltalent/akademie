import { describe, expect, it } from "vitest";
import { generateApiKey, generateWebhookSecret, hashApiKey, hashesMatch } from "./keys";

describe("generateApiKey", () => {
  it("erzeugt einen Klartext-Key mit ct_live_-Präfix und 32 Hex-Zeichen", () => {
    const { plaintext } = generateApiKey();
    expect(plaintext.startsWith("ct_live_")).toBe(true);
    expect(plaintext).toMatch(/^ct_live_[0-9a-f]{32}$/);
  });

  it("der zurückgegebene Hash entspricht hashApiKey(plaintext)", () => {
    const { plaintext, hash } = generateApiKey();
    expect(hash).toBe(hashApiKey(plaintext));
  });

  it("erzeugt bei jedem Aufruf einen anderen Key", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.plaintext).not.toBe(b.plaintext);
  });
});

describe("hashesMatch", () => {
  it("liefert true für identische Hashes", () => {
    const { hash } = generateApiKey();
    expect(hashesMatch(hash, hash)).toBe(true);
  });

  it("liefert false für unterschiedliche Hashes gleicher Länge", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(hashesMatch(a.hash, b.hash)).toBe(false);
  });

  it("liefert false (statt zu werfen) bei unterschiedlicher Länge", () => {
    expect(hashesMatch("ab", "abcd")).toBe(false);
  });

  it("liefert false bei zwei leeren Strings (kein Wildcard-Match)", () => {
    expect(hashesMatch("", "")).toBe(false);
  });
});

describe("generateWebhookSecret", () => {
  it("erzeugt ein ausreichend langes Zufalls-Secret", () => {
    const secret = generateWebhookSecret();
    expect(secret).toMatch(/^[0-9a-f]{48}$/);
  });

  it("erzeugt bei jedem Aufruf ein anderes Secret", () => {
    expect(generateWebhookSecret()).not.toBe(generateWebhookSecret());
  });
});
