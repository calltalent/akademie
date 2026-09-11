// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

/**
 * Affiliate-System, Block B3 — Tests des IP-Hashes mit Tagessalz
 * (`hash.ts`, PLAN_Affiliate-System.md 3.6, 4.2 Schritt 6).
 *
 * `crypto.subtle` fehlt in der jsdom-Standardumgebung von Vitest, ist in Node
 * und in Cloudflare Workers (der Ziel-Laufzeit) dagegen vorhanden — deshalb
 * läuft diese Datei per Docblock oben in der node-Umgebung, gleiches Vorgehen
 * und gleiche Begründung wie `src/lib/contact/form-token.test.ts:1-13`.
 *
 * `@/lib/env` wird gemockt: der Test braucht kein echtes
 * `SUPABASE_SERVICE_ROLE_KEY` (CLAUDE.md §2.6 — keine Secrets in Tests), und
 * geprüft wird ohnehin nicht die Env-Validierung, sondern dass das Salz
 * überhaupt eingeht und mit dem Tag wechselt.
 */
vi.mock("@/lib/env", () => ({
  getServerEnv: () => ({
    SUPABASE_SERVICE_ROLE_KEY: "test-schluessel-nur-fuer-vitest",
  }),
}));

const { buildClickDedupKey, hashClickIp, normalizeIp, utcDayStamp, utcHourStamp } =
  await import("./hash");

/** Dokumentations-IPs nach RFC 5737/3849 — nie eine echte Adresse in einem Fixture. */
const IP_A = "203.0.113.7";
const IP_B = "198.51.100.42";
const IP_V6 = "2001:db8::1";

const TAG_1 = new Date("2026-09-11T08:15:00.000Z");
const TAG_1_SPAET = new Date("2026-09-11T23:59:59.999Z");
const TAG_2 = new Date("2026-09-12T00:00:00.000Z");

const HEX_64 = /^[0-9a-f]{64}$/;

describe("Zeitstempel des Salzes", () => {
  it("bildet den Tag als JJJJMMTT in UTC", () => {
    expect(utcDayStamp(TAG_1)).toBe("20260911");
    expect(utcDayStamp(TAG_2)).toBe("20260912");
  });

  it("bildet die Stunde als JJJJMMTTHH in UTC", () => {
    expect(utcHourStamp(TAG_1)).toBe("2026091108");
    expect(utcHourStamp(TAG_1_SPAET)).toBe("2026091123");
  });

  it("rechnet in UTC, nicht in Ortszeit", () => {
    // 00:30 UTC ist in Berlin bereits der 12. — der Tagesstempel muss
    // trotzdem der UTC-Tag sein, sonst rotiert das Salz je nach Region des
    // ausführenden Workers zu einer anderen Stunde.
    expect(utcDayStamp(new Date("2026-09-12T00:30:00.000Z"))).toBe("20260912");
    expect(utcDayStamp(new Date("2026-09-11T23:30:00.000Z"))).toBe("20260911");
  });
});

describe("normalizeIp", () => {
  it("entfernt umgebende Leerzeichen", () => {
    expect(normalizeIp(`  ${IP_A}  `)).toBe(IP_A);
  });

  it("schreibt IPv6 klein, damit dieselbe Adresse denselben Hash ergibt", () => {
    expect(normalizeIp("2001:DB8::AB")).toBe("2001:db8::ab");
  });

  it("führt eine IPv4-mapped IPv6-Adresse auf die IPv4-Form zurück", () => {
    // `cf-connecting-ip` und `x-forwarded-for` schreiben dieselbe Adresse
    // sonst unterschiedlich, und der Dedup-Schlüssel wiche auseinander.
    expect(normalizeIp(`::ffff:${IP_A}`)).toBe(IP_A);
    expect(normalizeIp(`::FFFF:${IP_A}`)).toBe(IP_A);
  });

  it("meldet fehlende und leere Werte als null", () => {
    expect(normalizeIp(null)).toBeNull();
    expect(normalizeIp(undefined)).toBeNull();
    expect(normalizeIp("")).toBeNull();
    expect(normalizeIp("   ")).toBeNull();
  });
});

