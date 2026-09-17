import "server-only";
import { z } from "zod";
import type { createAdminClient } from "@/lib/supabase/admin";
import { writeAuditEntry } from "./audit";

/**
 * Affiliate-System, Block B9 — ANONYMISIERUNG STATT LÖSCHUNG
 * (PLAN_Affiliate-System.md 7.8, 10/B9).
 *
 * DIE ABWÄGUNG, um die es hier geht
 *
 * Ein Partner verlangt die Löschung seiner Daten (Art. 17 Abs. 1 DSGVO).
 * Gleichzeitig sind seine Gutschriften Buchungsbelege: § 147 Abs. 1 Nr. 4,
 * Abs. 3 AO und § 257 Abs. 1 Nr. 4, Abs. 4 HGB verpflichten den Aussteller,
 * Buchungsbelege ZEHN JAHRE aufzubewahren. Beides zugleich zu erfüllen ist
 * unmöglich, wenn man „löschen" wörtlich nimmt.
 *
 * Das Gesetz löst den Konflikt selbst: Art. 17 Abs. 3 lit. b DSGVO nimmt die
 * Verarbeitung aus, die „zur Erfüllung einer rechtlichen Verpflichtung"
 * erforderlich ist — die steuer- und handelsrechtliche Aufbewahrung ist
 * genau das. Der Löschanspruch entfällt für die Belege also nicht erst nach
 * einer Interessenabwägung, sondern kraft ausdrücklicher Ausnahme; er lebt
 * nach Ablauf der Frist wieder auf. Für alles, was KEIN Beleg ist, bleibt er
 * dagegen uneingeschränkt bestehen.
 *
 * Daraus folgt die Aufteilung, die diese Datei vornimmt:
 *
 *   BLEIBEN UNVERÄNDERT — `affiliate_commissions` und jeder NUMMERIERTE Satz
 *     in `affiliate_payouts`. Das sind die Buchungsbelege selbst (Betrag,
 *     Satz, Steuermodus, Belegnummer). Sie werden nicht angefasst, nicht
 *     überschrieben, nicht „geleert": ein Beleg, dessen Zahlen jemand
 *     nachträglich ändert, ist keiner mehr. Die Anschrift, die auf der
 *     Gutschrift stehen muss (§ 14 Abs. 4 UStG), steht dort in der PDF UND
 *     seit der Berichtigung zu Befund 10 zusätzlich in
 *     `affiliate_payouts.recipient_snapshot` (legal_name, street,
 *     postal_code, city, country, vat_id, tax_number) — genau deshalb darf
 *     das Abrechnungsprofil weg, und genau deshalb steht die Abgrenzung
 *     gleich darunter.
 *
 *   DIE GRENZE LÄUFT AN DER BELEGNUMMER, nicht an der Tabelle (Abnahme,
 *     Befund N4). Der Kopf dieser Datei behauptete früher, in
 *     `affiliate_payouts` stehe keine Anschrift; seit `recipient_snapshot`
 *     stimmt das nicht mehr, und die Datei wurde dabei nicht nachgezogen.
 *       * BELEG MIT NUMMER (`document_no is not null`) — bleibt vollständig.
 *         Art. 17 Abs. 3 lit. b DSGVO deckt ihn, und der Belegfrost im Guard
 *         ließe eine Änderung ohnehin nicht zu.
 *       * ENTWURF OHNE NUMMER — geht. Ein verworfener Entwurf
 *         ('cancelled') hat nie eine Nummer gezogen, ist kein Buchungsbeleg
 *         und steht nicht in `OPEN_PAYOUT_STATUSES`; er blockiert die
 *         Anonymisierung also nicht und behielte Anschrift, Steuernummer und
 *         USt-IdNr. sonst auf Dauer, obwohl der Partner die Löschung
 *         verlangt hat. Schritt 5b nullt dort `recipient_snapshot`.
 *
 *   WERDEN UNKENNTLICH — die Personendaten in `affiliate_partners`. Nach
 *     dieser Funktion trägt die Zeile keinen Namen, keine Firma, keine
 *     Adresse, keine Kontoverknüpfung und keinen Zustimmungsnachweis mehr.
 *     Übrig bleibt eine ID, ein Code und die Statushistorie — die
 *     Schlüssel, ohne die die Belege ins Leere zeigen würden.
 *
 *   WERDEN GELÖSCHT — `affiliate_billing_profiles` (Anschrift, Steuernummer,
 *     USt-IdNr., IBAN), `affiliate_referrals` und `affiliate_clicks` des
 *     Partners. Für diese drei gibt es keinen Aufbewahrungsgrund: sie sind
 *     Tracking- und Stammdaten, kein Beleg.
 *
 * WARUM DER PARTNER-CODE BLEIBT: er steht im `dedup_key` und in der
 * Attributionshistorie jeder Provisionszeile. Ihn zu ändern hieße, die
 * Zuordnung zwischen Beleg und Buchung zu kappen. Er ist für sich genommen
 * kein Personenbezug mehr, sobald Name, Firma und Adresse fort sind — ein
 * Kürzel wie `mm-4f2a` ohne jeden Datensatz dahinter.
 *
 * DER KÄUFER IST NICHT GEMEINT. `affiliate_referrals.user_id` und
 * `affiliate_customer_bindings` tragen den Personenbezug des GEWORBENEN.
 * Der hängt am bestehenden Löschprozess (`deletion_requests`), nicht hier —
 * ein Partner darf nicht durch seinen eigenen Löschantrag die Kontobindungen
 * fremder Käufer mitnehmen. Diese Funktion löscht `affiliate_referrals` des
 * Partners trotzdem, und das ist kein Widerspruch: die Zuordnungszeile ist
 * die Verbindung ZWISCHEN beiden, sie hat ohne den Partner keinen Zweck
 * mehr, und `affiliate_commissions.referral_id` fängt das per
 * `on delete set null (referral_id)` sauber ab (Migration 20260911130000,
 * der Guard lässt genau diesen Übergang zu).
 *
 * `affiliate_daily_stats` bleibt: Tagessummen je Partner, reine Zahlen ohne
 * Personenbezug, und die Kennzahlen des Mandanten sollen durch einen
 * Löschantrag nicht rückwirkend springen.
 *
 * `affiliate_audit_log` bleibt ebenfalls und muss es: die Tabelle ist
 * unveränderlich (Trigger weist jede Änderung ab, auch die des
 * `service_role`). Das ist nur deshalb kein Widerspruch zur Anonymisierung,
 * weil `audit.ts` die Personendaten schon beim SCHREIBEN schwärzt — sie
 * stehen dort von Anfang an als `***`. Siehe Kopfkommentar dort, Punkt 2.
 *
 * ABWEICHUNG VON DER PLAN-SIGNATUR (7.8 nennt
 * `anonymizeAffiliatePartner(partnerId, reason)`), zwei Gründe:
 *   1. `tenantId` MUSS dazu. Ohne ihn liefe jede Anweisung auf eine
 *      client-gelieferte ID ohne Mandantenbindung — genau das, was
 *      CLAUDE.md §2.15 und Plan 11.15 ausschließen.
 *   2. Der Admin-Client kommt als erster Parameter herein, wie bei
 *      `reverseForRefund()` (reversal.ts) und `markAffiliatePayoutPaid()`
 *      (payout.ts). Sonst wäre die Funktion ohne einen Modul-Mock nicht
 *      prüfbar, und eine ungeprüfte Löschfunktion ist die letzte, die man
 *      sich wünschen sollte.
 */

