import { NextResponse, type NextRequest } from "next/server";
import { affiliateClickQuerySchema } from "@/lib/affiliate/schema";
import { inspectClickTarget, CLICK_TARGET_FALLBACK_PATH } from "@/lib/affiliate/click-target";
import { AFFILIATE_COOKIE_NAME, affiliateCookieOptions } from "@/lib/affiliate/cookie";
import { trackAffiliateClick } from "@/lib/affiliate/track";
import { checkAffiliateProgramAccess } from "@/lib/affiliate/access";
import { isConsentGranted, parseConsentCookie } from "@/lib/consent/read";
import { TRACKING_CONSENT_COOKIE } from "@/lib/consent/schema";

/**
 * Affiliate-System, Block B3 — `GET /api/aff/k?c=<code>&z=<ziel>&cam=<kampagne>`
 * (PLAN_Affiliate-System.md 4.2, 4.1, G11, G18, Prüfliste 11.3/11.7/11.9/11.10/11.13/11.14/11.15).
 *
 * Der einzige öffentliche, unauthentifizierte Endpunkt dieses Moduls. Jeder
 * Partnerlink der Welt zeigt hierher; was hier passiert, entscheidet, wem
 * später eine Provision zusteht.
 *
 * ## Warum der Pfad unter `/api/` liegt
 *
 * Geprüft (11.09.2026), beides trifft zu und beides ist nötig:
 *   - `isApiPath("/api/aff/k")` ist `true` (`src/lib/tenant/routing.ts:95-97`).
 *     Auf dem Portal- und dem Marketplace-Host bleibt der Pfad damit vom
 *     Prefix-Rewrite verschont; ein Pfad wie `/r/<code>` würde dort zu
 *     `/portal/r/...` und liefe in einen 404.
 *   - `isMaintenanceBypassPath("/api/aff/k")` ist `true` (über `isApiPath`,
 *     `routing.ts:150`). Ein Partnerlink bleibt also auch dann erreichbar,
 *     wenn der Händler den Wartungsmodus einschaltet — sonst beantwortete ein
 *     bezahlter Klick eine 503-Seite.
 *   - Auf einem Mandanten-Host löst `decideRouting()` den Mandanten auch für
 *     `/api/...` auf (`routing.ts`, Regel 2). `getTenant()` bekommt
 *     `x-tenant-data` damit frei Haus, ohne eigenen Datenbankzugriff.
 * Kein Eingriff in `src/middleware.ts` war nötig und es ist keiner erlaubt:
 * das Cookie setzt dieser Endpunkt selbst auf seiner eigenen Antwort, die
 * `pendingCookies`-Mechanik (`middleware.ts:166-176`) existiert
 * ausschließlich für den Supabase-Session-Refresh im Wartungsmodus-Zweig.
 *
 * ## Die Antwort ist IMMER dieselbe Art von Antwort
 *
 * Es gibt keinen Fehlerzweig. Ungültige Parameter, unbekannter Code,
 * gesperrter Partner, abgeschaltetes Programm, ausgeschaltetes Modul,
 * Datenbankfehler — alles endet in einer 302-Weiterleitung. Der Besucher hat
 * auf einen Link geklickt; er hat nichts falsch gemacht und darf nie auf
 * einer Fehlerseite landen.
 *
 * Dieselbe Antwort ist zugleich eine Sicherheitsanforderung (CLAUDE.md §2.15,
 * Plan 11.15): unterschieden sich „Code existiert nicht" und „Partner
 * gesperrt" in Status, Text oder Laufzeit, wäre dieser Endpunkt ein Orakel,
 * mit dem sich die gültigen Partnercodes eines Händlers durchprobieren
 * lassen. Deshalb laufen beide Fälle durch dieselbe eine Abfragemenge in
 * `track.ts` (drei parallele Abfragen, gleiche Zahl, gleiche Reihenfolge) und
 * enden in demselben `nothing("no-partner")`.
 *
 * ## Die Weiterleitung ist RELATIV
 *
 * `Location` trägt einen Pfad, nie eine absolute Adresse. Plan 4.2 Schritt 2
 * schreibt `NextResponse.redirect(new URL(ziel, request.url), 302)`; davon
 * weicht diese Datei mit einem harten Grund ab (A1):
 *
 *   `request.url` wird in Next.js aus dem `Host`-Kopf zusammengesetzt. Hinter
 *   Cloudflare ist der zwar gesetzt, aber er bleibt eine vom Client gelieferte
 *   Angabe — und dieser Endpunkt wird per Definition von fremden Seiten aus
 *   aufgerufen. Eine daraus gebaute absolute Adresse trüge im Zweifel einen
 *   fremden Host im `Location`, also genau die offene Weiterleitung, gegen die
 *   `click-target.ts` antritt. Ein relativer `Location` KANN den Origin nicht
 *   verlassen; RFC 7231 §7.1.2 erlaubt ihn ausdrücklich, jeder Browser löst
 *   ihn gegen die angefragte Adresse auf.
 *   Nebenwirkung, die ebenfalls gewollt ist: das host-only Cookie aus
 *   `cookie.ts` wirkt nur auf demselben Host (G11, Plan 4.7) — ein Redirect,
 *   der den Host wechseln kann, wäre ein Cookie, das ins Leere gesetzt wird.
 *
 * `NextResponse.redirect()` nimmt keine relative Adresse an, deshalb die
 * Antwort von Hand. 302 und nicht 301: ein 301 wird dauerhaft gecacht und
 * machte jede spätere Änderung an Ziel oder Zuordnung wirkungslos.
 *
 * ## Kein Rate-Limit über `check_rate_limit` — die Regel gehört vor den Worker
 *
 * Plan 11.7 nennt den Postgres-Limiter (`src/lib/security/rate-limit.ts`) als
 * mitlaufenden Grundschutz. Hier läuft er NICHT mit (A2), und zwar aus drei
 * Gründen, die sich gegenseitig verstärken:
 *
 *   1. Er ist ein zusätzlicher HTTP-Rundlauf zu Postgres, VOR jeder anderen
 *      Arbeit. Der Endpunkt hat 200 ms Serverzeit als Abnahmebedingung (Plan
 *      B3) und braucht im Normalfall bereits drei Rundläufe. Ein vierter
 *      kostet jeden echten Besucher Zeit.
 *   2. Er ist fail-open (`rate-limit.ts:36-39`). Genau unter der Last, gegen
 *      die er schützen soll, fällt er aus — und lässt dann alles durch. Ein
 *      Schutz, der unter Last verschwindet, ist an dieser Stelle kein
 *      Grundschutz, sondern eine Gewohnheit.
 *   3. Sein `insert ... on conflict (key) do update` serialisiert alle
 *      gleichzeitigen Anfragen desselben Schlüssels auf EINE Zeile (G18).
 *      Bei Klicklast wird der Limiter damit selbst zum Engpass des Systems,
 *      das er schützen soll — auf dem schreiblastigsten Pfad des Moduls.
 *
 * Was stattdessen greift: der Bot- und Einbettungsfilter (`bot.ts`), die
 * Entdopplung als Constraint (`unique (tenant_id, dedup_key)`), die
 * Tagesobergrenze von 50 000 Klicks je Partner in
 * `public.affiliate_record_click()` — und als eigentlicher Schutz die
 * Cloudflare-Regel unten. G18 macht sie zur Bedingung des Live-Gangs: OHNE
 * SIE GEHT DIESER ENDPUNKT NICHT LIVE.
 *
 * ------------------------------------------------------------------------
 * EINZURICHTENDE CLOUDFLARE-REGEL (Zone der Akademie-Domain)
 * Dashboard: Security -> WAF -> Rate limiting rules -> "Create rule"
 *
 *   Name                 affiliate-klick-ip
 *   Wenn eingehende
 *   Anfragen passen zu   (http.request.uri.path eq "/api/aff/k")
 *   Merkmale             IP with NAT support
 *                        (Fallback, falls der Tarif es nicht anbietet:
 *                         "IP Address")
 *   Zeitraum             10 Sekunden
 *   Anfragen             20
 *   Dann                 Managed Challenge
 *   Dauer der Maßnahme   60 Sekunden
 *
 * Begründungen, damit beim Einrichten nichts geraten werden muss:
 *   - 20/10 s: ein Mensch klickt einen Partnerlink einmal, in Ausnahmefällen
 *     zweimal. Der Wert liegt weit über jedem echten Verhalten und weit unter
 *     dem, was Cookie-Stuffing oder ein Klickbetrugslauf braucht.
 *   - Managed Challenge statt Block: ein Block verliert den Klick endgültig,
 *     und hinter einem Firmen- oder Mobilfunk-NAT sitzen viele echte
 *     Besucher auf derselben IP. Eine Challenge lässt den Menschen durch und
 *     hält das Skript auf.
 *   - "IP with NAT support" schlüsselt zusätzlich nach Cloudflares
 *     Besuchermerkmal und trifft deshalb den einzelnen Missbraucher statt das
 *     ganze Firmennetz.
 *
 *   Zweite Regel, NUR auf Business/Enterprise verfügbar (dort sind eigene
 *   Merkmale erlaubt) — sie deckt den Fall ab, dass der Angriff aus vielen
 *   IP-Adressen auf EINEN Partnercode läuft:
 *
 *   Name                 affiliate-klick-code
 *   Ausdruck             (http.request.uri.path eq "/api/aff/k")
 *   Merkmale             Query-Parameter "c"
 *   Zeitraum             60 Sekunden
 *   Anfragen             600
 *   Dann                 Managed Challenge, Dauer 300 Sekunden
 *
 *   Die datenbankseitige Obergrenze von 50 000 Klicks je Partner und Tag
 *   bleibt unabhängig davon bestehen; sie ist die letzte Grenze, nicht die
 *   erste.
 * ------------------------------------------------------------------------
 *
 * ## Kein `verifySameOrigin()`
 *
 * Ausdrücklich nicht (Plan 11.9): der Aufruf kommt per Definition von einer
 * fremden Domain und hat oft gar keinen `Origin`-Kopf. `verifySameOrigin()`
 * ist fail-closed und wiese jeden einzelnen Affiliate-Klick ab. Der Endpunkt
 * ist ein GET ohne Nutzereingabe und ohne Wirkung auf ein angemeldetes Konto;
 * es gibt hier keinen CSRF-Gegenstand.
 *
 * ## Cloudflare Workers
 *
 * Kein `node:crypto`, kein `fs`, keine Arbeit nach der Antwort. Der
 * Schreibvorgang liegt VOR dem Ausliefern (Plan 4.2, letzter Absatz):
 * `custom-worker.ts:59` entfernt den `ctx`-Parameter, es gibt also kein
 * `waitUntil()`, und eine nach der Antwort gestartete Promise kann Cloudflare
 * abbrechen. Ein verlorener Klick ist verlorenes Geld; der Preis ist ein
 * Rundlauf Latenz, bewusst bezahlt.
 */

