import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { AffiliatePayoutMethod, AffiliateTaxMode } from "@/lib/affiliate/types";

/**
 * Affiliate-System — der Entwurf der Stornogutschrift, an EINER Stelle
 * (PLAN_Affiliate-System.md 7.7; Abnahme, Befund N3).
 *
 * Warum eine eigene Datei: es gibt ZWEI Wege, auf denen ein bereits
 * nummerierter Beleg stillgelegt wird, und beide enden an derselben Kante.
 *   1. `markAffiliatePayoutFailed()` (payout.ts) — die Überweisung ist
 *      zurückgelaufen, ein Mensch vermerkt es.
 *   2. `quarantineFailedPayouts()` (integrity.ts) — der Kontrollabgleich
 *      findet einen Satz, dessen Positionssumme nicht zu seinem Kopf passt,
 *      und legt ihn still.
 * Der zweite Weg erzeugte den Storno-Entwurf NICHT. Danach war der Beleg
 * endgültig unneutralisierbar: `markAffiliatePayoutFailed()` verlangt
 * approved/exported, und 'failed' hat im Guard keine ausgehende Kante. Der
 * Beleg mit ausgewiesener Steuer blieb im Bestand, ohne jeden Weg zur
 * Berichtigung nach § 14c UStG.
 *
 * Die Funktion liegt deshalb weder in `payout.ts` noch in `integrity.ts`:
 * `payout.ts` importiert `integrity.ts`, die Gegenrichtung wäre ein
 * Modulzyklus. Ein gemeinsamer Ort ist die einzige Bauart, bei der die beiden
 * Wege nicht wieder auseinanderlaufen können.
 *
 * ABGRENZUNG ZU `reversal.ts` (Block B5): dort geht es um die Gegenbuchung
 * einer PROVISIONSZEILE nach einer Erstattung oder Rückbuchung. Hier geht es
 * um die Stornogutschrift eines BELEGS. Zwei verschiedene Ebenen, deshalb
 * zwei Dateien.
 */

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Die Spalten des Ursprungsbelegs, die der Storno spiegelt. Ausgeschrieben,
 * weil `select('*')` auf `affiliate_payouts` mit 42501 abbricht (Spaltenrecht)
 * — und weil eine Liste, die beide Aufrufer teilen, nicht an einem von beiden
 * verkürzt werden kann.
 */
export const AFFILIATE_REVERSAL_SOURCE_COLUMNS =
  "id, tenant_id, program_id, partner_id, period_from, period_to, currency, " +
  "gross_cents, reversal_cents, subtotal_cents, tax_mode, tax_rate_bp, tax_cents, " +
  "total_cents, status, method, document_no, reverses_payout_id, recipient_snapshot";

export type AffiliateReversalSourceRow = {
  id: string;
  tenant_id: string;
  program_id: string;
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
  status: string;
  method: AffiliatePayoutMethod | null;
  document_no: string | null;
  reverses_payout_id: string | null;
  recipient_snapshot: unknown;
};

/**
 * Drei Ausgänge statt `string | null`, weil zwei davon verschiedene
 * Handlungen verlangen:
 *   - `created`: der Entwurf steht, er wartet auf eine Freigabe.
 *   - `not_applicable`: es gibt nichts zu neutralisieren (Storno auf einen
 *     Storno, oder ein Satz, der nie eine Nummer gezogen hat). Kein Fehler.
 *   - `failed`: es hätte einen geben MÜSSEN und es gibt keinen. Das muss ein
 *     Mensch sehen; ein Log hält keine Steuerschuld auf.
 * `string | null` warf die letzten beiden zusammen — und genau darüber wäre
 * ein fehlender Storno wieder unsichtbar geworden.
 */
export type AffiliateReversalDraftResult =
  | { status: "created"; payout_id: string }
  | { status: "not_applicable" }
  | { status: "failed" };

/** Leerer, getrimmter oder fehlender Wert zählt als „keine Nummer". */
function hasDocumentNo(value: string | null): boolean {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Alle Zahlen des Ursprungsbelegs mit umgedrehtem Vorzeichen, derselbe
 * Zeitraum, dieselbe Währung, derselbe Steuermodus, derselbe Zahlweg. Die
 * Nummer zieht der Storno erst bei seiner EIGENEN Freigabe (7.3) — ein
 * Entwurf verbrennt keine.
 *
 * Ein Storno auf einen Storno gibt es nicht: die Kette endet nach einem
 * Schritt, sonst neutralisiert irgendwann jemand eine Neutralisierung.
 *
 * Die Provisionszeilen rührt diese Funktion NICHT an. Ob sie zurück in den
 * nächsten Lauf laufen, entscheidet der jeweilige Weg: bei der
 * fehlgeschlagenen Überweisung ja (`releaseClaimedRows()`), bei der
 * Quarantäne ausdrücklich nein — dort ist ungeklärt, warum die Summen
 * auseinanderlaufen, und die Stempel sind der einzige Beweis dafür, welche
 * Zeilen der Satz einmal eingesammelt hatte.
 */
export async function createAffiliateReversalDraft(
  admin: Admin,
  payout: AffiliateReversalSourceRow,
): Promise<AffiliateReversalDraftResult> {
  if (payout.reverses_payout_id !== null) return { status: "not_applicable" };
  if (!hasDocumentNo(payout.document_no)) return { status: "not_applicable" };

  const { data, error } = await admin
    .from("affiliate_payouts")
    .insert({
      tenant_id: payout.tenant_id,
      program_id: payout.program_id,
      partner_id: payout.partner_id,
      period_from: payout.period_from,
      period_to: payout.period_to,
      currency: payout.currency,
      gross_cents: -payout.gross_cents,
      reversal_cents: -payout.reversal_cents,
      subtotal_cents: -payout.subtotal_cents,
      tax_mode: payout.tax_mode,
      tax_rate_bp: payout.tax_rate_bp,
      tax_cents: -payout.tax_cents,
      total_cents: -payout.total_cents,
      status: "draft",
      method: payout.method,
      reverses_payout_id: payout.id,
      // Der Empfänger des Stornos ist der des Ursprungsbelegs — und zwar so,
      // wie er DORT eingefroren wurde, nicht wie er heute im Profil steht.
      recipient_snapshot: payout.recipient_snapshot ?? null,
    })
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error !== null || data === null) {
    // Nur der SQLSTATE, nie die rohe Meldung (CLAUDE.md §2.11).
    console.error(
      `[affiliate/payout-reversal] Storno-Entwurf nicht angelegt (Code ${
        (error as { code?: string } | null)?.code ?? "unbekannt"
      }).`,
    );
    return { status: "failed" };
  }
  return { status: "created", payout_id: data.id };
}
