import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { getAuthUser } from "@/lib/auth/context";
import { writeAuditEntry } from "@/lib/affiliate/audit";
import type { AffiliateAuditEntity } from "@/lib/affiliate/types";
import type { PublicTenant } from "@/lib/tenant/types";

/**
 * Affiliate-System, Block B1 — Zugriffsprüfung des Moduls
 * (PLAN_Affiliate-System.md G9, G10, G15, 3.1, 3.3, 8.1, 8.2, 9.8, 11.10).
 *
 * Zweite Verteidigungslinie neben RLS, exakt im Stil von
 * `src/lib/auth/staff.ts` und `src/lib/calendar/access.ts`: die Policies in
 * der Datenbank (`affiliate_is_manager()`, `affiliate_partner_id()`,
 * Migration 20260910120000_affiliate_core.sql) verhindern das Lesen und
 * Schreiben bereits hart; diese Funktionen liefern zusätzlich eine
 * verständliche deutsche Meldung bzw. eine Redirect-Grundlage, BEVOR
 * überhaupt eine Abfrage an Supabase geht — und sie prüfen den
 * Feature-Schalter, den RLS gar nicht kennt.
 *
 * Drei Gates, weil es drei unterschiedliche Aufrufer gibt:
 *   requireAffiliateProgram()  Modul an? (auch für anonyme Aufrufer:
 *                              öffentliche Programmseite und Bewerbung, 8.3)
 *   requireAffiliateManager()  Geld- und Personaldaten, owner/admin (G10)
 *   requireAffiliatePartner()  Partnerbereich /partner/* (G9)
 *
 * Der Feature-Schalter wird hier gegatet und NICHT nur in der Oberfläche:
 * `marketplace_enabled` wird heute ausschließlich in der UI geprüft, nicht in
 * `createMarketplaceCheckout()` — diese Lücke (Entitlement-Bypass) darf
 * `affiliate_enabled` nicht erben (Plan 9.8). Deshalb ruft jede Server Action
 * und jeder Route Handler dieses Moduls eines der drei `require…` als erste
 * Zeile; `requireAffiliateManager()` und `requireAffiliatePartner()` prüfen
 * den Schalter selbst mit, ein zusätzlicher `requireAffiliateProgram()`-Aufruf
 * ist also nicht nötig.
 */

// --- Feature-Schalter ---------------------------------------------------

/**
 * Opt-in-Polarität: NUR ein ausdrückliches `true` schaltet frei; fehlender
 * Wert = AUS (wie `marketplace_enabled`/`shift_calendar_enabled`, siehe
 * `src/lib/tenant/types.ts`). Gesetzt wird der Schalter ausschließlich im
 * Betreiber-Portal (`updateTenantFeatures()`); der DB-seitige
 * `tenants_operator_settings_guard()` hält einen Mandanten-Admin davon ab,
 * ihn selbst zu setzen (Plan 3.0d/9.8).
 *
 * Gelesen über einen `Record`-Zugriff statt über `tenant.settings.affiliate_enabled`:
 * das Feld wird in `src/lib/tenant/types.ts` von einem anderen Arbeitsschritt
 * desselben Blocks ergänzt (Plan 9.8, fünf Dateien). Der Record-Zugriff macht
 * diese Datei von der Reihenfolge der Blockarbeiten unabhängig und bleibt
 * auch danach korrekt — die Polarität steckt in `=== true`, nicht im Typ.
 */
export function isAffiliateEnabled(tenant: PublicTenant): boolean {
  const settings: Record<string, unknown> = tenant.settings;
  return settings.affiliate_enabled === true;
}

// --- Ergebnisformen (wirft nie, für Layouts und Server Components) ------

export type AffiliateProgramAccess =
  | { ok: true; tenant: PublicTenant }
  | { ok: false; reason: "no-tenant" | "feature-disabled" };