/**
 * `no-store` ist die eigentliche Anforderung, `private` die Verstärkung: die
 * Antwort trägt im Erfolgsfall ein `Set-Cookie` mit dem Referral-Token und
 * einen `Location` mit demselben Token im Query-String. Läge sie in einer
 * Zwischenstation — Cloudflare-Cache, Firmen-Proxy, Browser-Cache —, bekäme
 * der nächste Besucher die Zuordnung eines fremden Klicks untergeschoben.
 * `no-store` verbietet das Ablegen überhaupt (Plan 11.14, 4.2 Schritt 2).
 *
 * Die Basis-Security-Header (`nosniff`, `X-Frame-Options`, `Referrer-Policy`,
 * HSTS) kommen aus `next.config.ts:40` über `source: "/:path*"` und gelten
 * damit auch hier; diese Route setzt keinen davon herunter.
 */
const CLICK_RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "no-store, private",
  // Der Endpunkt ist eine Weiterleitung, kein Inhalt. Ohne diesen Kopf legen
  // Suchmaschinen die Partnerlinks als eigene URLs an — und fahren sie dann
  // regelmäßig ab, was den Bot-Filter beschäftigt und die Klickzahlen des
  // Partners unerklärlich macht.
  "X-Robots-Tag": "noindex, nofollow",
};