type Admin = ReturnType<typeof createAdminClient>;

/** Der Name, der nach der Anonymisierung in jeder Liste steht (7.8). */
export const AFFILIATE_ANONYMIZED_DISPLAY_NAME = "Gelöschter Partner";

/**
 * Die Ersatzadresse. `.invalid` ist die von RFC 2606 dafür reservierte
 * Top-Level-Domain — sie ist garantiert nicht auflösbar, eine Mail dorthin
 * kann also niemanden mehr erreichen, auch nicht versehentlich. Die
 * Partner-ID im lokalen Teil hält die Eindeutigkeit
 * `(tenant_id, program_id, applicant_email)` (3.3) auch dann, wenn beim
 * selben Mandanten mehrere Partner anonymisiert werden.
 */
export function anonymizedApplicantEmail(partnerId: string): string {
  return `deleted+${partnerId}@invalid`;
}

/**
 * Auszahlungszustände, in denen der Beleg noch NICHT fertig ist. Solange
 * einer davon offen ist, wird die Anschrift für die Gutschrift noch
 * gebraucht (§ 14 Abs. 4 UStG) — das Abrechnungsprofil darf dann nicht weg,
 * und eine halbe Anonymisierung wäre schlimmer als eine verschobene.
 */
const OPEN_PAYOUT_STATUSES = ["draft", "approved", "exported"] as const;

export const affiliateAnonymizeInputSchema = z.object({
  tenant_id: z.string().uuid(),
  partner_id: z.string().uuid(),
  /**
   * Der Anlass, wortwörtlich ins Protokoll. Pflicht: eine Anonymisierung
   * ohne festgehaltenen Grund ist gegenüber einer Aufsichtsbehörde nicht
   * erklärbar ("Löschantrag vom 12.09.2026, Ticket 4711").
   */
  reason: z.string().trim().min(3).max(500),
  /** `null` = automatisierter Lauf; sonst der entscheidende Mensch. */
  actor_user_id: z.string().uuid().nullable().default(null),
});

