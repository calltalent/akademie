import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getFormatter, getTranslations } from "next-intl/server";
import {
  assertNoSelfApproval,
  checkAffiliateManagerAccess,
  requireAffiliateManager,
} from "@/lib/affiliate/access";
import { writeAuditEntry } from "@/lib/affiliate/audit";
import {
  affiliateCreditNotePath,
  generateAffiliateCreditNotePdf,
} from "@/lib/affiliate/credit-note";
import {
  countPendingReversals,
  hasUnquarantinedCriticalFinding,
  verifyAffiliateIntegrity,
} from "@/lib/affiliate/integrity";
import {
  AFFILIATE_PAYOUT_MAX_PERIOD_MONTHS,
  approveAffiliatePayout,
  checkAffiliatePayoutPeriodBounds,
  createAffiliatePayoutDrafts,
  markAffiliatePayoutFailed,
  markAffiliatePayoutPaid,
  planAffiliatePayoutRun,
  resolveAffiliatePayoutPeriod,
  resolveTenantVatId,
} from "@/lib/affiliate/payout";
import { getAffiliateProgram, listAffiliatePartners } from "@/lib/affiliate/queries";
import { isValidIban } from "@/lib/affiliate/sepa";
import { taxHintForMode } from "@/lib/affiliate/tax";
import {
  AFFILIATE_PAYOUT_EXPECTED_PATTERN,
  parseAffiliatePayoutExpected,
  type AffiliatePayoutActionState,
} from "@/lib/affiliate/state";
import type {
  AffiliateEntityKind,
  AffiliatePayoutMethod,
  AffiliateTaxMode,
  AffiliateVatCheckResult,
} from "@/lib/affiliate/types";
import { resolveLegalEntity } from "@/lib/legal/company";
import { createAdminClient } from "@/lib/supabase/admin";
import { genericErrorMessage } from "@/lib/errors/generic";

import {
  AffiliateAccessNotice,
  AffiliateProgramMissing,
  AffiliateShell,
} from "../affiliate-shell";
import {
  CARD_BORDER,
  CARD_CLASS,
  FOCUS_RING,
  INK,
  MUTED,
  NAVY,
  centsToAmount,
  currencyCode,
} from "../affiliate-format";
import {
  PayoutList,
  PayoutRunForm,
  type PayoutRowView,
  type PayoutStatus,
} from "./lauf-form";

/**
 * Affiliate-System, Block B8-C — `/admin/affiliate/auszahlungen`
 * (PLAN_Affiliate-System.md 7.1 bis 7.7, 8.1 Zeile 6, 8.5, 11.15, 11.17;
 * CLAUDE.md §2.9, §2.11, §2.15).
 *
 * Zweck laut Plan: „Geld bewegen, ohne etwas zu übersehen."
 *
 * ## DIE VIER SCHRITTE UND IHRE REIHENFOLGE
 *
 *   Entwurf (7.1) → Prüfung und Freigabe (7.2) → Export (7.7) → bezahlt (7.7).
 *
 * Jeder Schritt hat auf dieser Seite genau eine Bedienstelle, und keiner ist
 * überspringbar: ein Satz ohne Belegnummer wird nicht exportiert, ein Satz
 * ohne Export kann als gezahlt markiert werden (Überweisung per Hand ist ein
 * gültiger Weg), aber ein Entwurf nicht. Die verbindliche Grenze zieht in
 * jedem Fall die Datenbank — `affiliate_payouts_guard()` lässt einen Insert
 * nur als `draft` und ohne Belegfelder zu, `approve_affiliate_payout()` macht
 * den Statuswechsel per Compare-and-Swap, und der Lösch-Guard verbietet jedes
 * Wegwerfen. Diese Seite ist die Bedienung, nicht die Regel.
 *
 * ## WARUM DIE SERVER ACTIONS IN DIESER DATEI STEHEN
 *
 * ABWEICHUNG, bewusst und benannt: alle übrigen Server Actions des Moduls
 * liegen in `src/lib/affiliate/actions.ts`. Diese vier stehen hier, weil der
 * Auftrag dieses Blocks ausdrücklich nur `page.tsx` und `lauf-form.tsx`
 * umfasst und `actions.ts` einem anderen Arbeitsschritt gehört; ein
 * gleichzeitiger Eingriff in dieselbe Datei aus zwei Richtungen ist genau die
 * Art von Konflikt, die stillschweigend eine Prüfung verliert. Sie sind
 * deshalb NICHT exportiert (eine `page.tsx` darf keine fremden Exporte
 * tragen), sondern werden als Prop an die Client-Komponente gereicht — die
 * übliche Bauart für eine an eine Seite gebundene Aktion. Wandern sie später
 * nach `actions.ts`, ändert sich an ihrem Inhalt nichts; der Zustandstyp
 * (`AffiliatePayoutActionState`) liegt bereits dort, wo er hingehört.
 *
 * Für jede der vier gilt, was für jede Action des Moduls gilt:
 *   1. ROLLE ZUERST — `requireAffiliateManager()` als erste Zeile (owner/admin,
 *      nicht `trainer`, G10), samt Feature-Schalter.
 *   2. MANDANT VOR ALLEM ANDEREN — jede client-gelieferte ID wird gegen
 *      `tenant_id` geprüft, BEVOR etwas geschrieben wird (§2.15). Die
 *      Auszahlungs-IDs kommen aus einem Formular, also vom Client.
 *   3. EINE MELDUNG für „gibt es nicht" und „gehört jemand anderem" — sonst
 *      verrät allein der Fehlertext die Existenz fremder Sätze (11.15).
 *   4. PROTOKOLL IMMER — `writeAuditEntry()` nach jedem Vorgang; G15 schreibt
 *      seinen eigenen Eintrag bereits in `assertNoSelfApproval()`.
 *
 * ## G15 — NIEMAND GIBT SICH SELBST GELD FREI
 *
 * Die Freigabe prüft den Interessenkonflikt an zwei Stellen: in
 * `assertNoSelfApproval()` (mit Audit-Eintrag über den Versuch) und noch
 * einmal in `approveAffiliatePayout()`. Beide Prüfungen bleiben stehen; sie
 * kosten eine Abfrage und schließen den Fall, in dem eine der beiden später
 * einmal umgebaut wird.
 *
 * ## DAS PDF KOMMT NACH DER NUMMER
 *
 * `approveAffiliatePayout()` vergibt Nummer und Status in EINER Transaktion;
 * erst danach erzeugt diese Seite das PDF und legt es im privaten Bucket ab.
 * Scheitert das, bleibt die Freigabe gültig und `document_path` null — die
 * eingefrorenen Zahlen SIND der Beleg (7.2), und der Teilindex
 * `affiliate_payouts_missing_document_idx` findet den Satz für einen
 * Reparaturlauf wieder. Die umgekehrte Reihenfolge risse bei jedem
 * Storage-Fehler eine Lücke in die Nummernfolge.
 *
 * ## SPALTEN IMMER BENENNEN
 *
 * `select('*')` bricht auf `affiliate_payouts` mit 42501 ab: die Tabelle
 * vergibt Spaltenrechte einzeln, und `document_path`, `created_by` und
 * `reference` gehören nicht dazu. Gelesen wird deshalb NACH dem Gate über
 * `createAdminClient()` mit ausdrücklicher Liste — und zusätzlich zu RLS mit
 * `.eq("tenant_id", …)` auf jeder Abfrage (Defense in Depth, 8.1).
 */

// --- Reiter -------------------------------------------------------------

