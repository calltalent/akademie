import { describe, expect, it, vi } from "vitest";
import de from "../../../messages/de.json";
import bs from "../../../messages/bs.json";
import en from "../../../messages/en.json";
import {
  affiliateApplicationReceived,
  affiliateApproved,
  affiliatePayout,
  affiliateRejected,
  affiliateReversal,
  affiliateSale,
  certificateIssued,
  confirmSignup,
  contactFormNotification,
  escapeHtml,
  magicLinkEmail,
  orderPaid,
  passwordReset,
  shiftChangeRequestDecided,
  shiftChangeRequestSubmitted,
  submissionGraded,
  welcomeInvite,
} from "./templates";

/**
 * `getTranslations()` aus `next-intl/server` setzt einen echten Next.js-
 * Request-/RSC-Kontext voraus (React-Server-Build + `next-intl/config`, das
 * nur über die next-intl-Webpack/Turbopack-Plugin-Magie in next.config.ts
 * auf `src/i18n/request.ts` zeigt) — außerhalb von `next dev`/`next build`
 * (also unter Vitest) ist das nicht sinnvoll herstellbar. Gemockt wird
 * deshalb NUR die next-intl-Schnittstelle, nicht die eigentlich zu
 * testende Logik: der Mock liest dieselben `messages/de.json`/`bs.json`
 * wie die echte Anwendung und löst `{platzhalter}` per einfacher
 * String-Ersetzung auf (die `email.*`-Vorlagen nutzen keine
 * plural/select-ICU-Syntax) — ein fehlender Message-Key wirft, macht einen
 * Tippfehler in `templates.ts` also sofort sichtbar.
 */
type MessageTree = Record<string, unknown>;

function getNamespace(tree: MessageTree, namespace: string): MessageTree {
  return (tree[namespace] ?? {}) as MessageTree;
}

function lookupMessage(tree: MessageTree, path: string): string {
  const value = path
    .split(".")
    .reduce<unknown>(
      (acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined),
      tree,
    );
  if (typeof value !== "string") {
    throw new Error(`Test-Mock (next-intl/server): fehlender Message-Key "email.${path}"`);
  }
  return value;
}

function interpolate(message: string, values?: Record<string, unknown>): string {
  return message.replace(/\{(\w+)\}/g, (match, key: string) =>
    values && key in values ? String(values[key]) : match,
  );
}

vi.mock("next-intl/server", () => ({
  getTranslations: async ({ locale, namespace }: { locale: string; namespace: string }) => {
    const messages = locale === "bs" ? bs : locale === "en" ? en : de;
    const tree = getNamespace(messages as MessageTree, namespace);
    return (key: string, values?: Record<string, unknown>) => interpolate(lookupMessage(tree, key), values);
  },
}));

