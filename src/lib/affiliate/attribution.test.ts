import { describe, expect, it } from "vitest";
import {
  AFFILIATE_ATTRIBUTION_AUDIT_ACTIONS,
  detectSelfReferral,
  hasAffiliateAttribution,
  normalizeAffiliateEmail,
  resolveAttribution,
  type AffiliateAttributionInput,
  type AffiliateAttributionPartner,
  type AffiliateAttributionProgram,
  type AffiliateBindingCandidate,
  type AffiliateReferralCandidate,
} from "./attribution";

/**
 * Affiliate-System, Block B3 — Tests der Attributionsentscheidung
 * (`src/lib/affiliate/attribution.ts`, PLAN_Affiliate-System.md 4.4).
 *
 * Jede der zehn Regeln einzeln, ohne einen einzigen Mock — das ist der ganze
 * Grund, warum `resolveAttribution()` rein ist. Die Tabelle in 4.4 ist ein
 * Vertrag mit dem Partner (sie gehört wörtlich in `program.terms_text`), und
 * ein Vertrag, dessen Einhaltung sich nur mit laufender Datenbank überprüfen
 * lässt, wird nicht überprüft.
 *
 * Stil wie `compute.test.ts`: feste, kanonisch klein geschriebene UUIDs, ein
 * fester Zeitpunkt, jede Erwartung ausgeschrieben.
 */

const TENANT = "11111111-0000-4000-8000-000000000001";
const OTHER_TENANT = "22222222-0000-4000-8000-000000000002";
const PROGRAM = "33333333-0000-4000-8000-000000000003";
const OTHER_PROGRAM = "44444444-0000-4000-8000-000000000004";

const PARTNER_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const PARTNER_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const PARTNER_C = "cccccccc-0000-4000-8000-00000000000c";

const BUYER = "dddddddd-0000-4000-8000-00000000000d";
const BUYER_EMAIL = "kaeuferin@example.com";

/** Bestellzeitpunkt aller Fälle. Nie `new Date()` — sonst altern die Tests. */
const AT = new Date("2026-09-11T12:00:00.000Z");
const IN_FUTURE = "2026-10-01T00:00:00.000Z";
const IN_PAST = "2026-09-01T00:00:00.000Z";

function partner(
  overrides: Partial<AffiliateAttributionPartner> & Pick<AffiliateAttributionPartner, "id">,
): AffiliateAttributionPartner {
  return {
    tenant_id: TENANT,
    program_id: PROGRAM,
    user_id: null,
    applicant_email: `partner-${overrides.id.slice(0, 4)}@example.com`,
    status: "active",
    ...overrides,
  };
}

function referral(
  overrides: Partial<AffiliateReferralCandidate> & Pick<AffiliateReferralCandidate, "id">,
): AffiliateReferralCandidate {
  const partnerId = overrides.partner_id ?? overrides.partner?.id ?? PARTNER_A;
  return {
    tenant_id: TENANT,
    program_id: PROGRAM,
    partner_id: partnerId,
    token: `${"0".repeat(63)}1`,
    campaign: null,
    user_id: null,
    status: "active",
    expires_at: IN_FUTURE,
    created_at: "2026-09-05T00:00:00.000Z",
    is_bot: false,
    partner: partner({ id: partnerId }),
    ...overrides,
  };
}

function binding(
  overrides: Partial<AffiliateBindingCandidate> = {},
): AffiliateBindingCandidate {
  const partnerId = overrides.partner_id ?? overrides.partner?.id ?? PARTNER_B;
  return {
    tenant_id: TENANT,
    program_id: PROGRAM,
    user_id: BUYER,
    partner_id: partnerId,
    source: "click",
    partner: partner({ id: partnerId }),
    ...overrides,
  };
}

function program(
  overrides: Partial<AffiliateAttributionProgram> = {},
): AffiliateAttributionProgram {
  return {
    id: PROGRAM,
    tenant_id: TENANT,
    status: "active",
    attribution_model: "last",
    lifetime_binding: true,
    self_referral: "block",
    test_mode: false,
    ...overrides,
  };
}

function input(overrides: Partial<AffiliateAttributionInput> = {}): AffiliateAttributionInput {
  return {
    tenantId: TENANT,
    featureEnabled: true,
    program: program(),
    buyer: { userId: BUYER, email: BUYER_EMAIL },
    at: AT,
    ...overrides,
  };
}

