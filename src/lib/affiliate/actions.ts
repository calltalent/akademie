"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertNoSelfApproval, requireAffiliateManager } from "@/lib/affiliate/access";
import { writeAuditEntry } from "@/lib/affiliate/audit";
import {
  buildDedupKey,
  computeBaseCents,
  computeCommissionParts,
  resolveCondition,
} from "@/lib/affiliate/compute";
import {
  affiliateCommissionDecisionSchema,
  affiliateCommissionFlagSchema,
  affiliateConditionSchema,
  affiliateGroupSchema,
  affiliateManualBookingSchema,
  affiliatePartnerAdminSchema,
  affiliatePartnerCreateSchema,
  affiliatePartnerStatusSchema,
  affiliateProgramSettingsSchema,
  affiliateReassignSchema,
} from "@/lib/affiliate/schema";
import { getAffiliateProgram, listAffiliateConditions } from "@/lib/affiliate/queries";
import type {
  AffiliateCommissionActionState,
  AffiliateConditionActionState,
  AffiliateGroupActionState,
  AffiliatePartnerActionState,
  AffiliateProgramActionState,
} from "@/lib/affiliate/state";
import type {
  AffiliateConditionSnapshot,
  AffiliateProgramRow,
} from "@/lib/affiliate/types";
import { translateDbError } from "@/lib/errors/db";
import { genericErrorMessage } from "@/lib/errors/generic";

/**
 * Affiliate-System, Block B6-A — die Server Actions der Mandanten-Oberfläche
 * (PLAN_Affiliate-System.md 4.6, 8.1, G10, G14, G15, 11.3, 11.9, 11.15,
 * 11.17).
 *
 * VIER REGELN, DIE HIER FÜR JEDE FUNKTION OHNE AUSNAHME GELTEN:
 *
 * 1. ROLLE ZUERST. Erste Zeile ist immer `requireAffiliateManager()` —
 *    `member_role(t) in ('owner','admin')`, ausdrücklich NICHT `is_staff()`,
 *    weil das `trainer` einschließt (`0001_init.sql:63-69`) und es hier um
 *    Geld und Personendaten geht (G10). Das Gate prüft zugleich den
 *    Feature-Schalter, den RLS gar nicht kennt (9.8).
 *
 * 2. MANDANT VOR ALLEM ANDEREN. Jede client-gelieferte ID — `partnerId`,
 *    `conditionId`, `groupId`, `commissionId`, `orderId`, `productId`,
 *    `referredBy` — wird gegen `tenant_id` geprüft, BEVOR irgendetwas
 *    geschrieben wird (CLAUDE.md §2.15, Plan 11.15). Nie
 *    `where id = :clientId` allein.
 *
 * 3. EINE MELDUNG FÜR „GIBT ES NICHT" UND „GEHÖRT JEMAND ANDEREM". Die
 *    Konstanten unten sind die einzigen Texte für diesen Fall, und der
 *    Partner-Text ist WORTGLEICH mit dem in `access.ts` — aus zwei
 *    verschiedenen Antworten ließe sich sonst die Existenz fremder Partner,
 *    Bestellungen und Buchungen ableiten. Nie `error.message` an die
 *    Oberfläche (CLAUDE.md §2.11): dafür `translateDbError()` bzw.
 *    `genericErrorMessage()`.
 *
 * 4. PROTOKOLL IMMER. Jede Funktion schreibt über `writeAuditEntry()`; das
 *    Protokoll ist redigiert und unveränderlich (3.16). `writeAuditEntry()`
 *    wirft, wenn es nicht schreiben konnte — der Vorgang gilt dann als
 *    unvollständig, und das ist Absicht: ein Prüfpfad mit Lücken, die
 *    niemand bemerkt, ist keiner.
 *
 * WARUM `createAdminClient()` UND NICHT DER SESSION-CLIENT. Das Schreibrecht
 * von `authenticated` reicht für diese Vorgänge nicht: `affiliate_commissions`
 * hat für Clients überhaupt kein INSERT/UPDATE-Recht (Migration
 * 20260911130000, Abschnitt 2.5), und eine vorab freigegebene Partnerzeile
 * lehnt `affiliate_partners_guard()` für jede Nicht-`service_role` ab
 * (`affiliate_partner_insert_must_be_pending`). Die Kehrseite steht
 * ausdrücklich hier: unter `service_role` kehrt DERSELBE Guard sofort zurück
 * — die Selbstfreigabesperre G15, die Mandantenprüfung und die
 * Statuskanten aus 6.3 wirken auf diesem Weg NICHT aus der Datenbank heraus.
 * Deshalb prüft jede Funktion unten beides selbst: `assertNoSelfApproval()`
 * für G15 und einen ausdrücklichen Lesevorgang mit `.eq("tenant_id", …)` für
 * die Mandantenbindung. Wer hier eine Prüfung streicht, streicht sie
 * vollständig.
 *
 * `"use server"`-Dateien dürfen in Next.js 16 ausschließlich async Funktionen
 * exportieren. Zustandstypen liegen deshalb in `state.ts`, Schemata in
 * `schema.ts`, Leseabfragen in `queries.ts` — und werden von hier NICHT
 * re-exportiert (Typ-RE-Export bricht unter Turbopack zur Laufzeit, siehe
 * `state.ts`).
 */

// --- Texte --------------------------------------------------------------

/**
 * WORTGLEICH mit `assertNoSelfApproval()` in access.ts. Beide Wege müssen
 * denselben Satz liefern: sonst verriete allein die Formulierung, ob eine
 * Partner-ID existiert (dann käme der Text aus access.ts) oder nicht.
 */
const PARTNER_NOT_FOUND = "Der Partner wurde in dieser Akademie nicht gefunden.";
const ORDER_NOT_FOUND = "Die Bestellung wurde in dieser Akademie nicht gefunden.";
const COMMISSION_NOT_FOUND = "Die Buchung wurde in dieser Akademie nicht gefunden.";
const CONDITION_NOT_FOUND = "Die Kondition wurde in dieser Akademie nicht gefunden.";
const GROUP_NOT_FOUND = "Die Gruppe wurde in dieser Akademie nicht gefunden.";
const PRODUCT_NOT_FOUND = "Das Produkt wurde in dieser Akademie nicht gefunden.";
const PROGRAM_MISSING =
  "Für diese Akademie ist noch kein Partnerprogramm eingerichtet. Bitte zuerst die Einstellungen speichern.";

/**
 * G15 im Wortlaut von access.ts. Der Gruppen-Fall (ein Manager wertet die
 * Gruppe auf, in der er selbst steht) bekommt denselben Text — er ist
 * dieselbe Entscheidung über eigenes Geld, nur eine Ebene weiter.
 */
const SELF_DEALING =
  "Dieser Vorgang gehört zur eigenen Partnerzeile und muss von einer anderen Person entschieden werden.";

const AFFILIATE_PATH = "/admin/affiliate";

// --- Kleine Helfer ------------------------------------------------------

/**
 * Die Meldungen, die aus einem `throw` heraus an die Oberfläche DÜRFEN.
 *
 * Ohne diese Liste wäre der `catch`-Zweig jeder Funktion eine Falle: die
 * beiden Texte, die `assertNoSelfApproval()` (access.ts) wirft — „Partner
 * nicht gefunden" und die G15-Absage —, verschwänden in
 * `genericErrorMessage()`, und der Manager läse „Unbekannter Fehler" an der
 * einzigen Stelle, an der die Begründung zählt. Beide Texte stehen oben
 * WORTGLEICH als Konstante; die Liste ist deshalb keine zweite Quelle,
 * sondern genau dieselbe.
 *
 * Alles andere — SDK-Fehler, Laufzeitfehler, die Absagen der Zugriffsgates —
 * fällt weiterhin in die generische Meldung (CLAUDE.md §2.11: `error.message`
 * erreicht nie die Oberfläche; §2.15: keine unterschiedlichen Fehlertexte, aus
 * denen sich Existenz ableiten lässt).
 */
const USER_FACING_MESSAGES: ReadonlySet<string> = new Set([
  PARTNER_NOT_FOUND,
  ORDER_NOT_FOUND,
  COMMISSION_NOT_FOUND,
  CONDITION_NOT_FOUND,
  GROUP_NOT_FOUND,
  PRODUCT_NOT_FOUND,
  PROGRAM_MISSING,
  SELF_DEALING,
]);

function actionMessage(e: unknown): string {
  if (e instanceof Error && USER_FACING_MESSAGES.has(e.message)) return e.message;
  return genericErrorMessage(e);
}

function programState(e: unknown): AffiliateProgramActionState {
  return { error: actionMessage(e) };
}
function partnerState(e: unknown): AffiliatePartnerActionState {
  return { error: actionMessage(e) };
}
function conditionState(e: unknown): AffiliateConditionActionState {
  return { error: actionMessage(e) };
}
function groupState(e: unknown): AffiliateGroupActionState {
  return { error: actionMessage(e) };
}
function commissionState(e: unknown): AffiliateCommissionActionState {
  return { error: actionMessage(e) };
}

/** `parsed.error.issues[0]?.message ?? "Ungültige Eingabe."` (Plan 11.3). */
function firstIssue(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? "Ungültige Eingabe.";
}

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 86_400_000);
}

/**
 * Die Mandantenbindung einer client-gelieferten ID, in einer Zeile. Liefert
 * `true` nur, wenn die Zeile existiert UND zu diesem Mandanten gehört.
 * `select("id")` genügt: mehr wird für die Prüfung nicht gebraucht, und mehr
 * zu lesen hieße, Spalten anzufassen, die diese Prüfung nichts angehen.
 */
