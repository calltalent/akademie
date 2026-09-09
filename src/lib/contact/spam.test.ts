import { describe, expect, it } from "vitest";
import { classifyContactSubmission } from "./spam";
import { containsLink, containsMarkup, countLinks } from "./patterns";
import { contactFormSchema } from "./schema";

/**
 * Regressionstests zum Spam-Vorfall vom 24.08.2026 (Josips Posteingang):
 * Vorname "Dear http://salestalent.app/fekal0911", Nachname "Administrator
 * Gee", Nachricht "To the salestalent.app Webmaster ...". Die echte
 * Nachricht ist hier bewusst nachgebaut statt kopiert, und die verwendete
 * Absenderadresse ist erfunden (CLAUDE.md §2.6: keine echten Adressen in
 * Fixtures).
 *
 * Zweiter, mindestens ebenso wichtiger Teil: echte deutsche Anfragen dürfen
 * NICHT blockiert werden — ein Fehlurteil kostet eine echte Kundenanfrage.
 */

const SPAM_HOST = "beispiel-spam.app";

describe("Link- und Markup-Erkennung", () => {
  it("erkennt Links mit Schema, mit www. und als blanke Domain", () => {
    expect(containsLink(`http://${SPAM_HOST}/fekal0911`)).toBe(true);
    expect(containsLink("www.example.com")).toBe(true);
    expect(containsLink("schau mal bei example.shop vorbei")).toBe(true);
  });

  it("hält eine E-Mail-Adresse nicht für einen Link", () => {
    expect(countLinks("Meine zweite Adresse ist jonas.weber@firma-beispiel.de")).toBe(0);
  });

  it("lässt normalen deutschen Text unangetastet", () => {
    expect(containsLink("Hallo, ich habe eine Frage zu Modul 3. Danke!")).toBe(false);
    // Satzende ohne Leerzeichen darf keine Domain vortäuschen.
    expect(containsLink("Das war super.Vielen Dank")).toBe(false);
  });

  it("erkennt HTML und BBCode", () => {
    expect(containsMarkup('<a href="#">klick</a>')).toBe(true);
    expect(containsMarkup("[url=http://example.com]klick[/url]")).toBe(true);
    expect(containsMarkup("Preis < 100 Euro")).toBe(false);
  });
});

describe("classifyContactSubmission", () => {
  it("blockiert die Anfrage aus dem Vorfall vom 24.08.2026", () => {
    const verdict = classifyContactSubmission({
      firstName: `Dear http://${SPAM_HOST}/fekal0911`,
      lastName: "Administrator Gee",
      subject: "Feedback zu einer Lektion",
      message: `To the ${SPAM_HOST} Webmaster, I found your site and can help you rank higher. Visit http://${SPAM_HOST}/offer for our seo service.`,
    });

    expect(verdict.blocked).toBe(true);
    expect(verdict.reasons).toContain("link-in-name");
    expect(verdict.reasons).toContain("generic-recipient");
  });

  it("blockiert eine reine Werbenachricht ohne Link im Namen", () => {
    const verdict = classifyContactSubmission({
      firstName: "Alex",
      lastName: "Smith",
      subject: "Zusammenarbeit",
      message:
        "Hello Sir, we offer link building and guest post placements to boost your search engine ranking.",
    });

    expect(verdict.blocked).toBe(true);
  });

  it("blockiert Nachrichten mit drei oder mehr Links", () => {
    const verdict = classifyContactSubmission({
      firstName: "Chris",
      lastName: "Meier",
      subject: "Sonstiges",
      message: "Siehe http://a-beispiel.com und http://b-beispiel.net sowie http://c-beispiel.org",
    });

    expect(verdict.blocked).toBe(true);
    expect(verdict.reasons).toContain("links-in-message");
  });

  it("lässt eine echte Anfrage mit einem einzelnen Link durch", () => {
    const verdict = classifyContactSubmission({
      firstName: "Sabine",
      lastName: "Krüger",
      subject: "Frage zu einem Kurs",
      message:
        "Guten Tag, in Lektion 4 lädt das Video nicht. Der Kurs liegt unter https://demo.localhost/kurse/vertrieb — können Sie das prüfen? Viele Grüße",
    });

    expect(verdict.blocked).toBe(false);
  });

  it("lässt gewöhnliche deutsche Anfragen ohne Punkte durch", () => {
    const verdict = classifyContactSubmission({
      firstName: "Jonas",
      lastName: "Weber",
      subject: "Zugang / Anmeldung",
      message: "Hallo, ich kann mich seit gestern nicht mehr anmelden. Können Sie helfen?",
    });

    expect(verdict.score).toBe(0);
    expect(verdict.blocked).toBe(false);
  });

  it("blockiert nicht bei einem einzelnen Vokabel-Treffer", () => {
    const verdict = classifyContactSubmission({
      firstName: "Nina",
      lastName: "Hoffmann",
      subject: "Zusammenarbeit",
      message: "Wir suchen ein Schulungsangebot für unser Team, unter anderem zum Thema Bitcoin.",
    });

    expect(verdict.blocked).toBe(false);
  });
});

describe("contactFormSchema", () => {
  it("weist Links im Namensfeld ab", () => {
    const result = contactFormSchema.safeParse({
      firstName: `Dear http://${SPAM_HOST}/fekal0911`,
      lastName: "Administrator Gee",
      email: "spam@beispiel-spam.app",
      subject: "Feedback zu einer Lektion",
      message: "Hallo",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("Links");
  });

  it("weist E-Mail-Adressen und HTML im Namensfeld ab", () => {
    expect(
      contactFormSchema.safeParse({
        firstName: "jonas@firma-beispiel.de",
        lastName: "Weber",
        email: "jonas@firma-beispiel.de",
        subject: "Sonstiges",
        message: "Hallo",
      }).success,
    ).toBe(false);

    expect(
      contactFormSchema.safeParse({
        firstName: "<b>Jonas</b>",
        lastName: "Weber",
        email: "jonas@firma-beispiel.de",
        subject: "Sonstiges",
        message: "Hallo",
      }).success,
    ).toBe(false);
  });

  it("akzeptiert echte Namen inklusive Umlauten und Bindestrichen", () => {
    for (const [firstName, lastName] of [
      ["Jonas", "Weber"],
      ["Anne-Sophie", "Müller-Lüdenscheidt"],
      ["Josip", "Josipović"],
      ["Élodie", "O'Connor"],
    ]) {
      const result = contactFormSchema.safeParse({
        firstName,
        lastName,
        email: "kontakt@firma-beispiel.de",
        subject: "Sonstiges",
        message: "Hallo, ich habe eine Frage.",
      });
      expect(result.success, `${firstName} ${lastName}`).toBe(true);
    }
  });
});