// --- E-Mail-Normalisierung (4.4, letzter Absatz) ------------------------

describe("normalizeAffiliateEmail", () => {
  it("macht klein und schneidet Leerraum ab", () => {
    expect(normalizeAffiliateEmail("  Max.Mustermann@Example.COM ")).toBe(
      "max.mustermann@example.com",
    );
  });

  it("schneidet den lokalen Teil ab dem ersten Plus ab", () => {
    expect(normalizeAffiliateEmail("partner+kauf@example.com")).toBe("partner@example.com");
    expect(normalizeAffiliateEmail("partner+a+b@example.com")).toBe("partner@example.com");
  });

  it("entfernt Punkte NUR bei gmail.com", () => {
    expect(normalizeAffiliateEmail("max.muster.mann@gmail.com")).toBe("maxmustermann@gmail.com");
    expect(normalizeAffiliateEmail("max.muster@example.com")).toBe("max.muster@example.com");
  });

  it("wendet Plus und Punkte bei gmail.com zusammen an", () => {
    expect(normalizeAffiliateEmail("M.A.X+shop@GMail.com")).toBe("max@gmail.com");
  });

  it("lässt googlemail.com unangetastet — der Plan nennt nur gmail.com", () => {
    expect(normalizeAffiliateEmail("m.a.x@googlemail.com")).toBe("m.a.x@googlemail.com");
  });

  it("gibt null zurück, was nicht vergleichbar ist", () => {
    expect(normalizeAffiliateEmail(null)).toBeNull();
    expect(normalizeAffiliateEmail(undefined)).toBeNull();
    expect(normalizeAffiliateEmail("")).toBeNull();
    expect(normalizeAffiliateEmail("   ")).toBeNull();
    expect(normalizeAffiliateEmail("ohne-at-zeichen")).toBeNull();
    expect(normalizeAffiliateEmail("@example.com")).toBeNull();
    expect(normalizeAffiliateEmail("lokal@")).toBeNull();
  });

  it("gibt null statt einer nur-Domain-Adresse zurück, wenn der lokale Teil wegfällt", () => {
    // Die gefährlichste Stelle: „@example.com" wäre für ZWEI verschiedene
    // Menschen derselbe Wert und würde fremde Käufe als Selbstkauf sperren.
    expect(normalizeAffiliateEmail("+tag@example.com")).toBeNull();
    expect(normalizeAffiliateEmail("...@gmail.com")).toBeNull();
  });

  it("trennt am LETZTEN @, nicht am ersten", () => {
    expect(normalizeAffiliateEmail('"a@b"@example.com')).toBe('"a@b"@example.com');
  });
});

describe("detectSelfReferral", () => {
  it("erkennt die Konto-ID", () => {
    expect(detectSelfReferral(partner({ id: PARTNER_A, user_id: BUYER }), {
      userId: BUYER,
      email: null,
    })).toBe("account");
  });

  it("erkennt die normalisierte E-Mail", () => {
    expect(
      detectSelfReferral(partner({ id: PARTNER_A, applicant_email: "Partner@Example.com" }), {
        userId: BUYER,
        email: "partner+kauf@example.com",
      }),
    ).toBe("email");
  });

  it("meldet nichts, wenn die E-Mail des Partners nicht geladen wurde", () => {
    // `applicant_email` fehlt im Spalten-Grant für `authenticated`
    // (AFFILIATE_PARTNER_CLIENT_COLUMNS) — `null` heißt „nicht geladen".
    expect(
      detectSelfReferral(partner({ id: PARTNER_A, applicant_email: null }), {
        userId: BUYER,
        email: BUYER_EMAIL,
      }),
    ).toBeNull();
  });

  it("meldet nichts ohne Kandidaten", () => {
    expect(detectSelfReferral(null, { userId: BUYER, email: BUYER_EMAIL })).toBeNull();
  });
});

// --- R0 ------------------------------------------------------------------