async function belongsToTenant(
  table: "affiliate_groups" | "affiliate_partners" | "affiliate_conditions" | "products" | "orders",
  tenantId: string,
  id: string,
): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from(table)
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  // Fail-closed: ein Abfragefehler ist KEIN Nachweis der Zugehörigkeit.
  if (error) {
    console.error(`[affiliate/actions] Zugehörigkeit prüfen fehlgeschlagen (Code ${error.code}).`);
    return false;
  }
  return data !== null;
}

/**
 * Die eigene Partnerzeile des handelnden Managers, sofern es eine gibt.
 * Gelesen wird über `user_id` und ohne Statusfilter — dieselbe Auskunft wie
 * `affiliate_self_partner_id()` in der Datenbank, und aus demselben Grund
 * ohne `status = 'active'`: die Frage „geht es um mein eigenes Geld?" hängt
 * an der Person, nicht am Freigabestatus der eigenen Zeile.
 */
async function loadOwnPartner(
  tenantId: string,
  userId: string,
): Promise<{ id: string; group_id: string | null } | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("affiliate_partners")
    .select("id, group_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error(`[affiliate/actions] Eigene Partnerzeile lesen fehlgeschlagen (Code ${error.code}).`);
    // Fail-closed wäre hier falsch herum: ohne gelesene Zeile darf keine
    // Entscheidung durchgehen, die G15 betrifft. Der Aufrufer behandelt
    // `undefined` deshalb als „unbekannt" und bricht ab.
    throw new Error("self_partner_unknown");
  }
  return (data ?? null) as { id: string; group_id: string | null } | null;
}

/**
 * G15 für die Kondition (5.2/8.1): weder die eigene Partnerzeile noch die
 * eigene Gruppe darf sich ein Manager selbst besser stellen. Die reine
 * Produktkondition bleibt bewusst erlaubt — sie gilt für ALLE Partner, und
 * ein Betreiber, der sein eigener erster Partner ist, könnte sonst sein
 * Programm nicht konfigurieren (wörtlich so in der Migration begründet).
 */
async function assertNoSelfCondition(params: {
  tenantId: string;
  userId: string;
  partnerId: string | null;
  groupId: string | null;
  attemptedAction: string;
}): Promise<void> {
  const own = await loadOwnPartner(params.tenantId, params.userId);
  if (own === null) return;

  const hitsOwnPartner = params.partnerId !== null && params.partnerId === own.id;
  const hitsOwnGroup =
    params.groupId !== null && own.group_id !== null && params.groupId === own.group_id;
  if (!hitsOwnPartner && !hitsOwnGroup) return;

  await writeAuditEntry({
    tenantId: params.tenantId,
    actorKind: "manager",
    actorUserId: params.userId,
    entity: "condition",
    entityId: own.id,
    action: "condition.self_approval_blocked",
    after: { attempted_action: params.attemptedAction },
  });
  throw new Error(SELF_DEALING);
}

/**
 * Der eingefrorene Rechenweg einer Zeile, die KEINE Kondition getroffen hat
 * (Handbuchung, Umbuchung ohne Treffer). Alle Felder aus dem Programm, damit
 * eine spätere Abo-Folgerate denselben Satz wiederfindet (5.7).
 */
function snapshotFromProgram(
  program: AffiliateProgramRow,
  resolution: { condition_id: string | null; source: "condition" | "program_default"; rate_kind: "percent" | "fixed"; rate_bp: number; fixed_cents: number },
): AffiliateConditionSnapshot {
  return {
    condition_id: resolution.condition_id,
    source: resolution.source,
    rate_kind: resolution.rate_kind,
    rate_bp: resolution.rate_bp,
    fixed_cents: resolution.fixed_cents,
    basis_kind: program.basis_kind,
    fee_deduction_bp: program.fee_deduction_bp,
    min_commission_cents: program.min_commission_cents,
    max_commission_cents: program.max_commission_cents,
    reserve_bp: program.reserve_bp,
    hold_days: program.hold_days,
    reserve_days: program.reserve_days,
    tier2_enabled: program.tier2_enabled,
    tier2_basis: program.tier2_basis,
    tier2_rate_bp: program.tier2_rate_bp,
  };
}

// =======================================================================
// 1. Programm-Einstellungen (/admin/affiliate/einstellungen)
// =======================================================================

/**
 * Legt die Programmzeile an oder schreibt sie fort.
 *
 * `terms_version` steht bewusst NICHT im Schema (siehe dort): die Fassung
 * steigt SERVERSEITIG, sobald sich `terms_text` ändert, und löst damit die
 * Neuzustimmung aller Partner aus (8.2, `/partner/bedingungen`). Ein Feld im
 * Formular ließe eine Änderung der Bedingungen ohne neue Zustimmung zu — und
 * genau darauf beruht die Durchsetzbarkeit der Programmregeln.
 *
 * `books_closed_until` wird nie geschrieben (G14). Der Wert entsteht
 * ausschließlich beim Erzeugen einer Gutschrift; über diesen Weg gesetzt
 * wäre er der Schalter, mit dem sich ein abgeschlossener Abrechnungszeitraum
 * wieder öffnen ließe.
 */
export async function saveAffiliateProgramSettings(
  _prevState: AffiliateProgramActionState,
  formData: FormData,
): Promise<AffiliateProgramActionState> {
  try {
    const { tenant, user } = await requireAffiliateManager();

    const parsed = affiliateProgramSettingsSchema.safeParse({
      status: text(formData, "status"),
      visibility: text(formData, "visibility"),
      approvalMode: text(formData, "approvalMode"),
      rateKind: text(formData, "rateKind"),
      rateBp: text(formData, "rateBp"),
      fixedCents: text(formData, "fixedCents"),
      minCommissionCents: formData.get("minCommissionCents"),
      maxCommissionCents: formData.get("maxCommissionCents"),
      basisKind: text(formData, "basisKind"),
      feeDeductionBp: text(formData, "feeDeductionBp"),
      currency: text(formData, "currency"),
      attributionModel: text(formData, "attributionModel"),
      cookieTtlDays: text(formData, "cookieTtlDays"),
      overwritePolicy: text(formData, "overwritePolicy"),
      lifetimeBinding: formData.get("lifetimeBinding"),
      selfReferral: text(formData, "selfReferral"),
      referrerBlocklist: formData.get("referrerBlocklist"),
      recurringMode: text(formData, "recurringMode"),
      recurringMaxPeriods: text(formData, "recurringMaxPeriods"),
      tier2Enabled: formData.get("tier2Enabled"),
      tier2Basis: text(formData, "tier2Basis"),
      tier2RateBp: text(formData, "tier2RateBp"),
      holdDays: text(formData, "holdDays"),
      reserveBp: text(formData, "reserveBp"),
      reserveDays: text(formData, "reserveDays"),
      minPayoutCents: text(formData, "minPayoutCents"),
      payoutSchedule: text(formData, "payoutSchedule"),
      descriptionMd: text(formData, "descriptionMd"),
      termsText: text(formData, "termsText"),
      applicationNote: text(formData, "applicationNote"),
      applicationFields: formData.get("applicationFields") ?? undefined,
      testMode: formData.get("testMode"),
    });
    if (!parsed.success) return { error: firstIssue(parsed.error) };
    const input = parsed.data;

    const admin = createAdminClient();
    const existing = await getAffiliateProgram(tenant.id);

    const columns = {
      status: input.status,
      visibility: input.visibility,
      approval_mode: input.approvalMode,
      rate_kind: input.rateKind,
      rate_bp: input.rateBp,
      fixed_cents: input.fixedCents,
      min_commission_cents: input.minCommissionCents,
      max_commission_cents: input.maxCommissionCents,
      basis_kind: input.basisKind,
      fee_deduction_bp: input.feeDeductionBp,
      currency: input.currency,
      attribution_model: input.attributionModel,
      cookie_ttl_days: input.cookieTtlDays,
      overwrite_policy: input.overwritePolicy,
      lifetime_binding: input.lifetimeBinding,
      self_referral: input.selfReferral,
      referrer_blocklist: input.referrerBlocklist,
      recurring_mode: input.recurringMode,
      recurring_max_periods: input.recurringMaxPeriods,
      tier2_enabled: input.tier2Enabled,
      tier2_basis: input.tier2Basis,
      tier2_rate_bp: input.tier2RateBp,
      hold_days: input.holdDays,
      reserve_bp: input.reserveBp,
      reserve_days: input.reserveDays,
      min_payout_cents: input.minPayoutCents,
      payout_schedule: input.payoutSchedule,
      description_md: input.descriptionMd,
      terms_text: input.termsText,
      application_note: input.applicationNote,
      application_fields: input.applicationFields,
      test_mode: input.testMode,
    };

    if (existing === null) {
      const { error } = await admin
        .from("affiliate_programs")
        .insert({ tenant_id: tenant.id, ...columns, terms_version: 1 });
      if (error) return { error: `Speichern fehlgeschlagen: ${translateDbError(error)}` };

      await writeAuditEntry({
        tenantId: tenant.id,
        actorKind: "manager",
        actorUserId: user.id,
        entity: "program",
        action: "program.create",
        after: columns,
      });
    } else {
      // Die Fassung steigt genau dann, wenn sich der Text ändert — nicht bei
      // jedem Speichern. Sonst müssten alle Partner nach jeder Änderung an
      // der Sperrfrist erneut zustimmen, und die Zustimmung verlöre ihren
      // Aussagewert.
      const termsChanged = existing.terms_text !== input.termsText;
      const nextTermsVersion = termsChanged ? existing.terms_version + 1 : existing.terms_version;

      const { error } = await admin
        .from("affiliate_programs")
        .update({ ...columns, terms_version: nextTermsVersion })
        .eq("tenant_id", tenant.id)
        .eq("id", existing.id);
      if (error) return { error: `Speichern fehlgeschlagen: ${translateDbError(error)}` };

      await writeAuditEntry({
        tenantId: tenant.id,
        actorKind: "manager",
        actorUserId: user.id,
        entity: "program",
        entityId: existing.id,
        action: "program.update",
        before: { ...existing },
        after: { ...columns, terms_version: nextTermsVersion },
      });
    }

    revalidatePath(AFFILIATE_PATH);
    revalidatePath(`${AFFILIATE_PATH}/einstellungen`);
    return { error: null, success: true };
  } catch (e) {
    return programState(e);
  }
}

