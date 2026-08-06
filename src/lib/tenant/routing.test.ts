import { describe, expect, it } from "vitest";
import { decideRouting, isApiPath, isAuthPath, isMaintenanceBypassPath, isSameHost } from "./routing";

const PORTAL_HOST = "portal.calltalent.ai";
const MARKETPLACE_HOST = "marketplace.calltalent.ai";

describe("isApiPath", () => {
  it("erkennt /api und /api/...", () => {
    expect(isApiPath("/api")).toBe(true);
    expect(isApiPath("/api/bunny/create-video")).toBe(true);
  });

  it("verwechselt ähnlich beginnende Pfade nicht mit API-Pfaden", () => {
    expect(isApiPath("/apiary")).toBe(false);
    expect(isApiPath("/kurse/api-grundlagen")).toBe(false);
    expect(isApiPath("/")).toBe(false);
  });
});

describe("decideRouting — Mandanten-Host", () => {
  // REGRESSIONSSCHUTZ (der eigentliche Zweck dieser Datei): Genau diese
  // Zusicherung war vom 12.07. bis 17.07.2026 verletzt. Sechs API-Routen
  // lesen x-tenant-id über getTenant(); ohne Auflösung liefen sie alle in
  // "Kein Mandant zu diesem Host gefunden" — Video-Upload, KI-Generator,
  // CSV-Import, CSV-Export und Datei-Abgaben waren in Produktion tot.
  it("löst den Mandanten auch für /api/... auf", () => {
    expect(
      decideRouting({
        host: "academy.calltalent.ai",
        pathname: "/api/bunny/create-video",
        portalHost: PORTAL_HOST,
      }),
    ).toEqual({
      servedPath: "/api/bunny/create-video",
      resolveTenant: true,
      rewrite: false,
    });
  });

  it.each([
    "/api/admin/ki/generate",
    "/api/admin/ki/status",
    "/api/admin/users/import",
    "/api/admin/reporting/csv",
    "/api/submissions/upload-url",
  ])("löst den Mandanten für die host-abhängige Route %s auf", (pathname) => {
    const decision = decideRouting({
      host: "academy.calltalent.ai",
      pathname,
      portalHost: PORTAL_HOST,
    });
    expect(decision.resolveTenant).toBe(true);
    expect(decision.servedPath).toBe(pathname);
  });

  it("löst den Mandanten für normale Seiten auf und schreibt nie um", () => {
    expect(
      decideRouting({
        host: "academy.calltalent.ai",
        pathname: "/admin/kurse",
        portalHost: PORTAL_HOST,
      }),
    ).toEqual({ servedPath: "/admin/kurse", resolveTenant: true, rewrite: false });
  });

  it("gilt genauso für den Dev-Host <slug>.localhost:3000", () => {
    const decision = decideRouting({
      host: "calltalent.localhost:3000",
      pathname: "/api/bunny/create-video",
      portalHost: "portal.localhost:3000",
    });
    expect(decision.resolveTenant).toBe(true);
    expect(decision.rewrite).toBe(false);
  });
});

describe("isAuthPath", () => {
  it("erkennt /auth und /auth/...", () => {
    expect(isAuthPath("/auth")).toBe(true);
    expect(isAuthPath("/auth/signout")).toBe(true);
    expect(isAuthPath("/auth/callback")).toBe(true);
  });

  it("verwechselt ähnlich beginnende Pfade nicht mit Auth-Pfaden", () => {
    expect(isAuthPath("/authentifizierung")).toBe(false);
    expect(isAuthPath("/")).toBe(false);
  });
});

describe("isMaintenanceBypassPath", () => {
  it.each([
    "/api",
    "/api/bunny/create-video",
    "/auth/signout",
    "/auth/callback",
    "/wartung",
    "/admin",
    "/admin/kurse",
    "/admin/einstellungen",
    "/login",
    "/registrieren",
    "/passwort-vergessen",
    "/passwort-setzen",
  ])("lässt %s auch bei aktivem Wartungsmodus immer durch", (pathname) => {
    expect(isMaintenanceBypassPath(pathname)).toBe(true);
  });

  it.each(["/", "/dashboard", "/kurse", "/kurs/beispiel-kurs", "/profil", "/kunden-area"])(
    "sperrt %s NICHT grundsätzlich aus (Middleware entscheidet zusätzlich per Staff-Prüfung)",
    (pathname) => {
      expect(isMaintenanceBypassPath(pathname)).toBe(false);
    },
  );
});