describe("R0 — Modul aus oder Programm nicht aktiv", () => {
  it("greift, wenn der Feature-Schalter aus ist", () => {
    const result = resolveAttribution(
      input({ featureEnabled: false, urlReferral: referral({ id: "ref-1" }) }),
    );
    expect(result.meta).toEqual({ rule: "R0", reason: null });
    expect(result.partnerId).toBeNull();
    expect(result.token).toBeNull();
    expect(hasAffiliateAttribution(result)).toBe(false);
  });

  it("greift ohne Programmzeile", () => {
    expect(resolveAttribution(input({ program: null })).meta.rule).toBe("R0");
  });

  it("greift bei `draft` und `paused`", () => {
    expect(resolveAttribution(input({ program: program({ status: "draft" }) })).meta.rule).toBe("R0");
    expect(resolveAttribution(input({ program: program({ status: "paused" }) })).meta.rule).toBe("R0");
  });

  it("greift, wenn die Programmzeile zu einem anderen Mandanten gehört", () => {
    const result = resolveAttribution(
      input({ program: program({ tenant_id: OTHER_TENANT }), urlReferral: referral({ id: "ref-1" }) }),
    );
    expect(result.meta.rule).toBe("R0");
  });

  it("meldet keine Testbestellung, auch wenn `test_mode` gesetzt wäre", () => {
    const result = resolveAttribution(
      input({ featureEnabled: false, program: program({ test_mode: true }) }),
    );
    expect(result.isTest).toBe(false);
  });
});

// --- R1 / R2 — Selbst-Empfehlung ----------------------------------------

describe("R1 — Selbst-Empfehlung, `self_referral = 'block'`", () => {
  it("sperrt die Zuordnung, wenn der Partner über die Konto-ID der Käufer ist", () => {
    const self = partner({ id: PARTNER_A, user_id: BUYER });
    const result = resolveAttribution(
      input({ urlReferral: referral({ id: "ref-1", partner_id: PARTNER_A, partner: self }) }),
    );

    expect(result.meta).toEqual({ rule: "R1", reason: "self_referral" });
    expect(result.partnerId).toBeNull();
    expect(result.countsAsOrderWithoutCommission).toBe(true);
    expect(result.auditActions).toEqual([
      AFFILIATE_ATTRIBUTION_AUDIT_ACTIONS.selfReferralBlocked,
    ]);
  });

  it("sperrt auch über die normalisierte E-Mail mit Plus-Adressierung", () => {
    const self = partner({ id: PARTNER_A, applicant_email: "kaeuferin@example.com" });
    const result = resolveAttribution(
      input({
        buyer: { userId: BUYER, email: "Kaeuferin+shop@Example.com" },
        urlReferral: referral({ id: "ref-1", partner_id: PARTNER_A, partner: self }),
      }),
    );

    expect(result.meta).toEqual({ rule: "R1", reason: "self_referral" });
    expect(result.partnerId).toBeNull();
  });

  it("sperrt über die normalisierte E-Mail mit Punkten bei gmail.com", () => {
    const self = partner({ id: PARTNER_A, applicant_email: "maxmustermann@gmail.com" });
    const result = resolveAttribution(
      input({
        buyer: { userId: BUYER, email: "max.muster.mann+akademie@gmail.com" },
        urlReferral: referral({ id: "ref-1", partner_id: PARTNER_A, partner: self }),
      }),
    );

    expect(result.meta.rule).toBe("R1");
  });

  it("sperrt NICHT, wenn dieselben Punkte bei einer anderen Domain stehen", () => {
    const other = partner({ id: PARTNER_A, applicant_email: "maxmustermann@example.com" });
    const result = resolveAttribution(
      input({
        buyer: { userId: BUYER, email: "max.muster.mann@example.com" },
        urlReferral: referral({ id: "ref-1", partner_id: PARTNER_A, partner: other }),
      }),
    );

    expect(result.meta).toEqual({ rule: "R5", reason: "url_token" });
    expect(result.partnerId).toBe(PARTNER_A);
  });

  it("greift auch über den Gutscheincode (R3 wird von R1 überstimmt)", () => {
    const self = partner({ id: PARTNER_A, user_id: BUYER });
    const result = resolveAttribution(input({ couponPartner: self }));

    expect(result.meta.rule).toBe("R1");
    expect(result.setsLifetimeBinding).toBe(false);
  });
});

