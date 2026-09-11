import { describe, expect, it } from "vitest";
import {
  classifyUserAgent,
  detectClickBot,
  readClickSignals,
  type ClickRequestSignals,
} from "./bot";

/**
 * Affiliate-System, Block B3 — Tests des Bot- und Einbettungsfilters
 * (`bot.ts`, PLAN_Affiliate-System.md 4.2 Schritt 4, 3.6).
 *
 * Zwei Richtungen, beide gleich wichtig:
 *
 *   - Kein Vorschau-, Scanner- oder Prefetch-Abruf darf durchkommen. Jede
 *     dieser Quellen steht als eigener Fall mit einem echten User-Agent
 *     bzw. einer echten Kopfzeilen-Kombination.
 *   - Ein echter Besucher darf NICHT hängenbleiben. Der teuerste Fehler
 *     dieses Filters ist der Fehlalarm: er kostet einen Partner Geld, das er
 *     verdient hat, und er ist im Nachhinein nicht mehr aufzufinden. Deshalb
 *     stehen unten auch die Browser ohne Fetch-Metadata (ältere Safari) und
 *     die mit ungewöhnlichem `Accept`.
 *
 * Der User-Agent ist frei wählbar; ein Angreifer kann jede dieser Zeichenketten
 * setzen. Das entwertet die Prüfung nicht — sie zielt auf die ehrlichen
 * Automaten, die sich korrekt ausweisen, und die Prüfungen (b) und (c) auf
 * die, die es nicht tun.
 */

/** Ein echter Chrome-Navigationsabruf, der Ausgangspunkt aller Abwandlungen. */
const HUMAN_CLICK: ClickRequestSignals = {
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  secFetchDest: "document",
  secFetchMode: "navigate",
  secPurpose: null,
};

function withSignals(overrides: Partial<ClickRequestSignals>): ClickRequestSignals {
  return { ...HUMAN_CLICK, ...overrides };
}

describe("Klickfilter — echte Besucher kommen durch", () => {
  it("lässt eine gewöhnliche Chrome-Navigation zu", () => {
    expect(detectClickBot(HUMAN_CLICK)).toEqual({ isBot: false, reason: null });
  });

  it("lässt einen Browser ohne Fetch-Metadata zu", () => {
    // Ältere Safari- und In-App-Browser schicken weder Sec-Fetch-Dest noch
    // Sec-Fetch-Mode. Ein fehlender Kopf darf keine Zuordnung kosten.
    expect(
      detectClickBot(
        withSignals({
          userAgent:
            "Mozilla/5.0 (iPhone; CPU iPhone OS 15_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1",
          secFetchDest: null,
          secFetchMode: null,
        }),
      ).isBot,
    ).toBe(false);
  });

  it("lässt Firefox zu", () => {
    expect(
      detectClickBot(
        withSignals({
          userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        }),
      ).isBot,
    ).toBe(false);
  });

  it("lässt ein Accept ohne Zusätze zu, solange text/html darin steht", () => {
    expect(detectClickBot(withSignals({ accept: "text/html" })).isBot).toBe(false);
    expect(detectClickBot(withSignals({ accept: "TEXT/HTML,*/*" })).isBot).toBe(false);
  });

  it("stört sich nicht an einem gesetzten, aber harmlosen Sec-Purpose", () => {
    // Chrome schickt bei einer normalen Navigation aus der Adressleiste
    // teilweise `Sec-Purpose`-Werte, die kein Vorladen bedeuten.
    expect(detectClickBot(withSignals({ secPurpose: "navigation" })).isBot).toBe(false);
  });
});

