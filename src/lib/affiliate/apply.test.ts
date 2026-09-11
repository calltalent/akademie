// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Affiliate-System, Block B7-B — Tests der Schutzschichten des öffentlichen
 * Bewerbungsformulars (`src/lib/affiliate/apply.ts`,
 * PLAN_Affiliate-System.md 8.3, 11.7, 11.15; CLAUDE.md §2.7).
 *
 * Umgebung `node` statt jsdom: `crypto.subtle` fehlt in der jsdom-Standard-
 * umgebung von Vitest und wird hier für das echte Formular-Token, den
 * Adress-Hash und den Zustimmungsnachweis gebraucht — gleiche Begründung wie
 * in `hash.test.ts:1-13` und `contact/form-token.test.ts:1-13`.
 *
 * Fünf Dinge werden geprüft, und jedes ist eine eigene Fehlerklasse:
 *
 *   1. HONEYPOT UND ZEITFALLE QUITTIEREN WIE EIN MENSCH. Nicht nur, dass sie
 *      greifen — sondern dass sie exakt denselben Zustand zurückgeben wie eine
 *      echte Bewerbung UND dass trotzdem keine Zeile entsteht. Ein Bot, der am
 *      Antworttext erkennt, dass er aufgeflogen ist, probiert die nächste
 *      Variante; genau deshalb ist der gleiche Text hier Prüfgegenstand.
 *   2. DREI RATE-LIMIT-EBENEN. IP, global und Mandant greifen vor jeder
 *      Datenbankarbeit, das Adresslimit danach. Der verteilte Bot aus dem
 *      Vorfall vom 24.08.2026 kam mit je einem Treffer von vier IPs — ein
 *      reines IP-Limit hätte ihn nie gesehen.
 *   3. KEIN ORAKEL (CLAUDE.md §2.15, Plan 11.15). „Modul aus", „Programm
 *      privat", „Programm im Entwurf" und „Programm existiert nicht" liefern
 *      denselben Text; eine bereits vorhandene Bewerbung liefert den
 *      Erfolgstext.
 *   4. DIE ZEILE ENTSTEHT ALS UNBEWERTETE BEWERBUNG. `status='pending'`, kein
 *      `user_id`, Zustimmungsnachweis gesetzt — der Guard
 *      `affiliate_partner_insert_must_be_pending` kehrt unter `service_role`
 *      sofort zurück, die Datenbank schützt hier also NICHT.
 *   5. DIE MANDANTENBINDUNG KOMMT AUS DEM HEADER, NIE AUS DEM FORMULAR. Ein
 *      mitgeschicktes `tenantId`/`programId` darf nichts bewirken.
 *
 * Mock-Muster wie `actions.test.ts` und `intake.test.ts`: ein In-Memory-Store,
 * der echt persistiert — ein reiner Spy verdeckte genau das, worauf es hier
 * ankommt, nämlich ob nach einer abgewiesenen Anfrage eine Zeile entstanden
 * ist. Die Unique-Constraints aus 3.3 (`(tenant_id, code)` und
 * `(tenant_id, program_id, applicant_email)`) sind im Mock nachgebildet, damit
 * der Wiederholungspfad bei Codekollision überhaupt geprüft werden kann.
 */

type Row = Record<string, unknown>;
type MockError = { code?: string; message: string };

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const PROGRAM_A = "33333333-3333-4333-8333-333333333333";
const PROGRAM_B = "44444444-4444-4444-8444-444444444444";

/** Wortgleich mit apply.ts — genau das ist der Prüfgegenstand. */
const APPLICATION_CLOSED =
  "Für diese Akademie können derzeit keine Bewerbungen entgegengenommen werden.";
const RATE_LIMITED = "Zu viele Anfragen. Bitte kurz warten und erneut versuchen.";
const ORIGIN_REJECTED = "Anfrage abgelehnt (ungültiger Origin).";

// --- Mock-Infrastruktur -------------------------------------------------

