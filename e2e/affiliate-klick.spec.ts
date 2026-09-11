import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createE2eAdminClient,
  createPublishedCourse,
  DEMO_TENANT_URL,
  E2E_PREFIX,
  getDemoTenantId,
} from "./helpers/test-data";
// Relativer Import statt `@/lib/legal/updated`: die übrigen Dateien in diesem
// Verzeichnis meiden Importe aus `src/` grundsätzlich, weil Playwright sie in
// einem reinen Node-Prozess ohne Next.js' Bundler-Aliase ausführt (siehe
// Kopfkommentar in e2e/helpers/test-data.ts). `updated.ts` ist die eine
// Ausnahme, die gefahrlos geht: eine einzige exportierte Konstante, kein
// `server-only`, überhaupt kein Import. Eine lokale Kopie des Datums wäre die
// schlechtere Wahl — der Einwilligungs-Cookie unten gilt nur für GENAU diesen
// Textstand (`isConsentGranted()`, src/lib/consent/read.ts), eine abgedriftete
// Kopie ließe Test 2 mit einer irreführenden Begründung scheitern.
import { LEGAL_LAST_UPDATED } from "../src/lib/legal/updated";

/**
 * Affiliate-System, Block B3 — End-to-End-Abnahme des Klick-Endpunkts
 * `GET /api/aff/k` (PLAN_Affiliate-System.md Abschnitt 10/B3, Prüfliste
 * 11.3/11.7/11.13/11.14/11.15).
 *
 * Geprüft werden die fünf Punkte, die der Plan für diesen Block nennt:
 *   1. Klick OHNE Einwilligung: kein `ct_aff`-Cookie, aber `?aff=<token>`.
 *   2. Klick MIT Einwilligung: Cookie mit den erwarteten Flags.
 *   3. Absolutes/protokollrelatives/kodiertes Ziel: Rückfall auf „/" — kein
 *      Open Redirect.
 *   4. Unbekannter Code und gesperrter Partner antworten gleich (kein Orakel
 *      für gültige Partnercodes, CLAUDE.md §2.15).
 *   5. `Sec-Fetch-Dest: image`: Klickzeile mit `is_bot`, aber keine Zuordnung
 *      und kein Cookie.
 *
 * ====================================================================
 * FEHLENDE VORBEDINGUNG — DIESER TEST IST HIER NICHT AUSFÜHRBAR
 * ====================================================================
 * Am 11.09.2026 lesend gegen das verbundene Supabase-Projekt
 * (`vklqksdiyiijzoirntyt`) geprüft: `information_schema.tables` enthält KEINE
 * einzige Tabelle `affiliate%` und kein `tracking_consents`. Die vier
 * Migrationen dieses Moduls
 *   supabase/migrations/20260910120000_affiliate_core.sql
 *   supabase/migrations/20260910120100_tracking_consents.sql
 *   supabase/migrations/20260910120200_affiliate_enabled_guard.sql
 *   supabase/migrations/20260911120000_affiliate_tracking.sql
 * sind also nicht angewendet (`list_migrations` endet bei 20260909183704).
 * Das Anwenden bleibt Josip vorbehalten (CLAUDE.md §4.6, `npx supabase db
 * push`); ohne es gibt es keine `affiliate_programs`-Zeile, keinen Partner,
 * keine Klicktabelle — und damit nichts zu prüfen.
 *
 * Konsequenz im Code statt nur im Kommentar: `test.beforeAll` fragt die
 * Tabelle einmal ab. Fehlt sie, überspringen sich alle fünf Tests MIT
 * Begründung im Playwright-Bericht (Muster: `test.skip(!process.env.
 * STRIPE_SECRET_KEY, …)` in stripe-checkout.spec.ts). Bewusst ein Skip und
 * kein harter Fehlschlag: die fehlende Migration ist ein noch nicht
 * freigegebener Schritt, kein Defekt. Ist die Tabelle dagegen da und der
 * Endpunkt verhält sich falsch, wird der Test rot — genau das soll er.
 * Es werden hier KEINE grünen Ergebnisse behauptet: der Test ist in dieser
 * Umgebung nie gelaufen.
 *
 * Zusätzlich gelten die stehenden Vorbedingungen der ganzen Suite
 * (`e2e/global-setup.ts`): laufender Dev-Server, `NEXT_PUBLIC_SUPABASE_URL`
 * und `SUPABASE_SERVICE_ROLE_KEY` in `.env`, Mandant `demo-blau`.
 * ANMERKUNG dazu: der Mandant `demo-blau` EXISTIERT im verbundenen Projekt
 * (am 11.09.2026 lesend bestätigt). Die gegenteilige Behauptung in den
 * Kopfkommentaren von `marketplace-public.spec.ts`/`marketplace-listing.
 * spec.ts` stammt aus M2/M3 und ist überholt.
 *
 * ## Warum dieser Test über `request` läuft und nicht über `page`
 *
 * Geprüft wird eine 302-Antwort samt `Location` und `Set-Cookie`. Ein Browser
 * folgt der Weiterleitung sofort und zeigt weder das eine noch das andere;
 * `page.goto()` könnte hinterher nur die Endadresse beurteilen. Playwrights
 * `request`-Fixture (`APIRequestContext`) ist je Test frisch, hat einen
 * eigenen Cookie-Behälter und kann mit `maxRedirects: 0` die Antwort selbst
 * festhalten — die einzige Form, in der die Prüfpunkte 1, 2 und 3 überhaupt
 * beobachtbar sind. Der Preis ist, dass die Kopfzeilen einer echten
 * Browser-Navigation von Hand gesetzt werden müssen (`BROWSER_HEADERS`);
 * genau das macht Prüfpunkt 5 aber erst möglich, denn `Sec-Fetch-Dest`
 * ist aus einer echten Seite heraus nicht setzbar.
 */

