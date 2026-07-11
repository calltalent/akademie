import { describe, expect, it } from "vitest";
import {
  certificateIssued,
  escapeHtml,
  orderPaid,
  submissionGraded,
  welcomeInvite,
} from "./templates";

describe("escapeHtml", () => {
  it("escaped spitze Klammern, Anführungszeichen und Et-Zeichen", () => {
    expect(escapeHtml("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
    expect(escapeHtml(`"'&`)).toBe("&quot;&#39;&amp;");
  });
});

describe("welcomeInvite", () => {
  it("enthält Mandantennamen, Empfängernamen und Login-Link", () => {
    const html = welcomeInvite({
      tenantName: "Demo Akademie",
      recipientName: "Max Mustermann",
      loginUrl: "https://demo-blau.akademie.calltalent.ai/login",
      accentColor: "#1d4ed8",
    });
    expect(html).toContain("Demo Akademie");
    expect(html).toContain("Max Mustermann");
    expect(html).toContain("https://demo-blau.akademie.calltalent.ai/login");
    expect(html).toContain("Diese E-Mail wurde automatisch von Demo Akademie versendet.");
  });

  it("escaped einen bösartigen Empfängernamen statt ihn auszuführen", () => {
    const html = welcomeInvite({
      tenantName: "Demo Akademie",
      recipientName: "<script>alert(1)</script>",
      loginUrl: "https://demo-blau.akademie.calltalent.ai/login",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("fällt bei fehlender/ungültiger Akzentfarbe auf den neutralen Blauton zurück", () => {
    const html = welcomeInvite({
      tenantName: "Demo Akademie",
      loginUrl: "https://demo-blau.akademie.calltalent.ai/login",
      accentColor: "javascript:alert(1)",
    });
    expect(html).not.toContain("javascript:alert(1)");
    expect(html).toContain("#171717");
  });
});

describe("submissionGraded", () => {
  it("enthält Mandantennamen, Kurs-/Lektionstitel, Status und Feedback", () => {
    const html = submissionGraded({
      tenantName: "Demo Akademie",
      recipientName: "Max Mustermann",
      courseTitle: "Einführung",
      lessonTitle: "Lektion 1",
      status: "approved",
      feedback: "Gut gemacht!",
    });
    expect(html).toContain("Demo Akademie");
    expect(html).toContain("Einführung");
    expect(html).toContain("Lektion 1");
    expect(html).toContain("angenommen");
    expect(html).toContain("Gut gemacht!");
  });

  it("escaped bösartiges Feedback statt es auszuführen", () => {
    const html = submissionGraded({
      tenantName: "Demo Akademie",
      courseTitle: "Kurs",
      lessonTitle: "Lektion",
      status: "rejected",
      feedback: "<img src=x onerror=alert(1)>",
    });
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;img");
    expect(html).toContain("abgelehnt");
  });
});

describe("certificateIssued", () => {
  it("enthält Mandantennamen und Kurstitel", () => {
    const html = certificateIssued({
      tenantName: "Demo Akademie",
      recipientName: "Max Mustermann",
      courseTitle: "Einführung",
    });
    expect(html).toContain("Demo Akademie");
    expect(html).toContain("Einführung");
    expect(html).toContain("Zertifikat");
  });

  it("escaped einen bösartigen Kurstitel", () => {
    const html = certificateIssued({
      tenantName: "Demo Akademie",
      courseTitle: "<script>alert(1)</script>",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
  });
});

describe("orderPaid", () => {
  it("enthält Mandantennamen und Produktname", () => {
    const html = orderPaid({
      tenantName: "Demo Akademie",
      recipientName: "Max Mustermann",
      productName: "Komplett-Paket",
    });
    expect(html).toContain("Demo Akademie");
    expect(html).toContain("Komplett-Paket");
  });

  it("escaped einen bösartigen Produktnamen", () => {
    const html = orderPaid({
      tenantName: "Demo Akademie",
      productName: '<img src=x onerror=alert(1)>',
    });
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
  });
});