describe("R2 — Selbst-Empfehlung, `self_referral = 'allow_flagged'`", () => {
  it("ordnet zu, markiert aber", () => {
    const self = partner({ id: PARTNER_A, user_id: BUYER });
    const result = resolveAttribution(
      input({
        program: program({ self_referral: "allow_flagged" }),
        urlReferral: referral({ id: "ref-1", partner_id: PARTNER_A, partner: self, token: "a".repeat(64) }),
      }),
    );

    expect(result.meta).toEqual({ rule: "R2", reason: "self_referral_flagged" });
    expect(result.partnerId).toBe(PARTNER_A);
    expect(result.token).toBe("a".repeat(64));
    expect(result.flagged).toBe(true);
    expect(result.flagReason).toBe("self_referral");
    expect(result.countsAsOrderWithoutCommission).toBe(false);
    expect(result.auditActions).toContain(
      AFFILIATE_ATTRIBUTION_AUDIT_ACTIONS.selfReferralFlagged,
    );
  });
});

// --- R3 ------------------------------------------------------------------

describe("R3 — Gutscheincode", () => {
  it("gewinnt über Token, Cookie und Serverzustand", () => {
    const result = resolveAttribution(
      input({
        couponPartner: partner({ id: PARTNER_A }),
        urlReferral: referral({ id: "ref-1", partner_id: PARTNER_B }),
        cookieReferral: referral({ id: "ref-2", partner_id: PARTNER_C }),
      }),
    );

    expect(result.meta).toEqual({ rule: "R3", reason: "coupon" });
    expect(result.partnerId).toBe(PARTNER_A);
    expect(result.setsLifetimeBinding).toBe(true);
    // Ein Gutschein trägt keine Referral-Zeile — es gibt nichts, was als
    // `affiliate_ref_token` in die Metadata wandern könnte.
    expect(result.referralId).toBeNull();
    expect(result.token).toBeNull();
  });

  it("greift nicht bei gesperrtem Partner", () => {
    const result = resolveAttribution(
      input({ couponPartner: partner({ id: PARTNER_A, status: "suspended" }) }),
    );
    expect(result.meta.rule).toBe("R9");
  });

  it("greift nicht bei einem Partner aus einem fremden Mandanten", () => {
    const result = resolveAttribution(
      input({ couponPartner: partner({ id: PARTNER_A, tenant_id: OTHER_TENANT }) }),
    );
    expect(result.meta.rule).toBe("R9");
  });
});

// --- R4 ------------------------------------------------------------------

describe("R4 — Lifetime-Bindung ohne gültiges frisches Token", () => {
  it("gewinnt, wenn gar kein Token vorliegt", () => {
    const result = resolveAttribution(input({ binding: binding({ partner_id: PARTNER_B }) }));

    expect(result.meta).toEqual({ rule: "R4", reason: "lifetime" });
    expect(result.partnerId).toBe(PARTNER_B);
    expect(result.auditActions).toEqual([]);
  });

  it("greift nicht, wenn `lifetime_binding` abgeschaltet ist", () => {
    const result = resolveAttribution(
      input({
        program: program({ lifetime_binding: false }),
        binding: binding({ partner_id: PARTNER_B }),
      }),
    );
    // Ohne R4 fällt die Bindung auf R8 durch — sie verfällt nicht.
    expect(result.meta).toEqual({ rule: "R8", reason: "lifetime_fallback" });
    expect(result.partnerId).toBe(PARTNER_B);
  });

  it("greift nicht bei einer Bindung eines anderen Kunden", () => {
    const result = resolveAttribution(
      input({ binding: binding({ user_id: "eeeeeeee-0000-4000-8000-00000000000e" }) }),
    );
    expect(result.meta.rule).toBe("R9");
  });

  it("greift nicht, wenn der gebundene Partner gesperrt ist", () => {
    const suspended = partner({ id: PARTNER_B, status: "suspended" });
    const result = resolveAttribution(
      input({ binding: binding({ partner_id: PARTNER_B, partner: suspended }) }),
    );
    expect(result.meta.rule).toBe("R9");
  });
});

// --- R5 ------------------------------------------------------------------