// --- Fixtures und Konstanten -------------------------------------------

const CLICK_PATH = "/api/aff/k";

/** Name aus `src/lib/consent/schema.ts` (`TRACKING_COOKIES_ON_CONSENT[0]`). */
const AFFILIATE_COOKIE = "ct_aff";
/** Name aus `src/lib/consent/schema.ts` (`TRACKING_CONSENT_COOKIE`). */
const CONSENT_COOKIE = "ct_consent";

/**
 * Laufzeit der Zuordnung, die dieser Test dem Programm gibt. Der erwartete
 * `Max-Age`-Wert wird daraus GERECHNET und nicht als Zahl hingeschrieben —
 * sonst prüfte Test 2 nur noch, dass irgendein Cookie irgendeine Laufzeit
 * trägt.
 */
const PROGRAM_COOKIE_TTL_DAYS = 30;
const EXPECTED_COOKIE_MAX_AGE = PROGRAM_COOKIE_TTL_DAYS * 86_400;

/** `AFFILIATE_REFERRAL_TOKEN_PATTERN` (src/lib/affiliate/schema.ts). */
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

const SKIP_REASON =
  "Affiliate-Migrationen (20260910120000 ff.) sind nicht angewendet — siehe Kopfkommentar.";

/**
 * Kopfzeilen einer echten Dokument-Navigation. Sie sind hier keine Kosmetik,
 * sondern die Voraussetzung dafür, dass `detectClickBot()`
 * (src/lib/affiliate/bot.ts) den Abruf überhaupt als Mensch durchlässt:
 *
 *   - Der User-Agent darf `BOT_USER_AGENT_PATTERN` nicht treffen. Playwrights
 *     Vorgabe-Agent einer `APIRequestContext` enthält „HeadlessChrome" und
 *     fiele über „headless" sofort in den Bot-Zweig — jeder Test hier wäre
 *     dann aus dem falschen Grund grün bzw. rot.
 *   - `accept` muss `text/html` enthalten (Prüfung 4b), `sec-fetch-dest`
 *     `document` und `sec-fetch-mode` `navigate` (Prüfung 4c).
 *   - `sec-fetch-site: cross-site` ist der realistische Wert: ein
 *     Partnerlink wird per Definition von einer fremden Seite aus geklickt.
 *     Der Endpunkt bewertet ihn nicht, er steht hier der Echtheit halber.
 */
const BROWSER_HEADERS: Record<string, string> = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "de-DE,de;q=0.9",
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "cross-site",
};

type PartnerStatus = "active" | "suspended";

type ProgramRow = {
  id: string;
  status: string;
  cookie_ttl_days: number;
  overwrite_policy: string;
};

let admin: SupabaseClient;
let tenantId = "";
let programId = "";

/** `kurs/<slug>` als Zielschlüssel bzw. `/kurs/<slug>` als erwarteter Pfad. */
let courseTarget = "";
let courseTargetPath = "";

let activeCode = "";
let activePartnerId = "";
let suspendedCode = "";
let suspendedPartnerId = "";
let botCode = "";
let botPartnerId = "";
/** Formal gültiger Code, der bewusst NIE angelegt wird (Prüfpunkt 4). */
let unknownCode = "";

let migrationMissing = false;

/** Aufräumzustand: was dieser Lauf selbst angelegt bzw. verändert hat. */
let createdProgramId: string | null = null;
let previousProgram: ProgramRow | null = null;
const createdPartnerIds: string[] = [];
let createdCourseId: string | null = null;
let previousTenantSettings: Record<string, unknown> | null = null;

