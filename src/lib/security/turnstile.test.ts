import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `@/lib/env` und `next/headers` sind gemockt: der Test braucht weder eine
 * echte `.env` noch einen Next.js-Request-Kontext (CLAUDE.md §2.6 — keine
 * Secrets in Tests, der hier verwendete "Secret" ist eine Attrappe).
 * `TURNSTILE_SECRET_KEY`/`NEXT_PUBLIC_TURNSTILE_SITE_KEY` werden pro Fall
 * über die beiden veränderlichen Objekte unten umgeschaltet, damit sowohl
 * der konfigurierte als auch der abgeschaltete Zustand geprüft ist.
 */
const serverEnv = { TURNSTILE_SECRET_KEY: undefined as string | undefined };
const clientEnv = { NEXT_PUBLIC_TURNSTILE_SITE_KEY: undefined as string | undefined };

vi.mock("@/lib/env", () => ({
  getServerEnv: () => serverEnv,
  get publicEnv() {
    return clientEnv;
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "cf-connecting-ip": "203.0.113.7" }),
}));

const { verifyTurnstile, isTurnstileConfigured } = await import("./turnstile");

function enableTurnstile() {
  serverEnv.TURNSTILE_SECRET_KEY = "secret-attrappe-nur-fuer-vitest";
  clientEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "0x0000000000000000000000";
}

function mockSiteverify(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  // Signatur mit Parametern, damit `fetchMock.mock.calls[0][1].body` unten
  // typisiert ist (sonst leerer Tupel-Typ).
  const fetchMock = vi.fn(async (_url: string, requestInit?: { body?: unknown }) => {
    void requestInit;
    return {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: async () => body,
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  serverEnv.TURNSTILE_SECRET_KEY = undefined;
  clientEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY = undefined;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("verifyTurnstile", () => {
  it("ist ohne Schlüssel abgeschaltet und ruft Cloudflare gar nicht auf", async () => {
    const fetchMock = mockSiteverify({ success: true });

    expect(isTurnstileConfigured()).toBe(false);
    expect(await verifyTurnstile("irgendein-token")).toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("bleibt abgeschaltet, wenn nur einer der beiden Schlüssel gesetzt ist", async () => {
    serverEnv.TURNSTILE_SECRET_KEY = "secret-attrappe-nur-fuer-vitest";
    const fetchMock = mockSiteverify({ success: true });

    expect(isTurnstileConfigured()).toBe(false);
    expect(await verifyTurnstile("irgendein-token")).toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("akzeptiert ein gültiges Token und schickt Secret, Token und IP mit", async () => {
    enableTurnstile();
    const fetchMock = mockSiteverify({ success: true });

    expect(await verifyTurnstile("gueltiges-token")).toBe("ok");

    const body = fetchMock.mock.calls[0]?.[1]?.body as FormData;

    expect(body.get("secret")).toBe("secret-attrappe-nur-fuer-vitest");
    expect(body.get("response")).toBe("gueltiges-token");
    expect(body.get("remoteip")).toBe("203.0.113.7");
  });

  it("lehnt ein fehlendes oder leeres Token ohne Netzaufruf ab", async () => {
    enableTurnstile();
    const fetchMock = mockSiteverify({ success: true });

    expect(await verifyTurnstile(null)).toBe("failed");
    expect(await verifyTurnstile("")).toBe("failed");
    expect(await verifyTurnstile("   ")).toBe("failed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lehnt ein bereits verbrauchtes Token ab", async () => {
    enableTurnstile();
    mockSiteverify({ success: false, "error-codes": ["timeout-or-duplicate"] });

    expect(await verifyTurnstile("verbrauchtes-token")).toBe("failed");
  });

  it("lässt bei einem Ausfall von Cloudflare durch (fail-open)", async () => {
    enableTurnstile();

    mockSiteverify({}, { ok: false, status: 503 });
    expect(await verifyTurnstile("token")).toBe("unavailable");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    expect(await verifyTurnstile("token")).toBe("unavailable");
  });
});