describe("Klickfilter — Vorschau, Scanner und Automaten", () => {
  it("erkennt die Link-Vorschau in Messengern", () => {
    // Genau der Fall, für den dieser Filter gebaut ist: der Partner teilt
    // seinen Link in einer Gruppe, und die Vorschau holt ihn ab.
    // WhatsApp weist sich nicht als Bot aus — die UA-Liste greift hier nicht.
    // Erkannt wird der Abruf ausschließlich daran, dass er kein Dokument
    // anfordert. Genau dafür gibt es Prüfung (b).
    expect(
      detectClickBot(withSignals({ userAgent: "WhatsApp/2.24.1 A", accept: "*/*" })).reason,
    ).toBe("accept");
    expect(
      detectClickBot(
        withSignals({
          userAgent: "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
        }),
      ).reason,
    ).toBe("user_agent");
    expect(detectClickBot(withSignals({ userAgent: "facebookexternalhit/1.1" })).reason).toBe(
      "user_agent",
    );
    expect(detectClickBot(withSignals({ userAgent: "TelegramBot (like TwitterBot)" })).reason).toBe(
      "user_agent",
    );
  });

  it("erkennt Suchmaschinen und Crawler", () => {
    for (const ua of [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
      "Mozilla/5.0 (compatible; YandexBot/3.0)",
      "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
      "Some-Random-Spider/1.0",
      "archive.org_crawler",
    ]) {
      expect(detectClickBot(withSignals({ userAgent: ua })).reason).toBe("user_agent");
    }
  });

  it("erkennt Mail-Scanner und Uptime-Prüfungen", () => {
    expect(
      detectClickBot(
        withSignals({
          userAgent: "Mozilla/5.0 (compatible; Barracuda-LinkPreview)",
        }),
      ).reason,
    ).toBe("user_agent");
    expect(detectClickBot(withSignals({ userAgent: "UptimeMonitor/1.2" })).reason).toBe(
      "user_agent",
    );
  });

  it("erkennt Kommandozeilen- und Skript-Abrufe", () => {
    expect(detectClickBot(withSignals({ userAgent: "curl/8.6.0", accept: "*/*" })).reason).toBe(
      "user_agent",
    );
    expect(detectClickBot(withSignals({ userAgent: "Wget/1.21.4", accept: "*/*" })).reason).toBe(
      "user_agent",
    );
    expect(
      detectClickBot(withSignals({ userAgent: "python-requests/2.32.3", accept: "*/*" })).reason,
    ).toBe("user_agent");
    expect(
      detectClickBot(
        withSignals({
          userAgent:
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/127.0.0.0 Safari/537.36",
        }),
      ).reason,
    ).toBe("user_agent");
  });

  it("erkennt einen Abruf ganz ohne User-Agent", () => {
    expect(detectClickBot(withSignals({ userAgent: null })).reason).toBe("missing_user_agent");
    expect(detectClickBot(withSignals({ userAgent: "   " })).reason).toBe("missing_user_agent");
  });
});

describe("Klickfilter — Cookie-Stuffing mit echtem Browser-User-Agent", () => {
  it("erkennt die Einbettung als <img>", () => {
    // Der Angriff: eine fremde Seite bindet den Partnerlink als Bild ein und
    // setzt damit jedem ihrer Besucher das Attributions-Cookie. Der
    // User-Agent ist ein echter Chrome — nur der Accept-Kopf verrät, dass
    // hier kein Dokument geladen wird.
    const verdict = detectClickBot(
      withSignals({
        accept: "image/avif,image/webp,image/apng,*/*;q=0.8",
        secFetchDest: "image",
        secFetchMode: "no-cors",
      }),
    );
    expect(verdict).toEqual({ isBot: true, reason: "accept" });
  });

  it("erkennt die Einbettung als verstecktes <iframe>", () => {
    // Ein iframe schickt text/html, kommt also an (b) vorbei — hier greift
    // ausschließlich die Fetch-Metadata-Prüfung (c).
    const verdict = detectClickBot(
      withSignals({ secFetchDest: "iframe", secFetchMode: "navigate" }),
    );
    expect(verdict).toEqual({ isBot: true, reason: "fetch_metadata" });
  });

  it("erkennt einen fetch()-/XHR-Aufruf aus fremdem Skript", () => {
    expect(
      detectClickBot(withSignals({ secFetchDest: "empty", secFetchMode: "cors" })).reason,
    ).toBe("fetch_metadata");
  });

  it("erkennt ein <script src> und ein <link rel=stylesheet>", () => {
    expect(detectClickBot(withSignals({ accept: "*/*", secFetchDest: "script" })).reason).toBe(
      "accept",
    );
    expect(
      detectClickBot(withSignals({ secFetchDest: "style", secFetchMode: "no-cors" })).reason,
    ).toBe("fetch_metadata");
  });

  it("erkennt einen als Navigation getarnten Abruf ohne text/html", () => {
    expect(detectClickBot(withSignals({ accept: "*/*" })).reason).toBe("accept");
    expect(detectClickBot(withSignals({ accept: null })).reason).toBe("accept");
  });
});