/**
 * Partnercode mit `e2e-`-Präfix (Teardown-Konvention der Suite) und einem
 * Zeitanteil, damit ein zweiter Lauf nicht an `unique (tenant_id, code)`
 * scheitert. Das Ergebnis muss `AFFILIATE_PARTNER_CODE_PATTERN`
 * (`^[a-z0-9][a-z0-9-]{2,31}$`) erfüllen: `toString(36)` liefert
 * ausschließlich Kleinbuchstaben und Ziffern, die Gesamtlänge bleibt bei
 * etwa 20 Zeichen.
 */
function partnerCode(rolle: string): string {
  const zeit = Date.now().toString(36);
  const zufall = Math.floor(Math.random() * 1296)
    .toString(36)
    .padStart(2, "0");
  return `${E2E_PREFIX}${rolle}-${zeit}${zufall}`;
}

/**
 * Ein `ct_consent`-Cookie mit erteilter Einwilligung, wortgleich mit dem, was
 * `setTrackingConsent()` (src/lib/consent/actions.ts) schreibt.
 *
 * `pol` MUSS `LEGAL_LAST_UPDATED` sein: `isConsentGranted()` vergleicht streng
 * auf Gleichheit, eine Einwilligung zu einem anderen Textstand gilt als nicht
 * erteilt. `cid` ist eine synthetische 32-stellige Hex-Kennung — kein echter
 * Wert und kein Personenbezug (CLAUDE.md §2.6).
 */
function consentCookieHeader(): string {
  const payload = JSON.stringify({
    v: 1,
    cid: "00000000000000000000000000e2e001",
    pol: LEGAL_LAST_UPDATED,
    at: new Date().toISOString(),
    dec: { affiliate: "granted" },
  });
  // `encodeURIComponent`, weil die Gegenseite dekodiert: NextRequest liest das
  // Cookie über `@edge-runtime/cookies`, und dessen Parser ruft
  // `decodeURIComponent()` auf jeden Wert. Roh gesendet zerfiele die JSON-
  // Nutzlast am ersten Komma in zwei Cookies.
  return `${CONSENT_COOKIE}=${encodeURIComponent(payload)}`;
}

function clickUrl(params: Record<string, string>): string {
  const url = new URL(CLICK_PATH, DEMO_TENANT_URL);
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }
  return url.toString();
}

/**
 * Ein Klick. `maxRedirects: 0` ist der Kern: ohne diese Angabe folgte
 * Playwright der 302 und lieferte die Antwort der Zielseite — `Location` und
 * `Set-Cookie` wären damit unbeobachtbar.
 */
async function sendClick(
  request: APIRequestContext,
  params: Record<string, string>,
  extraHeaders: Record<string, string> = {},
): Promise<APIResponse> {
  return request.get(clickUrl(params), {
    headers: { ...BROWSER_HEADERS, ...extraHeaders },
    maxRedirects: 0,
  });
}

function locationOf(response: APIResponse): string {
  return response.headers()["location"] ?? "";
}

/**
 * Der rohe `Set-Cookie`-Eintrag für `ct_aff` oder `null`.
 *
 * `headersArray()` statt `headers()`: `headers()` fasst gleichnamige
 * Kopfzeilen zu einer zusammen, und eine Antwort kann mehrere `Set-Cookie`
 * tragen. Die Flags sollen am ROHEN Eintrag geprüft werden und nicht an dem,
 * was Playwrights Cookie-Behälter daraus gemacht hat — der zeigt nur an, was
 * er akzeptiert hat, nicht, was der Server gesendet hat.
 */
function affiliateCookieHeader(response: APIResponse): string | null {
  const treffer = response
    .headersArray()
    .filter((h) => h.name.toLowerCase() === "set-cookie")
    .map((h) => h.value)
    .find((wert) => wert.startsWith(`${AFFILIATE_COOKIE}=`));
  return treffer ?? null;
}

/** Das Token aus `…?aff=<token>`; leer, wenn kein Parameter angehängt wurde. */
function tokenFromLocation(location: string): string {
  const index = location.indexOf("?aff=");
  return index === -1 ? "" : location.slice(index + "?aff=".length);
}