export type AffiliateManagerAccess =
  | { ok: true; tenant: PublicTenant; user: { id: string; email?: string } }
  | {
      ok: false;
      reason: "no-tenant" | "feature-disabled" | "not-authenticated" | "not-manager";
    };

export type AffiliatePartnerAccess =
  | { ok: true; tenant: PublicTenant; user: { id: string; email?: string }; partnerId: string }
  | {
      ok: false;
      reason: "no-tenant" | "feature-disabled" | "not-authenticated" | "not-partner";
    };

/**
 * Die beiden Rollen, die Geld- und Personaldaten sehen dürfen (G10).
 * Wortgleich mit `public.affiliate_is_manager(t)` in der Migration
 * (`member_role(t) in ('owner','admin')`) — bewusst `is_staff()` NICHT, denn
 * das schließt `trainer` ein (`0001_init.sql:63-69`), und im Affiliate-Modul
 * geht es um Provisionen, Bankdaten und Bewerbungsangaben.
 *
 * Geprüft wird über die bestehende RPC `member_role` und nicht über die neue
 * `affiliate_is_manager`: `member_role` ist seit 0001 in Betrieb und wird von
 * `requireAdminTenant()` (staff.ts) und `checkShiftPlannerAccess()`
 * (calendar/access.ts) genauso benutzt — dasselbe Muster statt eines zweiten.
 * Die Prädikate sind identisch; wer eines ändert, muss beide ändern.
 */
const AFFILIATE_MANAGER_ROLES = ["owner", "admin"] as const;

// --- Meldungen ----------------------------------------------------------

/**
 * Eine Meldung je Ablehnungsgrund, deutsch und ohne technische Details
 * (CLAUDE.md §2.15: kein Enumeration-Leck über unterschiedliche Fehlertexte —
 * „nicht angemeldet" und „keine Rolle" sind bewusst getrennt, weil beides der
 * Nutzer über sich selbst ohnehin weiß, „Partner gesperrt" und „nie beworben"
 * dagegen fallen beide auf denselben Text).
 *
 * Die Texte stehen hier und nicht in `messages/de.json`, weil sie über
 * `throw new Error()` in den `catch`-Zweig einer Server Action laufen — dort
 * ist kein `getTranslations()`-Kontext, gleiches Muster wie in staff.ts,
 * platform/auth.ts und calendar/access.ts.
 */
const AFFILIATE_ACCESS_MESSAGES: Record<
  | "no-tenant"
  | "feature-disabled"
  | "not-authenticated"
  | "not-manager"
  | "not-partner",
  string
> = {
  "no-tenant": "Kein Mandant zu diesem Host gefunden.",
  "feature-disabled": "Das Partnerprogramm ist für diese Akademie nicht aktiviert.",
  "not-authenticated": "Nicht angemeldet.",
  "not-manager": "Kein Zugriff — nur für Inhaber/Administratoren.",
  "not-partner": "Kein Zugriff — nur für freigeschaltete Partner.",
};

// --- Modul-Gate ---------------------------------------------------------

/**
 * Ist das Partnerprogramm für diesen Mandanten überhaupt aktiv? Prüft
 * bewusst KEINE Anmeldung: die öffentliche Programmseite und das
 * Bewerbungsformular (8.3) laufen ohne Konto, und der Schalter ist die
 * Grenze, die dort zuerst greifen muss.
 */
export async function checkAffiliateProgramAccess(): Promise<AffiliateProgramAccess> {
  const tenant = await getTenant();
  if (!tenant) return { ok: false, reason: "no-tenant" };

  if (!isAffiliateEnabled(tenant)) return { ok: false, reason: "feature-disabled" };

  return { ok: true, tenant };
}

/** Für Server Actions und Route Handler — wirft, damit try/catch einheitlich greift. */
export async function requireAffiliateProgram() {
  const result = await checkAffiliateProgramAccess();
  if (!result.ok) {
    throw new Error(AFFILIATE_ACCESS_MESSAGES[result.reason]);
  }

  const supabase = await createClient();
  return { tenant: result.tenant, supabase };
}