// =======================================================================
// 2. Partner anlegen und einladen
// =======================================================================

/**
 * Gemeinsamer Rumpf von „anlegen" und „einladen". Der einzige Unterschied ist
 * der Anfangsstatus.
 */
async function insertPartner(params: {
  tenantId: string;
  userId: string;
  formData: FormData;
  status: "pending" | "active";
  action: "partner.create" | "partner.invite";
}): Promise<AffiliatePartnerActionState> {
  const parsed = affiliatePartnerCreateSchema.safeParse({
    applicantEmail: text(params.formData, "applicantEmail"),
    displayName: text(params.formData, "displayName"),
    company: params.formData.get("company"),
    code: text(params.formData, "code"),
    groupId: params.formData.get("groupId"),
    referredBy: params.formData.get("referredBy"),
    internalNote: params.formData.get("internalNote"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const input = parsed.data;

  const program = await getAffiliateProgram(params.tenantId);
  if (program === null) return { error: PROGRAM_MISSING };

  // Plan 11.15: beide client-gelieferten Fremd-IDs gegen den Mandanten, BEVOR
  // geschrieben wird. Ohne diese Prüfung schriebe der Admin-Client eine
  // Gruppe oder einen Werber aus einem fremden Mandanten in die Zeile — der
  // zusammengesetzte Fremdschlüssel fienge das zwar ab, aber erst am COMMIT
  // und mit einer Meldung, die niemand zuordnen kann.
  if (input.groupId !== null && !(await belongsToTenant("affiliate_groups", params.tenantId, input.groupId))) {
    return { error: GROUP_NOT_FOUND };
  }
  if (
    input.referredBy !== null &&
    !(await belongsToTenant("affiliate_partners", params.tenantId, input.referredBy))
  ) {
    return { error: PARTNER_NOT_FOUND };
  }

  // G15, zweite Linie im Anwendungscode: ein Manager, der selbst Partner ist,
  // trägt sich nicht als Werber einer neuen Partnerzeile ein — er bezöge
  // sonst Zweitstufen-Provision auf jemanden, den er nie geworben hat. Der
  // Guard-Trigger prüft dasselbe, kehrt unter `service_role` aber sofort
  // zurück; über den Admin-Client greift also nur diese Prüfung hier.
  if (input.referredBy !== null) {
    const own = await loadOwnPartner(params.tenantId, params.userId);
    if (own !== null && own.id === input.referredBy) {
      await writeAuditEntry({
        tenantId: params.tenantId,
        actorKind: "manager",
        actorUserId: params.userId,
        entity: "partner",
        entityId: own.id,
        action: "partner.self_approval_blocked",
        after: { attempted_action: params.action },
      });
      return { error: SELF_DEALING };
    }
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("affiliate_partners")
    .insert({
      tenant_id: params.tenantId,
      program_id: program.id,
      applicant_email: input.applicantEmail,
      display_name: input.displayName,
      company: input.company,
      code: input.code,
      status: params.status,
      group_id: input.groupId,
      referred_by: input.referredBy,
      internal_note: input.internalNote,
    })
    .select("id")
    .maybeSingle();
  if (error) {
    // `unique (tenant_id, code)` und `unique (tenant_id, program_id,
    // applicant_email)` (3.3) kommen beide als 23505 zurück; der Text bleibt
    // derselbe und nennt keinen Wert (CLAUDE.md §2.11).
    return { error: `Anlegen fehlgeschlagen: ${translateDbError(error)}` };
  }

  const partnerId = (data as { id: string } | null)?.id ?? null;

  await writeAuditEntry({
    tenantId: params.tenantId,
    actorKind: "manager",
    actorUserId: params.userId,
    entity: "partner",
    entityId: partnerId,
    action: params.action,
    after: {
      applicant_email: input.applicantEmail,
      display_name: input.displayName,
      company: input.company,
      code: input.code,
      status: params.status,
      group_id: input.groupId,
      referred_by: input.referredBy,
      internal_note: input.internalNote,
    },
  });

  revalidatePath(AFFILIATE_PATH);
  revalidatePath(`${AFFILIATE_PATH}/partner`);
  return { error: null, success: true, ...(partnerId === null ? {} : { partnerId }) };
}

/** Partner von Hand anlegen — immer als unbewertete Bewerbung (`pending`). */
export async function createAffiliatePartner(
  _prevState: AffiliatePartnerActionState,
  formData: FormData,
): Promise<AffiliatePartnerActionState> {
  try {
    const { tenant, user } = await requireAffiliateManager();
    return await insertPartner({
      tenantId: tenant.id,
      userId: user.id,
      formData,
      status: "pending",
      action: "partner.create",
    });
  } catch (e) {
    return partnerState(e);
  }
}

/**
 * Einladung mit Vorab-Freigabe (8.1, Einladungsformular): die Zeile entsteht
 * gleich als `active`, der Partner kann seinen Link sofort benutzen. Die
 * Einladungsmail selbst gehört zu Block B9; diese Funktion erzeugt die Zeile,
 * aus der der Link entsteht.
 *
 * G15 IN EINER FORM, DIE ES NUR HIER GIBT: „Vorab-Freigabe" ist eine
 * Freigabe. Lädt ein Manager sich selbst ein — also die Adresse, mit der er
 * angemeldet ist —, wäre das die eigene Bewerbung, die er selbst entscheidet,
 * und `assertNoSelfApproval()` käme nie zum Zug, weil es die Zeile noch nicht
 * gibt. Deshalb der Abgleich über die Anmeldeadresse. Er ist bewusst eng
 * (eine zweite Adresse desselben Menschen erkennt er nicht) und genau deshalb
 * nicht der einzige Schutz: sobald die Zeile ein Konto hat, greift der
 * reguläre G15-Pfad.
 */
export async function inviteAffiliatePartner(
  _prevState: AffiliatePartnerActionState,
  formData: FormData,
): Promise<AffiliatePartnerActionState> {
  try {
    const { tenant, user } = await requireAffiliateManager();

    const applicantEmail = text(formData, "applicantEmail").trim().toLowerCase();
    const actorEmail = (user.email ?? "").trim().toLowerCase();
    if (actorEmail.length > 0 && applicantEmail === actorEmail) {
      await writeAuditEntry({
        tenantId: tenant.id,
        actorKind: "manager",
        actorUserId: user.id,
        entity: "partner",
        action: "partner.self_approval_blocked",
        after: { attempted_action: "partner.invite" },
      });
      return { error: SELF_DEALING };
    }

    return await insertPartner({
      tenantId: tenant.id,
      userId: user.id,
      formData,
      status: "active",
      action: "partner.invite",
    });
  } catch (e) {
    return partnerState(e);
  }
}

// =======================================================================
// 3. Bewerbung freigeben, ablehnen, Partner sperren
// =======================================================================

/**
 * Gemeinsamer Rumpf der drei Statuswechsel. `status` kommt NICHT aus dem
 * Formular, sondern von der aufrufenden Funktion: sonst genügte ein
 * geändertes Hidden-Feld, um aus „ablehnen" ein „freigeben" zu machen.
 */
async function changePartnerStatus(params: {
  tenantId: string;
  userId: string;
  formData: FormData;
  status: "active" | "rejected" | "suspended";
  action: "partner.approve" | "partner.reject" | "partner.suspend";
}): Promise<AffiliatePartnerActionState> {
  const parsed = affiliatePartnerStatusSchema.safeParse({
    partnerId: text(params.formData, "partnerId"),
    status: params.status,
    reason: params.formData.get("reason"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const input = parsed.data;

  // SCHRITT 1, VOR ALLEM ANDEREN: Mandantenbindung der client-gelieferten ID.
  const admin = createAdminClient();
  const { data: existing, error: readError } = await admin
    .from("affiliate_partners")
    .select("id, status, status_reason, user_id, display_name, code")
    .eq("tenant_id", params.tenantId)
    .eq("id", input.partnerId)
    .maybeSingle();
  if (readError) {
    console.error(`[affiliate/actions] Partner lesen fehlgeschlagen (Code ${readError.code}).`);
    return { error: PARTNER_NOT_FOUND };
  }
  if (existing === null) return { error: PARTNER_NOT_FOUND };

  // SCHRITT 2: G15. Wirft mit demselben Text, den auch der Gruppenfall
  // benutzt, und schreibt den abgewiesenen Versuch ins Protokoll.
  await assertNoSelfApproval({
    tenantId: params.tenantId,
    userId: params.userId,
    partnerId: input.partnerId,
    entity: "partner",
    attemptedAction: params.action,
  });

  const row = existing as {
    id: string;
    status: string;
    status_reason: string | null;
    user_id: string | null;
  };

  const { error } = await admin
    .from("affiliate_partners")
    .update({ status: input.status, status_reason: input.reason })
    .eq("tenant_id", params.tenantId)
    .eq("id", input.partnerId);
  if (error) return { error: `Speichern fehlgeschlagen: ${translateDbError(error)}` };

  await writeAuditEntry({
    tenantId: params.tenantId,
    actorKind: "manager",
    actorUserId: params.userId,
    entity: "partner",
    entityId: input.partnerId,
    action: params.action,
    before: { status: row.status, status_reason: row.status_reason },
    after: { status: input.status, status_reason: input.reason },
  });

  revalidatePath(AFFILIATE_PATH);
  revalidatePath(`${AFFILIATE_PATH}/partner`);
  revalidatePath(`${AFFILIATE_PATH}/partner/${input.partnerId}`);
  return { error: null, success: true, partnerId: input.partnerId };
}

/** Bewerbung freigeben (`pending` → `active`). */
export async function approveAffiliatePartner(
  _prevState: AffiliatePartnerActionState,
  formData: FormData,
): Promise<AffiliatePartnerActionState> {
  try {
    const { tenant, user } = await requireAffiliateManager();
    return await changePartnerStatus({
      tenantId: tenant.id,
      userId: user.id,
      formData,
      status: "active",
      action: "partner.approve",
    });
  } catch (e) {
    return partnerState(e);
  }
}

/** Bewerbung ablehnen — Begründung ist Pflicht (Schema). */
export async function rejectAffiliatePartner(
  _prevState: AffiliatePartnerActionState,
  formData: FormData,
): Promise<AffiliatePartnerActionState> {
  try {
    const { tenant, user } = await requireAffiliateManager();
    return await changePartnerStatus({
      tenantId: tenant.id,
      userId: user.id,
      formData,
      status: "rejected",
      action: "partner.reject",
    });
  } catch (e) {
    return partnerState(e);
  }
}

/** Partner sperren — Begründung ist Pflicht (Schema). */
export async function suspendAffiliatePartner(
  _prevState: AffiliatePartnerActionState,
  formData: FormData,
): Promise<AffiliatePartnerActionState> {
  try {
    const { tenant, user } = await requireAffiliateManager();
    return await changePartnerStatus({
      tenantId: tenant.id,
      userId: user.id,
      formData,
      status: "suspended",
      action: "partner.suspend",
    });
  } catch (e) {
    return partnerState(e);
  }
}

// =======================================================================
// 4. Manager-Felder: Gruppe, Werber, Auszahlungssperre, interne Notiz
// =======================================================================

/**
 * Die Felder der Partnerseite, die nur ein Manager setzt (8.1: Aktionen
 * „Auszahlungssperre", „interne Notiz"). Auszahlungssperre und Gruppenwechsel
 * sind Entscheidungen über Geld und fallen deshalb ebenfalls unter G15 —
 * wortgleich zur Aufzählung im Guard-Trigger (`status`, `payout_hold`,
 * `group_id`).
 */
export async function saveAffiliatePartnerAdminFields(
  _prevState: AffiliatePartnerActionState,
  formData: FormData,
): Promise<AffiliatePartnerActionState> {
  try {
    const { tenant, user } = await requireAffiliateManager();

    const parsed = affiliatePartnerAdminSchema.safeParse({
      partnerId: text(formData, "partnerId"),
      groupId: formData.get("groupId"),
      referredBy: formData.get("referredBy"),
      payoutHold: formData.get("payoutHold"),
      payoutHoldReason: formData.get("payoutHoldReason"),
      internalNote: formData.get("internalNote"),
    });
    if (!parsed.success) return { error: firstIssue(parsed.error) };
    const input = parsed.data;

    const admin = createAdminClient();
    const { data: existing, error: readError } = await admin
      .from("affiliate_partners")
      .select("id, group_id, referred_by, payout_hold, payout_hold_reason, internal_note")
      .eq("tenant_id", tenant.id)
      .eq("id", input.partnerId)
      .maybeSingle();
    if (readError) {
      console.error(`[affiliate/actions] Partner lesen fehlgeschlagen (Code ${readError.code}).`);
      return { error: PARTNER_NOT_FOUND };
    }
    if (existing === null) return { error: PARTNER_NOT_FOUND };

    if (input.groupId !== null && !(await belongsToTenant("affiliate_groups", tenant.id, input.groupId))) {
      return { error: GROUP_NOT_FOUND };
    }
    if (
      input.referredBy !== null &&
      !(await belongsToTenant("affiliate_partners", tenant.id, input.referredBy))
    ) {
      return { error: PARTNER_NOT_FOUND };
    }

    await assertNoSelfApproval({
      tenantId: tenant.id,
      userId: user.id,
      partnerId: input.partnerId,
      entity: "partner",
      attemptedAction: "partner.update",
    });

    // Auch hier G15 auf der Werberseite (siehe insertPartner).
    if (input.referredBy !== null) {
      const own = await loadOwnPartner(tenant.id, user.id);
      if (own !== null && own.id === input.referredBy) {
        await writeAuditEntry({
          tenantId: tenant.id,
          actorKind: "manager",
          actorUserId: user.id,
          entity: "partner",
          entityId: own.id,
          action: "partner.self_approval_blocked",
          after: { attempted_action: "partner.update" },
        });
        return { error: SELF_DEALING };
      }
    }

    const { error } = await admin
      .from("affiliate_partners")
      .update({
        group_id: input.groupId,
        referred_by: input.referredBy,
        payout_hold: input.payoutHold,
        payout_hold_reason: input.payoutHold ? input.payoutHoldReason : null,
        internal_note: input.internalNote,
      })
      .eq("tenant_id", tenant.id)
      .eq("id", input.partnerId);
    if (error) return { error: `Speichern fehlgeschlagen: ${translateDbError(error)}` };

    await writeAuditEntry({
      tenantId: tenant.id,
      actorKind: "manager",
      actorUserId: user.id,
      entity: "partner",
      entityId: input.partnerId,
      action: "partner.update",
      before: { ...(existing as Record<string, unknown>) },
      after: {
        group_id: input.groupId,
        referred_by: input.referredBy,
        payout_hold: input.payoutHold,
        payout_hold_reason: input.payoutHold ? input.payoutHoldReason : null,
        internal_note: input.internalNote,
      },
    });

    revalidatePath(`${AFFILIATE_PATH}/partner/${input.partnerId}`);
    return { error: null, success: true, partnerId: input.partnerId };
  } catch (e) {
    return partnerState(e);
  }
}

// =======================================================================
// 5. Konditionen (/admin/affiliate/konditionen)
// =======================================================================

function parseConditionForm(formData: FormData) {
  return affiliateConditionSchema.safeParse({
    partnerId: formData.get("partnerId"),
    groupId: formData.get("groupId"),
    productId: formData.get("productId"),
    rateKind: text(formData, "rateKind"),
    rateBp: text(formData, "rateBp"),
    fixedCents: text(formData, "fixedCents"),
    validFrom: text(formData, "validFrom"),
    validTo: formData.get("validTo"),
    note: formData.get("note"),
  });
}

/** Die drei Geltungsbereiche gegen den Mandanten (11.15). */
async function checkConditionScope(
  tenantId: string,
  scope: { partnerId: string | null; groupId: string | null; productId: string | null },
): Promise<string | null> {
  if (scope.partnerId !== null && !(await belongsToTenant("affiliate_partners", tenantId, scope.partnerId))) {
    return PARTNER_NOT_FOUND;
  }
  if (scope.groupId !== null && !(await belongsToTenant("affiliate_groups", tenantId, scope.groupId))) {
    return GROUP_NOT_FOUND;
  }
  if (scope.productId !== null && !(await belongsToTenant("products", tenantId, scope.productId))) {
    return PRODUCT_NOT_FOUND;
  }
  return null;
}

export async function createAffiliateCondition(
  _prevState: AffiliateConditionActionState,
  formData: FormData,
): Promise<AffiliateConditionActionState> {
  try {
    const { tenant, user } = await requireAffiliateManager();

    const parsed = parseConditionForm(formData);
    if (!parsed.success) return { error: firstIssue(parsed.error) };
    const input = parsed.data;

    const program = await getAffiliateProgram(tenant.id);
    if (program === null) return { error: PROGRAM_MISSING };

    const scopeError = await checkConditionScope(tenant.id, input);
    if (scopeError !== null) return { error: scopeError };

    await assertNoSelfCondition({
      tenantId: tenant.id,
      userId: user.id,
      partnerId: input.partnerId,
      groupId: input.groupId,
      attemptedAction: "condition.create",
    });

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("affiliate_conditions")
      .insert({
        tenant_id: tenant.id,
        program_id: program.id,
        partner_id: input.partnerId,
        group_id: input.groupId,
        product_id: input.productId,
        rate_kind: input.rateKind,
        rate_bp: input.rateBp,
        fixed_cents: input.fixedCents,
        valid_from: input.validFrom,
        valid_to: input.validTo,
        note: input.note,
      })
      .select("id")
      .maybeSingle();
    if (error) {
      // Der Überschneidungsschutz der Datenbank meldet sich als 23505/23P01;
      // `translateDbError()` hat für beide einen deutschen Text.
      return { error: `Anlegen fehlgeschlagen: ${translateDbError(error)}` };
    }

    await writeAuditEntry({
      tenantId: tenant.id,
      actorKind: "manager",
      actorUserId: user.id,
      entity: "condition",
      entityId: (data as { id: string } | null)?.id ?? null,
      action: "condition.create",
      after: { ...input },
    });

    revalidatePath(`${AFFILIATE_PATH}/konditionen`);
    return { error: null, success: true };
  } catch (e) {
    return conditionState(e);
  }
}

/**
 * Kondition ändern. `valid_from` nagelt der Guard-Trigger für JEDE Rolle
 * fest — eine Korrektur des Beginns läuft als Löschen und Neuanlegen, also
 * als sichtbarer Vorgang mit eigenem Protokolleintrag. Der Wert wird hier
 * deshalb gar nicht erst mitgeschickt.
 */
export async function updateAffiliateCondition(
  _prevState: AffiliateConditionActionState,
  formData: FormData,
): Promise<AffiliateConditionActionState> {
  try {
    const { tenant, user } = await requireAffiliateManager();

    const conditionId = text(formData, "conditionId");
    const parsed = parseConditionForm(formData);
    if (!parsed.success) return { error: firstIssue(parsed.error) };
    const input = parsed.data;

    const admin = createAdminClient();
    const { data: existing, error: readError } = await admin
      .from("affiliate_conditions")
      .select("id, partner_id, group_id, product_id, rate_kind, rate_bp, fixed_cents, valid_from, valid_to, note")
      .eq("tenant_id", tenant.id)
      .eq("id", conditionId)
      .maybeSingle();
    if (readError) {
      console.error(`[affiliate/actions] Kondition lesen fehlgeschlagen (Code ${readError.code}).`);
      return { error: CONDITION_NOT_FOUND };
    }
    if (existing === null) return { error: CONDITION_NOT_FOUND };

    const scopeError = await checkConditionScope(tenant.id, input);
    if (scopeError !== null) return { error: scopeError };

    // BEIDE Seiten prüfen: die alte Kondition (sie könnte bereits die eigene
    // sein) und die neue (der Geltungsbereich darf nicht auf die eigene Zeile
    // gezogen werden).
    const old = existing as { partner_id: string | null; group_id: string | null };
    await assertNoSelfCondition({
      tenantId: tenant.id,
      userId: user.id,
      partnerId: old.partner_id,
      groupId: old.group_id,
      attemptedAction: "condition.update",
    });
    await assertNoSelfCondition({
      tenantId: tenant.id,
      userId: user.id,
      partnerId: input.partnerId,
      groupId: input.groupId,
      attemptedAction: "condition.update",
    });

    const { error } = await admin
      .from("affiliate_conditions")
      .update({
        partner_id: input.partnerId,
        group_id: input.groupId,
        product_id: input.productId,
        rate_kind: input.rateKind,
        rate_bp: input.rateBp,
        fixed_cents: input.fixedCents,
        valid_to: input.validTo,
        note: input.note,
      })
      .eq("tenant_id", tenant.id)
      .eq("id", conditionId);
    if (error) return { error: `Speichern fehlgeschlagen: ${translateDbError(error)}` };

    await writeAuditEntry({
      tenantId: tenant.id,
      actorKind: "manager",
      actorUserId: user.id,
      entity: "condition",
      entityId: conditionId,
      action: "condition.update",
      before: { ...(existing as Record<string, unknown>) },
      after: { ...input },
    });

    revalidatePath(`${AFFILIATE_PATH}/konditionen`);
    return { error: null, success: true };
  } catch (e) {
    return conditionState(e);
  }
}

/**
 * Kondition löschen. Bestehende Buchungen bleiben unberührt: sie tragen den
 * Rechenweg als `condition_snapshot` in der eigenen Zeile (G4), nicht als
 * Verweis auf diese Tabelle.
 */
export async function deleteAffiliateCondition(
  _prevState: AffiliateConditionActionState,
  formData: FormData,
): Promise<AffiliateConditionActionState> {
  try {
    const { tenant, user } = await requireAffiliateManager();

    const conditionId = text(formData, "conditionId");
    const admin = createAdminClient();
    const { data: existing, error: readError } = await admin
      .from("affiliate_conditions")
      .select("id, partner_id, group_id, product_id, rate_kind, rate_bp, fixed_cents, valid_from, valid_to")
      .eq("tenant_id", tenant.id)
      .eq("id", conditionId)
      .maybeSingle();
    if (readError) {
      console.error(`[affiliate/actions] Kondition lesen fehlgeschlagen (Code ${readError.code}).`);
      return { error: CONDITION_NOT_FOUND };
    }
    if (existing === null) return { error: CONDITION_NOT_FOUND };

    const old = existing as { partner_id: string | null; group_id: string | null };
    await assertNoSelfCondition({
      tenantId: tenant.id,
      userId: user.id,
      partnerId: old.partner_id,
      groupId: old.group_id,
      attemptedAction: "condition.delete",
    });

    const { error } = await admin
      .from("affiliate_conditions")
      .delete()
      .eq("tenant_id", tenant.id)
      .eq("id", conditionId);
    if (error) return { error: `Löschen fehlgeschlagen: ${translateDbError(error)}` };

    await writeAuditEntry({
      tenantId: tenant.id,
      actorKind: "manager",
      actorUserId: user.id,
      entity: "condition",
      entityId: conditionId,
      action: "condition.delete",
      before: { ...(existing as Record<string, unknown>) },
    });

    revalidatePath(`${AFFILIATE_PATH}/konditionen`);
    return { error: null, success: true };
  } catch (e) {
    return conditionState(e);
  }
}

// =======================================================================
// 6. Gruppen (3.4)
// =======================================================================

export async function createAffiliateGroup(
  _prevState: AffiliateGroupActionState,
  formData: FormData,
): Promise<AffiliateGroupActionState> {
  try {
    const { tenant, user } = await requireAffiliateManager();

    const parsed = affiliateGroupSchema.safeParse({ name: text(formData, "name") });
    if (!parsed.success) return { error: firstIssue(parsed.error) };

    const program = await getAffiliateProgram(tenant.id);
    if (program === null) return { error: PROGRAM_MISSING };

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("affiliate_groups")
      .insert({ tenant_id: tenant.id, program_id: program.id, name: parsed.data.name })
      .select("id")
      .maybeSingle();
    if (error) return { error: `Anlegen fehlgeschlagen: ${translateDbError(error)}` };

    const groupId = (data as { id: string } | null)?.id ?? null;

    await writeAuditEntry({
      tenantId: tenant.id,
      actorKind: "manager",
      actorUserId: user.id,
      entity: "group",
      entityId: groupId,
      action: "group.create",
      after: { name: parsed.data.name },
    });

    revalidatePath(`${AFFILIATE_PATH}/partner`);
    return { error: null, success: true, ...(groupId === null ? {} : { groupId }) };
  } catch (e) {
    return groupState(e);
  }
}

export async function renameAffiliateGroup(
  _prevState: AffiliateGroupActionState,
  formData: FormData,
): Promise<AffiliateGroupActionState> {
  try {
    const { tenant, user } = await requireAffiliateManager();

    const groupId = text(formData, "groupId");
    const parsed = affiliateGroupSchema.safeParse({ name: text(formData, "name") });
    if (!parsed.success) return { error: firstIssue(parsed.error) };

    const admin = createAdminClient();
    const { data: existing, error: readError } = await admin
      .from("affiliate_groups")
      .select("id, name")
      .eq("tenant_id", tenant.id)
      .eq("id", groupId)
      .maybeSingle();
    if (readError) {
      console.error(`[affiliate/actions] Gruppe lesen fehlgeschlagen (Code ${readError.code}).`);
      return { error: GROUP_NOT_FOUND };
    }
    if (existing === null) return { error: GROUP_NOT_FOUND };

    const { error } = await admin
      .from("affiliate_groups")
      .update({ name: parsed.data.name })
      .eq("tenant_id", tenant.id)
      .eq("id", groupId);
    if (error) return { error: `Speichern fehlgeschlagen: ${translateDbError(error)}` };

    await writeAuditEntry({
      tenantId: tenant.id,
      actorKind: "manager",
      actorUserId: user.id,
      entity: "group",
      entityId: groupId,
      action: "group.update",
      before: { name: (existing as { name: string }).name },
      after: { name: parsed.data.name },
    });

    revalidatePath(`${AFFILIATE_PATH}/partner`);
    return { error: null, success: true, groupId };
  } catch (e) {
    return groupState(e);
  }
}

/**
 * Gruppe löschen. Partner der Gruppe verlieren nur die Zuordnung
 * (`on delete set null`); Konditionen mit dieser `group_id` verschwinden über
 * dieselbe Kaskade — das ist der Grund, warum dieser Vorgang im Protokoll
 * steht.
 */
export async function deleteAffiliateGroup(
  _prevState: AffiliateGroupActionState,
  formData: FormData,
): Promise<AffiliateGroupActionState> {
  try {
    const { tenant, user } = await requireAffiliateManager();

    const groupId = text(formData, "groupId");
    const admin = createAdminClient();
    const { data: existing, error: readError } = await admin
      .from("affiliate_groups")
      .select("id, name")
      .eq("tenant_id", tenant.id)
      .eq("id", groupId)
      .maybeSingle();
    if (readError) {
      console.error(`[affiliate/actions] Gruppe lesen fehlgeschlagen (Code ${readError.code}).`);
      return { error: GROUP_NOT_FOUND };
    }
    if (existing === null) return { error: GROUP_NOT_FOUND };

    // G15: die eigene Gruppe aufzulösen ist dieselbe Entscheidung wie sie
    // aufzuwerten — beides verschiebt den eigenen Satz.
    await assertNoSelfCondition({
      tenantId: tenant.id,
      userId: user.id,
      partnerId: null,
      groupId,
      attemptedAction: "group.delete",
    });

    const { error } = await admin
      .from("affiliate_groups")
      .delete()
      .eq("tenant_id", tenant.id)
      .eq("id", groupId);
    if (error) return { error: `Löschen fehlgeschlagen: ${translateDbError(error)}` };

    await writeAuditEntry({
      tenantId: tenant.id,
      actorKind: "manager",
      actorUserId: user.id,
      entity: "group",
      entityId: groupId,
      action: "group.delete",
      before: { name: (existing as { name: string }).name },
    });

    revalidatePath(`${AFFILIATE_PATH}/partner`);
    return { error: null, success: true };
  } catch (e) {
    return groupState(e);
  }
}

// =======================================================================
// 7. Handbuchung (11.17)
// =======================================================================

/**
 * Ab diesem Betrag verlangt eine Handbuchung eine zweite, ausgeschriebene
 * Bestätigung (Plan 11.17: „eine Handbuchung über 500 € erfordert eine zweite
 * Bestätigung mit ausgeschriebenem Betrag"). Ohne diese Grenze könnte ein
 * übernommenes Händler-Konto in einer Sitzung beliebig hohe Provisionen
 * buchen und auszahlungsreif machen.
 */
const AFFILIATE_MANUAL_CONFIRM_THRESHOLD_CENTS = 50_000;

/**
 * Handbuchung mit Pflichtbegründung (`check (kind <> 'manual' or note is not
 * null)`, 3.11; das Schema verlangt zusätzlich mindestens fünf Zeichen).
 *
 * Der Betrag darf negativ sein: eine Korrektur oder eine vereinbarte Kürzung
 * entsteht so, ohne eine bestehende Zeile anzufassen (G4 — Zeilen sind
 * unveränderlich).
 *
 * Die Frist folgt dem Vorzeichen, und das ist eine bewusste Entscheidung
 * (CLAUDE.md §4.5, der Plan schweigt dazu): eine GUTSCHRIFT bekommt die
 * reguläre Sperrfrist des Programms wie ein Verkauf — sonst wäre die
 * Handbuchung der Weg, die Sperrfrist zu umgehen. Eine SCHULD (negativer
 * Betrag) wird sofort fällig, damit sie die nächste Auszahlung mindert und
 * nicht erst in 30 Tagen; das ist dieselbe Regel, nach der eine Gegenbuchung
 * zu einer bereits freigegebenen Zeile sofort `approved` wird (G6).
 *
 * Gebucht wird über `book_affiliate_commissions(jsonb)` und nicht per
 * `insert`: die RPC hält die Sperre, prüft die Mandantenbindung von
 * `program_id` und `partner_id` ein zweites Mal serverseitig nach (11.15) und
 * ist über `unique (tenant_id, dedup_key)` idempotent (G3). Ein Doppelklick
 * auf „Buchen" erzeugt damit keine zweite Zeile.
 */
export async function createAffiliateManualBooking(
  _prevState: AffiliateCommissionActionState,
  formData: FormData,
): Promise<AffiliateCommissionActionState> {
  try {
    const { tenant, user } = await requireAffiliateManager();

    const parsed = affiliateManualBookingSchema.safeParse({
      partnerId: text(formData, "partnerId"),
      amountEuro: text(formData, "amountEuro"),
      currency: text(formData, "currency"),
      note: text(formData, "note"),
    });
    if (!parsed.success) return { error: firstIssue(parsed.error) };
    const input = parsed.data;

    const program = await getAffiliateProgram(tenant.id);
    if (program === null) return { error: PROGRAM_MISSING };

    // SCHRITT 1: Mandantenbindung der client-gelieferten Partner-ID.
    if (!(await belongsToTenant("affiliate_partners", tenant.id, input.partnerId))) {
      return { error: PARTNER_NOT_FOUND };
    }

    // SCHRITT 2: G15 — keine Handbuchung auf die eigene Partnerzeile.
    await assertNoSelfApproval({
      tenantId: tenant.id,
      userId: user.id,
      partnerId: input.partnerId,
      entity: "commission",
      attemptedAction: "commission.manual",
    });

    // SCHRITT 3: die zweite Bestätigung über der Grenze (11.17). Verlangt wird
    // der Betrag ein zweites Mal in Worten des Formulars — eine Checkbox
    // wäre mit demselben Klick abgehakt, mit dem der Betrag falsch steht.
    if (Math.abs(input.amountCents) > AFFILIATE_MANUAL_CONFIRM_THRESHOLD_CENTS) {
      const confirmed = affiliateManualBookingSchema.safeParse({
        partnerId: input.partnerId,
        amountEuro: text(formData, "confirmAmountEuro"),
        currency: input.currency,
        note: input.note,
      });
      if (!confirmed.success || confirmed.data.amountCents !== input.amountCents) {
        return {
          error:
            "Bitte den Betrag zur Bestätigung ein zweites Mal eingeben — er muss genau übereinstimmen.",
        };
      }
    }

    const now = new Date();
    const holdUntil =
      input.amountCents < 0 ? now : addDays(now, program.hold_days);

    const dedupKey = buildDedupKey({ kind: "manual", unique_id: crypto.randomUUID() });

    const admin = createAdminClient();
    const { data, error } = await admin.rpc("book_affiliate_commissions", {
      p_payload: {
        tenant_id: tenant.id,
        program_id: program.id,
        lock_key: dedupKey,
        rows: [
          {
            ref: "manual",
            kind: "manual",
            partner_id: input.partnerId,
            parent_ref: null,
            order_id: null,
            stripe_invoice_id: null,
            stripe_subscription_id: null,
            stripe_charge_id: null,
            product_id: null,
            campaign: null,
            referral_id: null,
            parent_id: null,
            base_cents: 0,
            basis_kind: program.basis_kind,
            rate_kind: "fixed",
            rate_bp: 0,
            fixed_cents: Math.abs(input.amountCents),
            amount_cents: input.amountCents,
            currency: input.currency,
            condition_id: null,
            condition_snapshot: snapshotFromProgram(program, {
              condition_id: null,
              source: "program_default",
              rate_kind: "fixed",
              rate_bp: 0,
              fixed_cents: Math.abs(input.amountCents),
            }),
            status: "pending",
            cancel_reason: null,
            hold_until: holdUntil.toISOString(),
            flagged: false,
            flag_reason: null,
            is_test: false,
            note: input.note,
            dedup_key: dedupKey,
          },
        ],
      },
    });
    if (error) {
      console.error(`[affiliate/actions] Handbuchung fehlgeschlagen (Code ${error.code}).`);
      return { error: `Buchen fehlgeschlagen: ${translateDbError(error)}` };
    }

    const booked = (data as { rows?: Array<{ id: string }> } | null)?.rows ?? [];
    const commissionId = booked[0]?.id ?? null;

    await writeAuditEntry({
      tenantId: tenant.id,
      actorKind: "manager",
      actorUserId: user.id,
      entity: "commission",
      entityId: commissionId,
      action: "commission.manual",
      after: {
        partner_id: input.partnerId,
        amount_cents: input.amountCents,
        currency: input.currency,
        hold_until: holdUntil.toISOString(),
        note: input.note,
        dedup_key: dedupKey,
      },
    });

    revalidatePath(`${AFFILIATE_PATH}/provisionen`);
    revalidatePath(`${AFFILIATE_PATH}/partner/${input.partnerId}`);
    return { error: null, success: true, ...(commissionId === null ? {} : { commissionId }) };
  } catch (e) {
    return commissionState(e);
  }
}

// =======================================================================
// 8. Umbuchung (4.6)
// =======================================================================

/**
 * Präfix der Umbuchungs-Schlüssel, wörtlich aus 4.6:
 * `'sale:' || order_id || ':r' || <lfd>`.
 *
 * ABSICHTLICH NICHT über `buildDedupKey()`: dessen `sale`-Form ist
 * `sale:<order_id>` und damit per Definition der Schlüssel der
 * URSPRÜNGLICHEN Buchung. Eine Umbuchung braucht einen eigenen, und der Plan
 * gibt seine Form vor. Die laufende Nummer kommt aus den bereits vorhandenen
 * Zeilen derselben Bestellung; zwei gleichzeitige Umbuchungen derselben
 * Bestellung liefen damit auf denselben Schlüssel — das fängt
 * `unique (tenant_id, dedup_key)` unter der Sperre der RPC ab, und die zweite
 * Umbuchung meldet „existiert bereits" statt doppelt zu buchen (G3).
 */
function reassignDedupKey(orderId: string, sequence: number): string {
  return `sale:${orderId}:r${sequence}`;
}

/**
 * Umbuchung einer Bestellung auf einen anderen Partner (4.6) — der einzige
 * Grund, warum diese Funktion existiert: jeder Attributionsstreit soll ohne
 * Datenbankeingriff lösbar sein.
 *
 * Drei Schritte, exakt in dieser Reihenfolge:
 *
 *   1. `pending`/`on_hold` → `cancelled` mit `cancel_reason='reassigned'`.
 *      Das ist der einzige Fall, in dem eine Zeile ihren Status verliert,
 *      ohne dass Geld geflossen ist.
 *   2. `approved`/`paid` → GEGENBUCHUNG über den vollen Rest (G6). Der Status
 *      der Ursprungszeile bleibt unangetastet: würde man sie zusätzlich
 *      abschreiben, fiele sie aus dem Saldo und die negative Zeile zöge
 *      denselben Betrag ein zweites Mal ab.
 *   3. Bei gesetztem `newPartnerId` entsteht EINE neue Zeile. Der Plan sagt
 *      ausdrücklich „eine neue Zeile" — der Sicherheitseinbehalt (G5) ist
 *      Teil des automatischen Buchungspfades und wird hier nicht nachgebaut;
 *      er hätte auch keine Schlüsselform, die 4.6 vorgibt.
 *
 * Der Satz der neuen Zeile wird für den NEUEN Partner frisch aufgelöst
 * (`resolveCondition` + `computeCommissionParts`, dieselben reinen Funktionen
 * wie im Verarbeiter) — die Kondition des alten Partners zu übernehmen wäre
 * eine Provision, die es für diesen Partner nie gab.
 *
 * Begründung ist Pflicht (Schema, mindestens fünf Zeichen); sie steht in
 * `note` der neuen Zeile und im Protokolleintrag mit `before`/`after`.
 */
export async function reassignAffiliateOrder(
  _prevState: AffiliateCommissionActionState,
  formData: FormData,
): Promise<AffiliateCommissionActionState> {
  try {
    const { tenant, user } = await requireAffiliateManager();

    const parsed = affiliateReassignSchema.safeParse({
      orderId: text(formData, "orderId"),
      newPartnerId: formData.get("newPartnerId"),
      reason: text(formData, "reason"),
    });
    if (!parsed.success) return { error: firstIssue(parsed.error) };
    const input = parsed.data;

    const program = await getAffiliateProgram(tenant.id);
    if (program === null) return { error: PROGRAM_MISSING };

    // SCHRITT 1: beide client-gelieferten IDs gegen den Mandanten.
    const admin = createAdminClient();
    const { data: order, error: orderError } = await admin
      .from("orders")
      .select("id, tenant_id, product_id, amount_cents, currency")
      .eq("tenant_id", tenant.id)
      .eq("id", input.orderId)
      .maybeSingle();
    if (orderError) {
      console.error(`[affiliate/actions] Bestellung lesen fehlgeschlagen (Code ${orderError.code}).`);
      return { error: ORDER_NOT_FOUND };
    }
    if (order === null) return { error: ORDER_NOT_FOUND };

    if (input.newPartnerId !== null) {
      if (!(await belongsToTenant("affiliate_partners", tenant.id, input.newPartnerId))) {
        return { error: PARTNER_NOT_FOUND };
      }
      // SCHRITT 2: G15 — eine Bestellung auf die eigene Partnerzeile
      // umzubuchen ist die Entscheidung über eigenes Geld schlechthin.
      await assertNoSelfApproval({
        tenantId: tenant.id,
        userId: user.id,
        partnerId: input.newPartnerId,
        entity: "commission",
        attemptedAction: "commission.reassign",
      });
    }

    const { data: rowsData, error: rowsError } = await admin
      .from("affiliate_commissions")
      .select(
        "id, partner_id, kind, status, amount_cents, currency, hold_until, is_test, base_cents, " +
          "basis_kind, product_id, campaign, referral_id, dedup_key",
      )
      .eq("tenant_id", tenant.id)
      .eq("order_id", input.orderId)
      .order("id", { ascending: true });
    if (rowsError) {
      console.error(`[affiliate/actions] Buchungen lesen fehlgeschlagen (Code ${rowsError.code}).`);
      return { error: `Umbuchen fehlgeschlagen: ${translateDbError(rowsError)}` };
    }

    type ExistingRow = {
      id: string;
      partner_id: string;
      kind: string;
      status: string;
      amount_cents: number;
      currency: string;
      hold_until: string;
      is_test: boolean;
      base_cents: number;
      basis_kind: "net" | "gross";
      product_id: string | null;
      campaign: string | null;
      referral_id: string | null;
      dedup_key: string;
    };
    const existingRows = (rowsData ?? []) as unknown as ExistingRow[];

    const now = new Date();
    const sequence =
      existingRows.filter((row) => row.dedup_key.startsWith(`sale:${input.orderId}:r`)).length + 1;

    // --- Schritt 1: offene Zeilen stornieren ---------------------------
    let cancelled = 0;
    for (const row of existingRows) {
      if (row.status !== "pending" && row.status !== "on_hold") continue;
      const { error } = await admin
        .from("affiliate_commissions")
        .update({ status: "cancelled", cancel_reason: "reassigned" })
        .eq("tenant_id", tenant.id)
        .eq("id", row.id)
        // Compare-and-Swap: hat der Freigabelauf die Zeile zwischenzeitlich
        // auf `approved` gehoben, greift dieses Update nicht mehr — und die
        // Zeile fällt unten in den Gegenbuchungspfad statt still in einen
        // unmöglichen Statuswechsel zu laufen.
        .in("status", ["pending", "on_hold"]);
      if (error) {
        console.error(`[affiliate/actions] Stornieren fehlgeschlagen (Code ${error.code}).`);
        return { error: `Umbuchen fehlgeschlagen: ${translateDbError(error)}` };
      }
      cancelled += 1;
    }

    // --- Schritt 2: gebuchte Zeilen gegenbuchen ------------------------
    const REVERSIBLE = ["sale", "reserve", "recurring", "recurring_reserve", "tier2"];
    const reversalRows = existingRows
      .filter(
        (row) =>
          !row.is_test &&
          REVERSIBLE.includes(row.kind) &&
          (row.status === "approved" || row.status === "paid") &&
          row.amount_cents > 0,
      )
      .map((row) => ({
        reverses_id: row.id,
        // Der ZIELWERT ist der volle Betrag: die Zuordnung entfällt ganz, es
        // gibt keinen Teilbetrag, der beim alten Partner bliebe. Die Differenz
        // zum bereits Gegengebuchten zieht die RPC unter der Sperre selbst.
        target_cents: row.amount_cents,
        // G6: eine Gegenbuchung zu einer bereits freigegebenen Zeile ist
        // sofort fällig, damit die Schuld die nächste Auszahlung mindert.
        status: "approved" as const,
        hold_until: now.toISOString(),
        note: `Umbuchung: ${input.reason}`,
        stripe_charge_id: null,
        dedup_key: buildDedupKey({
          kind: "reversal",
          reverses_id: row.id,
          source_id: `reassign:${input.orderId}:r${sequence}`,
          refunded_total_cents: row.amount_cents,
        }),
      }));

    let reversed = 0;
    if (reversalRows.length > 0) {
      const { data: reversalResult, error } = await admin.rpc("book_affiliate_reversals", {
        p_payload: {
          tenant_id: tenant.id,
          lock_key: `order:${input.orderId}`,
          rows: reversalRows,
        },
      });
      if (error) {
        console.error(`[affiliate/actions] Gegenbuchung fehlgeschlagen (Code ${error.code}).`);
        return { error: `Umbuchen fehlgeschlagen: ${translateDbError(error)}` };
      }
      reversed = (reversalResult as { booked?: number } | null)?.booked ?? 0;
    }

    // --- Schritt 3: neue Zeile für den neuen Partner -------------------
    let commissionId: string | null = null;
    if (input.newPartnerId !== null) {
      const { data: partnerData, error: partnerError } = await admin
        .from("affiliate_partners")
        .select("id, group_id")
        .eq("tenant_id", tenant.id)
        .eq("id", input.newPartnerId)
        .maybeSingle();
      if (partnerError || partnerData === null) return { error: PARTNER_NOT_FOUND };
      const newPartner = partnerData as { id: string; group_id: string | null };

      // Die Bemessungsgrundlage der ursprünglichen Zuordnung, sofern es eine
      // gab — sie ist der eingefrorene, tatsächlich vereinnahmte Betrag (G13).
      // Ohne Vorgängerzeile wird sie aus der Bestellung gerechnet; die
      // Steueraufteilung ist dort nicht bekannt, das steht als Hinweis in der
      // Oberfläche.
      const template = existingRows.find((row) => row.kind === "sale") ?? null;
      const base =
        template !== null
          ? { base_cents: template.base_cents, basis_kind: template.basis_kind }
          : {
              base_cents: computeBaseCents({
                gross_cents: (order as { amount_cents: number | null }).amount_cents ?? 0,
                tax_cents: 0,
                shipping_cents: 0,
                basis_kind: program.basis_kind,
                fee_deduction_bp: program.fee_deduction_bp,
              }).base_cents,
              basis_kind: program.basis_kind,
            };

      const productId =
        template?.product_id ?? (order as { product_id: string | null }).product_id ?? null;
      const currency =
        template?.currency ?? (order as { currency: string | null }).currency ?? program.currency;

      const conditions = await listAffiliateConditions(tenant.id);
      const resolution = resolveCondition(
        conditions.map((row) => ({
          id: row.id,
          partner_id: row.partner_id,
          group_id: row.group_id,
          product_id: row.product_id,
          rate_kind: row.rate_kind,
          rate_bp: row.rate_bp,
          fixed_cents: row.fixed_cents,
          valid_from: row.valid_from,
          valid_to: row.valid_to,
        })),
        { partner_id: newPartner.id, group_id: newPartner.group_id, product_id: productId, at: now },
        { rate_kind: program.rate_kind, rate_bp: program.rate_bp, fixed_cents: program.fixed_cents },
      );

      const parts = computeCommissionParts({
        base_cents: base.base_cents,
        rate_kind: resolution.rate_kind,
        rate_bp: resolution.rate_bp,
        fixed_cents: resolution.fixed_cents,
        min_commission_cents: program.min_commission_cents,
        max_commission_cents: program.max_commission_cents,
        // Kein Sicherheitseinbehalt: es entsteht genau EINE Zeile (4.6).
        reserve_bp: 0,
      });

      const dedupKey = reassignDedupKey(input.orderId, sequence);
      const { data: bookData, error: bookError } = await admin.rpc("book_affiliate_commissions", {
        p_payload: {
          tenant_id: tenant.id,
          program_id: program.id,
          lock_key: `order:${input.orderId}`,
          rows: [
            {
              ref: "reassign",
              kind: "sale",
              partner_id: newPartner.id,
              parent_ref: null,
              order_id: input.orderId,
              stripe_invoice_id: null,
              stripe_subscription_id: null,
              stripe_charge_id: null,
              product_id: productId,
              campaign: template?.campaign ?? null,
              // Die Referral-Zeile gehört zum ALTEN Partner; sie an die neue
              // Buchung zu hängen wäre ein falscher Beleg.
              referral_id: null,
              parent_id: null,
              base_cents: base.base_cents,
              basis_kind: base.basis_kind,
              rate_kind: resolution.rate_kind,
              rate_bp: resolution.rate_bp,
              fixed_cents: resolution.fixed_cents,
              amount_cents: parts.amount_cents,
              currency,
              condition_id: resolution.condition_id,
              condition_snapshot: snapshotFromProgram(program, resolution),
              status: "pending",
              cancel_reason: null,
              hold_until: addDays(now, program.hold_days).toISOString(),
              flagged: parts.flagged,
              flag_reason: parts.flag_reason,
              is_test: false,
              note: `Umbuchung: ${input.reason}`,
              dedup_key: dedupKey,
            },
          ],
        },
      });
      if (bookError) {
        console.error(`[affiliate/actions] Umbuchung fehlgeschlagen (Code ${bookError.code}).`);
        return { error: `Umbuchen fehlgeschlagen: ${translateDbError(bookError)}` };
      }
      commissionId = (bookData as { rows?: Array<{ id: string }> } | null)?.rows?.[0]?.id ?? null;
    }

    await writeAuditEntry({
      tenantId: tenant.id,
      actorKind: "manager",
      actorUserId: user.id,
      entity: "commission",
      entityId: commissionId,
      action: "commission.reassign",
      before: {
        order_id: input.orderId,
        rows: existingRows.map((row) => ({
          id: row.id,
          partner_id: row.partner_id,
          kind: row.kind,
          status: row.status,
          amount_cents: row.amount_cents,
        })),
      },
      after: {
        order_id: input.orderId,
        new_partner_id: input.newPartnerId,
        cancelled,
        reversed,
        sequence,
        reason: input.reason,
      },
    });

    revalidatePath(`${AFFILIATE_PATH}/provisionen`);
    return { error: null, success: true, ...(commissionId === null ? {} : { commissionId }) };
  } catch (e) {
    return commissionState(e);
  }
}

// =======================================================================
// 9. Markierung setzen und lösen (6.3)
// =======================================================================

/**
 * `flagged`/`flag_reason` sind zwei der wenigen Spalten, die der
 * Unveränderlichkeits-Guard offen lässt (G4). Das Lösen einer Markierung an
 * der EIGENEN Zeile nennt G15 ausdrücklich — deshalb steht
 * `assertNoSelfApproval()` auch hier.
 */
export async function setAffiliateCommissionFlag(
  _prevState: AffiliateCommissionActionState,
  formData: FormData,
): Promise<AffiliateCommissionActionState> {
  try {
    const { tenant, user } = await requireAffiliateManager();

    const parsed = affiliateCommissionFlagSchema.safeParse({
      commissionId: text(formData, "commissionId"),
      flagged: formData.get("flagged"),
      reason: formData.get("reason"),
    });
    if (!parsed.success) return { error: firstIssue(parsed.error) };
    const input = parsed.data;

    const admin = createAdminClient();
    const { data: existing, error: readError } = await admin
      .from("affiliate_commissions")
      .select("id, partner_id, flagged, flag_reason")
      .eq("tenant_id", tenant.id)
      .eq("id", input.commissionId)
      .maybeSingle();
    if (readError) {
      console.error(`[affiliate/actions] Buchung lesen fehlgeschlagen (Code ${readError.code}).`);
      return { error: COMMISSION_NOT_FOUND };
    }
    if (existing === null) return { error: COMMISSION_NOT_FOUND };
    const row = existing as { partner_id: string; flagged: boolean; flag_reason: string | null };

    await assertNoSelfApproval({
      tenantId: tenant.id,
      userId: user.id,
      partnerId: row.partner_id,
      entity: "commission",
      attemptedAction: input.flagged ? "commission.flag" : "commission.unflag",
    });

    const { error } = await admin
      .from("affiliate_commissions")
      .update({ flagged: input.flagged, flag_reason: input.flagged ? input.reason : null })
      .eq("tenant_id", tenant.id)
      .eq("id", input.commissionId);
    if (error) return { error: `Speichern fehlgeschlagen: ${translateDbError(error)}` };

    await writeAuditEntry({
      tenantId: tenant.id,
      actorKind: "manager",
      actorUserId: user.id,
      entity: "commission",
      entityId: input.commissionId,
      action: input.flagged ? "commission.flag" : "commission.unflag",
      before: { flagged: row.flagged, flag_reason: row.flag_reason },
      after: { flagged: input.flagged, flag_reason: input.flagged ? input.reason : null },
    });

    revalidatePath(`${AFFILIATE_PATH}/provisionen`);
    return { error: null, success: true };
  } catch (e) {
    return commissionState(e);
  }
}

// =======================================================================
// 10. Entscheidung über eine Zeile in Prüfung (6.3)
// =======================================================================

/**
 * `on_hold` → `approved` oder `cancelled`, und `pending` → `cancelled`
 * (8.1: Aktion „Stornieren"). Die erlaubten Kanten stehen in der Datenbank
 * (`affiliate_commission_status_transition_forbidden`) und werden hier
 * vorweggenommen, damit der Mensch eine verständliche Meldung sieht statt
 * eines rohen Constraint-Fehlers.
 *
 * Die Begründung geht ins Protokoll und NICHT in `note`: `note` ist bei
 * `manual` und `reversal` der Beleg und vom Guard festgenagelt (K11) — eine
 * Begründung, die je nach Buchungsart mal ankommt und mal nicht, wäre
 * schlimmer als gar keine.
 */
export async function decideAffiliateCommission(
  _prevState: AffiliateCommissionActionState,
  formData: FormData,
): Promise<AffiliateCommissionActionState> {
  try {
    const { tenant, user } = await requireAffiliateManager();

    const parsed = affiliateCommissionDecisionSchema.safeParse({
      commissionId: text(formData, "commissionId"),
      decision: text(formData, "decision"),
      cancelReason: formData.get("cancelReason") ?? undefined,
      reason: text(formData, "reason"),
    });
    if (!parsed.success) return { error: firstIssue(parsed.error) };
    const input = parsed.data;

    const admin = createAdminClient();
    const { data: existing, error: readError } = await admin
      .from("affiliate_commissions")
      .select("id, partner_id, status, cancel_reason")
      .eq("tenant_id", tenant.id)
      .eq("id", input.commissionId)
      .maybeSingle();
    if (readError) {
      console.error(`[affiliate/actions] Buchung lesen fehlgeschlagen (Code ${readError.code}).`);
      return { error: COMMISSION_NOT_FOUND };
    }
    if (existing === null) return { error: COMMISSION_NOT_FOUND };
    const row = existing as { partner_id: string; status: string; cancel_reason: string | null };

    await assertNoSelfApproval({
      tenantId: tenant.id,
      userId: user.id,
      partnerId: row.partner_id,
      entity: "commission",
      attemptedAction: `commission.${input.decision === "approved" ? "approve" : "cancel"}`,
    });

    const allowed =
      (input.decision === "approved" && (row.status === "on_hold" || row.status === "pending")) ||
      (input.decision === "cancelled" && (row.status === "on_hold" || row.status === "pending"));
    if (!allowed) {
      return { error: "Diese Buchung lässt sich in ihrem aktuellen Zustand nicht mehr ändern." };
    }

    const { error } = await admin
      .from("affiliate_commissions")
      .update(
        input.decision === "approved"
          ? { status: "approved" }
          : { status: "cancelled", cancel_reason: input.cancelReason },
      )
      .eq("tenant_id", tenant.id)
      .eq("id", input.commissionId)
      // Compare-and-Swap gegen den Freigabelauf, der zwischen Lesen und
      // Schreiben denselben Zustand verändert haben kann.
      .in("status", ["pending", "on_hold"]);
    if (error) return { error: `Speichern fehlgeschlagen: ${translateDbError(error)}` };

    await writeAuditEntry({
      tenantId: tenant.id,
      actorKind: "manager",
      actorUserId: user.id,
      entity: "commission",
      entityId: input.commissionId,
      action: `commission.${input.decision === "approved" ? "approve" : "cancel"}`,
      before: { status: row.status, cancel_reason: row.cancel_reason },
      after: {
        status: input.decision,
        cancel_reason: input.decision === "cancelled" ? input.cancelReason : null,
        reason: input.reason,
      },
    });

    revalidatePath(`${AFFILIATE_PATH}/provisionen`);
    return { error: null, success: true };
  } catch (e) {
    return commissionState(e);
  }
}