describe("decideRouting — Portal-Host", () => {
  // REGRESSIONSSCHUTZ für den Stripe-Fix vom 12.07.2026: Der Webhook ist auf
  // dem Portal-Host registriert und leitet alles aus session.metadata ab. Ein
  // Rewrite auf /portal/api/... trifft eine nicht existierende Route -> 404,
  // Stripe meldete "3 von 3 Zustellungen fehlgeschlagen".
  it("schreibt /api/... NIEMALS auf /portal/api/... um", () => {
    expect(
      decideRouting({
        host: PORTAL_HOST,
        pathname: "/api/stripe/webhook",
        portalHost: PORTAL_HOST,
      }),
    ).toEqual({ servedPath: "/api/stripe/webhook", resolveTenant: false, rewrite: false });
  });

  // REGRESSIONSSCHUTZ (22.07.2026, Josips Fund "Abmelden im Portal führt zu
  // einem weißen, leeren Fenster"): /auth/signout liegt wie /api/... außerhalb
  // von src/app/portal/... — ein Rewrite auf /portal/auth/signout träfe eine
  // nicht existierende Route (404), supabase.auth.signOut() liefe nie.
  it("schreibt /auth/... NIEMALS auf /portal/auth/... um", () => {
    expect(
      decideRouting({ host: PORTAL_HOST, pathname: "/auth/signout", portalHost: PORTAL_HOST }),
    ).toEqual({ servedPath: "/auth/signout", resolveTenant: false, rewrite: false });
    expect(
      decideRouting({ host: PORTAL_HOST, pathname: "/auth/callback", portalHost: PORTAL_HOST }),
    ).toEqual({ servedPath: "/auth/callback", resolveTenant: false, rewrite: false });
  });

  it("versucht auf dem Portal-Host keine Mandanten-Auflösung", () => {
    const decision = decideRouting({
      host: PORTAL_HOST,
      pathname: "/mandanten",
      portalHost: PORTAL_HOST,
    });
    expect(decision.resolveTenant).toBe(false);
  });

  it("schreibt Seiten auf /portal/... um", () => {
    expect(
      decideRouting({ host: PORTAL_HOST, pathname: "/mandanten", portalHost: PORTAL_HOST }),
    ).toEqual({ servedPath: "/portal/mandanten", resolveTenant: false, rewrite: true });
  });

  it("schreibt die Wurzel um", () => {
    expect(
      decideRouting({ host: PORTAL_HOST, pathname: "/", portalHost: PORTAL_HOST }).servedPath,
    ).toBe("/portal/");
  });

  it("vermeidet einen Doppel-Rewrite bei bereits vorangestelltem /portal", () => {
    expect(
      decideRouting({ host: PORTAL_HOST, pathname: "/portal/mandanten", portalHost: PORTAL_HOST })
        .servedPath,
    ).toBe("/portal/mandanten");
    expect(
      decideRouting({ host: PORTAL_HOST, pathname: "/portal", portalHost: PORTAL_HOST }).servedPath,
    ).toBe("/portal");
  });
});