describe("hashClickIp", () => {
  it("liefert 64 Hexzeichen", async () => {
    expect(await hashClickIp(IP_A, TAG_1)).toMatch(HEX_64);
  });

  it("ist für dieselbe IP am selben Tag stabil", async () => {
    expect(await hashClickIp(IP_A, TAG_1)).toBe(await hashClickIp(IP_A, TAG_1_SPAET));
  });

  it("trennt verschiedene IPs", async () => {
    expect(await hashClickIp(IP_A, TAG_1)).not.toBe(await hashClickIp(IP_B, TAG_1));
  });

  it("wechselt mit dem Tag — das ist die Rotation, nicht der Schutz", async () => {
    // Nach Mitternacht UTC ergibt dieselbe IP einen anderen Hash. Damit
    // lassen sich die Zeilen zweier Tage nicht mehr zu einem Bewegungsprofil
    // verketten (Plan 3.6).
    expect(await hashClickIp(IP_A, TAG_1)).not.toBe(await hashClickIp(IP_A, TAG_2));
  });

  it("behandelt die Schreibvarianten derselben Adresse als dieselbe", async () => {
    expect(await hashClickIp(`::ffff:${IP_A}`, TAG_1)).toBe(await hashClickIp(IP_A, TAG_1));
    expect(await hashClickIp("2001:DB8::1", TAG_1)).toBe(await hashClickIp(IP_V6, TAG_1));
  });

  it("gibt ohne IP null zurück statt eines Hashes über den leeren String", async () => {
    // Ein konstanter Hash sähe aus wie eine echte Adresse und verschmölze
    // alle IP-losen Klicks zu einem Absender.
    expect(await hashClickIp(null, TAG_1)).toBeNull();
    expect(await hashClickIp(undefined, TAG_1)).toBeNull();
    expect(await hashClickIp("", TAG_1)).toBeNull();
  });

  it("gibt die IP in keiner Form preis", async () => {
    const hash = await hashClickIp(IP_A, TAG_1);
    expect(hash).not.toBeNull();
    expect(hash).not.toContain(IP_A);
    // Auch nicht als Hex der eigenen Bytes — das wäre eine Kodierung, keine
    // Pseudonymisierung.
    const alsHex = Array.from(new TextEncoder().encode(IP_A))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    expect(hash).not.toContain(alsHex);
  });

  it("hängt tatsächlich am geheimen Schlüssel, nicht nur am Datum", async () => {
    // Die Kernaussage der Begründung in hash.ts: wäre nur das Datum das
    // Salz, ließe sich der IPv4-Raum in Sekunden durchrechnen. Zwei
    // Instanzen mit verschiedenen Schlüsseln müssen deshalb für dieselbe IP
    // am selben Tag verschiedene Hashes liefern.
    const mitSchluessel = async (secret: string) => {
      vi.resetModules();
      vi.doMock("@/lib/env", () => ({
        getServerEnv: () => ({ SUPABASE_SERVICE_ROLE_KEY: secret }),
      }));
      const modul = await import("./hash");
      return modul.hashClickIp(IP_A, TAG_1);
    };

    const a = await mitSchluessel("schluessel-eins-nur-fuer-vitest");
    const b = await mitSchluessel("schluessel-zwei-nur-fuer-vitest");
    expect(a).not.toBe(b);

    vi.doUnmock("@/lib/env");
    vi.resetModules();
  });
});

describe("buildClickDedupKey", () => {
  const BASIS = {
    partnerId: "aaaaaaaa-0000-4000-8000-000000000001",
    ipHash: "a".repeat(64),
    uaFamily: "chrome",
    at: TAG_1,
  };

  it("liefert 64 Hexzeichen", async () => {
    expect(await buildClickDedupKey(BASIS)).toMatch(HEX_64);
  });

  it("ist für dieselbe Eingabe stabil — der Dedup ist ein Constraint, keine Abfrage", async () => {
    expect(await buildClickDedupKey(BASIS)).toBe(await buildClickDedupKey({ ...BASIS }));
  });

  it("fasst dieselbe Stunde zusammen und trennt die nächste", async () => {
    const frueh = await buildClickDedupKey({
      ...BASIS,
      at: new Date("2026-09-11T08:00:00.000Z"),
    });
    const spaet = await buildClickDedupKey({
      ...BASIS,
      at: new Date("2026-09-11T08:59:59.999Z"),
    });
    const naechste = await buildClickDedupKey({
      ...BASIS,
      at: new Date("2026-09-11T09:00:00.000Z"),
    });
    expect(frueh).toBe(spaet);
    expect(frueh).not.toBe(naechste);
  });

  it("trennt Partner, IP-Hash und UA-Klasse", async () => {
    const basis = await buildClickDedupKey(BASIS);
    expect(
      await buildClickDedupKey({
        ...BASIS,
        partnerId: "bbbbbbbb-0000-4000-8000-000000000002",
      }),
    ).not.toBe(basis);
    expect(await buildClickDedupKey({ ...BASIS, ipHash: "b".repeat(64) })).not.toBe(basis);
    expect(await buildClickDedupKey({ ...BASIS, uaFamily: "firefox" })).not.toBe(basis);
  });

  it("behandelt den Klick ohne IP als eigene, zusammenfallende Klasse", async () => {
    const ohneIp = await buildClickDedupKey({ ...BASIS, ipHash: null });
    expect(ohneIp).toMatch(HEX_64);
    expect(ohneIp).not.toBe(await buildClickDedupKey(BASIS));
    // Zwei IP-lose Klicks desselben Partners in derselben Stunde fallen
    // bewusst auf eine Zeile zusammen (siehe NO_IP_MARKER in hash.ts): ohne
    // IP lässt sich ein zweiter Besucher von einem Wiederholungsabruf nicht
    // unterscheiden, und eine zu hohe Klickzahl wäre schlimmer als eine zu
    // niedrige.
    expect(ohneIp).toBe(
      await buildClickDedupKey({
        ...BASIS,
        ipHash: null,
        at: new Date("2026-09-11T08:44:00.000Z"),
      }),
    );
  });

  it("lässt keinen Bestandteil in den nächsten überlaufen", async () => {
    // Alle Bestandteile sind Hex, UUID, eine Klasse aus einer festen Liste
    // oder Ziffern — keiner kann ein „|" enthalten. Die Probe: zwei
    // Eingaben, die bei einer Verkettung ohne Trennzeichen gleich wären.
    const a = await buildClickDedupKey({
      ...BASIS,
      uaFamily: "chrome",
      ipHash: "ab".repeat(32),
    });
    const b = await buildClickDedupKey({
      ...BASIS,
      uaFamily: "ome",
      ipHash: `${"ab".repeat(31)}abchr`,
    });
    expect(a).not.toBe(b);
  });
});
