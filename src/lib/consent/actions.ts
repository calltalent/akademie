"use server";

import { cookies, headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getServerEnv } from "@/lib/env";
import { getTenant } from "@/lib/tenant/context";
import { LEGAL_LAST_UPDATED } from "@/lib/legal/updated";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import { genericErrorMessage } from "@/lib/errors/generic";
import { parseConsentCookie } from "@/lib/consent/read";
import {
  CONSENT_COOKIE_VERSION,
  setTrackingConsentInputSchema,
  TRACKING_CONSENT_COOKIE,
  TRACKING_CONSENT_MAX_AGE_SECONDS,
  TRACKING_COOKIES_ON_CONSENT,
  type SetTrackingConsentResult,
} from "@/lib/consent/schema";

/**
 * Affiliate-Modul, Block B2 (PLAN_Affiliate-System.md Abschnitt 10/B2,
 * 10.09.2026): die Schreibseite der Tracking-Einwilligung.
 *
 * Eine einzige Server Action nimmt alle drei Entscheidungen entgegen —
 * zustimmen, ablehnen, widerrufen. Das ist keine Bequemlichkeit, sondern die
 * Vorgabe: der Widerruf muss so einfach sein wie die Erteilung (Art. 7 Abs. 3
 * DSGVO), und Ablehnen darf nicht mehr Schritte kosten als Annehmen. Es gibt
 * deshalb auch keinen Vorgabewert und keine Vorauswahl; ohne ausdrückliche
 * Entscheidung passiert gar nichts, und ohne Zustimmung wird kein
 * Attributions-Cookie gesetzt (Plan 4.2, Schritt 8).
 *
 * CSRF: Server Actions sind durch den eingebauten Origin-Check von Next.js
 * abgedeckt (CLAUDE.md §2.9, Plan 11.9) — ein Aufruf von einer fremden
 * Herkunft wird abgewiesen, bevor diese Funktion läuft. `verifySameOrigin()`
 * (src/lib/security/origin.ts) kommt hier bewusst NICHT dazu: es prüft ein
 * `Request`-Objekt, das eine Server Action gar nicht bekommt, und ist für die
 * state-ändernden `route.ts`-Handler gedacht, die diesen Schutz nicht haben.
 *
 * Kein `revalidatePath()`: die Einwilligung wird bei jedem Request aus dem
 * Cookie gelesen, es gibt keinen zwischengespeicherten Inhalt, der veralten
 * könnte. Ein `revalidatePath("/", "layout")` würde bei jedem Klick auf
 * „Annehmen" den gesamten Seiten-Cache verwerfen und damit genau das
 * Performance-Budget reißen, das der Plan für diesen Block als einziges
 * Risiko benennt (CLAUDE.md §3.3, Plan 10/B2).
 */

const CONSENT_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  // In der Entwicklung läuft die App über http://localhost — ein `secure`
  // Cookie käme dort nie an. Gleiches Muster und gleiche Begründung wie
  // NEXT_LOCALE_COOKIE_OPTIONS (src/lib/account/actions.ts:139-146).
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: TRACKING_CONSENT_MAX_AGE_SECONDS,
  // KEIN `domain`-Attribut: host-only. Eine Einwilligung, die auf
  // `.calltalent.ai` gesetzt wird, gälte sonst für alle Mandanten-Subdomains
  // zugleich — der Besucher hat sie aber genau einer Akademie gegeben.
};

let cachedIpHashKey: CryptoKey | null = null;

/**
 * Schlüsselmaterial ist der ohnehin serverseitige
 * `SUPABASE_SERVICE_ROLE_KEY`, domänenpräfixiert, damit der Hash nirgends
 * sonst wiederverwendbar ist — dasselbe Verfahren wie beim Kontaktformular
 * (src/lib/contact/form-token.ts:31-44). Bewusst kein neues Secret, das Josip
 * zusätzlich hinterlegen müsste.
 *
 * Das Salz ist STATISCH und nicht tagesrotierend wie bei `affiliate_clicks`
 * (Plan 3.6): dort dient der Hash der Entdeckung von Mehrfachklicks und darf
 * altern, hier ist er Teil eines Nachweises nach Art. 7 Abs. 1 DSGVO. Ein
 * Nachweis, der nach 24 Stunden nicht mehr überprüfbar ist, ist keiner
 * (Plan 11.6).
 */
async function ipHashKey(): Promise<CryptoKey> {
  if (cachedIpHashKey) return cachedIpHashKey;
  const secret = new TextEncoder().encode(
    `calltalent:tracking-consent-ip:${getServerEnv().SUPABASE_SERVICE_ROLE_KEY}`,
  );
  cachedIpHashKey = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return cachedIpHashKey;
}

