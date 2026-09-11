import { beforeEach, describe, expect, it, vi } from "vitest";
import { LEGAL_LAST_UPDATED } from "@/lib/legal/updated";
import { TRACKING_CONSENT_COOKIE, type TrackingConsentRow } from "@/lib/consent/schema";

/**
 * Affiliate-Modul, Block B2 (PLAN_Affiliate-System.md Abschnitt 10/B2):
 * Zustandsauflösung der Tracking-Einwilligung.
 *
 * Geprüft wird genau das, was im Betrieb Geld oder ein Bußgeld kostet: dass
 * die jüngste Nachweiszeile gewinnt, dass ein Widerruf eine Zustimmung
 * schlägt, und dass jeder unklare Zustand — kein Cookie, kaputtes Cookie,
 * veralteter Stand der Rechtstexte — als „keine Einwilligung" endet.
 *
 * `next/headers` ist gemockt: der Test braucht keinen Next.js-Request-Kontext
 * (gleiches Muster wie src/lib/security/turnstile.test.ts). Die Cookie-Ablage
 * ist eine schlichte Map, die jeder Fall selbst füllt.
 */

const cookieJar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
}));

const {
  hasTrackingConsent,
  isConsentGranted,
  needsConsentDecision,
  parseConsentCookie,
  readTrackingConsent,
  resolveConsentRows,
} = await import("./read");

/** Baut einen gültigen Cookie-Wert; jeder Fall überschreibt nur, was er prüft. */
function cookieValue(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    v: 1,
    cid: "0123456789abcdef0123456789abcdef",
    pol: LEGAL_LAST_UPDATED,
    at: "2026-09-10T10:00:00.000Z",
    dec: { affiliate: "granted" },
    ...overrides,
  });
}

function row(decision: TrackingConsentRow["decision"], createdAt: string): TrackingConsentRow {
  return { category: "affiliate", decision, created_at: createdAt };
}

beforeEach(() => {
  cookieJar.clear();
});

describe("consent/read — Nachweiszeilen", () => {
  it("lässt die jüngste Zeile gewinnen, unabhängig von der Ladereihenfolge", () => {
    const rows = [
      row("granted", "2026-09-01T08:00:00.000Z"),
      row("withdrawn", "2026-09-03T08:00:00.000Z"),
      row("denied", "2026-08-20T08:00:00.000Z"),
    ];
    expect(resolveConsentRows(rows)).toBe("withdrawn");
    // Umgekehrt geladen muss dasselbe herauskommen.
    expect(resolveConsentRows([...rows].reverse())).toBe("withdrawn");
  });

  it("erkennt eine erneute Zustimmung nach einem Widerruf", () => {
    expect(
      resolveConsentRows([
        row("withdrawn", "2026-09-01T08:00:00.000Z"),
        row("granted", "2026-09-05T08:00:00.000Z"),
      ]),
    ).toBe("granted");
  });

  it("lässt den Widerruf gewinnen, wenn beide Zeilen denselben Zeitstempel tragen", () => {
    // Doppelt abgeschickter Klick oder zwei Geräte in derselben Millisekunde:
    // die einschränkende Entscheidung gewinnt (fail-closed).
    expect(
      resolveConsentRows([
        row("granted", "2026-09-05T08:00:00.000Z"),
        row("withdrawn", "2026-09-05T08:00:00.000Z"),
      ]),
    ).toBe("withdrawn");
    expect(
      resolveConsentRows([
        row("withdrawn", "2026-09-05T08:00:00.000Z"),
        row("granted", "2026-09-05T08:00:00.000Z"),
      ]),
    ).toBe("withdrawn");
  });

  it("verdrängt eine gültige Zeile nicht durch eine mit unlesbarem Datum", () => {
    expect(
      resolveConsentRows([
        row("granted", "2026-09-05T08:00:00.000Z"),
        row("withdrawn", "kein Datum"),
      ]),
    ).toBe("granted");
  });

  it("ignoriert Zeilen anderer Kategorien und liefert ohne Zeile null", () => {
    const fremd = { category: "sonstiges", decision: "granted", created_at: "2026-09-05T08:00:00.000Z" };
    expect(resolveConsentRows([fremd as unknown as TrackingConsentRow])).toBeNull();
    expect(resolveConsentRows([])).toBeNull();
  });
});