describe("R5 — `?aff=`-Token aus der URL", () => {
  it("gewinnt über Cookie und Serverzustand", () => {
    const result = resolveAttribution(
      input({
        urlReferral: referral({ id: "ref-1", partner_id: PARTNER_A, campaign: "podcast", token: "b".repeat(64) }),
        cookieReferral: referral({ id: "ref-2", partner_id: PARTNER_B }),
        userReferrals: [referral({ id: "ref-3", partner_id: PARTNER_C, user_id: BUYER })],
      }),
    );

    expect(result.meta).toEqual({ rule: "R5", reason: "url_token" });
    expect(result.partnerId).toBe(PARTNER_A);
    expect(result.referralId).toBe("ref-1");
    expect(result.token).toBe("b".repeat(64));
    expect(result.campaign).toBe("podcast");
  });

  it("fällt auf das Cookie zurück, wenn das URL-Token abgelaufen ist", () => {
    const result = resolveAttribution(
      input({
        urlReferral: referral({ id: "ref-1", partner_id: PARTNER_A, expires_at: IN_PAST }),
        cookieReferral: referral({ id: "ref-2", partner_id: PARTNER_B }),
      }),
    );

    expect(result.meta).toEqual({ rule: "R6", reason: "cookie_token" });
    expect(result.partnerId).toBe(PARTNER_B);
  });

  it("ignoriert ein Token eines FREMDEN Mandanten", () => {
    const foreign = referral({
      id: "ref-1",
      tenant_id: OTHER_TENANT,
      partner_id: PARTNER_A,
      partner: partner({ id: PARTNER_A, tenant_id: OTHER_TENANT }),
    });
    const result = resolveAttribution(input({ urlReferral: foreign }));

    expect(result.meta.rule).toBe("R9");
    expect(result.partnerId).toBeNull();
  });

  it("ignoriert ein Token eines gesperrten Partners", () => {
    const suspended = partner({ id: PARTNER_A, status: "suspended" });
    const result = resolveAttribution(
      input({ urlReferral: referral({ id: "ref-1", partner_id: PARTNER_A, partner: suspended }) }),
    );

    expect(result.meta.rule).toBe("R9");
  });

  it("ignoriert eine Zeile aus einem Bot-Klick", () => {
    const result = resolveAttribution(
      input({ urlReferral: referral({ id: "ref-1", partner_id: PARTNER_A, is_bot: true }) }),
    );

    expect(result.meta.rule).toBe("R9");
  });

  it("akzeptiert eine Zeile, deren Klickzeile bereits gelöscht ist (`is_bot = null`)", () => {
    // `affiliate_clicks` wird nach 90 Tagen gelöscht, die Zuordnung darf bis
    // zu 365 Tage leben — sonst verlöre der Partner Geld an die
    // Aufbewahrungsfrist.
    const result = resolveAttribution(
      input({ urlReferral: referral({ id: "ref-1", partner_id: PARTNER_A, is_bot: null }) }),
    );

    expect(result.meta).toEqual({ rule: "R5", reason: "url_token" });
  });

  it("ignoriert abgelöste und zurückgenommene Zeilen", () => {
    expect(
      resolveAttribution(
        input({ urlReferral: referral({ id: "ref-1", status: "superseded" }) }),
      ).meta.rule,
    ).toBe("R9");
    expect(
      resolveAttribution(input({ urlReferral: referral({ id: "ref-1", status: "revoked" }) })).meta
        .rule,
    ).toBe("R9");
  });

  it("ignoriert eine Zeile aus einem anderen Programm", () => {
    const result = resolveAttribution(
      input({ urlReferral: referral({ id: "ref-1", program_id: OTHER_PROGRAM }) }),
    );
    expect(result.meta.rule).toBe("R9");
  });
});

// --- R6 ------------------------------------------------------------------

describe("R6 — `ct_aff`-Cookie", () => {
  it("gewinnt über den Serverzustand", () => {
    const result = resolveAttribution(
      input({
        cookieReferral: referral({ id: "ref-2", partner_id: PARTNER_B }),
        userReferrals: [referral({ id: "ref-3", partner_id: PARTNER_C, user_id: BUYER })],
      }),
    );

    expect(result.meta).toEqual({ rule: "R6", reason: "cookie_token" });
    expect(result.partnerId).toBe(PARTNER_B);
    expect(result.referralId).toBe("ref-2");
  });
});

// --- R7 ------------------------------------------------------------------