/**
 * Baut die Antwort. Eine einzige Stelle, an der eine Antwort entsteht — damit
 * kein Zweig versehentlich einen anderen Status, einen anderen Kopf oder eine
 * andere Gestalt liefert und so doch wieder unterscheidbar wird.
 *
 * `path` ist immer ein relativer Pfad aus `click-target.ts` und enthält
 * bauartbedingt kein `?` (`AFFILIATE_TARGET_PATTERN`), das Anhängen von
 * `?aff=` ist deshalb eindeutig. Das Token ist 64 Hex-Zeichen und braucht
 * keine Kodierung.
 */
function redirectTo(path: string, token: string | null): NextResponse {
  const location = token === null ? path : `${path}?aff=${token}`;
  return new NextResponse(null, {
    status: 302,
    headers: { ...CLICK_RESPONSE_HEADERS, Location: location },
  });
}

export async function GET(request: NextRequest) {
  // Ein Zeitpunkt für den ganzen Vorgang. Kein zweites `new Date()` weiter
  // unten: Tagessalz, Entdopplungsfenster, `consent_at` und `expires_at`
  // müssen sich auf denselben Augenblick beziehen, sonst fällt ein Klick am
  // Tageswechsel in zwei verschiedene Fenster.
  const at = new Date();

  const params = request.nextUrl.searchParams;

  // --- Schritt 1: zod auf alle drei Parameter (CLAUDE.md §2.3) ----------
  // Ungültig heißt laut Plan 4.2 Schritt 1: Ziel „/", weiter mit Schritt 8 —
  // also Weiterleitung OHNE jede Zuordnung und ohne jeden Schreibvorgang.
  // Das gilt bewusst auch für ein ungültiges `cam`: ein Kampagnenschlüssel,
  // der das Muster verletzt, stammt nicht aus dem Promolink-Generator,
  // sondern aus fremder Hand.
  const parsed = affiliateClickQuerySchema.safeParse({
    c: params.get("c"),
    z: params.get("z"),
    cam: params.get("cam"),
  });
  if (!parsed.success) return redirectTo(CLICK_TARGET_FALLBACK_PATH, null);

  // --- Schritt 2: das Ziel steht fest ----------------------------------
  // Zweite, engere Linie hinter zod (siehe Kopf von `click-target.ts`): das
  // Schema prüft dasselbe Muster, diese Funktion zusätzlich Steuerzeichen,
  // Nicht-ASCII, Prozentkodierung, Backslash, Schema-Doppelpunkt,
  // protokollrelative Adressen und Punkt-Segmente — jeweils mit eigenem,
  // testbarem Ablehnungsgrund. Eine Ablehnung kann hier nach bestandener
  // zod-Prüfung nicht mehr vorkommen; genau deshalb steht sie hier, damit
  // eine spätere Lockerung des Musters den Redirect nicht STILL öffnet.
  const verdict = inspectClickTarget(parsed.data.z ?? "");
  if (!verdict.ok) return redirectTo(CLICK_TARGET_FALLBACK_PATH, null);
  const target = verdict.path;

  // --- Schritt 3, erster Teil: Mandant und Feature-Schalter -------------
  // `checkAffiliateProgramAccess()` liest den Mandanten aus dem
  // Middleware-Header (kein Datenbankzugriff) und prüft
  // `settings.affiliate_enabled`. Der Schalter wird hier und nicht nur in der
  // Oberfläche geprüft (Plan 9.8): `marketplace_enabled` wird heute
  // ausschließlich in der UI geprüft — diese Lücke soll das Affiliate-Modul
  // nicht erben. Die Antwort ist dieselbe wie bei einem unbekannten Code.
  // Dass dieser Zweig ohne Datenbankzugriff auskommt und damit schneller ist,
  // verrät nichts Schützenswertes: der Schalter ist eine Eigenschaft des
  // MANDANTEN und für jeden Aufrufer gleich — die öffentliche Programmseite
  // gibt ihn ohnehin preis. Ein Orakel entstünde erst, wenn sich einzelne
  // CODES unterscheiden ließen, und genau das verhindert `track.ts`.
  const access = await checkAffiliateProgramAccess();
  if (!access.ok) return redirectTo(target, null);

  // Einwilligung: gelesen aus dem `ct_consent`-Cookie, rein und ohne
  // Datenbankzugriff (`src/lib/consent/read.ts`). Bewusst
  // `parseConsentCookie()` + `isConsentGranted()` statt
  // `hasTrackingConsent()`: die Route hält den `NextRequest` ohnehin in der
  // Hand, und `hasTrackingConsent()` läse dasselbe Cookie ein zweites Mal
  // über `next/headers`. Der Zustand ist derselbe — inklusive der beiden dort
  // gebauten Bedingungen: letzte Entscheidung `granted` UND bezogen auf den
  // aktuellen Stand der Rechtstexte. Jede Unklarheit endet bei „keine
  // Einwilligung".
  const consentGranted = isConsentGranted(
    parseConsentCookie(request.cookies.get(TRACKING_CONSENT_COOKIE)?.value),
  );

  // --- Schritte 3 bis 7: alles, was schreibt (track.ts) -----------------
  // Wirft nie. Der Rückgabewert ist die einzige Information, die von hier aus
  // die Antwort beeinflusst — und er beeinflusst nur, ob ein `?aff=` und ein
  // `Set-Cookie` dazukommen, nie Status oder Ziel.
  const tracked = await trackAffiliateClick({
    tenantId: access.tenant.id,
    code: parsed.data.c,
    campaign: parsed.data.cam ?? null,
    landingPath: target,
    headers: request.headers,
    // Das bestehende Attributions-Cookie. `track.ts` liest es nur bei
    // vorliegender Einwilligung überhaupt aus (§ 25 TDDDG erfasst auch den
    // ZUGRIFF auf die Endeinrichtung, nicht nur das Speichern) — hier wird es
    // deshalb unbewertet durchgereicht.
    existingToken: request.cookies.get(AFFILIATE_COOKIE_NAME)?.value ?? null,
    consentGranted,
    at,
  });

  // --- Schritt 8: ausliefern -------------------------------------------
  const response = redirectTo(target, tracked.token);

  // Cookie nur bei Einwilligung UND nur, wenn eine neue Zuordnung entstanden
  // ist. `cookieTtlDays` ist `null`, sobald eine der beiden Bedingungen
  // fehlt. `keepCookie` deckt Plan 4.2 Schritt 7a ab: bestehende Zuordnung
  // bei `overwrite_policy = 'deny'` — das Cookie bleibt unverändert, weil ein
  // erneutes `Set-Cookie` die Laufzeit der Zusage gegenüber dem ERSTEN
  // Partner still verlängern würde.
  //
  // Die Optionen kommen vollständig aus `affiliateCookieOptions()`
  // (httpOnly, sameSite lax, secure in Produktion, path "/", KEIN
  // domain-Attribut, Laufzeit auf [1, 365] Tage beschnitten). Hier steht
  // bewusst kein einziges Cookie-Feld im Klartext: `cookie.ts` ist die eine
  // Quelle für Setzen UND Löschen, sonst überlebt das Attributions-Cookie
  // einen Widerruf der Einwilligung (CLAUDE.md §2.13, Prüfliste 11.8/11.13).
  if (tracked.token !== null && tracked.cookieTtlDays !== null && !tracked.keepCookie) {
    response.cookies.set(
      AFFILIATE_COOKIE_NAME,
      tracked.token,
      affiliateCookieOptions(tracked.cookieTtlDays),
    );
  }

  return response;
}