const { state, MockClient, rateLimitCalls } = vi.hoisted(() => {
  const state: {
    tables: Record<string, Row[]>;
    tenant: { id: string; name: string; settings: Record<string, unknown> } | null;
    /** Kopfzeilen des Requests (Origin/Host/IP). */
    requestHeaders: Record<string, string>;
    /** Namensräume, die der Limiter abweisen soll. */
    blockedLimits: Set<string>;
    turnstile: "skipped" | "ok" | "failed" | "unavailable";
    nextId: number;
  } = {
    tables: {},
    tenant: {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Beispiel-Akademie",
      settings: { affiliate_enabled: true },
    },
    requestHeaders: {
      origin: "https://akademie.example.invalid",
      host: "akademie.example.invalid",
      "cf-connecting-ip": "203.0.113.7",
    },
    blockedLimits: new Set<string>(),
    turnstile: "skipped",
    nextId: 0,
  };

  const rateLimitCalls: string[] = [];

  function rows(table: string): Row[] {
    return state.tables[table] ?? (state.tables[table] = []);
  }

  /** Die beiden Unique-Constraints aus Plan 3.3, im Speicher nachgebildet. */
  function uniqueViolation(table: string, row: Row): boolean {
    if (table !== "affiliate_partners") return false;
    return rows(table).some(
      (existing) =>
        (existing.tenant_id === row.tenant_id && existing.code === row.code) ||
        (existing.tenant_id === row.tenant_id &&
          existing.program_id === row.program_id &&
          existing.applicant_email === row.applicant_email),
    );
  }

  class MockQuery implements PromiseLike<{ data: Row[] | null; error: MockError | null }> {
    private op: "select" | "insert" = "select";
    private eqFilters: Array<[string, unknown]> = [];
    private inFilters: Array<[string, unknown[]]> = [];
    private payload: Row | null = null;
    private wantsRow = false;

    constructor(private table: string) {}

    select(): this {
      if (this.op !== "select") this.wantsRow = true;
      return this;
    }
    insert(row: Row): this {
      this.op = "insert";
      this.payload = row;
      return this;
    }
    eq(column: string, value: unknown): this {
      this.eqFilters.push([column, value]);
      return this;
    }
    in(column: string, values: unknown[]): this {
      this.inFilters.push([column, values]);
      return this;
    }

    private matching(): Row[] {
      let result = rows(this.table);
      for (const [column, value] of this.eqFilters) {
        result = result.filter((row) => row[column] === value);
      }
      for (const [column, values] of this.inFilters) {
        result = result.filter((row) => values.includes(row[column]));
      }
      return result;
    }

    private exec(): { data: Row[] | null; error: MockError | null } {
      if (this.op === "insert" && this.payload !== null) {
        if (uniqueViolation(this.table, this.payload)) {
          return { data: null, error: { code: "23505", message: "duplicate key" } };
        }
        state.nextId += 1;
        const row: Row = { id: `row-${state.nextId}`, ...this.payload };
        rows(this.table).push(row);
        return { data: this.wantsRow ? [row] : null, error: null };
      }
      return { data: this.matching().map((row) => ({ ...row })), error: null };
    }

    maybeSingle(): Promise<{ data: Row | null; error: MockError | null }> {
      const result = this.exec();
      return Promise.resolve({ data: result.data?.[0] ?? null, error: result.error });
    }

    then<TResult1 = { data: Row[] | null; error: MockError | null }, TResult2 = never>(
      onFulfilled?:
        | ((value: { data: Row[] | null; error: MockError | null }) => TResult1 | PromiseLike<TResult1>)
        | null,
      onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
      return Promise.resolve(this.exec()).then(onFulfilled, onRejected);
    }
  }

  class MockClient {
    from(table: string): MockQuery {
      return new MockQuery(table);
    }
  }

  return { state, MockClient, rateLimitCalls };
});

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => new MockClient() }));