export type AffiliateAnonymizeInput = z.input<typeof affiliateAnonymizeInputSchema>;

export type AffiliateAnonymizeResult =
  | {
      ok: true;
      partner_id: string;
      /** `false`, wenn es gar kein Abrechnungsprofil gab (nie eines angelegt). */
      billing_profile_deleted: boolean;
      referrals_deleted: number;
      clicks_deleted: number;
      /**
       * Wie viele Auszahlungs-ENTWÜRFE ohne Belegnummer ihre eingefrorene
       * Anschrift verloren haben (Befund N4). Nummerierte Belege sind nie
       * dabei — siehe Kopf.
       */
      payout_snapshots_cleared: number;
    }
  | {
      ok: false;
      /**
       * `not_found`   — keine Partnerzeile dieses Mandanten mit dieser ID;
       * `payout_open` — es gibt eine Auszahlung, deren Beleg noch aussteht;
       * `write_failed`— eine Anweisung ist gescheitert, siehe Server-Log.
       */
      reason: "not_found" | "payout_open" | "write_failed";
    };

/**
 * Protokolliert einen Datenbankfehler OHNE Werte und ohne `error.message`
 * (CLAUDE.md §2.11) — dieselbe Form wie in `reversal.ts`/`payout.ts`. Gerade
 * hier wichtig: die Nutzlast dieser Anweisungen ist die E-Mail-Adresse und
 * der Name eines Menschen, der gerade seine Löschung verlangt hat.
 */
function logDbError(context: string, error: { code?: string } | null): void {
  console.error(`[affiliate/anonymize] ${context} fehlgeschlagen`, { code: error?.code });
}