describe("R7 — Serverzustand am Konto des Käufers", () => {
  const older = referral({
    id: "ref-old",
    partner_id: PARTNER_A,
    user_id: BUYER,
    created_at: "2026-09-01T10:00:00.000Z",
    status: "superseded",
  });
  const newer = referral({
    id: "ref-new",
    partner_id: PARTNER_B,
    user_id: BUYER,
    created_at: "2026-09-09T10:00:00.000Z",
  });

  it("last-click: die jüngste Zeile gewinnt", () => {
    const result = resolveAttribution(
      input({ program: program({ lifetime_binding: false }), userReferrals: [older, newer] }),
    );

    expect(result.meta).toEqual({ rule: "R7", reason: "server_state" });
    expect(result.partnerId).toBe(PARTNER_B);
    expect(result.referralId).toBe("ref-new");
  });

  it("first-click: die älteste Zeile gewinnt — auch wenn sie abgelöst ist", () => {
    const result = resolveAttribution(
      input({
        program: program({ attribution_model: "first", lifetime_binding: false }),
        userReferrals: [newer, older],
      }),
    );

    expect(result.partnerId).toBe(PARTNER_A);
    expect(result.referralId).toBe("ref-old");
  });

  it("ignoriert `revoked`, abgelaufene und fremde Zeilen", () => {
    const result = resolveAttribution(
      input({
        userReferrals: [
          referral({ id: "r1", partner_id: PARTNER_A, user_id: BUYER, status: "revoked" }),
          referral({ id: "r2", partner_id: PARTNER_B, user_id: BUYER, expires_at: IN_PAST }),
          referral({ id: "r3", partner_id: PARTNER_C, user_id: "ffffffff-0000-4000-8000-00000000000f" }),
        ],
      }),
    );

    expect(result.meta.rule).toBe("R9");
  });

  it("ignoriert eine noch nicht an das Konto gebundene Zeile", () => {
    // Ohne `bindReferral()` (4.3) gibt es diesen Weg nicht: `user_id` ist null.
    const result = resolveAttribution(
      input({ userReferrals: [referral({ id: "r1", partner_id: PARTNER_A, user_id: null })] }),
    );
    expect(result.meta.rule).toBe("R9");
  });

  it("entscheidet bei gleichem Zeitstempel stabil über die `id`", () => {
    const a = referral({ id: "aaa", partner_id: PARTNER_A, user_id: BUYER, created_at: AT.toISOString() });
    const b = referral({ id: "bbb", partner_id: PARTNER_B, user_id: BUYER, created_at: AT.toISOString() });

    expect(
      resolveAttribution(input({ program: program({ lifetime_binding: false }), userReferrals: [b, a] }))
        .referralId,
    ).toBe("aaa");
    expect(
      resolveAttribution(input({ program: program({ lifetime_binding: false }), userReferrals: [a, b] }))
        .referralId,
    ).toBe("aaa");
  });
});

// --- R8 ------------------------------------------------------------------

describe("R8 — Lifetime-Bindung als Auffangfall", () => {
  it("greift, wenn ein Token existierte, aber an R5 scheiterte", () => {
    // Erreichbar ist R8 nur bei abgeschalteter `lifetime_binding` — mit
    // eingeschalteter fängt R4 dieselbe Lage schon ab (siehe der Fall
    // darunter). Das ist kein Widerspruch zur Klammer in 4.4 R8, sondern ihr
    // Sinn: die Bindung gewinnt gegen ein GESCHEITERTES Token in beiden
    // Einstellungen, nur über zwei verschiedene Regeln.
    const result = resolveAttribution(
      input({
        program: program({ lifetime_binding: false }),
        urlReferral: referral({ id: "ref-1", partner_id: PARTNER_A, expires_at: IN_PAST }),
        binding: binding({ partner_id: PARTNER_B }),
      }),
    );

    expect(result.meta).toEqual({ rule: "R8", reason: "lifetime_fallback" });
    expect(result.partnerId).toBe(PARTNER_B);
    expect(result.auditActions).toEqual([]);
  });

  it("greift nach einem gescheiterten Serverzustand", () => {
    const result = resolveAttribution(
      input({
        program: program({ lifetime_binding: false }),
        userReferrals: [referral({ id: "r1", partner_id: PARTNER_A, user_id: BUYER, status: "revoked" })],
        binding: binding({ partner_id: PARTNER_B }),
      }),
    );

    expect(result.meta.rule).toBe("R8");
  });
});

// --- Die Überschreibregel zwischen R4 und R8 ----------------------------