const TABS = ["drafts", "approved", "exported", "paid", "history"] as const;
type Tab = (typeof TABS)[number];

/**
 * Welche Status zeigt ein Reiter? `history` zeigt ALLES, auch `failed` und
 * `cancelled` — die beiden haben sonst keinen Ort, und ein fehlgeschlagener
 * Satz ist genau der, den jemand sucht.
 */
const TAB_STATUSES: Record<Tab, readonly PayoutStatus[] | null> = {
  drafts: ["draft"],
  approved: ["approved"],
  exported: ["exported"],
  paid: ["paid"],
  history: null,
};

/** Ein Reiter, der nur lesen lässt, bekommt auch keine Aktion gereicht. */
const TAB_MODE: Record<Tab, "approve" | "settle" | "read"> = {
  drafts: "approve",
  approved: "settle",
  exported: "settle",
  paid: "read",
  history: "read",
};

const PAYOUT_LIST_COLUMNS =
  "id, tenant_id, partner_id, period_from, period_to, currency, " +
  "gross_cents, reversal_cents, subtotal_cents, tax_mode, tax_rate_bp, " +
  "tax_cents, total_cents, status, method, document_no, document_path, " +
  "document_issued_at, reference, reverses_payout_id, approved_at, paid_at, created_at";

/** Höchstzahl der Zeilen je Reiter — dieselbe Größenordnung wie die Buchungsliste. */
const PAYOUT_LIST_LIMIT = 200;

type PayoutListRow = {
  id: string;
  partner_id: string;
  period_from: string;
  period_to: string;
  currency: string;
  gross_cents: number;
  reversal_cents: number;
  subtotal_cents: number;
  tax_mode: AffiliateTaxMode;
  tax_rate_bp: number;
  tax_cents: number;
  total_cents: number;
  status: PayoutStatus;
  method: AffiliatePayoutMethod | null;
  document_no: string | null;
  document_path: string | null;
  reference: string | null;
  /**
   * Gesetzt, wenn dieser Satz eine STORNOGUTSCHRIFT ist: er zahlt nichts aus,
   * er neutralisiert den Beleg, auf den er zeigt (§ 14c UStG). Ohne diese
   * Spalte stünde er im Reiter „Entwürfe" als gewöhnlicher Entwurf mit
   * negativen Beträgen, und der Manager gäbe etwas anderes frei, als er
   * gelesen hat.
   */
  reverses_payout_id: string | null;
};

/**
 * Das Abrechnungsprofil, soweit diese Seite es braucht. IBAN und
 * PayPal-Adresse stehen NICHT in der Liste: die Oberfläche zeigt Bankdaten
 * nie an (8.1, letzte Spalte der Partnerzeile) — sie zeigt nur, OB sie
 * verwertbar sind. Genau deshalb steht `iban` hier trotzdem: die Prüfziffer
 * lässt sich nicht aus einem Ja/Nein ableiten, und eine ungültige IBAN ist
 * der häufigste Grund, aus dem eine Überweisung zurückkommt. Der Wert wird
 * gelesen, geprüft und verworfen — er verlässt den Server nicht.
 */
const BILLING_CHECK_COLUMNS =
  "partner_id, entity_kind, legal_name, street, postal_code, city, country, " +
  "small_business, vat_id, vat_check_result, vat_checked_at, payout_method, " +
  "account_holder, iban, paypal_email";

type BillingCheckRow = {
  partner_id: string;
  entity_kind: AffiliateEntityKind | null;
  legal_name: string | null;
  street: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
  small_business: boolean;
  vat_id: string | null;
  vat_check_result: AffiliateVatCheckResult | null;
  vat_checked_at: string | null;
  payout_method: AffiliatePayoutMethod | null;
  account_holder: string | null;
  iban: string | null;
  paypal_email: string | null;
};

// --- Texte für die Server Actions ---------------------------------------

/**
 * EIN Text für „gibt es nicht", „gehört einem anderen Mandanten" und „hat
 * inzwischen einen anderen Status". Drei Formulierungen wären drei Auskünfte
 * über fremde Daten (11.15).
 */
const PAYOUT_NOT_FOUND =
  "Der Auszahlungssatz wurde in dieser Akademie nicht gefunden oder hat inzwischen einen anderen Stand.";
const CONFIRM_MISSING = "Bitte die Freigabe im Bestätigungsschritt ausdrücklich bestätigen.";
const AMOUNT_CHANGED =
  "Die Beträge haben sich seit der Anzeige geändert. Bitte die Liste neu laden und erneut prüfen.";
const NOTHING_SELECTED = "Bitte zuerst mindestens eine Auszahlung auswählen.";
/**
 * Getrennt von `NOTHING_SELECTED`, weil die beiden Fälle verschiedene
 * Handlungen verlangen: „nichts ausgewählt" ist ein Bedienhinweis, ein am
 * Schema gescheitertes Formular ist ein Fehler der Seite. Ein Text, der das
 * Gegenteil dessen sagt, was los ist, kostet im Zweifel eine Stunde Suche am
 * falschen Ende — genau so ist die Stornofreigabe zuletzt unbemerkt
 * ausgefallen.
 */
const FORM_INVALID =
  "Die Freigabe konnte nicht gelesen werden. Bitte die Seite neu laden und erneut versuchen.";
const CONFIRM_DOCUMENT_MISSING =
  "Bitte die Belegnummer genau so eintragen, wie sie an der Auszahlung steht. Der Fehlschlag lässt sich nicht zurücknehmen.";
const PAYOUT_PATH = "/admin/affiliate/auszahlungen";

function logDbError(context: string, error: unknown): void {
  // Nur Vorgang und SQLSTATE. `error.message` trägt bei einer
  // Constraint-Verletzung den Schlüsselwert im Klartext — hier wären das
  // Belegnummer, IBAN oder USt-IdNr. (CLAUDE.md §2.11).
  console.error(
    `[admin/affiliate/auszahlungen] ${context} fehlgeschlagen (Code ${
      (error as { code?: string } | null)?.code ?? "unbekannt"
    }).`,
  );
}

// --- Server Actions -----------------------------------------------------

const uuidSchema = z.string().uuid();
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Bitte ein gültiges Datum wählen.");

const runSchema = z.object({
  periodFrom: isoDateSchema,
  periodTo: isoDateSchema,
});

/**
 * Schritt 1 — Entwürfe erzeugen (7.1).
 *
 * Die Seite ruft `planAffiliatePayoutRun()` für die Vorschau und dieselbe
 * Funktion hier noch einmal für den Lauf. Das ist kein vergessener Cache: die
 * Vorschau kann Minuten alt sein, und zwischen Anzeige und Klick darf eine
 * gesperrte Partnerzeile nicht doch noch zu einem Entwurf führen.
 */