vi.mock("@/lib/tenant/context", () => ({ getTenant: async () => state.tenant }));

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) => state.requestHeaders[name.toLowerCase()] ?? null,
  }),
}));

/**
 * Kein echtes Secret im Test (CLAUDE.md §2.6) — geprüft wird nicht die
 * Env-Validierung, sondern dass Signatur und Hash überhaupt entstehen.
 */
vi.mock("@/lib/env", () => ({
  getServerEnv: () => ({ SUPABASE_SERVICE_ROLE_KEY: "test-schluessel-nur-fuer-vitest" }),
}));

vi.mock("@/lib/security/rate-limit", () => ({
  checkRateLimit: async (namespace: string) => {
    rateLimitCalls.push(namespace);
    return !state.blockedLimits.has(namespace);
  },
  RATE_LIMIT_MESSAGE: "Zu viele Anfragen. Bitte kurz warten und erneut versuchen.",
}));

vi.mock("@/lib/security/turnstile", () => ({
  verifyTurnstile: async () => state.turnstile,
  TURNSTILE_RESPONSE_FIELD: "cf-turnstile-response",
  TURNSTILE_FAILED_MESSAGE:
    "Die Sicherheitsprüfung ist fehlgeschlagen. Bitte lade die Seite neu und sende erneut.",
}));

// `form-token.ts` läuft ECHT: die Zeitfalle ist Prüfgegenstand, ein Mock
// prüfte nur den Mock.
const { issueContactFormToken } = await import("@/lib/contact/form-token");
const { submitAffiliateApplication } = await import("./apply");
const { initialAffiliateApplicationActionState: INITIAL } = await import("./state");

// --- Ausgangsbestand ----------------------------------------------------

function seed(): void {
  state.tables = {
    affiliate_programs: [
      {
        id: PROGRAM_A,
        tenant_id: TENANT_A,
        status: "active",
        visibility: "public",
        terms_version: 3,
        application_fields: [
          { key: "kanal", label: "Dein Kanal", type: "url", required: true },
          { key: "plan", label: "Wie willst du werben?", type: "textarea", required: false },
        ],
      },
      // Ein Programm eines FREMDEN Mandanten — darf nie erreichbar sein.
      {
        id: PROGRAM_B,
        tenant_id: TENANT_B,
        status: "active",
        visibility: "public",
        terms_version: 1,
        application_fields: [],
      },
    ],
    affiliate_partners: [],
    affiliate_audit_log: [],
  };
  state.tenant = {
    id: TENANT_A,
    name: "Beispiel-Akademie",
    settings: { affiliate_enabled: true },
  };
  state.requestHeaders = {
    origin: "https://akademie.example.invalid",
    host: "akademie.example.invalid",
    "cf-connecting-ip": "203.0.113.7",
  };
  state.blockedLimits = new Set();
  state.turnstile = "skipped";
  state.nextId = 0;
  rateLimitCalls.length = 0;
}

/** Programmzeile des Mandanten A ändern. */
function program(patch: Row): void {
  Object.assign(state.tables.affiliate_programs[0], patch);
}

function partners(): Row[] {
  return state.tables.affiliate_partners ?? [];
}

type FormValues = Record<string, string>;

/**
 * Ein vollständiges, gültiges Formular. `ageSeconds` steuert die Zeitfalle:
 * 10 Sekunden sind menschlich, 0 Sekunden maschinell.
 */
async function buildForm(
  overrides: FormValues = {},
  ageSeconds = 10,
): Promise<FormData> {
  const values: FormValues = {
    displayName: "Erika Beispiel",
    email: "erika@example.invalid",
    company: "Beispiel GmbH",
    code: "",
    answer_kanal: "https://kanal.example.invalid",
    answer_plan: "Newsletter und Podcast.",
    acceptTerms: "on",
    termsVersion: "3",
    formToken: await issueContactFormToken(Date.now() - ageSeconds * 1000),
    ...overrides,
  };

  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) formData.set(key, value);
  return formData;
}