// --- Manager-Gate (owner/admin, G10) ------------------------------------

/**
 * Reihenfolge: Mandant, Schalter, Anmeldung, Rolle. Der Schalter steht vor
 * der Anmeldung, weil er die Berechtigung des MANDANTEN ist und ohne
 * Rundlauf zu prüfen ist — ist das Modul aus, ist die Antwort für jeden
 * dieselbe. Ein Informationsleck ist das nicht: denselben Zustand verrät die
 * öffentliche Programmseite ohnehin.
 */
export async function checkAffiliateManagerAccess(): Promise<AffiliateManagerAccess> {
  const tenant = await getTenant();
  if (!tenant) return { ok: false, reason: "no-tenant" };

  if (!isAffiliateEnabled(tenant)) return { ok: false, reason: "feature-disabled" };

  const user = await getAuthUser();
  if (!user) return { ok: false, reason: "not-authenticated" };

  const supabase = await createClient();
  const { data: role, error } = await supabase.rpc("member_role", { t: tenant.id });
  // Fail-closed: ein Abfragefehler zählt NICHT als Rolle (Muster
  // `checkPlatformAccess()`, platform/auth.ts).
  if (error || !AFFILIATE_MANAGER_ROLES.some((r) => r === role)) {
    return { ok: false, reason: "not-manager" };
  }

  return { ok: true, tenant, user: { id: user.id, email: user.email } };
}

/** Für Server Actions und Route Handler von `/admin/affiliate/*` — wirft. */
export async function requireAffiliateManager() {
  const result = await checkAffiliateManagerAccess();
  if (!result.ok) {
    throw new Error(AFFILIATE_ACCESS_MESSAGES[result.reason]);
  }

  const supabase = await createClient();
  return { tenant: result.tenant, user: result.user, supabase };
}

// --- Partner-Gate (G9) --------------------------------------------------

/**
 * Ein Partner hat in der Regel KEINE `memberships`-Zeile (G9) — `member_role()`
 * liefert für ihn `null`, und genau deshalb gibt es `affiliate_partner_id(t)`
 * als eigene Security-Definer-Funktion. Sie liefert nur für Partner mit
 * `status = 'active'` eine ID; eine offene Bewerbung (`pending`), eine
 * Ablehnung (`rejected`) und eine Sperre (`suspended`) landen hier also
 * absichtlich bei `not-partner` — sie sollen den Partnerbereich nicht
 * betreten. Die Oberfläche darf für diese Fälle keinen unterschiedlichen
 * Text zeigen (11.15: keine Auskunft darüber, welcher Zustand vorliegt).
 */
export async function checkAffiliatePartnerAccess(): Promise<AffiliatePartnerAccess> {
  const tenant = await getTenant();
  if (!tenant) return { ok: false, reason: "no-tenant" };

  if (!isAffiliateEnabled(tenant)) return { ok: false, reason: "feature-disabled" };

  const user = await getAuthUser();
  if (!user) return { ok: false, reason: "not-authenticated" };

  const supabase = await createClient();
  const { data: partnerId, error } = await supabase.rpc("affiliate_partner_id", { t: tenant.id });
  // Fail-closed wie oben; zusätzlich die Typprüfung, damit kein `any` aus der
  // untypisierten RPC in den Rückgabewert durchschlägt.
  if (error || typeof partnerId !== "string" || partnerId.length === 0) {
    return { ok: false, reason: "not-partner" };
  }

  return { ok: true, tenant, user: { id: user.id, email: user.email }, partnerId };
}

/** Für Server Actions und Route Handler von `/partner/*` — wirft. */
export async function requireAffiliatePartner() {
  const result = await checkAffiliatePartnerAccess();
  if (!result.ok) {
    throw new Error(AFFILIATE_ACCESS_MESSAGES[result.reason]);
  }

  const supabase = await createClient();
  return {
    tenant: result.tenant,
    user: result.user,
    partnerId: result.partnerId,
    supabase,
  };
}