describe("decideRouting — Marketplace-Host (Marketplace M4)", () => {
  // Analog zu den Portal-Host-Regressionsschutz-Tests oben — gleiche
  // Rewrite-Achse (prefixRewrite()), anderes Präfix.
  it("schreibt normale Seiten auf /marketplace/... um", () => {
    expect(
      decideRouting({
        host: MARKETPLACE_HOST,
        pathname: "/kurs/beispiel-kurs",
        portalHost: PORTAL_HOST,
        marketplaceHost: MARKETPLACE_HOST,
      }),
    ).toEqual({ servedPath: "/marketplace/kurs/beispiel-kurs", resolveTenant: false, rewrite: true });
  });

  it("schreibt die Wurzel um", () => {
    expect(
      decideRouting({
        host: MARKETPLACE_HOST,
        pathname: "/",
        portalHost: PORTAL_HOST,
        marketplaceHost: MARKETPLACE_HOST,
      }).servedPath,
    ).toBe("/marketplace/");
  });

  it("schreibt /api/... NIEMALS auf /marketplace/api/... um", () => {
    expect(
      decideRouting({
        host: MARKETPLACE_HOST,
        pathname: "/api/stripe/webhook",
        portalHost: PORTAL_HOST,
        marketplaceHost: MARKETPLACE_HOST,
      }),
    ).toEqual({ servedPath: "/api/stripe/webhook", resolveTenant: false, rewrite: false });
  });

  it("schreibt /auth/... NIEMALS auf /marketplace/auth/... um", () => {
    expect(
      decideRouting({
        host: MARKETPLACE_HOST,
        pathname: "/auth/callback",
        portalHost: PORTAL_HOST,
        marketplaceHost: MARKETPLACE_HOST,
      }),
    ).toEqual({ servedPath: "/auth/callback", resolveTenant: false, rewrite: false });
  });

  it("vermeidet einen Doppel-Rewrite bei bereits vorangestelltem /marketplace", () => {
    expect(
      decideRouting({
        host: MARKETPLACE_HOST,
        pathname: "/marketplace/kurs/beispiel-kurs",
        portalHost: PORTAL_HOST,
        marketplaceHost: MARKETPLACE_HOST,
      }).servedPath,
    ).toBe("/marketplace/kurs/beispiel-kurs");
  });

  it("versucht auf dem Marketplace-Host keine Mandanten-Auflösung", () => {
    const decision = decideRouting({
      host: MARKETPLACE_HOST,
      pathname: "/kurs/beispiel-kurs",
      portalHost: PORTAL_HOST,
      marketplaceHost: MARKETPLACE_HOST,
    });
    expect(decision.resolveTenant).toBe(false);
  });

  it("lässt einen normalen Mandanten-Host unverändert, wenn marketplaceHost gesetzt ist", () => {
    expect(
      decideRouting({
        host: "academy.calltalent.ai",
        pathname: "/admin/kurse",
        portalHost: PORTAL_HOST,
        marketplaceHost: MARKETPLACE_HOST,
      }),
    ).toEqual({ servedPath: "/admin/kurse", resolveTenant: true, rewrite: false });
  });

  it("ohne übergebenen marketplaceHost bleibt ein Host, der zufällig 'marketplace...' heißt, ein normaler Mandanten-Host", () => {
    // Regressionsschutz für die bewusst optionale Signatur (siehe
    // decideRouting()-Kommentar): fehlt marketplaceHost, greift die
    // Marketplace-Prüfung gar nicht erst — bestehende Aufrufer ohne diesen
    // Parameter verhalten sich exakt wie vor M4.
    expect(
      decideRouting({ host: MARKETPLACE_HOST, pathname: "/", portalHost: PORTAL_HOST }),
    ).toEqual({ servedPath: "/", resolveTenant: true, rewrite: false });
  });

  // Plan Abschnitt 4.1, letzter Satz: bei (hypothetisch) identischer
  // Konfiguration beider Sonder-Hosts gewinnt der Portal-Host, weil er in
  // decideRouting() zuerst geprüft wird.
  it("Portal-Host gewinnt bei identischer Konfiguration beider Sonder-Hosts", () => {
    const sameHost = "sonder.calltalent.ai";
    expect(
      decideRouting({
        host: sameHost,
        pathname: "/mandanten",
        portalHost: sameHost,
        marketplaceHost: sameHost,
      }).servedPath,
    ).toBe("/portal/mandanten");
  });
});

describe("isSameHost", () => {
  it("ignoriert den Port auf beiden Seiten", () => {
    expect(isSameHost("portal.localhost:3000", "portal.localhost:3000")).toBe(true);
    expect(isSameHost("portal.localhost:3000", "portal.localhost")).toBe(true);
  });

  it("unterscheidet unterschiedliche Hostnamen", () => {
    expect(isSameHost("marketplace.calltalent.ai", "portal.calltalent.ai")).toBe(false);
  });
});

describe("decideRouting — Host-Vergleich", () => {
  it("ignoriert den Port auf beiden Seiten", () => {
    const decision = decideRouting({
      host: "portal.localhost:3000",
      pathname: "/mandanten",
      portalHost: "portal.localhost:3000",
    });
    expect(decision.rewrite).toBe(true);
    expect(decision.resolveTenant).toBe(false);
  });

  it("hält einen Mandanten-Host mit gleichem Präfix nicht für den Portal-Host", () => {
    // "portal-kunde.calltalent.ai" ist ein Mandant, kein Betreiber-Portal.
    const decision = decideRouting({
      host: "portal-kunde.calltalent.ai",
      pathname: "/",
      portalHost: PORTAL_HOST,
    });
    expect(decision.resolveTenant).toBe(true);
    expect(decision.rewrite).toBe(false);
  });
});