describe("Klickfilter — Prefetch", () => {
  it("erkennt Chrome-Prefetch trotz Dokument-Navigation", () => {
    // Sec-Fetch-Dest ist „document" und Sec-Fetch-Mode „navigate": die drei
    // Prüfungen des Plans sehen hier nichts. Der Link wurde aber nur auf
    // Verdacht geladen, der Nutzer hat nichts angeklickt.
    expect(detectClickBot(withSignals({ secPurpose: "prefetch" })).reason).toBe("prefetch");
    expect(detectClickBot(withSignals({ secPurpose: "prefetch;prerender" })).reason).toBe(
      "prefetch",
    );
  });

  it("erkennt Firefox-Prefetch (X-Moz) und die ältere Purpose-Schreibweise", () => {
    // readClickSignals() zieht beide Schreibweisen auf dasselbe Feld.
    const firefox = readClickSignals(
      new Headers({
        "user-agent": "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0",
        accept: "text/html,*/*",
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "x-moz": "prefetch",
      }),
    );
    expect(detectClickBot(firefox).reason).toBe("prefetch");

    const legacy = readClickSignals(
      new Headers({
        "user-agent": HUMAN_CLICK.userAgent ?? "",
        accept: "text/html",
        purpose: "prefetch",
      }),
    );
    expect(detectClickBot(legacy).reason).toBe("prefetch");
  });
});

describe("readClickSignals", () => {
  it("liest alle fünf Werte und meldet fehlende als null", () => {
    const signals = readClickSignals(
      new Headers({ "user-agent": "Mozilla/5.0", accept: "text/html" }),
    );
    expect(signals).toEqual({
      userAgent: "Mozilla/5.0",
      accept: "text/html",
      secFetchDest: null,
      secFetchMode: null,
      secPurpose: null,
    });
  });

  it("bevorzugt Sec-Purpose vor Purpose und X-Moz", () => {
    const signals = readClickSignals(
      new Headers({
        "sec-purpose": "prefetch",
        purpose: "andere",
        "x-moz": "noch andere",
      }),
    );
    expect(signals.secPurpose).toBe("prefetch");
  });
});

describe("classifyUserAgent — grobe Klasse statt Fingerabdruck", () => {
  it("ordnet die gängigen Browser vom Speziellen zum Allgemeinen zu", () => {
    // Jeder dieser UAs enthält „Safari", die meisten zusätzlich „Chrome" —
    // eine andere Reihenfolge der Prüfungen ergäbe überall „safari".
    expect(
      classifyUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
      ),
    ).toBe("edge");
    expect(
      classifyUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 OPR/115.0.0.0",
      ),
    ).toBe("opera");
    expect(
      classifyUserAgent(
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
      ),
    ).toBe("samsung");
    expect(
      classifyUserAgent("Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0"),
    ).toBe("firefox");
    expect(classifyUserAgent(HUMAN_CLICK.userAgent)).toBe("chrome");
    expect(
      classifyUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
      ),
    ).toBe("safari");
  });

  it("fasst alle Automaten zu einer Klasse zusammen", () => {
    expect(classifyUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe("bot");
    expect(classifyUserAgent("curl/8.6.0")).toBe("bot");
  });

  it("liefert none ohne und other für Unbekanntes", () => {
    expect(classifyUserAgent(null)).toBe("none");
    expect(classifyUserAgent("")).toBe("none");
    expect(classifyUserAgent("   ")).toBe("none");
    expect(classifyUserAgent("Irgendetwas Eigenes/1.0")).toBe("other");
  });

  it("gibt nie den vollständigen User-Agent zurück", () => {
    // Plan 3.6: `ua_family` ist eine grobe Klasse, nie der volle
    // User-Agent — zusammen mit der IP wäre der ein Gerätefingerabdruck.
    const erlaubt = new Set([
      "none",
      "bot",
      "edge",
      "opera",
      "samsung",
      "firefox",
      "chrome",
      "safari",
      "other",
    ]);
    for (const ua of [
      HUMAN_CLICK.userAgent,
      "Mozilla/5.0 (compatible; Googlebot/2.1)",
      "Irgendetwas Eigenes/1.0",
      null,
    ]) {
      const family = classifyUserAgent(ua);
      expect(erlaubt.has(family)).toBe(true);
      expect(family.length).toBeLessThanOrEqual(8);
    }
  });
});