/** HMAC-SHA-256 der IP als Hex — die IP selbst wird nirgends gespeichert. */
async function hashIp(ip: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await ipHashKey(),
    new TextEncoder().encode(ip),
  );
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** 16 Zufallsbytes als Hex, siehe `consentIdSchema`. */
function newConsentId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Entscheidung des Besuchers festhalten: erst als Nachweiszeile in
 * `public.tracking_consents`, dann als Cookie.
 *
 * Die Reihenfolge ist Absicht. Eine Zustimmung ohne Nachweis ist wertlos —
 * schlägt der Schreibvorgang fehl, wird KEIN zustimmendes Cookie gesetzt und
 * damit später auch kein Attributions-Cookie. Umgekehrt gilt: eine Ablehnung
 * oder ein Widerruf wirken IMMER, auch wenn die Datenbank gerade nicht
 * erreichbar ist. Der Nutzer darf nie darauf warten müssen, dass unsere
 * Technik funktioniert, um Nein sagen zu können.
 *
 * Aufruf aus dem Einwilligungsdialog und aus dem Einstellungen-Bereich:
 *   await setTrackingConsent("granted")    // Annehmen
 *   await setTrackingConsent("denied")     // Ablehnen
 *   await setTrackingConsent("withdrawn")  // Widerrufen
 */
export async function setTrackingConsent(
  decision: string,
  category?: string,
): Promise<SetTrackingConsentResult> {
  try {
    // CLAUDE.md §2.3: eine Server Action ist ein öffentlich aufrufbarer
    // Endpunkt, `decision` und `category` sind Nutzereingaben.
    const parsed = setTrackingConsentInputSchema.safeParse({
      decision,
      ...(category === undefined ? {} : { category }),
    });
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }
    const { decision: entscheidung, category: kategorie } = parsed.data;
    const grants = entscheidung === "granted";

    // Rate-Limiting NUR für die zustimmende Richtung. Ein Limiter, der einen
    // Widerruf abweisen kann, verletzt Art. 7 Abs. 3 DSGVO — Nein sagen muss
    // jederzeit durchgehen. Missbrauchspotenzial hat ohnehin nur die
    // Richtung, die Zeilen mit Zustimmung erzeugt.
    if (grants && !(await checkRateLimit("consent-grant", { maxRequests: 60, windowSeconds: 3600 }))) {
      return { ok: false, error: RATE_LIMIT_MESSAGE };
    }

    const tenant = await getTenant();
    if (!tenant) {
      // Ohne Mandanten gibt es keine Zeile (tracking_consents.tenant_id ist
      // not null) und damit keinen gültigen Nachweis. Der Dialog wird nur auf
      // Mandanten-Hosts gerendert; dieser Zweig ist die Absicherung dagegen,
      // dass er versehentlich woanders auftaucht.
      return { ok: false, error: "Einwilligung konnte nicht gespeichert werden." };
    }

    const cookieStore = await cookies();
    const previous = parseConsentCookie(cookieStore.get(TRACKING_CONSENT_COOKIE)?.value);
    // Dieselbe opake ID über alle Entscheidungen hinweg: nur so bilden
    // Zustimmung und späterer Widerruf im Nachweis eine Kette.
    const consentId = previous.consentId ?? newConsentId();

    // Eingeloggte Person: `profiles.id` als Subjekt, damit ein Widerruf auch
    // von einem anderen Gerät aus dem Nachweis zuzuordnen ist. Anonym: die
    // opake Consent-ID. Bewusst nur EINE Zeile je Entscheidung — zwei Zeilen
    // (anonym und benannt) würden dieselbe Handlung doppelt protokollieren
    // und die Frage „was galt wann?" schwerer statt leichter beantwortbar
    // machen.
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const h = await headers();
    const ip =
      h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

    const { error } = await createAdminClient()
      .from("tracking_consents")
      .insert({
        tenant_id: tenant.id,
        subject_kind: user ? "user" : "anon",
        subject_key: user ? user.id : consentId,
        category: kategorie,
        decision: entscheidung,
        policy_version: LEGAL_LAST_UPDATED,
        ip_hash: ip ? await hashIp(ip) : null,
      });

    if (error) {
      // Nur der Fehlercode ins Log, nie `error.message`: die Meldung kann den
      // Zeileninhalt samt ip_hash und Subjektschlüssel enthalten
      // (CLAUDE.md §2.11).
      console.error("Einwilligung konnte nicht protokolliert werden. Code:", error.code);
      if (grants) {
        return { ok: false, error: "Einwilligung konnte nicht gespeichert werden." };
      }
      // Ablehnen und Widerrufen laufen trotzdem weiter, siehe Kopf.
    }

    cookieStore.set(
      TRACKING_CONSENT_COOKIE,
      JSON.stringify({
        v: CONSENT_COOKIE_VERSION,
        cid: consentId,
        pol: LEGAL_LAST_UPDATED,
        at: new Date().toISOString(),
        // Entscheidungen anderer Kategorien bleiben erhalten; heute gibt es
        // nur diese eine, künftige kommen additiv dazu.
        dec: { ...previous.decisions, [kategorie]: entscheidung },
      }),
      CONSENT_COOKIE_OPTIONS,
    );

    if (!grants) {
      // Ein Widerruf, nach dem das Attributions-Cookie weiterläuft, ist
      // keiner. Löschen mit demselben `path`, mit dem gesetzt wurde — sonst
      // trifft die Löschanweisung das Cookie nicht.
      for (const name of TRACKING_COOKIES_ON_CONSENT) {
        cookieStore.delete({ name, path: "/" });
      }
    }

    return { ok: true, decision: entscheidung };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}