describe("escapeHtml", () => {
  it("escaped spitze Klammern, Anführungszeichen und Et-Zeichen", () => {
    expect(escapeHtml("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
    expect(escapeHtml(`"'&`)).toBe("&quot;&#39;&amp;");
  });
});

describe("welcomeInvite", () => {
  it("enthält Mandantennamen, Empfängernamen und Login-Link", async () => {
    const html = await welcomeInvite({
      tenantName: "Demo Akademie",
      recipientName: "Max Mustermann",
      loginUrl: "https://demo-blau.akademie.calltalent.ai/login",
      accentColor: "#1d4ed8",
      locale: "de",
    });
    expect(html).toContain("Demo Akademie");
    expect(html).toContain("Max Mustermann");
    expect(html).toContain("https://demo-blau.akademie.calltalent.ai/login");
    expect(html).toContain("Diese E-Mail wurde automatisch von Demo Akademie versendet.");
  });

  it("escaped einen bösartigen Empfängernamen statt ihn auszuführen", async () => {
    const html = await welcomeInvite({
      tenantName: "Demo Akademie",
      recipientName: "<script>alert(1)</script>",
      loginUrl: "https://demo-blau.akademie.calltalent.ai/login",
      locale: "de",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("fällt bei fehlender/ungültiger Akzentfarbe auf den neutralen Blauton zurück", async () => {
    const html = await welcomeInvite({
      tenantName: "Demo Akademie",
      loginUrl: "https://demo-blau.akademie.calltalent.ai/login",
      accentColor: "javascript:alert(1)",
      locale: "de",
    });
    expect(html).not.toContain("javascript:alert(1)");
    expect(html).toContain("#171717");
  });

  it("rendert bosnische Texte und <html lang=\"bs\">, wenn locale=\"bs\" übergeben wird", async () => {
    const html = await welcomeInvite({
      tenantName: "Demo Akademie",
      loginUrl: "https://demo-blau.akademie.calltalent.ai/login",
      locale: "bs",
    });
    expect(html).toContain('<html lang="bs">');
    expect(html).toContain("Dobrodošao/la");
    expect(html).not.toContain("Willkommen");
  });
});

describe("submissionGraded", () => {
  it("enthält Mandantennamen, Kurs-/Lektionstitel, Status und Feedback", async () => {
    const html = await submissionGraded({
      tenantName: "Demo Akademie",
      recipientName: "Max Mustermann",
      courseTitle: "Einführung",
      lessonTitle: "Lektion 1",
      status: "approved",
      feedback: "Gut gemacht!",
      locale: "de",
    });
    expect(html).toContain("Demo Akademie");
    expect(html).toContain("Einführung");
    expect(html).toContain("Lektion 1");
    expect(html).toContain("angenommen");
    expect(html).toContain("Gut gemacht!");
  });

  it("escaped bösartiges Feedback statt es auszuführen", async () => {
    const html = await submissionGraded({
      tenantName: "Demo Akademie",
      courseTitle: "Kurs",
      lessonTitle: "Lektion",
      status: "rejected",
      feedback: "<img src=x onerror=alert(1)>",
      locale: "de",
    });
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;img");
    expect(html).toContain("abgelehnt");
  });
});

describe("certificateIssued", () => {
  it("enthält Mandantennamen und Kurstitel", async () => {
    const html = await certificateIssued({
      tenantName: "Demo Akademie",
      recipientName: "Max Mustermann",
      courseTitle: "Einführung",
      locale: "de",
    });
    expect(html).toContain("Demo Akademie");
    expect(html).toContain("Einführung");
    expect(html).toContain("Zertifikat");
  });

  it("escaped einen bösartigen Kurstitel", async () => {
    const html = await certificateIssued({
      tenantName: "Demo Akademie",
      courseTitle: "<script>alert(1)</script>",
      locale: "de",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
  });
});

describe("passwordReset", () => {
  it("enthält Mandantennamen, Empfängernamen und Reset-Link", async () => {
    const html = await passwordReset({
      tenantName: "Demo Akademie",
      recipientName: "Max Mustermann",
      resetUrl: "https://demo-blau.akademie.calltalent.ai/auth/callback?next=/passwort-setzen",
      locale: "de",
    });
    expect(html).toContain("Demo Akademie");
    expect(html).toContain("Max Mustermann");
    expect(html).toContain("https://demo-blau.akademie.calltalent.ai/auth/callback?next=/passwort-setzen");
    expect(html).toContain("Passwort zurücksetzen");
  });

  it("escaped einen bösartigen Empfängernamen statt ihn auszuführen", async () => {
    const html = await passwordReset({
      tenantName: "Demo Akademie",
      recipientName: "<script>alert(1)</script>",
      resetUrl: "https://demo-blau.akademie.calltalent.ai/auth/callback",
      locale: "de",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

describe("magicLinkEmail", () => {
  it("enthält Mandantennamen, Empfängernamen und Login-Link", async () => {
    const html = await magicLinkEmail({
      tenantName: "Demo Akademie",
      recipientName: "Max Mustermann",
      loginUrl: "https://demo-blau.akademie.calltalent.ai/auth/callback",
      locale: "de",
    });
    expect(html).toContain("Demo Akademie");
    expect(html).toContain("Max Mustermann");
    expect(html).toContain("https://demo-blau.akademie.calltalent.ai/auth/callback");
    expect(html).toContain("Dein Login-Link");
  });

  it("escaped einen bösartigen Empfängernamen statt ihn auszuführen", async () => {
    const html = await magicLinkEmail({
      tenantName: "Demo Akademie",
      recipientName: "<script>alert(1)</script>",
      loginUrl: "https://demo-blau.akademie.calltalent.ai/auth/callback",
      locale: "de",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

describe("confirmSignup", () => {
  it("enthält Mandantennamen, Empfängernamen und Bestätigungslink", async () => {
    const html = await confirmSignup({
      tenantName: "Demo Akademie",
      recipientName: "Max Mustermann",
      confirmUrl: "https://demo-blau.akademie.calltalent.ai/auth/callback",
      locale: "de",
    });
    expect(html).toContain("Demo Akademie");
    expect(html).toContain("Max Mustermann");
    expect(html).toContain("https://demo-blau.akademie.calltalent.ai/auth/callback");
    expect(html).toContain("Bestätige deine E-Mail-Adresse");
  });

  it("escaped einen bösartigen Empfängernamen statt ihn auszuführen", async () => {
    const html = await confirmSignup({
      tenantName: "Demo Akademie",
      recipientName: "<script>alert(1)</script>",
      confirmUrl: "https://demo-blau.akademie.calltalent.ai/auth/callback",
      locale: "de",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

describe("contactFormNotification", () => {
  it("enthält Absenderdaten, Betreff und Nachricht — bleibt bewusst Deutsch, kein locale-Parameter", () => {
    const html = contactFormNotification({
      firstName: "Max",
      lastName: "Mustermann",
      email: "max@example.com",
      subject: "Frage zum Angebot",
      message: "Wie viel kostet der Enterprise-Plan?",
      tenantName: "Calltalent",
    });
    expect(html).toContain("Max");
    expect(html).toContain("Mustermann");
    expect(html).toContain("max@example.com");
    expect(html).toContain("Frage zum Angebot");
    expect(html).toContain("Wie viel kostet der Enterprise-Plan?");
    expect(html).toContain("Calltalent");
    expect(html).toContain('<html lang="de">');
  });

  it("verwendet den Mandantennamen im Kopf/Fuß statt fest Calltalent", () => {
    const html = contactFormNotification({
      firstName: "Max",
      lastName: "Mustermann",
      email: "max@example.com",
      subject: "Frage zum Angebot",
      message: "Wie viel kostet der Enterprise-Plan?",
      tenantName: "SalesTalent",
    });
    expect(html).toContain("SalesTalent");
  });

  it("escaped eine bösartige Nachricht statt sie auszuführen", () => {
    const html = contactFormNotification({
      firstName: "Max",
      lastName: "Mustermann",
      email: "max@example.com",
      subject: "Betreff",
      message: "<img src=x onerror=alert(1)>",
      tenantName: "Calltalent",
    });
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;img");
  });
});

describe("orderPaid", () => {
  it("enthält Mandantennamen und Produktname", async () => {
    const html = await orderPaid({
      tenantName: "Demo Akademie",
      recipientName: "Max Mustermann",
      productName: "Komplett-Paket",
      locale: "de",
    });
    expect(html).toContain("Demo Akademie");
    expect(html).toContain("Komplett-Paket");
  });

  it("escaped einen bösartigen Produktnamen", async () => {
    const html = await orderPaid({
      tenantName: "Demo Akademie",
      productName: '<img src=x onerror=alert(1)>',
      locale: "de",
    });
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
  });
});

describe("shiftChangeRequestDecided", () => {
  it("enthält Schicht-/Vorschlag-/Notiz-Details bei Genehmigung (de)", async () => {
    const html = await shiftChangeRequestDecided({
      tenantName: "Demo Akademie",
      recipientName: "Max Mustermann",
      decision: "approved",
      kind: "update",
      shiftLabel: "Montag, 10. August, 08:00–16:00 Uhr",
      proposedLabel: "Montag, 10. August, 09:00–17:00 Uhr",
      decisionNote: "Passt so.",
      locale: "de",
    });
    expect(html).toContain("Demo Akademie");
    expect(html).toContain("genehmigt");
    expect(html).toContain("Montag, 10. August, 08:00–16:00 Uhr");
    expect(html).toContain("Montag, 10. August, 09:00–17:00 Uhr");
    expect(html).toContain("Passt so.");
  });

  it("rendert englische Texte bei Ablehnung (en), ohne proposedLabel bei kind=cancel", async () => {
    const html = await shiftChangeRequestDecided({
      tenantName: "Demo Academy",
      decision: "rejected",
      kind: "cancel",
      shiftLabel: "Monday, August 10, 08:00–16:00",
      locale: "en",
    });
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("rejected");
    expect(html).toContain("Monday, August 10, 08:00–16:00");
  });

  it("escaped einen bösartigen Entscheidungsnotiz-Text statt ihn auszuführen", async () => {
    const html = await shiftChangeRequestDecided({
      tenantName: "Demo Akademie",
      decision: "approved",
      kind: "update",
      shiftLabel: "Montag, 10. August, 08:00–16:00 Uhr",
      proposedLabel: "Montag, 10. August, 09:00–17:00 Uhr",
      decisionNote: "<script>alert(1)</script>",
      locale: "de",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

describe("shiftChangeRequestSubmitted", () => {
  it("enthält Arbeitername, Schicht-/Vorschlag-/Begründungsdetails (de)", async () => {
    const html = await shiftChangeRequestSubmitted({
      tenantName: "Demo Akademie",
      recipientName: "Max Mustermann",
      workerName: "Erika Musterfrau",
      shiftLabel: "Montag, 10. August, 08:00–16:00 Uhr",
      proposedLabel: "Montag, 10. August, 09:00–17:00 Uhr",
      kind: "update",
      reason: "Arzttermin.",
      locale: "de",
    });
    expect(html).toContain("Demo Akademie");
    expect(html).toContain("Erika Musterfrau");
    expect(html).toContain("Montag, 10. August, 08:00–16:00 Uhr");
    expect(html).toContain("Montag, 10. August, 09:00–17:00 Uhr");
    expect(html).toContain("Arzttermin.");
  });

  it("rendert englische Texte (en), ohne reason-Block wenn keine Begründung angegeben ist", async () => {
    const html = await shiftChangeRequestSubmitted({
      tenantName: "Demo Academy",
      workerName: "Jane Doe",
      shiftLabel: "Monday, August 10, 08:00–16:00",
      kind: "cancel",
      locale: "en",
    });
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("Jane Doe");
    expect(html).toContain("Monday, August 10, 08:00–16:00");
  });

  it("escaped einen bösartigen Arbeitername statt ihn auszuführen", async () => {
    const html = await shiftChangeRequestSubmitted({
      tenantName: "Demo Akademie",
      workerName: "<script>alert(1)</script>",
      shiftLabel: "Montag, 10. August, 08:00–16:00 Uhr",
      kind: "cancel",
      locale: "de",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("escaped eine bösartige Begründung statt sie auszuführen", async () => {
    const html = await shiftChangeRequestSubmitted({
      tenantName: "Demo Akademie",
      workerName: "Erika Musterfrau",
      shiftLabel: "Montag, 10. August, 08:00–16:00 Uhr",
      kind: "update",
      proposedLabel: "Montag, 10. August, 09:00–17:00 Uhr",
      reason: "<img src=x onerror=alert(1)>",
      locale: "de",
    });
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;img");
  });
});

describe("affiliateReversal (Affiliate B5)", () => {
  /**
   * Diese Vorlage hat ZEHN Message-Keys in drei Sprachdateien. Ohne einen
   * Test, der sie alle anfasst, ist ein Tippfehler oder ein in `bs.json`
   * vergessener Schlüssel bis zur ersten echten Storno-Mail unsichtbar — der
   * Mock oben wirft bei einem fehlenden Key, aber nur für Vorlagen, die auch
   * gerendert werden. Deshalb wird hier jeder der drei Anlässe einmal in
   * jeder Sprache gerendert.
   */
  const reasons = ["refund", "dispute", "recredit"] as const;

  it("rendert alle drei Anlässe in allen drei Sprachen ohne fehlenden Message-Key", async () => {
    for (const locale of ["de", "en", "bs"] as const) {
      for (const reason of reasons) {
        const html = await affiliateReversal({
          tenantName: "Demo Akademie",
          recipientName: "Erika Musterfrau",
          reason,
          amountLabel: "26,47 €",
          referenceLabel: "Sommerkampagne",
          locale,
          actionUrl: "https://demo.example.invalid/partner/konto",
        });
        expect(html).toContain(`<html lang="${locale}">`);
        expect(html).toContain("26,47 €");
        expect(html).toContain("Sommerkampagne");
      }
    }
  });

  it("unterscheidet Wiedergutschrift und Rücknahme in Überschrift und Hinweis (de)", async () => {
    const reversal = await affiliateReversal({
      tenantName: "Demo Akademie",
      reason: "refund",
      amountLabel: "26,47 €",
      locale: "de",
    });
    const recredit = await affiliateReversal({
      tenantName: "Demo Akademie",
      reason: "recredit",
      amountLabel: "26,47 €",
      locale: "de",
    });

    expect(reversal).toContain("Provision zurückgenommen");
    expect(recredit).toContain("Provision wieder gutgeschrieben");
    expect(reversal).not.toContain("Provision wieder gutgeschrieben");
  });

  it("lässt den Vorgangs-Block weg, wenn keine Referenz angegeben ist", async () => {
    const html = await affiliateReversal({
      tenantName: "Demo Akademie",
      reason: "dispute",
      amountLabel: "26,47 €",
      locale: "de",
    });
    expect(html).not.toContain("Vorgang:");
  });

  it("escaped einen bösartigen Mandantennamen und eine bösartige Referenz", async () => {
    // `referenceLabel` trägt Produktname oder Kampagne — beides vom Mandanten
    // frei gewählt und damit nichts, dem eine HTML-Mail vertrauen darf.
    const html = await affiliateReversal({
      tenantName: "<script>alert(1)</script>",
      reason: "refund",
      amountLabel: "26,47 €",
      referenceLabel: "<img src=x onerror=alert(2)>",
      locale: "de",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x onerror=alert(2)>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(2)&gt;");
  });
});

/**
 * Affiliate-System Block B9 — die fünf Vorlagen entlang des
 * Partner-Lebenslaufs (PLAN_Affiliate-System.md 10/B9).
 *
 * Der Mock oben wirft bei einem fehlenden Message-Key — aber nur für
 * Vorlagen, die auch wirklich gerendert werden. Deshalb rendert der erste
 * Test JEDE der fünf Vorlagen mit JEDEM optionalen Feld in ALLEN DREI
 * Sprachen: erst dadurch wird ein in `bs.json` vergessener Schlüssel oder
 * ein Tippfehler in `templates.ts` hier sichtbar statt bei der ersten
 * echten Mail an einen Partner. `src/i18n/messages.test.ts` vergleicht
 * zwar die Pfadlisten der drei Dateien, kennt aber nicht die Schlüssel,
 * die der Code TATSÄCHLICH liest.
 */
describe("Affiliate-Vorlagen B9", () => {
  const locales = ["de", "en", "bs"] as const;

  it("rendert alle fünf Vorlagen in allen drei Sprachen ohne fehlenden Message-Key", async () => {
    for (const locale of locales) {
      const rendered = await Promise.all([
        affiliateApplicationReceived({
          tenantName: "Demo Akademie",
          recipientName: "Erika Musterfrau",
          applicantName: "Max Mustermann",
          locale,
          actionUrl: "https://demo.example.invalid/admin/affiliate/partner",
        }),
        affiliateApproved({
          tenantName: "Demo Akademie",
          recipientName: "Max Mustermann",
          partnerCode: "max-mustermann",
          locale,
          actionUrl: "https://demo.example.invalid/partner",
        }),
        affiliateRejected({
          tenantName: "Demo Akademie",
          recipientName: "Max Mustermann",
          reason: "Zielgruppe passt nicht zum Programm.",
          locale,
        }),
        affiliateSale({
          tenantName: "Demo Akademie",
          recipientName: "Max Mustermann",
          amountLabel: "118,88 EUR",
          statusLabel: "Sperrfrist läuft",
          productName: "Telefonakquise-Intensivkurs",
          locale,
          actionUrl: "https://demo.example.invalid/partner/kontoauszug",
        }),
        affiliatePayout({
          tenantName: "Demo Akademie",
          recipientName: "Max Mustermann",
          amountLabel: "188,60 EUR",
          periodLabel: "01.08.2026–31.08.2026",
          reference: "SEPA-20260901-004",
          locale,
          actionUrl: "https://demo.example.invalid/partner/auszahlungen",
        }),
      ]);

      for (const html of rendered) {
        expect(html).toContain(`<html lang="${locale}">`);
        expect(html).toContain("Demo Akademie");
      }
    }
  });

  it("nennt Bewerbernamen und Handlungsaufruf in der Manager-Mail (de)", async () => {
    const html = await affiliateApplicationReceived({
      tenantName: "Demo Akademie",
      applicantName: "Max Mustermann",
      locale: "de",
      actionUrl: "https://demo.example.invalid/admin/affiliate/partner",
    });
    expect(html).toContain("Max Mustermann");
    expect(html).toContain("Bewerbung ansehen");
    expect(html).toContain("https://demo.example.invalid/admin/affiliate/partner");
  });

  it("nennt den Partner-Code in der Freigabe-Mail (de)", async () => {
    const html = await affiliateApproved({
      tenantName: "Demo Akademie",
      partnerCode: "max-mustermann",
      locale: "de",
    });
    expect(html).toContain("max-mustermann");
  });

  it("lässt den Begründungsblock weg, wenn keine Begründung übergeben wird", async () => {
    const withReason = await affiliateRejected({
      tenantName: "Demo Akademie",
      reason: "Zielgruppe passt nicht zum Programm.",
      locale: "de",
    });
    const withoutReason = await affiliateRejected({ tenantName: "Demo Akademie", locale: "de" });

    expect(withReason).toContain("Begründung");
    expect(withoutReason).not.toContain("Begründung");
  });

  it("zeigt Betrag UND Status in der Provisionsmail — nicht nur den Betrag", async () => {
    // Eine Provision, die als gutgeschrieben gemeldet wird und danach 14 Tage
    // nicht auszahlbar ist, erzeugt sonst genau die Rückfrage, die diese Mail
    // sparen soll.
    const html = await affiliateSale({
      tenantName: "Demo Akademie",
      amountLabel: "118,88 EUR",
      statusLabel: "Sperrfrist läuft",
      locale: "de",
    });
    expect(html).toContain("118,88 EUR");
    expect(html).toContain("Sperrfrist läuft");
  });

  it("lässt Produktzeile und Referenzzeile weg, wenn sie fehlen", async () => {
    const sale = await affiliateSale({
      tenantName: "Demo Akademie",
      amountLabel: "118,88 EUR",
      statusLabel: "Verfügbar",
      locale: "de",
    });
    const payout = await affiliatePayout({
      tenantName: "Demo Akademie",
      amountLabel: "188,60 EUR",
      periodLabel: "01.08.2026–31.08.2026",
      locale: "de",
    });

    expect(sale).not.toContain("Produkt:");
    expect(payout).not.toContain("Referenz:");
    expect(payout).toContain("Zeitraum:");
  });

  it("escaped bösartige Freitexte in allen fünf Vorlagen", async () => {
    // Bewerbername und Ablehnungsgrund sind freie Eingaben (öffentliches
    // Formular bzw. Managerfeld), Produktname und Bankreferenz stammen vom
    // Mandanten. Keiner dieser Werte darf als HTML ausgeführt werden.
    const evil = "<script>alert(1)</script>";
    const rendered = await Promise.all([
      affiliateApplicationReceived({ tenantName: "Demo", applicantName: evil, locale: "de" }),
      affiliateApproved({ tenantName: "Demo", partnerCode: evil, locale: "de" }),
      affiliateRejected({ tenantName: "Demo", reason: evil, locale: "de" }),
      affiliateSale({ tenantName: "Demo", amountLabel: "1,00 EUR", statusLabel: "Verfügbar", productName: evil, locale: "de" }),
      affiliatePayout({ tenantName: "Demo", amountLabel: "1,00 EUR", periodLabel: "…", reference: evil, locale: "de" }),
    ]);

    for (const html of rendered) {
      expect(html).not.toContain(evil);
      expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    }
  });
});
