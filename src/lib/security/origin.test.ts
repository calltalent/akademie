import { describe, expect, it } from "vitest";
import { verifySameOrigin } from "./origin";

/**
 * Bisher ungetestet, obwohl bereits in sechs Route-Handlern verwendet
 * (Security-Fix 08.08.2026). Nachgezogen im Rahmen des Logout-CSRF-Fixes
 * (Security-Review 07.09.2026, src/app/auth/signout/route.ts) — siehe
 * Kopfkommentar `origin.ts` für die Fail-closed-Begründung.
 */
describe("verifySameOrigin", () => {
  it("akzeptiert einen Request, dessen Origin zum Host passt", () => {
    const request = new Request("https://academy.calltalent.ai/auth/signout", {
      method: "POST",
      headers: { origin: "https://academy.calltalent.ai", host: "academy.calltalent.ai" },
    });
    expect(verifySameOrigin(request)).toBe(true);
  });

  it("lehnt einen fremden Origin ab (Cross-Site-Formular)", () => {
    const request = new Request("https://academy.calltalent.ai/auth/signout", {
      method: "POST",
      headers: { origin: "https://evil.example", host: "academy.calltalent.ai" },
    });
    expect(verifySameOrigin(request)).toBe(false);
  });

  it("ignoriert den Port beim Host nicht (Origin trägt den Port mit)", () => {
    const request = new Request("http://academy.localhost:3000/auth/signout", {
      method: "POST",
      headers: { origin: "http://academy.localhost:3000", host: "academy.localhost:3000" },
    });
    expect(verifySameOrigin(request)).toBe(true);
  });

  it("lehnt fail-closed ab, wenn der Origin-Header fehlt", () => {
    const request = new Request("https://academy.calltalent.ai/auth/signout", {
      method: "POST",
      headers: { host: "academy.calltalent.ai" },
    });
    expect(verifySameOrigin(request)).toBe(false);
  });

  it("lehnt fail-closed ab, wenn der Host-Header fehlt", () => {
    const request = new Request("https://academy.calltalent.ai/auth/signout", {
      method: "POST",
      headers: { origin: "https://academy.calltalent.ai" },
    });
    expect(verifySameOrigin(request)).toBe(false);
  });

  it("lehnt einen unparsbaren Origin-Header ab, statt zu werfen", () => {
    const request = new Request("https://academy.calltalent.ai/auth/signout", {
      method: "POST",
      headers: { origin: "nicht-eine-url", host: "academy.calltalent.ai" },
    });
    expect(verifySameOrigin(request)).toBe(false);
  });
});