// --- Interessenkonflikt (G15) -------------------------------------------

/**
 * G15: Ein Programm-Manager darf keinen Vorgang entscheiden, in dem er selbst
 * Partner ist — weder die eigene Bewerbung, noch die eigene Sonderkondition,
 * noch eine Auszahlung an sich selbst, noch das Lösen eines `flagged` an einer
 * eigenen Zeile. Ohne diese Regel ist die Selbst-Empfehlungssperre wirkungslos,
 * weil derselbe Mensch über den Verdachtsfall entscheidet.
 *
 * Der Guard-Trigger `affiliate_partners_guard()` setzt dasselbe in der
 * Datenbank durch; diese Funktion ist die zweite Linie in der Server Action,
 * die der Plan ausdrücklich zusätzlich verlangt — und sie deckt die Fälle ab,
 * die der Trigger auf `affiliate_partners` nicht sieht (Auszahlung, Kondition,
 * Provisionszeile).
 *
 * Bewusst NICHT über `affiliate_partner_id()`: die Funktion liefert nur für
 * `status = 'active'` eine ID, die eigene, noch offene Bewerbung (`pending`)
 * wäre damit ungeschützt — also genau der Fall, den G15 zuerst nennt. Gelesen
 * wird deshalb die Partnerzeile selbst (Session-Client, RLS: ein Manager darf
 * sie lesen).
 *
 * Nebenwirkung mit Absicht: die Funktion prüft zugleich die Mandantenbindung
 * der client-gelieferten `partnerId` (CLAUDE.md §2.15) — eine ID aus einem
 * fremden Mandanten findet hier keine Zeile und wirft.
 *
 * Jeder abgewiesene Versuch erzeugt einen Audit-Eintrag (G15, letzter Satz).
 */
export async function assertNoSelfApproval(params: {
  tenantId: string;
  /** Der handelnde Manager, immer aus `requireAffiliateManager()`. */
  userId: string;
  /** Die betroffene Partnerzeile (bei Auszahlung/Provision deren `partner_id`). */
  partnerId: string;
  /** Betroffener Gegenstand für das Protokoll, z. B. `"payout"`. */
  entity: AffiliateAuditEntity;
  /** Der versuchte Vorgang, `<entity>.<verb>`, z. B. `"partner.approve"`. */
  attemptedAction: string;
}): Promise<void> {
  const supabase = await createClient();
  const { data: partner, error } = await supabase
    .from("affiliate_partners")
    .select("id, user_id")
    .eq("tenant_id", params.tenantId)
    .eq("id", params.partnerId)
    .maybeSingle();

  // Fail-closed: ohne gelesene Zeile wird nicht entschieden. Der Text ist für
  // "gibt es nicht" und "gehört zu einem anderen Mandanten" derselbe (11.15).
  if (error || !partner) {
    throw new Error("Der Partner wurde in dieser Akademie nicht gefunden.");
  }

  // Bekannte Grenze, identisch mit dem Guard-Trigger (`old.user_id = auth.uid()`):
  // eine Bewerbung ohne Konto trägt `user_id = null` und ist über die Nutzer-ID
  // nicht als „eigene" erkennbar. Ein Abgleich über `applicant_email` wäre
  // trügerisch (Plus-Adressen, Alias, Adresswechsel) — die Bindung entsteht
  // erst mit dem Konto, und ab da greift diese Prüfung.
  if (partner.user_id !== params.userId) return;

  await writeAuditEntry({
    tenantId: params.tenantId,
    actorKind: "manager",
    actorUserId: params.userId,
    entity: params.entity,
    entityId: params.partnerId,
    action: `${params.entity}.self_approval_blocked`,
    after: { attempted_action: params.attemptedAction },
  });

  throw new Error(
    "Dieser Vorgang gehört zur eigenen Partnerzeile und muss von einer anderen Person entschieden werden.",
  );
}