describe("consent/read — Cookie", () => {
  it("liest eine gültige Zustimmung", async () => {
    cookieJar.set(TRACKING_CONSENT_COOKIE, cookieValue());

    const state = await readTrackingConsent();
    expect(state.consentId).toBe("0123456789abcdef0123456789abcdef");
    expect(state.decisions.affiliate).toBe("granted");
    expect(isConsentGranted(state)).toBe(true);
    expect(needsConsentDecision(state)).toBe(false);
    await expect(hasTrackingConsent()).resolves.toBe(true);
  });

  it("bedeutet ohne Cookie keine Einwilligung", async () => {
    const state = await readTrackingConsent();
    expect(state.consentId).toBeNull();
    expect(state.decisions.affiliate).toBeUndefined();
    expect(isConsentGranted(state)).toBe(false);
    // Ohne Entscheidung muss der Dialog erscheinen.
    expect(needsConsentDecision(state)).toBe(true);
    await expect(hasTrackingConsent()).resolves.toBe(false);
  });

  it("bedeutet mit kaputtem Cookie keine Einwilligung", async () => {
    const kaputt = [
      "",
      "nicht-json",
      "{",
      cookieValue().slice(0, 20), // unterwegs abgeschnitten
      JSON.stringify({ v: 1 }), // Nutzlast unvollständig
      cookieValue({ v: 2 }), // unbekannte Formatversion
      cookieValue({ cid: "zzz" }), // keine gültige Consent-ID
      cookieValue({ at: "gestern" }), // kein ISO-Zeitstempel
      cookieValue({ dec: { affiliate: "vielleicht" } }), // unbekannte Entscheidung
      cookieValue({ dec: "granted" }), // falscher Typ
      JSON.stringify([1, 2, 3]),
    ];

    for (const wert of kaputt) {
      cookieJar.set(TRACKING_CONSENT_COOKIE, wert);
      const state = await readTrackingConsent();
      expect(isConsentGranted(state), `Cookie-Wert: ${wert}`).toBe(false);
      expect(state.consentId, `Cookie-Wert: ${wert}`).toBeNull();
      await expect(hasTrackingConsent()).resolves.toBe(false);
    }
  });

  it("behandelt eine Ablehnung als Entscheidung, fragt also nicht erneut", async () => {
    cookieJar.set(TRACKING_CONSENT_COOKIE, cookieValue({ dec: { affiliate: "denied" } }));

    const state = await readTrackingConsent();
    expect(isConsentGranted(state)).toBe(false);
    expect(needsConsentDecision(state)).toBe(false);
  });

  it("lässt einen Widerruf im Cookie die frühere Zustimmung schlagen", async () => {
    cookieJar.set(TRACKING_CONSENT_COOKIE, cookieValue({ dec: { affiliate: "withdrawn" } }));

    const state = await readTrackingConsent();
    expect(state.decisions.affiliate).toBe("withdrawn");
    expect(isConsentGranted(state)).toBe(false);
    await expect(hasTrackingConsent()).resolves.toBe(false);
  });

  it("verwirft eine Zustimmung zu einem veralteten Stand der Rechtstexte", async () => {
    cookieJar.set(TRACKING_CONSENT_COOKIE, cookieValue({ pol: "2020-01-01" }));

    const state = await readTrackingConsent();
    expect(state.decisions.affiliate).toBe("granted");
    // Die Zustimmung galt einem anderen Text -> erneut fragen.
    expect(isConsentGranted(state)).toBe(false);
    expect(needsConsentDecision(state)).toBe(true);
  });

  it("wertet ein Cookie ohne Eintrag zur Kategorie nicht als Zustimmung", () => {
    // Abwärtskompatibilität: ein Cookie einer künftigen zweiten Kategorie darf
    // für 'affiliate' nichts behaupten.
    const state = parseConsentCookie(cookieValue({ dec: {} }));
    expect(state.consentId).toBe("0123456789abcdef0123456789abcdef");
    expect(isConsentGranted(state)).toBe(false);
    expect(needsConsentDecision(state)).toBe(true);
  });
});
