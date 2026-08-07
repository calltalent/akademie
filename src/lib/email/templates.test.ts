import { describe, expect, it, vi } from "vitest";
import de from "../../../messages/de.json";
import bs from "../../../messages/bs.json";
import en from "../../../messages/en.json";
import {
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