async function createPartner(
  code: string,
  status: PartnerStatus,
  displayName: string,
): Promise<string> {
  const { data, error } = await admin
    .from("affiliate_partners")
    .insert({
      tenant_id: tenantId,
      program_id: programId,
      // Reservierte, garantiert nicht auflösbare Testdomain (RFC 2606) —
      // Plan 11.6 nennt für Affiliate-Fixtures ausdrücklich `@example.invalid`.
      applicant_email: `${code}@example.invalid`,
      display_name: displayName,
      code,
      // Direkt im Zielzustand: `affiliate_partners_guard()` erzwingt für
      // `authenticated` eine unbewertete Bewerbung, lässt `service_role` aber
      // ausdrücklich durch (Migration 20260910120000). Der Freigabeweg über
      // die Oberfläche gehört zu Block B6/B7, nicht hierher.
      status,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Testpartner "${code}" konnte nicht angelegt werden: ${error?.message}`);
  }
  const id = data.id as string;
  createdPartnerIds.push(id);
  return id;
}

test.beforeAll(async () => {
  admin = createE2eAdminClient();
  tenantId = await getDemoTenantId(admin);

  // Vorbedingungs-Sonde, siehe Kopfkommentar. `42P01` ist Postgres'
  // „undefined_table", `PGRST205` PostgREST' Antwort für eine Tabelle, die
  // sein Schema-Cache nicht kennt — beides heißt hier: Migration fehlt.
  const probe = await admin.from("affiliate_programs").select("id").limit(1);
  if (probe.error) {
    if (probe.error.code === "42P01" || probe.error.code === "PGRST205") {
      migrationMissing = true;
      return;
    }
    throw new Error(`affiliate_programs nicht lesbar (Code ${probe.error.code}).`);
  }

  // --- Feature-Schalter (Plan 9.8) -------------------------------------
  // `checkAffiliateProgramAccess()` gibt den Endpunkt nur frei, wenn
  // `settings.affiliate_enabled === true` ist. Gesetzt wird der Schalter im
  // Betreiber-Portal; hier per `service_role`, den die Erlaubnisliste von
  // `tenants_operator_settings_guard()` ausdrücklich durchlässt. Gleiches
  // Muster wie legal-pages.spec.ts: alter Wert merken, in `afterAll`
  // zurückstellen — `demo-blau` soll nach dem Lauf genauso dastehen wie vorher.
  const tenantRow = await admin.from("tenants").select("settings").eq("id", tenantId).single();
  if (tenantRow.error) {
    throw new Error(`Mandanteneinstellungen nicht lesbar: ${tenantRow.error.message}`);
  }
  previousTenantSettings = (tenantRow.data?.settings ?? {}) as Record<string, unknown>;
  const { error: featureError } = await admin
    .from("tenants")
    .update({ settings: { ...previousTenantSettings, affiliate_enabled: true } })
    .eq("id", tenantId);
  if (featureError) {
    throw new Error(`Partnerprogramm-Schalter nicht setzbar: ${featureError.message}`);
  }

  // --- Programm ---------------------------------------------------------
  // `unique (tenant_id)`: je Mandant gibt es höchstens ein Programm. Deshalb
  // zwei Wege — ein vorhandenes wird geliehen und danach zurückgestellt, ein
  // fehlendes angelegt und danach gelöscht. Ein vorhandenes zu löschen käme
  // nicht in Frage: an einer Programmzeile hängen über die zusammengesetzten
  // Fremdschlüssel sämtliche Partner, Klicks und Zuordnungen.
  const existing = await admin
    .from("affiliate_programs")
    .select("id, status, cookie_ttl_days, overwrite_policy")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (existing.error) {
    throw new Error(`Partnerprogramm nicht lesbar: ${existing.error.message}`);
  }

  if (existing.data) {
    previousProgram = existing.data as ProgramRow;
    programId = previousProgram.id;
    const { error } = await admin
      .from("affiliate_programs")
      .update({
        status: "active",
        cookie_ttl_days: PROGRAM_COOKIE_TTL_DAYS,
        // `allow`, weil dieser Test mehrfach mit demselben Partner klickt und
        // jeder Klick eine frische Zuordnung erzeugen soll. `deny` ist Gegenstand
        // eines eigenen Falls in attribution.test.ts, nicht dieses Specs.
        overwrite_policy: "allow",
      })
      .eq("id", programId);
    if (error) {
      throw new Error(`Partnerprogramm nicht aktivierbar: ${error.message}`);
    }
  } else {
    const created = await admin
      .from("affiliate_programs")
      .insert({
        tenant_id: tenantId,
        status: "active",
        cookie_ttl_days: PROGRAM_COOKIE_TTL_DAYS,
        overwrite_policy: "allow",
      })
      .select("id")
      .single();
    if (created.error || !created.data) {
      throw new Error(`Partnerprogramm konnte nicht angelegt werden: ${created.error?.message}`);
    }
    programId = created.data.id as string;
    createdProgramId = programId;
  }

  // --- Partner ----------------------------------------------------------
  // Drei Zeilen, weil drei Prüfpunkte sich sonst gegenseitig die Datenlage
  // verderben: Prüfpunkt 5 zählt die Klickzeilen SEINES Partners und wäre
  // nicht mehr eindeutig, wenn derselbe Partner vorher schon geklickt hätte.
  activeCode = partnerCode("aktiv");
  suspendedCode = partnerCode("gesperrt");
  botCode = partnerCode("botziel");
  unknownCode = partnerCode("unbekannt");

  activePartnerId = await createPartner(activeCode, "active", "E2E Partner (aktiv)");
  suspendedPartnerId = await createPartner(suspendedCode, "suspended", "E2E Partner (gesperrt)");
  botPartnerId = await createPartner(botCode, "active", "E2E Partner (Bot-Prüfung)");

  // --- Ziel -------------------------------------------------------------
  // Ein echter, veröffentlichter Kurs statt eines erfundenen Slugs: das Ziel
  // des Partnerlinks soll eine Seite sein, die es wirklich gibt. Der Slug
  // trägt das `e2e-`-Präfix und passt damit zugleich auf
  // `AFFILIATE_TARGET_PATTERN` (`kurs/<slug>`).
  const course = await createPublishedCourse(admin, tenantId, "Affiliate Klickziel");
  createdCourseId = course.id;
  courseTarget = `kurs/${course.slug}`;
  courseTargetPath = `/${courseTarget}`;
});

test.afterAll(async () => {
  if (migrationMissing || !admin) return;

  // Reihenfolge: erst die Kinder, dann das Programm, zuletzt der Mandant.
  // Partner müssen ausdrücklich weg, wenn das Programm nur geliehen war —
  // sonst bliebe nach jedem Lauf ein Satz Testpartner stehen.
  //
  // Klick- und Zuordnungszeilen werden hier ABSICHTLICH nicht einzeln
  // gelöscht, sondern über die Kaskade des Partners mitgenommen. Der Grund
  // steht in der Migration: `affiliate_clicks_guard()` und
  // `affiliate_referrals_guard()` lassen ein DELETE nur für 'postgres'/
  // 'supabase_admin' oder bei `pg_trigger_depth() > 1` zu — 'service_role'
  // steht bewusst NICHT in der Liste, damit keine Server-Route mit einem
  // falschen Filter die Betrugsgrundlage räumen kann. Ein direktes
  // `delete from affiliate_clicks` aus diesem Testlauf bräche deshalb mit
  // 'affiliate_clicks_immutable' ab; die Kaskade läuft eine Ebene tiefer und
  // ist ausdrücklich freigegeben. Das DELETE auf `affiliate_partners` selbst
  // geht durch, weil sein Guard nur Abrechnungsprofile und Provisionszeilen
  // verweigert — beides hat ein Testpartner nicht.
  if (createdPartnerIds.length > 0) {
    await admin.from("affiliate_partners").delete().in("id", createdPartnerIds);
  }

  if (createdProgramId) {
    await admin.from("affiliate_programs").delete().eq("id", createdProgramId);
  } else if (previousProgram) {
    await admin
      .from("affiliate_programs")
      .update({
        status: previousProgram.status,
        cookie_ttl_days: previousProgram.cookie_ttl_days,
        overwrite_policy: previousProgram.overwrite_policy,
      })
      .eq("id", previousProgram.id);
  }

  if (createdCourseId) {
    await admin.from("courses").delete().eq("id", createdCourseId);
  }

  if (previousTenantSettings) {
    await admin.from("tenants").update({ settings: previousTenantSettings }).eq("id", tenantId);
  }
});

// --- 1. Ohne Einwilligung ----------------------------------------------

test("Klick ohne Einwilligung setzt kein ct_aff-Cookie, hängt den Token aber als ?aff= an", async ({
  request,
}) => {
  test.skip(migrationMissing, SKIP_REASON);

  const response = await sendClick(request, { c: activeCode, z: courseTarget });

  expect(response.status()).toBe(302);
  // Plan 11.14: die Antwort trägt Token im `Location` und darf deshalb in
  // keiner Zwischenstation liegen bleiben.
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["x-robots-tag"]).toContain("noindex");

  const location = locationOf(response);
  expect(location.startsWith(`${courseTargetPath}?aff=`)).toBe(true);
  // Relativer `Location` (G11): niemals eine absolute Adresse, sonst könnte
  // der `Host`-Kopf des Aufrufers den Zielhost bestimmen.
  expect(location.startsWith("/")).toBe(true);
  expect(location.startsWith("//")).toBe(false);

  const token = tokenFromLocation(location);
  expect(token).toMatch(TOKEN_PATTERN);

  // Der eigentliche Prüfpunkt: § 25 TDDDG — ohne Einwilligung kein Cookie.
  expect(affiliateCookieHeader(response)).toBeNull();

  // Gegenprobe in der Datenbank: die Zuordnung ist trotzdem entstanden (der
  // einwilligungsfreie Pfad läuft über `?aff=`), und sie trägt keinen
  // Einwilligungszeitpunkt.
  const referral = await admin
    .from("affiliate_referrals")
    .select("id, status, partner_id")
    .eq("tenant_id", tenantId)
    .eq("token", token)
    .maybeSingle();
  expect(referral.error).toBeNull();
  expect(referral.data?.status).toBe("active");

  expect(referral.data?.partner_id).toBe(activePartnerId);

  // Bewusst `order` + `limit(1)` statt `maybeSingle()`: die Entdopplung
  // (`unique (tenant_id, dedup_key)`) fasst alle Klicks desselben Partners aus
  // derselben Stunde zu EINER Zeile zusammen — springt die Stunde aber
  // mitten im Lauf um, entstehen zwei, und `maybeSingle()` wäre dann mit
  // PGRST116 rot, ohne dass irgendetwas kaputt wäre.
  const click = await admin
    .from("affiliate_clicks")
    .select("id, is_bot, consent_at, landing_path")
    .eq("tenant_id", tenantId)
    .eq("partner_id", activePartnerId)
    .order("created_at", { ascending: false })
    .limit(1);
  expect(click.error).toBeNull();
  expect(click.data?.[0]?.is_bot).toBe(false);
  // Ohne Einwilligung kein `consent_at` — der Wert heißt „es durfte ein Cookie
  // gesetzt werden", und das durfte es hier nicht.
  expect(click.data?.[0]?.consent_at).toBeNull();
  expect(click.data?.[0]?.landing_path).toBe(courseTargetPath);
});

// --- 2. Mit Einwilligung ------------------------------------------------

test("Klick mit Einwilligung setzt ct_aff mit httpOnly, SameSite=Lax, Path=/ und der Programm-Laufzeit", async ({
  request,
}) => {
  test.skip(migrationMissing, SKIP_REASON);

  const response = await sendClick(
    request,
    { c: activeCode, z: courseTarget },
    { cookie: consentCookieHeader() },
  );

  expect(response.status()).toBe(302);

  const location = locationOf(response);
  const token = tokenFromLocation(location);
  expect(token).toMatch(TOKEN_PATTERN);

  const cookie = affiliateCookieHeader(response);
  expect(cookie, "Mit Einwilligung MUSS ein ct_aff-Cookie gesetzt werden").not.toBeNull();
  const cookieValue = cookie ?? "";

  // Cookie und `?aff=` tragen dasselbe Token — sonst hinge an einem Kauf über
  // den Cookie-Pfad eine andere Zuordnung als über den Parameter-Pfad.
  expect(cookieValue.startsWith(`${AFFILIATE_COOKIE}=${token};`)).toBe(true);

  // Die Flags aus `affiliateCookieOptions()` (src/lib/affiliate/cookie.ts).
  // Alle Prüfungen ohne Rücksicht auf Groß-/Kleinschreibung und Reihenfolge:
  // beides ist Serialisierungsdetail, kein Vertrag.
  expect(cookieValue).toMatch(/;\s*httponly/i);
  expect(cookieValue).toMatch(/;\s*samesite=lax/i);
  expect(cookieValue).toMatch(/;\s*path=\/(;|$)/i);
  expect(cookieValue).toMatch(new RegExp(`;\\s*max-age=${EXPECTED_COOKIE_MAX_AGE}(;|$)`, "i"));
  // KEIN `Domain`-Attribut: host-only. Ein Cookie auf `.calltalent.ai` gälte
  // für alle Mandanten-Subdomains gleichzeitig — mandantenübergreifende
  // Attribution soll technisch unmöglich sein, nicht bloß unterlassen werden.
  expect(cookieValue).not.toMatch(/;\s*domain=/i);
  // `Secure` hängt an `NODE_ENV` (cookie.ts) und wird deshalb nicht an einem
  // festen Wert geprüft, sondern am Schema, über das dieser Test läuft: ein
  // `Secure`-Cookie über `http://` käme im Browser nie an. Läuft die Suite
  // später gegen eine `https://`-Adresse, entfällt diese Prüfung von selbst.
  if (DEMO_TENANT_URL.startsWith("http://")) {
    expect(cookieValue).not.toMatch(/;\s*secure/i);
  }

  // Gegenprobe: mit Einwilligung hält die Klickzeile den Zeitpunkt fest
  // (Nachweis nach Art. 7 Abs. 1 DSGVO, Plan 3.6).
  const referral = await admin
    .from("affiliate_referrals")
    .select("id, partner_id")
    .eq("tenant_id", tenantId)
    .eq("token", token)
    .maybeSingle();
  expect(referral.error).toBeNull();
  expect(referral.data?.partner_id).toBeTruthy();
});

// --- 3. Kein Open Redirect ----------------------------------------------

test("absolute, protokollrelative und kodierte Ziele landen auf „/“ ohne Zuordnung", async ({
  request,
}) => {
  test.skip(migrationMissing, SKIP_REASON);

  // Jeder Fall steht für einen benannten Ablehnungsgrund aus
  // `CLICK_TARGET_REJECTIONS` (src/lib/affiliate/click-target.ts). Der
  // Endpunkt unterscheidet sie in der Antwort bewusst NICHT — geprüft wird
  // deshalb für alle dasselbe: Weiterleitung auf „/", kein Token, kein Cookie.
  const angriffe: ReadonlyArray<{ z: string; grund: string }> = [
    { z: "https://boese.example/phishing", grund: "absolute URL mit Schema" },
    { z: "//boese.example/phishing", grund: "protokollrelative Adresse" },
    { z: "\\boese.example", grund: "Backslash, von Browsern wie „//“ behandelt" },
    { z: "/admin/kurse", grund: "absoluter interner Pfad" },
    { z: "kurs/../../admin", grund: "Punkt-Segmente (Pfad-Traversal)" },
    // Die Zeichenkette enthält ein echtes Prozentzeichen; `URLSearchParams`
    // kodiert es auf dem Weg zu `%25`, der Endpunkt sieht also wieder genau
    // diesen Wert. Das ist der Punkt: er darf ihn NICHT dekodieren, sonst
    // entstünde daraus „//boese.example".
    { z: "%2f%2fboese.example", grund: "prozentkodierte Variante" },
    { z: "javascript:alert(1)", grund: "javascript:-Schema" },
    { z: "kurs/kein slug", grund: "Leerzeichen im Ziel" },
    // Steuerzeichen im Ziel. `URLSearchParams` schreibt es als `%00`,
    // `searchParams.get()` liefert es wieder als rohes NUL — genau der Wert,
    // der ungeprüft in einem `Location`-Kopf eine zweite Kopfzeile
    // einschleusen könnte. Als Escape-Sequenz geschrieben und nicht als
    // rohes Zeichen, damit die Datei Text bleibt und in jedem Editor lesbar ist.
    { z: "kurs/abc\u0000def", grund: "Steuerzeichen (Header-Injection)" },
  ];

  for (const angriff of angriffe) {
    const response = await sendClick(request, { c: activeCode, z: angriff.z });

    expect(response.status(), angriff.grund).toBe(302);
    expect(locationOf(response), angriff.grund).toBe("/");
    expect(affiliateCookieHeader(response), angriff.grund).toBeNull();
  }

  // Positivkontrolle. Ohne sie wäre die Schleife oben auch dann grün, wenn der
  // Endpunkt JEDES Ziel verwürfe — der Test prüfte dann nicht mehr die Abwehr,
  // sondern nur noch, dass irgendetwas antwortet.
  const gueltig = await sendClick(request, { c: activeCode, z: courseTarget });
  expect(locationOf(gueltig).startsWith(`${courseTargetPath}?aff=`)).toBe(true);
});

// --- 4. Kein Orakel -----------------------------------------------------

test("unbekannter Partnercode und gesperrter Partner liefern dieselbe Antwort", async ({
  request,
}) => {
  test.skip(migrationMissing, SKIP_REASON);

  const unbekannt = await sendClick(request, { c: unknownCode, z: courseTarget });
  const gesperrt = await sendClick(request, { c: suspendedCode, z: courseTarget });

  // Alles, was ein Aufrufer sehen kann, muss gleich sein: Status, Ziel,
  // Cache-Vorgabe, Rumpf und das Fehlen eines Cookies (CLAUDE.md §2.15,
  // Plan 11.15). Ließe sich „Code existiert nicht" von „Partner gesperrt"
  // unterscheiden, wären die gültigen Partnercodes eines Händlers
  // durchprobierbar.
  expect(gesperrt.status()).toBe(unbekannt.status());
  expect(unbekannt.status()).toBe(302);
  expect(locationOf(gesperrt)).toBe(locationOf(unbekannt));
  expect(gesperrt.headers()["cache-control"]).toBe(unbekannt.headers()["cache-control"]);
  expect(affiliateCookieHeader(unbekannt)).toBeNull();
  expect(affiliateCookieHeader(gesperrt)).toBeNull();

  const rumpfUnbekannt = await unbekannt.body();
  const rumpfGesperrt = await gesperrt.body();
  expect(rumpfGesperrt.length).toBe(rumpfUnbekannt.length);

  // Das Ziel bleibt erhalten — der Besucher hat nichts falsch gemacht und darf
  // nie auf einer Fehlerseite landen —, aber es hängt kein Token daran.
  expect(locationOf(unbekannt)).toBe(courseTargetPath);
  expect(tokenFromLocation(locationOf(unbekannt))).toBe("");

  // Die Laufzeit wird hier bewusst NICHT verglichen: sie über HTTP zu messen
  // ist in einer Testumgebung notorisch verrauscht, und ein solcher Vergleich
  // wäre ein sprunghaft fehlschlagender Test statt einer Aussage. Die
  // Gleichheit entsteht strukturell in `trackAffiliateClick()` — beide Fälle
  // laufen durch dieselbe Menge paralleler Abfragen und enden in demselben
  // `nothing("no-partner")`.

  // Gegenprobe 1: für den gesperrten Partner ist nicht einmal eine Klickzeile
  // entstanden (Plan 4.2 Schritt 3: Abbruch ohne jeden Schreibvorgang).
  const klicks = await admin
    .from("affiliate_clicks")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("partner_id", suspendedPartnerId);
  expect(klicks.error).toBeNull();
  expect(klicks.data ?? []).toHaveLength(0);

  // Gegenprobe 2: der aktive Code liefert sehr wohl eine Zuordnung. Ohne sie
  // wäre dieser Test auch dann grün, wenn der Endpunkt für JEDEN Code nichts
  // mehr zuordnete.
  const aktiv = await sendClick(request, { c: activeCode, z: courseTarget });
  expect(tokenFromLocation(locationOf(aktiv))).toMatch(TOKEN_PATTERN);
});

// --- 5. Eingebetteter Abruf --------------------------------------------

test("Sec-Fetch-Dest: image erzeugt eine is_bot-Klickzeile, aber keine Zuordnung", async ({
  request,
}) => {
  test.skip(migrationMissing, SKIP_REASON);

  // Der Cookie-Stuffing-Fall: eine fremde Seite bindet den Partnerlink als
  // `<img src="…/api/aff/k?c=…">` ein und setzt damit jedem ihrer Besucher die
  // Zuordnung unter, ohne dass je jemand geklickt hätte.
  //
  // `accept` bleibt bewusst der Dokument-Wert aus `BROWSER_HEADERS`, obwohl
  // ein echtes `<img>` `image/…` schickte: sonst schlüge schon Prüfung 4b
  // („kein text/html") zu und dieser Test sagte nichts mehr über
  // `Sec-Fetch-Dest` aus — genau den Punkt, den der Plan für B3 nennt. So
  // kann NUR die Fetch-Metadata-Prüfung greifen.
  //
  // Die Einwilligung wird mitgeschickt, und auch das ist Absicht: ohne sie
  // gäbe es ohnehin kein Cookie, und der Test bewiese nicht, dass der
  // Bot-Filter es verhindert hat.
  const response = await sendClick(
    request,
    { c: botCode, z: courseTarget },
    { cookie: consentCookieHeader(), "sec-fetch-dest": "image", "sec-fetch-mode": "no-cors" },
  );

  expect(response.status()).toBe(302);
  // Ziel unverändert, aber weder Token noch Cookie.
  expect(locationOf(response)).toBe(courseTargetPath);
  expect(tokenFromLocation(locationOf(response))).toBe("");
  expect(affiliateCookieHeader(response)).toBeNull();

  // Die Klickzeile MUSS entstehen: sie ist der Prüfpfad und die Grundlage,
  // auf der sich später erklären lässt, warum die Klickzahl eines Partners von
  // seiner Zuordnungszahl abweicht.
  const klicks = await admin
    .from("affiliate_clicks")
    .select("id, is_bot, consent_at, landing_path")
    .eq("tenant_id", tenantId)
    .eq("partner_id", botPartnerId);
  expect(klicks.error).toBeNull();
  expect(klicks.data ?? []).toHaveLength(1);
  expect(klicks.data?.[0]?.is_bot).toBe(true);
  expect(klicks.data?.[0]?.landing_path).toBe(courseTargetPath);
  // `consent_at` heißt „ein Cookie hätte gesetzt werden dürfen". Beim Bot
  // durfte es das nicht — trotz vorliegender Einwilligung.
  expect(klicks.data?.[0]?.consent_at).toBeNull();

  // Und der eigentliche Punkt: keine Zuordnung, also auch später keine
  // Provision.
  const zuordnungen = await admin
    .from("affiliate_referrals")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("partner_id", botPartnerId);
  expect(zuordnungen.error).toBeNull();
  expect(zuordnungen.data ?? []).toHaveLength(0);
});