export async function anonymizeAffiliatePartner(
  admin: Admin,
  input: AffiliateAnonymizeInput,
): Promise<AffiliateAnonymizeResult> {
  const parsed = affiliateAnonymizeInputSchema.parse(input);
  const { tenant_id: tenantId, partner_id: partnerId } = parsed;

  // --- Schritt 1: Mandantenbindung der client-gelieferten ID -------------
  // VOR allem anderen, wie in `changePartnerStatus()` (actions.ts). Ein
  // `where id = :clientId` ohne `tenant_id` wäre hier nicht nur ein Leseleck,
  // sondern ein Löschbefehl über Mandantengrenzen hinweg.
  const { data: partner, error: readError } = await admin
    .from("affiliate_partners")
    .select("id, tenant_id, status, code, user_id")
    .eq("tenant_id", tenantId)
    .eq("id", partnerId)
    .maybeSingle();
  if (readError) {
    logDbError("Partner lesen", readError);
    return { ok: false, reason: "write_failed" };
  }
  if (partner === null) return { ok: false, reason: "not_found" };

  const before = partner as { status: string; code: string; user_id: string | null };

  // --- Schritt 2: Offene Belege sperren die Anonymisierung ---------------
  const { data: openPayouts, error: payoutError } = await admin
    .from("affiliate_payouts")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("partner_id", partnerId)
    .in("status", [...OPEN_PAYOUT_STATUSES])
    .limit(1);
  if (payoutError) {
    logDbError("Offene Auszahlungen prüfen", payoutError);
    return { ok: false, reason: "write_failed" };
  }
  if ((openPayouts ?? []).length > 0) return { ok: false, reason: "payout_open" };

  // --- Schritt 3: die Personendaten der Partnerzeile ---------------------
  // ZUERST, nicht zuletzt. Bricht ein späterer Schritt ab, ist der Name
  // trotzdem schon fort; umgekehrt stünde er nach einem Abbruch noch da,
  // obwohl Klicks und Profil bereits gelöscht wären. Die Funktion ist dabei
  // idempotent: ein zweiter Lauf schreibt dieselben Werte noch einmal.
  //
  // `status` bleibt stehen (auch `active`). Ihn hier auf `suspended` zu
  // setzen wäre eine fachliche Entscheidung, die dieser Funktion nicht
  // zusteht — ein Löschantrag ist keine Sperre. Wer den Partner zusätzlich
  // stilllegen will, tut das über `suspendAffiliatePartner()`.
  const { error: updateError } = await admin
    .from("affiliate_partners")
    .update({
      display_name: AFFILIATE_ANONYMIZED_DISPLAY_NAME,
      company: null,
      user_id: null,
      applicant_email: anonymizedApplicantEmail(partnerId),
      application: {},
      internal_note: null,
      terms_accepted_ip_hash: null,
    })
    .eq("tenant_id", tenantId)
    .eq("id", partnerId);
  if (updateError) {
    logDbError("Partnerzeile anonymisieren", updateError);
    return { ok: false, reason: "write_failed" };
  }

  // --- Schritt 4: Tracking-Zeilen ohne Aufbewahrungsgrund ----------------
  // Zuordnungen VOR Klicks: `affiliate_referrals.click_id` zeigt auf
  // `affiliate_clicks` und wird per `on delete set null (click_id)` gekappt.
  // Andersherum entstünde derselbe Endzustand, aber mit einem zusätzlichen,
  // überflüssigen Schreibvorgang auf jeder Zuordnungszeile.
  const { data: deletedReferrals, error: referralError } = await admin
    .from("affiliate_referrals")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("partner_id", partnerId)
    .select("id");
  if (referralError) {
    logDbError("Zuordnungen löschen", referralError);
    return { ok: false, reason: "write_failed" };
  }

  const { data: deletedClicks, error: clickError } = await admin
    .from("affiliate_clicks")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("partner_id", partnerId)
    .select("id");
  if (clickError) {
    logDbError("Klickzeilen löschen", clickError);
    return { ok: false, reason: "write_failed" };
  }

  // --- Schritt 5: Abrechnungsprofil ---------------------------------------
  // Anschrift, Steuernummer, USt-IdNr., IBAN. Erst jetzt, nachdem Schritt 2
  // bestätigt hat, dass kein Beleg mehr darauf wartet.
  const { data: deletedProfiles, error: billingError } = await admin
    .from("affiliate_billing_profiles")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("partner_id", partnerId)
    .select("partner_id");
  if (billingError) {
    logDbError("Abrechnungsprofil löschen", billingError);
    return { ok: false, reason: "write_failed" };
  }

  // --- Schritt 5b: Anschrift an Entwürfen ohne Belegnummer ----------------
  // Siehe Kopf, „DIE GRENZE LÄUFT AN DER BELEGNUMMER" (Befund N4). Der Filter
  // `is("document_no", null)` ist die Grenze selbst und nicht nur eine
  // Vorsichtsmaßnahme: ohne ihn liefe die Anweisung in den Belegfrost des
  // Guards, der `recipient_snapshot` ab vergebener Nummer auf den alten Wert
  // zurücksetzt — die Anweisung ginge durch, ohne etwas zu bewirken, und der
  // Rückgabewert läge über der Wirklichkeit.
  //
  // Nach Schritt 2 kann hier ohnehin nur ein 'cancelled'-Entwurf stehen:
  // draft/approved/exported sind ausgeschlossen, paid und failed tragen eine
  // Nummer.
  const { data: clearedSnapshots, error: snapshotError } = await admin
    .from("affiliate_payouts")
    .update({ recipient_snapshot: null })
    .eq("tenant_id", tenantId)
    .eq("partner_id", partnerId)
    .is("document_no", null)
    .select("id");
  if (snapshotError) {
    logDbError("Anschrift an Entwürfen ohne Beleg löschen", snapshotError);
    return { ok: false, reason: "write_failed" };
  }

  // --- Schritt 6: Prüfpfad ------------------------------------------------
  // `writeAuditEntry()` wirft, wenn der Eintrag nicht geschrieben wurde — und
  // hier wird das bewusst NICHT gefangen (anders als im Bewerbungspfad, der
  // seine Ausnahme an der Stelle begründet): eine Anonymisierung, von der es
  // keinen Nachweis gibt, ist gegenüber der Aufsichtsbehörde wertlos. Der
  // Aufrufer bekommt dann eine Ausnahme und muss den Vorgang wiederholen; er
  // ist idempotent, eine Wiederholung kostet nichts.
  //
  // `before`/`after` enthalten absichtlich KEINE Personendaten: der alte Name
  // und die alte Adresse gehören nicht in ein unveränderliches Protokoll,
  // sonst liefe die ganze Anonymisierung ins Leere (audit.ts schwärzt sie
  // ohnehin, aber sie hier gar nicht erst mitzugeben ist die klarere Regel).
  await writeAuditEntry({
    tenantId,
    actorKind: parsed.actor_user_id === null ? "system" : "manager",
    actorUserId: parsed.actor_user_id,
    entity: "partner",
    entityId: partnerId,
    action: "partner.anonymize",
    before: { status: before.status, had_user_account: before.user_id !== null },
    after: {
      reason: parsed.reason,
      referrals_deleted: (deletedReferrals ?? []).length,
      clicks_deleted: (deletedClicks ?? []).length,
      billing_profile_deleted: (deletedProfiles ?? []).length > 0,
      commissions_kept: true,
      payouts_kept: true,
      payout_snapshots_cleared: (clearedSnapshots ?? []).length,
    },
  });

  return {
    ok: true,
    partner_id: partnerId,
    billing_profile_deleted: (deletedProfiles ?? []).length > 0,
    referrals_deleted: (deletedReferrals ?? []).length,
    clicks_deleted: (deletedClicks ?? []).length,
    payout_snapshots_cleared: (clearedSnapshots ?? []).length,
  };
}