describe("Rangfolge R4 gegen R5/R6 gegen R8 (4.4, Begründung)", () => {
  it("ein gültiges frisches Token überstimmt die Lifetime-Bindung (R5)", () => {
    const result = resolveAttribution(
      input({
        urlReferral: referral({ id: "ref-1", partner_id: PARTNER_A }),
        binding: binding({ partner_id: PARTNER_B }),
      }),
    );

    expect(result.meta).toEqual({ rule: "R5", reason: "url_token" });
    expect(result.partnerId).toBe(PARTNER_A);
    expect(result.auditActions).toEqual([
      AFFILIATE_ATTRIBUTION_AUDIT_ACTIONS.overriddenByClick,
    ]);
  });

  it("ein gültiges Cookie überstimmt die Lifetime-Bindung (R6)", () => {
    const result = resolveAttribution(
      input({
        cookieReferral: referral({ id: "ref-2", partner_id: PARTNER_A }),
        binding: binding({ partner_id: PARTNER_B }),
      }),
    );

    expect(result.meta.rule).toBe("R6");
    expect(result.auditActions).toContain(
      AFFILIATE_ATTRIBUTION_AUDIT_ACTIONS.overriddenByClick,
    );
  });

  it("wird das Token ungültig, gewinnt die Bindung — ohne Protokolleintrag", () => {
    // Mit `lifetime_binding = true` ist das R4 (das ungültige Token ist kein
    // „gültiges frisches Token"), ohne sie R8. Beide Male gewinnt derselbe
    // Partner, und beide Male ist es keine Abweichung von der Bindung, also
    // auch kein `overridden_by_click`.
    const bot = referral({ id: "ref-1", partner_id: PARTNER_A, is_bot: true });

    const withLifetime = resolveAttribution(
      input({ urlReferral: bot, binding: binding({ partner_id: PARTNER_B }) }),
    );
    expect(withLifetime.meta).toEqual({ rule: "R4", reason: "lifetime" });
    expect(withLifetime.partnerId).toBe(PARTNER_B);
    expect(withLifetime.auditActions).toEqual([]);

    const withoutLifetime = resolveAttribution(
      input({
        program: program({ lifetime_binding: false }),
        urlReferral: bot,
        binding: binding({ partner_id: PARTNER_B }),
      }),
    );
    expect(withoutLifetime.meta).toEqual({ rule: "R8", reason: "lifetime_fallback" });
    expect(withoutLifetime.auditActions).toEqual([]);
  });

  it("kein Protokolleintrag, wenn Token und Bindung denselben Partner meinen", () => {
    const result = resolveAttribution(
      input({
        urlReferral: referral({ id: "ref-1", partner_id: PARTNER_B }),
        binding: binding({ partner_id: PARTNER_B }),
      }),
    );

    expect(result.meta.rule).toBe("R5");
    expect(result.auditActions).toEqual([]);
  });

  it("auch der Gutscheincode über einer bestehenden Bindung wird protokolliert", () => {
    const result = resolveAttribution(
      input({
        couponPartner: partner({ id: PARTNER_A }),
        binding: binding({ partner_id: PARTNER_B }),
      }),
    );

    expect(result.meta.rule).toBe("R3");
    expect(result.auditActions).toEqual([
      AFFILIATE_ATTRIBUTION_AUDIT_ACTIONS.overriddenByClick,
    ]);
  });
});

// --- R9 ------------------------------------------------------------------

describe("R9 — Hausverkauf", () => {
  it("ist das Ergebnis ohne jeden Kandidaten", () => {
    const result = resolveAttribution(input());

    expect(result.meta).toEqual({ rule: "R9", reason: null });
    expect(result.partnerId).toBeNull();
    expect(result.referralId).toBeNull();
    expect(result.token).toBeNull();
    expect(result.campaign).toBeNull();
    expect(result.flagged).toBe(false);
    expect(result.countsAsOrderWithoutCommission).toBe(false);
    expect(result.setsLifetimeBinding).toBe(false);
    expect(result.auditActions).toEqual([]);
  });
});

// --- Testbestellung (4.5) -----------------------------------------------

describe("Testbestellung (4.5)", () => {
  it("markiert die Zuordnung, wenn `program.test_mode` gesetzt ist", () => {
    const result = resolveAttribution(
      input({
        program: program({ test_mode: true }),
        urlReferral: referral({ id: "ref-1", partner_id: PARTNER_A }),
      }),
    );

    expect(result.isTest).toBe(true);
    expect(result.partnerId).toBe(PARTNER_A);
  });

  it("ist im Regelfall aus", () => {
    expect(resolveAttribution(input()).isTest).toBe(false);
  });
});
