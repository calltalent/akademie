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
import { verifyAffiliateIntegrity } from "@/lib/affiliate/integrity";
import {
  approveAffiliatePayout,
  createAffiliatePayoutDrafts,
  markAffiliatePayoutFailed,
  markAffiliatePayoutPaid,
  planAffiliatePayoutRun,
  resolveAffiliatePayoutPeriod,
} from "@/lib/affiliate/payout";
import { getAffiliateProgram, listAffiliatePartners } from "@/lib/affiliate/queries";
import { isValidIban } from "@/lib/affiliate/sepa";
import { resolveAffiliateTaxMode } from "@/lib/affiliate/tax";
import type { AffiliatePayoutActionState } from "@/lib/affiliate/state";
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
  "document_issued_at, reference, approved_at, paid_at, created_at";

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
    if (parsed.data.periodTo < parsed.data.periodFrom) {
      return { error: "Das Ende des Zeitraums liegt vor seinem Anfang." };
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
  /** `<waehrung>:<cent>`, genau so, wie die Bestätigungskarte es angezeigt hat. */
  expected: z.array(z.string().regex(/^[a-z]{3}:\d{1,12}$/)).max(10),
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
    if (!parsed.success) return { error: NOTHING_SELECTED };
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
      const [currency, cents] = entry.split(":");
      expected.set(currency, Number(cents));
    }
    const actual = new Map<string, number>();
    for (const draft of drafts) {
      actual.set(draft.currency, (actual.get(draft.currency) ?? 0) + draft.total_cents);
    }
    if (expected.size !== actual.size) return { error: AMOUNT_CHANGED };
    for (const [currency, cents] of actual) {
      if (expected.get(currency) !== cents) return { error: AMOUNT_CHANGED };
    }

    const report = await verifyAffiliateIntegrity(admin, tenant.id);

    let approved = 0;
    let blocked = 0;
    let failed = 0;

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
      await storeCreditNote(tenant.id, tenant.name, tenant.legal, draft.id);
    }

    revalidatePath(PAYOUT_PATH);

    if (approved === 0 && blocked > 0) return { error: SELF_DEALING };
    if (approved === 0) return { error: "Es wurde keine Auszahlung freigegeben. Bitte die Liste prüfen." };
    if (blocked > 0 || failed > 0) {
      return {
        error: `${approved} Auszahlungen wurden freigegeben, ${blocked + failed} nicht. Bitte die Liste prüfen.`,
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

/**
 * Die Überweisung ist fehlgeschlagen (7.7): Satz auf `failed`, die
 * Provisionszeilen werden freigegeben und laufen in den nächsten Entwurf. Der
 * Beleg bleibt bestehen — er wird nie gelöscht, sondern per Stornogutschrift
 * mit eigener Nummer neutralisiert.
 */
async function markFailedAction(
  _state: AffiliatePayoutActionState,
  formData: FormData,
): Promise<AffiliatePayoutActionState> {
  "use server";
  try {
    const { tenant, user } = await requireAffiliateManager();

    const parsed = uuidSchema.safeParse(formData.get("payoutId"));
    if (!parsed.success) return { error: PAYOUT_NOT_FOUND };

    const admin = createAdminClient();
    const result = await markAffiliatePayoutFailed(admin, {
      tenantId: tenant.id,
      payoutId: parsed.data,
    });
    if (!result.ok) {
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
      entityId: parsed.data,
      action: "payout.mark_failed",
      after: { released_rows: result.affected_rows },
    });

    revalidatePath(PAYOUT_PATH);
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
 * Zwei Dinge, die diese Funktion NICHT tut:
 *   - Sie rechnet nichts nach. Alle Zahlen kommen aus der Zeile, so wie sie
 *     eingefroren wurde; ein zweiter Rechenweg könnte ein PDF erzeugen, das
 *     seinem eigenen Belegkopf widerspricht.
 *   - Sie erfindet keinen Steuerhinweis. Der Pflichttext nach § 14 Abs. 4
 *     UStG kommt aus `tax.ts`, und zwar nur, wenn der dort aus dem
 *     Abrechnungsprofil abgeleitete Modus mit dem EINGEFRORENEN Modus des
 *     Belegs übereinstimmt. Hat sich das Profil seit dem Entwurf geändert,
 *     entsteht kein PDF — ein Beleg mit dem falschen Steuerhinweis ist ein
 *     § 14c-Fall und teurer als ein fehlendes PDF.
 */
async function storeCreditNote(
  tenantId: string,
  tenantName: string,
  tenantLegal: unknown,
  payoutId: string,
): Promise<void> {
  try {
    const legalEntity = resolveLegalEntity(tenantLegal);
    if (legalEntity === null) return;

    const admin = createAdminClient();
    const { data: payoutData, error: payoutError } = await admin
      .from("affiliate_payouts")
      .select(
        "id, partner_id, period_from, period_to, currency, gross_cents, reversal_cents, " +
          "subtotal_cents, tax_mode, tax_rate_bp, tax_cents, total_cents, method, " +
          "document_no, document_issued_at, document_path",
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
      }>();

    if (payoutError || payoutData === null) return;
    if (payoutData.document_no === null) return;
    // Schon vorhanden: nichts überschreiben. Ein zweites PDF zu derselben
    // Nummer wäre ein zweiter Beleg.
    if (payoutData.document_path !== null) return;

    const { data: profile, error: profileError } = await admin
      .from("affiliate_billing_profiles")
      .select(
        "partner_id, entity_kind, legal_name, street, postal_code, city, country, " +
          "small_business, vat_id, tax_number, vat_check_result, vat_checked_at",
      )
      .eq("tenant_id", tenantId)
      .eq("partner_id", payoutData.partner_id)
      .maybeSingle<{
        entity_kind: AffiliateEntityKind | null;
        legal_name: string | null;
        street: string | null;
        postal_code: string | null;
        city: string | null;
        country: string | null;
        small_business: boolean;
        vat_id: string | null;
        tax_number: string | null;
        vat_check_result: AffiliateVatCheckResult | null;
        vat_checked_at: string | null;
      }>();

    if (profileError || profile === null) return;
    if (
      profile.legal_name === null ||
      profile.street === null ||
      profile.postal_code === null ||
      profile.city === null ||
      profile.country === null
    ) {
      return;
    }

    const mode = resolveAffiliateTaxMode(
      {
        entity_kind: profile.entity_kind,
        country: profile.country,
        small_business: profile.small_business,
        vat_id: profile.vat_id,
        vat_check_result: profile.vat_check_result,
        vat_checked_at: profile.vat_checked_at,
      },
      new Date(),
    );
    if (!mode.ok || mode.tax_mode !== payoutData.tax_mode) {
      console.error(
        "[admin/affiliate/auszahlungen] Steuermodus des Profils weicht vom Beleg ab; kein PDF erzeugt.",
      );
      return;
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
      taxHint: mode.documentHint,
      issuer: { legalEntity, vatId: null },
      recipient: {
        legalName: profile.legal_name,
        street: profile.street,
        postalCode: profile.postal_code,
        city: profile.city,
        country: profile.country,
        vatId: profile.vat_id,
        taxNumber: profile.tax_number,
      },
      tenantName,
      method: payoutData.method,
    });

    // Der Pfad wird BERECHNET, nie aus der Zeile übernommen — dieselbe
    // Konvention, die der CHECK auf `document_path` erzwingt (§2.5).
    const path = affiliateCreditNotePath(tenantId, payoutData.id);
    const { error: uploadError } = await admin.storage
      .from("affiliate-documents")
      .upload(path, pdfBytes, { contentType: "application/pdf", upsert: false });
    if (uploadError) {
      console.error("[admin/affiliate/auszahlungen] Beleg-Upload fehlgeschlagen.");
      return;
    }

    const { error: updateError } = await admin
      .from("affiliate_payouts")
      .update({ document_path: path })
      .eq("tenant_id", tenantId)
      .eq("id", payoutData.id)
      .is("document_path", null);
    if (updateError) logDbError("Belegpfad eintragen", updateError);
  } catch (e) {
    // Auch ein Fehler in pdf-lib darf die Freigabe nicht nachträglich
    // entwerten. Ohne Werte ins Log (§2.11).
    console.error("[admin/affiliate/auszahlungen] Belegerzeugung fehlgeschlagen.", {
      known: e instanceof Error,
    });
  }
}

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