async function submit(overrides: FormValues = {}, ageSeconds = 10) {
  return submitAffiliateApplication(INITIAL, await buildForm(overrides, ageSeconds));
}

beforeEach(() => {
  seed();
  vi.restoreAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

// --- 1. Der gute Fall ---------------------------------------------------

describe("gültige Bewerbung", () => {
  it("legt genau eine unbewertete Bewerbung mit Zustimmungsnachweis an", async () => {
    const result = await submit();

    expect(result).toEqual({ error: null, success: true });
    expect(partners()).toHaveLength(1);

    const row = partners()[0];
    expect(row.tenant_id).toBe(TENANT_A);
    expect(row.program_id).toBe(PROGRAM_A);
    expect(row.status).toBe("pending");
    // Der Guard kehrt unter `service_role` sofort zurück — diese Zusicherung
    // ist im Betrieb die einzige.
    expect(row.user_id).toBeUndefined();
    expect(row.terms_version_accepted).toBe(3);
    expect(typeof row.terms_accepted_at).toBe("string");
    expect(row.terms_accepted_ip_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("speichert nur die Antworten auf bekannte Felder", async () => {
    await submit({ answer_fremd: "eingeschmuggelt" });

    expect(partners()[0].application).toEqual({
      kanal: "https://kanal.example.invalid",
      plan: "Newsletter und Podcast.",
    });
  });

  it("entfernt das +Suffix aus der gespeicherten Adresse (3.3)", async () => {
    await submit({ email: "Erika+partner@Example.invalid" });

    expect(partners()[0].applicant_email).toBe("erika@example.invalid");
  });

  it("schreibt einen Eintrag in den Prüfpfad", async () => {
    await submit();

    const log = state.tables.affiliate_audit_log ?? [];
    expect(log).toHaveLength(1);
    expect(log[0].action).toBe("partner.apply");
    expect(log[0].actor_kind).toBe("system");
    expect(log[0].tenant_id).toBe(TENANT_A);
  });

  it("redigiert die Bewerberdaten im Prüfpfad", async () => {
    await submit();

    const after = (state.tables.affiliate_audit_log ?? [])[0].after as Record<string, unknown>;
    expect(after.applicant_email).toBe("***");
    expect(after.display_name).toBe("***");
    expect(after.application).toBe("***");
    expect(after.status).toBe("pending");
  });

  it("nimmt einen freien Wunschcode und leitet sonst einen aus dem Namen ab", async () => {
    await submit({ code: "erika-empfiehlt" });
    expect(partners()[0].code).toBe("erika-empfiehlt");

    seed();
    await submit();
    expect(partners()[0].code).toBe("erika-beispiel");
  });

  it("weicht aus, wenn der Wunschcode schon vergeben ist — ohne die Bewerbung abzulehnen", async () => {
    partners().push({
      id: "fremd",
      tenant_id: TENANT_A,
      program_id: PROGRAM_A,
      applicant_email: "andere@example.invalid",
      code: "erika-beispiel",
      status: "active",
    });

    const result = await submit({ code: "erika-beispiel" });

    expect(result.success).toBe(true);
    expect(partners()).toHaveLength(2);
    expect(partners()[1].code).not.toBe("erika-beispiel");
    expect(partners()[1].code).toMatch(/^[a-z0-9][a-z0-9-]{2,31}$/);
  });
});

// --- 2. Honeypot und Zeitfalle -----------------------------------------

describe("Honeypot und Zeitfalle quittieren wie ein Mensch", () => {
  it("Honeypot: gleicher Zustand, keine Zeile", async () => {
    const echt = await submit();
    seed();

    const bot = await submit({ website: "https://spam.example.invalid" });

    expect(bot).toEqual(echt);
    expect(partners()).toHaveLength(0);
  });

  it("Zeitfalle: unter drei Sekunden ist maschinell", async () => {
    const bot = await submit({}, 0);

    expect(bot).toEqual({ error: null, success: true });
    expect(partners()).toHaveLength(0);
  });

  it("Zeitfalle: ohne Token — ein direktes POST auf die Action", async () => {
    const formData = await buildForm();
    formData.delete("formToken");

    const bot = await submitAffiliateApplication(INITIAL, formData);

    expect(bot).toEqual({ error: null, success: true });
    expect(partners()).toHaveLength(0);
  });

  it("Zeitfalle: gefälschte Signatur", async () => {
    const bot = await submit({ formToken: `${Math.floor(Date.now() / 1000)}.${"a".repeat(64)}` });

    expect(bot).toEqual({ error: null, success: true });
    expect(partners()).toHaveLength(0);
  });

  it("ein abgelaufenes Formular bekommt dagegen einen korrigierbaren Hinweis", async () => {
    const result = await submit({}, 4 * 60 * 60);

    expect(result.success).toBeUndefined();
    expect(result.error).toContain("abgelaufen");
    expect(partners()).toHaveLength(0);
  });
});

// --- 3. Rate-Limits -----------------------------------------------------

describe("Rate-Limits auf vier Ebenen", () => {
  it("fragt IP, global und Mandant, bevor irgendetwas geschrieben wird", async () => {
    await submit();

    expect(rateLimitCalls).toEqual([
      "affiliate-apply-ip",
      "affiliate-apply-global",
      "affiliate-apply-tenant",
      "affiliate-apply-email",
    ]);
  });

  it.each([
    ["affiliate-apply-ip"],
    ["affiliate-apply-global"],
    ["affiliate-apply-tenant"],
    ["affiliate-apply-email"],
  ])("%s abgewiesen: keine Zeile", async (namespace) => {
    state.blockedLimits.add(namespace);

    const result = await submit();

    expect(result.error).toBe(RATE_LIMITED);
    expect(partners()).toHaveLength(0);
  });

  it("das IP-Limit greift vor jeder Datenbankarbeit", async () => {
    state.blockedLimits.add("affiliate-apply-ip");

    await submit();

    expect(rateLimitCalls).toEqual(["affiliate-apply-ip"]);
  });
});

// --- 4. Turnstile und Origin -------------------------------------------

describe("Turnstile und Origin", () => {
  it("ein ungültiges Turnstile-Token wird abgewiesen", async () => {
    state.turnstile = "failed";

    const result = await submit();

    expect(result.error).toContain("Sicherheitsprüfung");
    expect(partners()).toHaveLength(0);
  });

  it("ein Ausfall bei Cloudflare lässt die Bewerbung durch (fail-open)", async () => {
    state.turnstile = "unavailable";

    expect((await submit()).success).toBe(true);
    expect(partners()).toHaveLength(1);
  });

  it("fremder Origin: abgewiesen, fail-closed", async () => {
    state.requestHeaders.origin = "https://angreifer.example.invalid";

    const result = await submit();

    expect(result.error).toBe(ORIGIN_REJECTED);
    expect(partners()).toHaveLength(0);
  });

  it("fehlender Origin-Header: ebenfalls abgewiesen", async () => {
    delete state.requestHeaders.origin;

    expect((await submit()).error).toBe(ORIGIN_REJECTED);
    expect(partners()).toHaveLength(0);
  });
});

// --- 5. Kein Orakel (§2.15) --------------------------------------------

describe("kein Orakel über fremde Programme und Bewerbungen", () => {
  it.each([
    [
      "Modul nicht freigeschaltet",
      () => {
        state.tenant = { id: TENANT_A, name: "Beispiel-Akademie", settings: {} };
      },
    ],
    [
      "kein Mandant zum Host",
      () => {
        state.tenant = null;
      },
    ],
    [
      "Programm privat",
      () => {
        program({ visibility: "private" });
      },
    ],
    [
      "Programm im Entwurf",
      () => {
        program({ status: "draft" });
      },
    ],
    [
      "Programm pausiert",
      () => {
        program({ status: "paused" });
      },
    ],
    [
      "kein Programm angelegt",
      () => {
        state.tables.affiliate_programs = [];
      },
    ],
  ])("%s: derselbe Text, keine Zeile", async (_name, arrange) => {
    arrange();

    const result = await submit();

    expect(result.error).toBe(APPLICATION_CLOSED);
    expect(partners()).toHaveLength(0);
  });

  it("eine bereits vorhandene Bewerbung bekommt den Erfolgstext — und bleibt eine", async () => {
    const erste = await submit();
    const zweite = await submit();

    expect(zweite).toEqual(erste);
    expect(partners()).toHaveLength(1);
  });

  it("eine vorhandene Bewerbung erzeugt keinen zweiten Prüfpfad-Eintrag", async () => {
    await submit();
    await submit();

    expect(state.tables.affiliate_audit_log).toHaveLength(1);
  });
});

// --- 6. Mandantenbindung ------------------------------------------------

describe("Mandantenbindung", () => {
  it("ein mitgeschicktes tenantId/programId bewirkt nichts", async () => {
    await submit({ tenantId: TENANT_B, programId: PROGRAM_B });

    expect(partners()[0].tenant_id).toBe(TENANT_A);
    expect(partners()[0].program_id).toBe(PROGRAM_A);
  });

  it("`visibility='link'` ist erreichbar — nur nicht gelistet", async () => {
    program({ visibility: "link" });

    expect((await submit()).success).toBe(true);
    expect(partners()).toHaveLength(1);
  });
});

// --- 7. zod und Inhaltsprüfung -----------------------------------------

describe("zod und Inhaltsprüfung", () => {
  it("ein Link im Namensfeld wird abgewiesen", async () => {
    const result = await submit({ displayName: "Jetzt kaufen unter https://billig.example.invalid" });

    expect(result.error).toBeTruthy();
    expect(result.success).toBeUndefined();
    expect(partners()).toHaveLength(0);
  });

  it("ohne Zustimmung zu den Bedingungen keine Bewerbung", async () => {
    const formData = await buildForm();
    formData.delete("acceptTerms");

    const result = await submitAffiliateApplication(INITIAL, formData);

    expect(result.error).toContain("Partnerbedingungen");
    expect(partners()).toHaveLength(0);
  });

  it("eine veraltete Fassung der Bedingungen wird abgewiesen", async () => {
    const result = await submit({ termsVersion: "2" });

    expect(result.error).toContain("geändert");
    expect(partners()).toHaveLength(0);
  });

  it("ein fehlendes Pflichtfeld nennt seine Beschriftung", async () => {
    const result = await submit({ answer_kanal: "" });

    expect(result.error).toContain("Dein Kanal");
    expect(partners()).toHaveLength(0);
  });

  it("ein url-Feld ohne Schema wird abgewiesen", async () => {
    const result = await submit({ answer_kanal: "kanal.example.invalid" });

    expect(result.error).toContain("Dein Kanal");
    expect(partners()).toHaveLength(0);
  });

  it("Markup in einer Freitext-Antwort wird abgewiesen", async () => {
    const result = await submit({ answer_plan: "<a href=\"https://spam.example\">hier</a>" });

    expect(result.error).toBeTruthy();
    expect(partners()).toHaveLength(0);
  });

  it("eine Linkliste in einer Freitext-Antwort wird abgewiesen", async () => {
    const result = await submit({
      answer_plan: "a.example.com b.example.net c.example.org d.example.io",
    });

    expect(result.error).toContain("Links");
    expect(partners()).toHaveLength(0);
  });

  it("ein einzelner Link im Freitext ist dagegen erlaubt", async () => {
    expect((await submit({ answer_plan: "Mein Blog: blog.example.com" })).success).toBe(true);
  });
});