async function runPayoutDraftsAction(
  _state: AffiliatePayoutActionState,
  formData: FormData,
): Promise<AffiliatePayoutActionState> {
  "use server";
  try {
    const { tenant, user } = await requireAffiliateManager();

    const parsed = runSchema.safeParse({
      periodFrom: formData.get("periodFrom"),
      periodTo: formData.get("periodTo"),
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }
    /**
     * ZEITRAUMGRENZEN (Abnahme B8/B9, Befund 7). Geprüft wurden bis dahin nur
     * Form und Reihenfolge. Ein Datum in der Zukunft — ein Vertipper genügt —
     * schloss beim Freigeben `books_closed_until` des gesamten Programms auf
     * diesen Wert, und `greatest()` nimmt das nie wieder zurück: ab da datiert
     * jede neue Provisionszeile um und trägt den unveränderlichen
     * Nachbuchungsvermerk. Dieselbe Regel steht in
     * `createAffiliatePayoutDrafts()` und in `approve_affiliate_payout()`.
     */
    const now = new Date();
    const periodProblem = checkAffiliatePayoutPeriodBounds(
      parsed.data.periodFrom,
      parsed.data.periodTo,
      now,
    );
    if (periodProblem === "reversed") {
      return { error: "Das Ende des Zeitraums liegt vor seinem Anfang." };
    }
    if (periodProblem === "future") {
      return {
        error:
          "Der Zeitraum endet in der Zukunft. Abgerechnet wird immer eine abgeschlossene Periode.",
      };
    }
    if (periodProblem === "too_old") {
      return {
        error: `Der Zeitraum beginnt mehr als ${AFFILIATE_PAYOUT_MAX_PERIOD_MONTHS} Monate in der Vergangenheit. Bitte den Zeitraum eingrenzen.`,
      };
    }

    const program = await getAffiliateProgram(tenant.id);
    if (program === null) {
      return { error: "Für diese Akademie ist noch kein Partnerprogramm eingerichtet." };
    }

    const admin = createAdminClient();
    const plan = await planAffiliatePayoutRun(admin, {
      tenantId: tenant.id,
      programId: program.id,
    });
    if (!plan.ok) {
      return {
        error:
          plan.reason === "tenant_legal_entity_missing"
            ? "Für diese Akademie ist kein Rechtsträger hinterlegt. Ohne ihn kann keine Gutschrift ausgestellt werden."
            : "Der Auszahlungslauf konnte nicht vorbereitet werden. Bitte später erneut versuchen.",
      };
    }
    if (plan.candidates.length === 0) {
      return { error: "Für diesen Zeitraum gibt es derzeit keinen auszahlbaren Partner." };
    }

    const outcomes = await createAffiliatePayoutDrafts(admin, {
      tenantId: tenant.id,
      candidates: plan.candidates,
      minPayoutCents: plan.minPayoutCents,
      periodFrom: parsed.data.periodFrom,
      periodTo: parsed.data.periodTo,
      createdBy: user.id,
      now,
    });

    const created = outcomes.filter((outcome) => outcome.status === "created");
    const failed = outcomes.filter((outcome) => outcome.status === "failed");

    await writeAuditEntry({
      tenantId: tenant.id,
      actorKind: "manager",
      actorUserId: user.id,
      entity: "payout",
      action: "payout.run",
      after: {
        period_from: parsed.data.periodFrom,
        period_to: parsed.data.periodTo,
        created: created.length,
        skipped: outcomes.length - created.length - failed.length,
        failed: failed.length,
      },
    });

    revalidatePath(PAYOUT_PATH);

    if (created.length === 0) {
      return {
        error:
          "Es ist kein Entwurf entstanden. Die Gründe stehen im Abschnitt „Nicht auszahlbar“.",
      };
    }
    if (failed.length > 0) {
      return {
        error: `${created.length} Entwürfe wurden angelegt, ${failed.length} nicht. Bitte die Liste prüfen.`,
      };
    }
    return { error: null, success: true };
  } catch (e) {
    return { error: actionErrorMessage(e, "Auszahlungslauf") };
  }
}

const approveSchema = z.object({
  payoutIds: z.array(uuidSchema).min(1).max(50),
  /**
   * `<waehrung>:<cent>`, genau so, wie die Bestätigungskarte es angezeigt hat.
   *
   * Das Vorzeichen ist PFLICHTBESTANDTEIL des Musters und keine Nachlässigkeit:
   * eine Stornogutschrift (`reverses_payout_id is not null`) hat gespiegelte,
   * also negative Summen. Ein Muster ohne `-` sperrt genau den Korrekturweg
   * nach § 14c UStG — der Manager kann den Beleg, den er neutralisieren muss,
   * über die Oberfläche nicht freigeben. Die nachfolgende Summenprüfung
   * rechnet mit `Number()` und trägt das Vorzeichen bereits mit.
   */
  expected: z.array(z.string().regex(AFFILIATE_PAYOUT_EXPECTED_PATTERN)).max(10),
  confirm: z.string(),
});

/**
 * Schritt 2 — Freigabe (7.2). Der Punkt, an dem Geld das Haus verlässt.
 *
 * Reihenfolge, und jeder Schritt hat seinen Grund:
 *   1. Bestätigung vorhanden? Ohne sie passiert nichts — der Knopf allein ist
 *      keine Entscheidung (11.17).
 *   2. Sätze MIT Mandantenfilter lesen; nur `draft` kommt in Frage.
 *   3. Angezeigte Summe gegen die tatsächliche rechnen. Weicht sie ab, wurde
 *      zwischen Anzeige und Klick etwas verändert, und der Mensch hätte etwas
 *      anderes freigegeben, als er gelesen hat.
 *   4. Kontrollabgleich EINMAL für den ganzen Stapel (7.6) — sechs Sätze
 *      sollen den Mandanten einmal prüfen, nicht sechsmal.
 *   5. Je Satz: G15, dann die RPC, dann das PDF, dann das Protokoll.
 */
async function approvePayoutsAction(
  _state: AffiliatePayoutActionState,
  formData: FormData,
): Promise<AffiliatePayoutActionState> {
  "use server";
  try {
    const { tenant, user } = await requireAffiliateManager();

    const parsed = approveSchema.safeParse({
      payoutIds: formData.getAll("payoutIds").map(String),
      expected: formData.getAll("expected").map(String),
      confirm: String(formData.get("confirm") ?? ""),
    });
    if (!parsed.success) {
      // Kein Satz markiert ist der Bedienfall; alles andere ist ein Fehler
      // des Formulars und darf nicht als Bedienfehler ausgegeben werden.
      const nothingPicked = formData.getAll("payoutIds").length === 0;
      return { error: nothingPicked ? NOTHING_SELECTED : FORM_INVALID };
    }
    if (parsed.data.confirm !== "yes") return { error: CONFIRM_MISSING };

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("affiliate_payouts")
      // §2.15: die IDs kommen aus dem Formular. Der Mandantenfilter steht
      // VOR jeder Verwendung, nicht danach.
      .select("id, partner_id, status, currency, total_cents, subtotal_cents, tax_mode, tax_rate_bp")
      .eq("tenant_id", tenant.id)
      .in("id", parsed.data.payoutIds)
      .eq("status", "draft");

    if (error) {
      logDbError("Lesen der Entwürfe vor der Freigabe", error);
      return { error: genericErrorMessage(error) };
    }

    const drafts = (data ?? []) as unknown as Array<{
      id: string;
      partner_id: string;
      currency: string;
      total_cents: number;
    }>;
    // Ein fehlender Satz ist entweder fremd, gelöscht oder nicht mehr
    // `draft` — alle drei bekommen denselben Text (11.15).
    if (drafts.length !== parsed.data.payoutIds.length) return { error: PAYOUT_NOT_FOUND };

    const expected = new Map<string, number>();
    for (const entry of parsed.data.expected) {
      // Derselbe Leser wie der Erzeuger in `lauf-form.tsx` — beide hängen an
      // `state.ts`. Ein unlesbarer Wert bricht ab, statt als 0 durchzugehen.
      const parsedEntry = parseAffiliatePayoutExpected(entry);
      if (parsedEntry === null) return { error: AMOUNT_CHANGED };
      expected.set(parsedEntry.currency, parsedEntry.cents);
    }
    const actual = new Map<string, number>();
    for (const draft of drafts) {
      actual.set(draft.currency, (actual.get(draft.currency) ?? 0) + draft.total_cents);
    }
    if (expected.size !== actual.size) return { error: AMOUNT_CHANGED };
    for (const [currency, cents] of actual) {
      if (expected.get(currency) !== cents) return { error: AMOUNT_CHANGED };
    }

    // MIT `quarantine: true` — so, wie 7.6 es vorsieht und wie `integrity.ts`
    // es beschreibt („Der Auszahlungsweg ruft ihn mit true"): ein Satz, dessen
    // Positionssumme nicht zu seinem Kopf passt, wird stillgelegt, bevor
    // irgendetwas freigegeben wird.
    const report = await verifyAffiliateIntegrity(admin, tenant.id, { quarantine: true });
    // Konnte eine Stilllegung NICHT geschrieben werden, steht ein kritischer
    // Befund weiter exportierbar im Bestand (Befund 9). Dann wird gar nichts
    // freigegeben — ein Log hält keine Überweisung auf.
    if (hasUnquarantinedCriticalFinding(report)) {
      return {
        error:
          "Der Kontrollabgleich hat einen kritischen Befund gefunden, der nicht stillgelegt werden konnte. Es wurde nichts freigegeben.",
      };
    }

    // Der Abgleich legt einen nummerierten Satz stillschweigend still und
    // erzeugt dabei den Storno-Entwurf (Befund N3). Gelingt der nicht, bleibt
    // ein Beleg mit ausgewiesener Steuer ohne Berichtigungsweg im Bestand —
    // und der Befund kommt beim nächsten Lauf NICHT wieder, weil ein
    // 'failed'-Satz übersprungen wird. Also hier aussprechen.
    const pendingReversals = countPendingReversals(report);
    if (pendingReversals > 0) {
      // Abbruch VOR der Schleife, wie beim nicht stillgelegten Befund darüber:
      // eine Freigabe, die erst läuft und dann meldet, dass die Bücher offen
      // sind, hat das Geld schon bewegt. Der Abgleich blockiert dadurch genau
      // EINEN Lauf — beim nächsten ist der Satz 'failed' und wird von
      // `checkPayoutSubtotals()` übersprungen, der Befund kommt also nicht
      // wieder und niemand sitzt fest.
      return {
        error: `Der Kontrollabgleich hat ${pendingReversals} Beleg(e) stillgelegt, für die der Entwurf der Stornogutschrift nicht angelegt werden konnte. Es wurde nichts freigegeben; bitte diese Belege prüfen.`,
      };
    }

    let approved = 0;
    let blocked = 0;
    let failed = 0;
    /** Belege, deren PDF (noch) nicht im Bucket liegt — sichtbar, nicht nur im Log. */
    let documentsPending = 0;

    for (const draft of drafts) {
      try {
        // G15, erste Linie: schreibt den Versuch selbst ins Protokoll und
        // wirft. Die zweite Linie steckt in `approveAffiliatePayout()`.
        await assertNoSelfApproval({
          tenantId: tenant.id,
          userId: user.id,
          partnerId: draft.partner_id,
          entity: "payout",
          attemptedAction: "payout.approve",
        });
      } catch {
        blocked += 1;
        continue;
      }

      const result = await approveAffiliatePayout(admin, {
        tenantId: tenant.id,
        payoutId: draft.id,
        actorUserId: user.id,
        integrityReport: report,
      });

      if (!result.ok) {
        failed += 1;
        continue;
      }
      approved += 1;

      await writeAuditEntry({
        tenantId: tenant.id,
        actorKind: "manager",
        actorUserId: user.id,
        entity: "payout",
        entityId: draft.id,
        action: "payout.approve",
        after: {
          document_no: result.document_no,
          currency: draft.currency,
          total_cents: draft.total_cents,
        },
      });

      // Das PDF danach, bewusst außerhalb jeder Abbruchbedingung (7.2).
      const stored = await storeCreditNote(tenant.id, tenant.name, tenant.legal, draft.id);
      if (!stored) documentsPending += 1;
    }

    revalidatePath(PAYOUT_PATH);

    if (approved === 0 && blocked > 0) return { error: SELF_DEALING };
    if (approved === 0) return { error: "Es wurde keine Auszahlung freigegeben. Bitte die Liste prüfen." };
    if (blocked > 0 || failed > 0) {
      return {
        error: `${approved} Auszahlungen wurden freigegeben, ${blocked + failed} nicht. Bitte die Liste prüfen.`,
      };
    }
    if (documentsPending > 0) {
      // Die Freigabe GILT — die eingefrorenen Zahlen sind der Beleg (7.2).
      // Gesagt werden muss es trotzdem: sonst sieht niemand, dass ein Partner
      // sein PDF noch nicht herunterladen kann (Befund 15).
      return {
        error: `${approved} Auszahlungen wurden freigegeben. Für ${documentsPending} davon konnte das Beleg-PDF noch nicht abgelegt werden; die Belege sind gültig und werden nachgereicht.`,
      };
    }
    return { error: null, success: true };
  } catch (e) {
    return { error: actionErrorMessage(e, "Freigabe") };
  }
}

/** G15 im Wortlaut von `access.ts` — beide Wege müssen denselben Satz liefern. */
const SELF_DEALING =
  "Dieser Vorgang gehört zur eigenen Partnerzeile und muss von einer anderen Person entschieden werden.";

/**
 * G15 FÜR DIE BEIDEN ABSCHLUSS-AKTIONEN (Abnahme, Befund S6).
 *
 * Von den vier Aktionen dieser Seite prüfte nur die Freigabe den
 * Interessenkonflikt. G15 nennt aber „eine Auszahlung an sich selbst" als
 * eigenen Fall, nicht nur deren Freigabe — und beide Abschluss-Aktionen sind
 * Entscheidungen über eigenes Geld an einem Beleg, den der Entscheidende
 * selbst empfängt:
 *   * „bezahlt" stellt zusätzlich alle zugehörigen Provisionszeilen auf
 *     `paid` — ein Endzustand;
 *   * „fehlgeschlagen" löst sie zurück auf `approved` (sie laufen damit in
 *     den nächsten Lauf) und legt eine Stornogutschrift mit eigener Nummer
 *     an, während der erste Beleg neutralisiert wird.
 *
 * Die `partner_id` steht nicht im Formular — sie wird mandantengebunden aus
 * dem Satz gelesen, BEVOR geschrieben wird (§2.15). Ein fehlender Satz ergibt
 * `null` und denselben Text wie „gehört einem anderen Mandanten" (11.15).
 */
async function assertNotOwnPayout(
  admin: ReturnType<typeof createAdminClient>,
  params: { tenantId: string; userId: string; payoutId: string; action: string },
): Promise<"ok" | "not_found"> {
  const { data, error } = await admin
    .from("affiliate_payouts")
    .select("partner_id")
    .eq("tenant_id", params.tenantId)
    .eq("id", params.payoutId)
    .maybeSingle();

  if (error) {
    logDbError("Partnerzeile der Auszahlung lesen", error);
    return "not_found";
  }
  const row = data as { partner_id: string } | null;
  if (row === null) return "not_found";

  // Wirft und schreibt den abgewiesenen Versuch selbst ins Protokoll.
  await assertNoSelfApproval({
    tenantId: params.tenantId,
    userId: params.userId,
    partnerId: row.partner_id,
    entity: "payout",
    attemptedAction: params.action,
  });
  return "ok";
}

const settleSchema = z.object({
  payoutId: uuidSchema,
  reference: z.string().optional(),
});

/**
 * Schritt 4 — nach dem Bankabgleich (7.7). Die Referenz ist Pflicht und wird
 * von `affiliatePayoutReferenceSchema` in `payout.ts` geprüft; hier steht
 * bewusst keine zweite Regel für dasselbe Feld.
 */
async function markPaidAction(
  _state: AffiliatePayoutActionState,
  formData: FormData,
): Promise<AffiliatePayoutActionState> {
  "use server";
  try {
    const { tenant, user } = await requireAffiliateManager();

    const parsed = settleSchema.safeParse({
      payoutId: formData.get("payoutId"),
      reference: formData.get("reference") ?? undefined,
    });
    if (!parsed.success) return { error: PAYOUT_NOT_FOUND };

    const admin = createAdminClient();

    // G15 nach dem zod-Parse und VOR dem Schreiben (Befund S6).
    if (
      (await assertNotOwnPayout(admin, {
        tenantId: tenant.id,
        userId: user.id,
        payoutId: parsed.data.payoutId,
        action: "payout.mark_paid",
      })) === "not_found"
    ) {
      return { error: PAYOUT_NOT_FOUND };
    }

    const result = await markAffiliatePayoutPaid(admin, {
      tenantId: tenant.id,
      payoutId: parsed.data.payoutId,
      reference: parsed.data.reference ?? "",
    });

    if (!result.ok) {
      return {
        error:
          result.reason === "write_failed"
            ? "Die Überweisung konnte nicht vermerkt werden. Bitte später erneut versuchen."
            : PAYOUT_NOT_FOUND,
      };
    }

    await writeAuditEntry({
      tenantId: tenant.id,
      actorKind: "manager",
      actorUserId: user.id,
      entity: "payout",
      entityId: parsed.data.payoutId,
      action: "payout.mark_paid",
      after: { rows: result.affected_rows },
    });

    revalidatePath(PAYOUT_PATH);
    return { error: null, success: true };
  } catch (e) {
    // Ein zod-Fehler aus `affiliatePayoutReferenceSchema` trägt eine eigene,
    // für den Menschen geschriebene Meldung; sie darf durch.
    if (e instanceof z.ZodError) {
      return { error: e.issues[0]?.message ?? "Die Referenz ist nicht verwertbar." };
    }
    return { error: actionErrorMessage(e, "Überweisung vermerken") };
  }
}

const failSchema = z.object({
  payoutId: uuidSchema,
  /** Die abgetippte Belegnummer (Abnahme B8/B9, Befund 16). */
  confirmDocumentNo: z.string().trim().min(1).max(60),
});

/**
 * Die Überweisung ist fehlgeschlagen (7.7): Satz auf `failed`, die
 * Provisionszeilen werden freigegeben und laufen in den nächsten Entwurf. Der
 * Beleg bleibt bestehen — er wird nie gelöscht, sondern per Stornogutschrift
 * mit eigener Nummer neutralisiert; deren Entwurf legt
 * `markAffiliatePayoutFailed()` im selben Vorgang an.
 *
 * `failed` ist ein Endzustand ohne ausgehende Kante. Deshalb muss die
 * Belegnummer abgetippt werden (Befund 16): wer eine angekommene Überweisung im
 * Kontoauszug falsch zuordnet, zahlt sonst mit dem nächsten Lauf dieselbe
 * Provision ein zweites Mal aus.
 */
async function markFailedAction(
  _state: AffiliatePayoutActionState,
  formData: FormData,
): Promise<AffiliatePayoutActionState> {
  "use server";
  try {
    const { tenant, user } = await requireAffiliateManager();

    const parsed = failSchema.safeParse({
      payoutId: formData.get("payoutId"),
      confirmDocumentNo: String(formData.get("confirmDocumentNo") ?? ""),
    });
    if (!parsed.success) return { error: CONFIRM_DOCUMENT_MISSING };

    const admin = createAdminClient();

    // G15 nach dem zod-Parse und VOR dem Schreiben (Befund S6).
    if (
      (await assertNotOwnPayout(admin, {
        tenantId: tenant.id,
        userId: user.id,
        payoutId: parsed.data.payoutId,
        action: "payout.mark_failed",
      })) === "not_found"
    ) {
      return { error: PAYOUT_NOT_FOUND };
    }

    const result = await markAffiliatePayoutFailed(admin, {
      tenantId: tenant.id,
      payoutId: parsed.data.payoutId,
      confirmDocumentNo: parsed.data.confirmDocumentNo,
    });
    if (!result.ok) {
      if (result.reason === "confirmation_mismatch") return { error: CONFIRM_DOCUMENT_MISSING };
      return {
        error:
          result.reason === "write_failed"
            ? "Der Vorgang konnte nicht gespeichert werden. Bitte später erneut versuchen."
            : PAYOUT_NOT_FOUND,
      };
    }

    await writeAuditEntry({
      tenantId: tenant.id,
      actorKind: "manager",
      actorUserId: user.id,
      entity: "payout",
      entityId: parsed.data.payoutId,
      action: "payout.mark_failed",
      // Vorher-/Nachher-Stand (Befund 16): der Vorgang ist unumkehrbar, also
      // muss im Protokoll stehen, aus welchem Zustand heraus er ausgelöst wurde
      // und welcher Beleg gemeint war.
      before: { status: result.previous_status, document_no: parsed.data.confirmDocumentNo },
      after: {
        status: "failed",
        released_rows: result.affected_rows,
        reversal_payout_id: result.reversal_payout_id,
      },
    });

    revalidatePath(PAYOUT_PATH);
    if (result.reversal_payout_id === null) {
      // Ohne Stornogutschrift bleibt ein Beleg mit ausgewiesener Steuer im
      // Bestand, während dieselbe Leistung gleich erneut abgerechnet wird —
      // § 14c UStG. Das darf nicht nur im Log stehen.
      return {
        error:
          "Der Fehlschlag ist vermerkt, aber der Entwurf der Stornogutschrift konnte nicht angelegt werden. Bitte den Beleg vor dem nächsten Lauf prüfen.",
      };
    }
    return { error: null, success: true };
  } catch (e) {
    return { error: actionErrorMessage(e, "Fehlschlag vermerken") };
  }
}

/**
 * Die Gate-Meldungen aus `access.ts` dürfen an die Oberfläche — sie sind
 * Aussagen über den Anfragenden selbst. Alles andere wird generisch, und die
 * rohe Meldung erreicht weder Oberfläche noch Log (§2.11).
 */
function actionErrorMessage(e: unknown, context: string): string {
  const raw = e instanceof Error ? e.message : "";
  if (
    raw.startsWith("Nicht angemeldet") ||
    raw.startsWith("Kein Zugriff") ||
    raw.startsWith("Kein Mandant") ||
    raw.includes("nicht aktiviert") ||
    raw === SELF_DEALING
  ) {
    return raw;
  }
  console.error(`[admin/affiliate/auszahlungen] ${context} fehlgeschlagen.`);
  return genericErrorMessage(e);
}

/**
 * Erzeugt das Gutschrift-PDF und legt es im privaten Bucket ab.
 *
 * Fehlerfrei zu sein ist hier NICHT die Bedingung: die Freigabe ist längst
 * geschrieben, und der Beleg gilt auch ohne Datei (7.2). Jeder Abbruch führt
 * deshalb nur zu einem Log-Eintrag ohne Werte; der Satz bleibt mit
 * `document_path = null` stehen und wird vom Reparaturlauf wiedergefunden.
 *
 * Drei Dinge, die diese Funktion NICHT tut:
 *   - Sie rechnet nichts nach. Alle Zahlen kommen aus der Zeile, so wie sie
 *     eingefroren wurde; ein zweiter Rechenweg könnte ein PDF erzeugen, das
 *     seinem eigenen Belegkopf widerspricht.
 *   - Sie leitet den Steuerhinweis NICHT mehr aus dem heutigen Profil ab
 *     (Abnahme B8/B9, Befund 10). Der Gedanke war richtig — kein PDF, das dem
 *     Belegkopf widerspricht —, die Umsetzung machte die zugesagte
 *     Deterministik aber kaputt: der Modus hängt über `hasCurrentVatCheck()`
 *     an einer 90-Tage-Frist und altert von selbst. Nach 90 Tagen lieferte
 *     `resolveAffiliateTaxMode()` `eu_vat_missing`, und JEDER
 *     Reverse-Charge-Beleg ohne PDF blieb dauerhaft ohne PDF — bei zehn Jahren
 *     Aufbewahrungsfrist und einem Partner, der über die Belegroute dauerhaft
 *     409 bekommt. Der Hinweis folgt jetzt aus dem EINGEFRORENEN Modus des
 *     Belegs (`taxHintForMode()`), sonst nichts.
 *   - Sie liest die Anschrift des Empfängers nicht live aus dem Profil,
 *     sondern aus `recipient_snapshot` (Befund 10, zweiter Teil). Nur für
 *     Belege, die vor dieser Berichtigung entstanden sind, gibt es den
 *     Rückfall auf das Profil — mit einem Vermerk im Log.
 *
 * Rückgabe `false` heißt: die Datei liegt NICHT im Bucket. Die Freigabe bleibt
 * davon unberührt, aber die Oberfläche sagt es (Befund 15).
 */
async function storeCreditNote(
  tenantId: string,
  tenantName: string,
  tenantLegal: unknown,
  payoutId: string,
): Promise<boolean> {
  try {
    const legalEntity = resolveLegalEntity(tenantLegal);
    if (legalEntity === null) return false;
    const issuerVatId = resolveTenantVatId(tenantLegal);

    const admin = createAdminClient();
    const { data: payoutData, error: payoutError } = await admin
      .from("affiliate_payouts")
      .select(
        "id, partner_id, period_from, period_to, currency, gross_cents, reversal_cents, " +
          "subtotal_cents, tax_mode, tax_rate_bp, tax_cents, total_cents, method, " +
          "document_no, document_issued_at, document_path, reverses_payout_id, recipient_snapshot",
      )
      .eq("tenant_id", tenantId)
      .eq("id", payoutId)
      .maybeSingle<{
        id: string;
        partner_id: string;
        period_from: string;
        period_to: string;
        currency: string;
        gross_cents: number;
        reversal_cents: number;
        subtotal_cents: number;
        tax_mode: AffiliateTaxMode;
        tax_rate_bp: number;
        tax_cents: number;
        total_cents: number;
        method: AffiliatePayoutMethod | null;
        document_no: string | null;
        document_issued_at: string | null;
        document_path: string | null;
        reverses_payout_id: string | null;
        recipient_snapshot: unknown;
      }>();

    if (payoutError || payoutData === null) return false;
    if (payoutData.document_no === null) return false;
    // Schon vorhanden: nichts überschreiben. Ein zweites PDF zu derselben
    // Nummer wäre ein zweiter Beleg.
    if (payoutData.document_path !== null) return true;

    const recipient = await resolveCreditNoteRecipient(admin, tenantId, payoutData);
    if (recipient === null) return false;

    // FAIL-CLOSED (Befund 5): bei Reverse Charge sind nach § 14a Abs. 5 UStG
    // BEIDE USt-IdNr. Pflichtangabe. Hier stand fest verdrahtet `vatId: null`,
    // und das PDF trug an ihrer Stelle einen Gedankenstrich — formal nicht
    // belegter Reverse Charge, technisch fehlerfrei, in keiner Prüfung
    // sichtbar. Ohne die Nummer des Ausstellers entsteht deshalb kein PDF.
    // Dass es gar nicht erst so weit kommt, dafür sorgt der Sperrgrund
    // `issuer_vat_id_missing` im Lauf.
    if (
      payoutData.tax_mode === "reverse_charge" &&
      (issuerVatId === null || (recipient.vatId ?? "").trim() === "")
    ) {
      console.error(
        "[admin/affiliate/auszahlungen] USt-IdNr. fehlt; Reverse-Charge-Beleg nicht erzeugt.",
      );
      return false;
    }

    // Die Nummer des stornierten Belegs — sie gehört auf die Stornogutschrift
    // (7.7), sonst ist sie ein zweiter Beleg über einen negativen Betrag.
    let reversesDocumentNo: string | null = null;
    if (payoutData.reverses_payout_id !== null) {
      const { data: origin } = await admin
        .from("affiliate_payouts")
        .select("id, document_no")
        .eq("tenant_id", tenantId)
        .eq("id", payoutData.reverses_payout_id)
        .maybeSingle<{ document_no: string | null }>();
      if (origin === null || origin.document_no === null) return false;
      reversesDocumentNo = origin.document_no;
    }

    const pdfBytes = await generateAffiliateCreditNotePdf({
      documentNo: payoutData.document_no,
      issuedAt:
        payoutData.document_issued_at === null
          ? new Date()
          : new Date(payoutData.document_issued_at),
      periodFrom: payoutData.period_from,
      periodTo: payoutData.period_to,
      currency: payoutData.currency,
      grossCents: payoutData.gross_cents,
      reversalCents: payoutData.reversal_cents,
      subtotalCents: payoutData.subtotal_cents,
      taxMode: payoutData.tax_mode,
      taxRateBp: payoutData.tax_rate_bp,
      taxCents: payoutData.tax_cents,
      totalCents: payoutData.total_cents,
      taxHint: taxHintForMode(payoutData.tax_mode),
      issuer: { legalEntity, vatId: issuerVatId },
      recipient,
      reversesDocumentNo,
      tenantName,
      method: payoutData.method,
    });

    // Der Pfad wird BERECHNET, nie aus der Zeile übernommen — dieselbe
    // Konvention, die der CHECK auf `document_path` erzwingt (§2.5).
    const path = affiliateCreditNotePath(tenantId, payoutData.id);
    const { error: uploadError } = await admin.storage
      .from("affiliate-documents")
      // `upsert: true` (Abnahme B8/B9, Befund 15). Der Reparaturlauf setzt
      // genau dort an, wo `document_path` null ist — und das ist auch dann der
      // Fall, wenn der Upload beim ersten Versuch durchging und nur das
      // nachfolgende UPDATE scheiterte. Mit `upsert: false` bekam jeder weitere
      // Versuch „Duplicate" zurück, der Pfad blieb für immer null, und der
      // Partner bekam dauerhaft 409, obwohl die Datei im Bucket lag. Ein
      // Überschreiben ändert nichts: das PDF ist deterministisch aus den
      // eingefrorenen Zahlen.
      .upload(path, pdfBytes, { contentType: "application/pdf", upsert: true });
    if (uploadError) {
      console.error("[admin/affiliate/auszahlungen] Beleg-Upload fehlgeschlagen.");
      return false;
    }

    const { error: updateError } = await admin
      .from("affiliate_payouts")
      .update({ document_path: path })
      .eq("tenant_id", tenantId)
      .eq("id", payoutData.id)
      .is("document_path", null);
    if (updateError) {
      logDbError("Belegpfad eintragen", updateError);
      // Die Datei liegt, der Verweis fehlt — der Satz bleibt für den
      // Reparaturlauf sichtbar, und der Aufrufer erfährt es (Befund 15).
      return false;
    }
    return true;
  } catch (e) {
    // Auch ein Fehler in pdf-lib darf die Freigabe nicht nachträglich
    // entwerten. Ohne Werte ins Log (§2.11).
    console.error("[admin/affiliate/auszahlungen] Belegerzeugung fehlgeschlagen.", {
      known: e instanceof Error,
    });
    return false;
  }
}

/**
 * Der Empfänger des Belegs: bevorzugt aus `recipient_snapshot` (eingefroren
 * beim Entwurf), ersatzweise aus dem Abrechnungsprofil.
 *
 * Der Rückfall ist ausdrücklich der ZWEITE Weg und existiert für Belege aus der
 * Zeit vor der Berichtigung zu Befund 10. Er ist nicht deterministisch — das
 * ist der Grund, aus dem es den Schnappschuss gibt — und wird deshalb
 * protokolliert.
 */
async function resolveCreditNoteRecipient(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  payout: { partner_id: string; recipient_snapshot: unknown },
): Promise<{
  legalName: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  vatId: string | null;
  taxNumber: string | null;
} | null> {
  const parsed = recipientSnapshotSchema.safeParse(payout.recipient_snapshot);
  if (parsed.success) {
    return {
      legalName: parsed.data.legal_name,
      street: parsed.data.street,
      postalCode: parsed.data.postal_code,
      city: parsed.data.city,
      country: parsed.data.country,
      vatId: parsed.data.vat_id,
      taxNumber: parsed.data.tax_number,
    };
  }

  console.error(
    "[admin/affiliate/auszahlungen] Beleg ohne eingefrorenen Empfänger; Rückfall auf das Abrechnungsprofil.",
  );

  const { data: profile, error } = await admin
    .from("affiliate_billing_profiles")
    .select("partner_id, legal_name, street, postal_code, city, country, vat_id, tax_number")
    .eq("tenant_id", tenantId)
    .eq("partner_id", payout.partner_id)
    .maybeSingle<{
      legal_name: string | null;
      street: string | null;
      postal_code: string | null;
      city: string | null;
      country: string | null;
      vat_id: string | null;
      tax_number: string | null;
    }>();

  if (error || profile === null) return null;
  if (
    profile.legal_name === null ||
    profile.street === null ||
    profile.postal_code === null ||
    profile.city === null ||
    profile.country === null
  ) {
    return null;
  }
  return {
    legalName: profile.legal_name,
    street: profile.street,
    postalCode: profile.postal_code,
    city: profile.city,
    country: profile.country,
    vatId: profile.vat_id,
    taxNumber: profile.tax_number,
  };
}

/** Der eingefrorene Empfänger, wie ihn der Entwurfslauf geschrieben hat. */
const recipientSnapshotSchema = z.object({
  legal_name: z.string().min(1),
  street: z.string().min(1),
  postal_code: z.string().min(1),
  city: z.string().min(1),
  country: z.string().min(1),
  vat_id: z.string().nullable().default(null),
  tax_number: z.string().nullable().default(null),
});

// --- Seite --------------------------------------------------------------

export default async function AdminAffiliatePayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const access = await checkAffiliateManagerAccess();
  if (!access.ok) return <AffiliateAccessNotice reason={access.reason} />;

  const t = await getTranslations("admin.affiliate");
  const tp = await getTranslations("admin.affiliate.payouts");
  const tBlocked = await getTranslations("affiliate.payoutRun.blocked");
  const format = await getFormatter();
  const params = await searchParams;

  // Der Reiter kommt aus der Adresse und wird gegen eine `as const`-Liste
  // geweißt (Muster `abgaben/page.tsx`); ein unbekannter Wert fällt auf
  // „Entwürfe" zurück, statt einen Filter zu bauen (§2.12).
  const tab: Tab = TABS.find((value) => value === params.tab) ?? "drafts";

  const program = await getAffiliateProgram(access.tenant.id);
  if (program === null) {
    return (
      <AffiliateShell active="payouts" title={tp("title")}>
        <AffiliateProgramMissing />
      </AffiliateShell>
    );
  }

  const admin = createAdminClient();

  let listQuery = admin
    .from("affiliate_payouts")
    .select(PAYOUT_LIST_COLUMNS)
    // Zusätzlich zu RLS, wörtlich wie in `marketplace/page.tsx`: Defense in
    // Depth. `createAdminClient()` umgeht RLS, dieser Filter ist hier also
    // nicht Wiederholung, sondern die einzige Mandantengrenze.
    .eq("tenant_id", access.tenant.id);

  const statuses = TAB_STATUSES[tab];
  if (statuses !== null) listQuery = listQuery.in("status", [...statuses]);

  const [{ data: listData, error: listError }, partners, plan] = await Promise.all([
    listQuery.order("created_at", { ascending: false }).limit(PAYOUT_LIST_LIMIT),
    listAffiliatePartners(access.tenant.id),
    planAffiliatePayoutRun(admin, {
      tenantId: access.tenant.id,
      programId: program.id,
    }),
  ]);

  if (listError) logDbError("Auszahlungsliste lesen", listError);
  const payouts = (listData ?? []) as unknown as PayoutListRow[];

  const partnerNameById = new Map(partners.rows.map((row) => [row.id, row.display_name]));

  // Abrechnungsprofile nur für die tatsächlich gezeigten Sätze.
  const partnerIds = [...new Set(payouts.map((row) => row.partner_id))];
  let profiles: BillingCheckRow[] = [];
  if (partnerIds.length > 0) {
    const { data: profileData, error: profileError } = await admin
      .from("affiliate_billing_profiles")
      .select(BILLING_CHECK_COLUMNS)
      .eq("tenant_id", access.tenant.id)
      .in("partner_id", partnerIds);
    if (profileError) logDbError("Abrechnungsprofile lesen", profileError);
    profiles = (profileData ?? []) as unknown as BillingCheckRow[];
  }
  const profileByPartner = new Map(profiles.map((row) => [row.partner_id, row]));

  // Belegnummern der neutralisierten Sätze. Eine Stornogutschrift muss in der
  // Liste sagen, WAS sie storniert — „minus 714,00 €" allein ist keine
  // Auskunft. Gelesen mit Mandantenfilter wie jede andere Abfrage dieser
  // Seite; ein Satz aus einem fremden Mandanten taucht damit gar nicht erst
  // als Name auf.
  const reversedIds = [
    ...new Set(
      payouts
        .map((row) => row.reverses_payout_id)
        .filter((value): value is string => value !== null),
    ),
  ];
  const reversedDocumentById = new Map<string, string | null>();
  if (reversedIds.length > 0) {
    const { data: reversedData, error: reversedError } = await admin
      .from("affiliate_payouts")
      .select("id, document_no")
      .eq("tenant_id", access.tenant.id)
      .in("id", reversedIds);
    if (reversedError) logDbError("Stornierte Belege lesen", reversedError);
    for (const entry of (reversedData ?? []) as unknown as Array<{
      id: string;
      document_no: string | null;
    }>) {
      reversedDocumentById.set(entry.id, entry.document_no);
    }
  }

  const money = (cents: number, currency: string) =>
    format.number(centsToAmount(cents), {
      style: "currency",
      currency: currencyCode(currency),
    });
  const day = (iso: string) =>
    format.dateTime(new Date(`${iso.slice(0, 10)}T00:00:00Z`), {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: "UTC",
    });

  /**
   * Die Vollständigkeit als TEXT (8.1: „Vollständigkeitsampel als TEXT, nicht
   * nur farbig").
   *
   * Sie ist ein BERICHT, keine Entscheidung: ob ausgezahlt werden darf,
   * entscheiden `planAffiliatePayoutRun()` und der Freigabe-RPC, und zwar
   * beide erneut. Hier steht nur, was einem Menschen auffallen soll, bevor er
   * eine Überweisung auslöst — vor allem der Fall, dass ein Partner seine
   * Zahlungsverbindung NACH dem Entwurf geändert hat.
   */
  function completeness(row: PayoutListRow): { text: string; complete: boolean } {
    const profile = profileByPartner.get(row.partner_id);
    if (profile === undefined) {
      return { text: tp("incomplete", { fields: tBlocked("billing_profile_missing") }), complete: false };
    }

    const missing: string[] = [];
    if (
      profile.legal_name === null ||
      profile.street === null ||
      profile.postal_code === null ||
      profile.city === null ||
      profile.country === null
    ) {
      missing.push(tBlocked("address_incomplete"));
    }
    const method = row.method ?? profile.payout_method;
    if (method === null) missing.push(tBlocked("payout_method_missing"));
    // Die IBAN wird geprüft, nicht gezeigt (8.1): eine ungültige Prüfziffer
    // ist der häufigste Grund für eine zurücklaufende Überweisung.
    if (method === "sepa" && !isValidIban(profile.iban)) missing.push(tBlocked("iban_invalid"));
    if (method === "paypal" && (profile.paypal_email ?? "").trim() === "") {
      missing.push(tBlocked("paypal_missing"));
    }

    if (missing.length === 0) return { text: tp("complete"), complete: true };
    return { text: tp("incomplete", { fields: missing.join(", ") }), complete: false };
  }

  const rows: PayoutRowView[] = payouts.map((row) => {
    const state = completeness(row);
    return {
      id: row.id,
      partnerName: partnerNameById.get(row.partner_id) ?? t("overview.partnerUnknown"),
      periodText: `${day(row.period_from)} – ${day(row.period_to)}`,
      grossText: money(row.gross_cents, row.currency),
      reversalText: money(row.reversal_cents, row.currency),
      subtotalText: money(row.subtotal_cents, row.currency),
      taxText: money(row.tax_cents, row.currency),
      totalText: money(row.total_cents, row.currency),
      totalCents: row.total_cents,
      currency: row.currency,
      taxModeText: tp(`taxMode.${row.tax_mode}`),
      methodText: row.method === null ? tp("methodUnknown") : tp(`method.${row.method}`),
      method: row.method,
      status: row.status,
      statusText: t(`status.payout.${row.status}`),
      documentNo: row.document_no,
      documentReady: row.document_path !== null,
      reference: row.reference,
      isReversal: row.reverses_payout_id !== null,
      // `null` bei gesetztem `isReversal` heißt „Beleg (noch) ohne Nummer",
      // nicht „kein Storno" — die Oberfläche unterscheidet beides.
      reversesDocumentNo:
        row.reverses_payout_id === null
          ? null
          : (reversedDocumentById.get(row.reverses_payout_id) ?? null),
      completenessText: state.text,
      complete: state.complete,
    };
  });

  // Vorschau des nächsten Laufs: Zeitraum aus dem Rhythmus des Programms,
  // Summen je Währung getrennt (5.11).
  const period = resolveAffiliatePayoutPeriod(program.payout_schedule);
  const candidates = plan.ok ? plan.candidates : [];
  const candidateTotals = [
    ...candidates
      .reduce((acc, candidate) => {
        acc.set(
          candidate.currency,
          (acc.get(candidate.currency) ?? 0) + candidate.preview_total_cents,
        );
        return acc;
      }, new Map<string, number>())
      .entries(),
  ]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([currency, cents]) => tp("run.previewTotal", { amount: money(cents, currency) }));

  const mode = TAB_MODE[tab];

  return (
    <AffiliateShell
      active="payouts"
      title={tp("title")}
      description={tp("description")}
    >
      {/* Der Lauf steht oben: er ist der erste Schritt, und alles darunter
          ist sein Ergebnis. */}
      <PayoutRunForm
        action={runPayoutDraftsAction}
        periodFrom={period.from}
        periodTo={period.to}
        candidateCount={candidates.length}
        candidateTotals={candidateTotals}
      />

      {!plan.ok && (
        <p
          role="alert"
          className={`${CARD_CLASS} p-[18px_22px] text-[15px]`}
          style={{ borderColor: CARD_BORDER, color: "#B24343" }}
        >
          {plan.reason === "tenant_legal_entity_missing"
            ? tp("legalEntityMissing")
            : tp("planUnavailable")}
        </p>
      )}

      {/* Reiter als echte Links: der Zustand steht in der Adresse und ist
          teilbar. `aria-current="page"` markiert den aktiven, die fette
          Schrift wiederholt es — nie nur Farbe (8.5). */}
      <nav aria-label={tp("tabsLabel")}>
        <ul className="flex flex-wrap gap-2 p-0" style={{ listStyle: "none" }}>
          {TABS.map((value) => {
            const isActive = value === tab;
            return (
              <li key={value}>
                <a
                  href={`/admin/affiliate/auszahlungen?tab=${value}`}
                  aria-current={isActive ? "page" : undefined}
                  className={`inline-flex min-h-[40px] items-center rounded-[11px] border px-[14px] text-[15px] no-underline ${FOCUS_RING}`}
                  style={
                    isActive
                      ? { background: NAVY, borderColor: NAVY, color: "#FFFFFF", fontWeight: 700 }
                      : { background: "#FFFFFF", borderColor: CARD_BORDER, color: NAVY, fontWeight: 600 }
                  }
                >
                  {tp(`tabs.${value}`)}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      <PayoutList
        mode={mode}
        rows={rows}
        approveAction={mode === "approve" ? approvePayoutsAction : undefined}
        paidAction={mode === "settle" ? markPaidAction : undefined}
        failedAction={mode === "settle" ? markFailedAction : undefined}
      />

      {/* „Nicht auszahlbar" mit dem KONKRETEN Grund je Partner (7.1, 8.1).
          Eine Zahl allein („3 Partner nicht auszahlbar") verlagert die Arbeit
          in eine Rückfrage; der Grund steht hier im selben Wortlaut, den der
          Partner in seinem Bereich liest. */}
      <section
        aria-labelledby="payouts-blocked-heading"
        className={`${CARD_CLASS} p-[22px_24px]`}
        style={{ borderColor: CARD_BORDER }}
      >
        <h2
          id="payouts-blocked-heading"
          className="text-[17px] font-bold"
          style={{ color: INK }}
        >
          {tp("blockedHeading")}
        </h2>
        {!plan.ok || plan.blocked.length === 0 ? (
          <p className="mt-1 text-[15px]" style={{ color: MUTED }}>
            {tp("blockedEmpty")}
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2 p-0 text-[15px]" style={{ listStyle: "none" }}>
            {plan.blocked.map((entry) => (
              <li key={`${entry.partner_id}-${entry.currency}-${entry.reason}`} style={{ color: INK }}>
                {tp("blockedReason", {
                  partner: partnerNameById.get(entry.partner_id) ?? t("overview.partnerUnknown"),
                  reason: tBlocked(entry.reason),
                })}
                <span style={{ color: MUTED }}>
                  {" — "}
                  {money(entry.available_cents, entry.currency)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AffiliateShell>
  );
}
