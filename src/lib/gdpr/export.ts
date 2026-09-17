import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Partnerspalten für die Selbstauskunft. Wortgleich zu
 * `PARTNER_ADMIN_COLUMNS` (`src/lib/affiliate/queries.ts`) — inklusive
 * `internal_note` und `status_reason`, denn ein Vermerk ÜBER den Betroffenen
 * ist sein personenbezogenes Datum (Art. 15 Abs. 1 DSGVO), und ohne
 * `terms_accepted_ip_hash`, siehe Kopf.
 */
const AFFILIATE_PARTNER_EXPORT_COLUMNS =
  "id, tenant_id, program_id, user_id, applicant_email, display_name, company, code, " +
  "status, status_reason, group_id, referred_by, payout_hold, payout_hold_reason, " +
  "internal_note, application, terms_version_accepted, terms_accepted_at, " +
  "notify_sale, notify_reversal, notify_payout, created_at, updated_at";

/**
 * DIE KÄUFERDATENGRENZE (Abnahme, Befund S3).
 *
 * Fünf Spalten fehlen hier ABSICHTLICH, und zwar dieselben fünf, die
 * Migration 20260911130000 (Abschnitt 2.5) dem `authenticated`-Spaltenrecht
 * mit ausdrücklicher Begründung entzogen hat: `order_id`,
 * `stripe_invoice_id`, `stripe_subscription_id`, `stripe_charge_id` und —
 * der unauffälligste Weg — `dedup_key`, der genau diese Kennungen im
 * Klartext trägt (`sale:<order_id>`, `recurring:<stripe_invoice_id>`).
 *
 * Warum das hier eigens dastehen muss: dieser Export läuft über
 * `createAdminClient()`, und `service_role` umgeht RLS UND Spaltenrechte.
 * Die Datenbankgrenze greift an dieser Stelle also gerade NICHT — sie muss
 * hier wiederholt werden, sonst baut die Selbstauskunft genau die
 * exportierbare Bestellliste der Käufer wieder auf, die das Spaltenrecht
 * zugemauert hat (Plan 11.15).
 *
 * Art. 15 Abs. 1 DSGVO verlangt die Daten ÜBER DIE PERSON, nicht die
 * Bestellkennungen ihrer Kunden. Die Provisionszeile bleibt ohne die fünf
 * Spalten vollständig nachvollziehbar: `kind`, `base_cents`, `rate_kind`,
 * `rate_bp`, `fixed_cents`, `amount_cents`, `currency`, `booked_at`,
 * `condition_snapshot` und `status` ergeben die Rechnung Zeile für Zeile.
 *
 * DREI SPALTEN BLEIBEN BEWUSST DRIN, obwohl das Spaltenrecht sie ebenfalls
 * nicht hergibt — das ist eine Entscheidung, kein Versehen:
 *   * `note` und `flag_reason` sind Vermerke ÜBER DEN BETROFFENEN
 *     („Verdacht auf Eigenbestellungen"). Ein Vermerk über eine Person IST
 *     ihr personenbezogenes Datum, und Art. 15 nimmt interne Notizen nicht
 *     aus; dieselbe Abwägung wie bei `internal_note` und `status_reason`
 *     oben. Dass ein Partner sie in der OBERFLÄCHE nicht sieht, ist eine
 *     andere Frage als die, was ihm auf Auskunftsverlangen zusteht.
 *   * `condition_snapshot` ist der eingefrorene Rechenweg SEINER eigenen
 *     Provision — ohne ihn ist die Zeile nicht nachrechenbar. Er enthält
 *     keine Käuferdaten, sondern Programm- und Konditionsparameter.
 * Der Widerspruch zum Spaltenrecht ist damit benannt und begrenzt; er gehört
 * zusätzlich nach PHASENSTATUS.md.
 */
const AFFILIATE_COMMISSION_EXPORT_COLUMNS =
  "id, tenant_id, program_id, partner_id, kind, product_id, campaign, referral_id, " +
  "parent_id, reverses_id, base_cents, basis_kind, rate_kind, rate_bp, fixed_cents, " +
  "amount_cents, currency, condition_id, condition_snapshot, status, cancel_reason, " +
  "hold_until, booked_at, payout_id, paid_at, flagged, flag_reason, is_test, note, " +
  "created_at, updated_at";

/**
 * Ohne `document_path` und `reference`, aus demselben Grund wie oben.
 *   * `reference` ist die ZAHLUNGSREFERENZ AUS DEM BANKAUSZUG DES MANDANTEN
 *     („SEPA-2026-10-01/17") — eine interne Betriebsangabe des Auftraggebers,
 *     kein Datum über den Partner. Migration 20260911150000 entzieht sie dem
 *     Spaltenrecht mit genau dieser Begründung.
 *   * `document_path` ist der Ablageort im privaten Bucket. Er ist allein
 *     nicht ausnutzbar (der Bucket hat keine Client-Policy), aber er ist auch
 *     zu nichts nütze: das Beleg-PDF bekommt der Partner über die Belegroute,
 *     und ein Speicherpfad ist kein personenbezogenes Datum.
 * Was ihm zusteht, bleibt vollständig: Zeitraum, Summen, Steuermodus,
 * Steuerbetrag, Status, Zahlweg, BELEGNUMMER und Ausstellungsdatum — also
 * alles, was auf der Gutschrift steht.
 */
const AFFILIATE_PAYOUT_EXPORT_COLUMNS =
  "id, tenant_id, program_id, partner_id, period_from, period_to, currency, " +
  "gross_cents, reversal_cents, subtotal_cents, tax_mode, tax_rate_bp, tax_cents, " +
  "total_cents, status, method, document_no, document_issued_at, " +
  "reverses_payout_id, approved_at, paid_at, created_at, updated_at";

/**
 * Das Abrechnungsprofil MIT Bankverbindung: der Empfänger dieses Exports ist
 * der Kontoinhaber selbst, und die Selbstauskunft soll ihm zeigen, welche
 * Zahlungsdaten der Mandant über ihn führt. `vat_check_log` bleibt draußen —
 * das ist das Rohprotokoll der VIES-Abfrage (technische Antwortdaten eines
 * Drittdienstes), kein Datum über die Person.
 */
const AFFILIATE_BILLING_EXPORT_COLUMNS =
  "partner_id, tenant_id, entity_kind, legal_name, street, postal_code, city, country, " +
  "small_business, vat_id, tax_number, vat_checked_at, vat_check_result, payout_method, " +
  "account_holder, iban, bic, paypal_email, created_at, updated_at";

const AFFILIATE_REFERRAL_EXPORT_COLUMNS =
  "id, tenant_id, program_id, partner_id, click_id, campaign, user_id, bound_at, " +
  "status, expires_at, created_at";

const AFFILIATE_BINDING_EXPORT_COLUMNS =
  "id, tenant_id, program_id, user_id, partner_id, source, bound_at";

/**
 * DSGVO-Selbstauskunft/-Datenexport (Art. 15/20 DSGVO), Phase 4 Block 3.
 *
 * Sammelt alle personenbezogenen Daten EINES Nutzers über ALLE Mandanten
 * hinweg, bei denen er Mitglied ist — genau die Tabellen aus dem
 * Security-Review (Phase 1, Block 7) als DSGVO-relevant vorgemerkt:
 * profiles, memberships, progress, submissions, attempts, certificates,
 * orders, tutor_conversations, tutor_messages. Ergänzt (Marketplace-
 * Gesamtaudit, 04.08.2026, security-reviewer-Fund): enrollments — fehlte
 * hier seit Phase 4, wurde durch den Marketplace (Block M5) relevant, da ein
 * KOSTENLOSER Marketplace-Erwerb (src/lib/marketplace/acquire.ts) KEINE
 * orders-Zeile erzeugt; die enrollments-Zeile (source='marketplace') ist
 * dort der einzige Nachweis der Transaktion und muss deshalb Teil der
 * DSGVO-Selbstauskunft sein.
 *
 * WICHTIG (Sicherheitsregel, siehe PHASENSTATUS.md Block-3-Plan):
 * Diese Funktion prüft SELBST KEINE Berechtigung. `userId` MUSS vom
 * Aufrufer bereits aus einer serverseitig geprüften Session stammen
 * (`supabase.auth.getUser()`), NIEMALS aus Client-/URL-/Body-Parametern —
 * siehe src/app/profil/export/route.ts. `supabase` MUSS der Admin-Client
 * (service_role, `createAdminClient()`) sein, den der Aufrufer übergibt:
 * die Autorisierung ist zu diesem Zeitpunkt bereits durch die
 * Session-Prüfung des Aufrufers sichergestellt; RLS würde bei manchen
 * dieser Tabellen sonst inkonsistent/zu restriktiv filtern (z. B. hat
 * `tutor_messages` keine eigene "eigene Nachricht"-Select-Policy, nur
 * `tutor_msg_own_select` über den Umweg der Konversation).
 *
 * ABWEICHUNG vom wörtlichen architect-Plan (dokumentiert, technisch
 * zwingend): `tutor_messages` hat laut `0001_init.sql` (Zeilen 319-333)
 * KEINE `user_id`-Spalte — nur `tutor_conversations` hat `user_id`, die
 * Nachrichten hängen ausschließlich über `conversation_id` daran. Ein
 * direktes `.eq("user_id", userId)` auf `tutor_messages` ist technisch
 * nicht möglich. Stattdessen: zuerst die eigenen Konversations-IDs laden,
 * dann alle Nachrichten (Rolle "user" UND "assistant") dieser
 * Konversationen — das bildet den vollständigen eigenen Tutor-Chatverlauf
 * ab, exakt das, was der Nutzer nach Art. 15/20 DSGVO erwarten würde.
 *
 * Schichtplan-Nachzug (Block S2, 08.08.2026, SPEC.md §12): `calendar_workers`
 * hat KEINE direkte `user_id`-Filterung auf `calendar_shifts`/
 * `calendar_time_entries`/`calendar_absences` (die hängen an `worker_id`,
 * nicht an `user_id`) — gleiches Zwei-Schritt-Prinzip wie bei
 * `tutor_messages` oben: zuerst die eigenen Arbeiterzeilen (ein Nutzer kann
 * in mehreren Mandanten je eine Arbeiterzeile haben) laden, dann alle drei
 * Tabellen über `worker_id in (...)`. `calendar_absences` mit
 * `worker_id is null` (mandantenweite Feiertage) wird bewusst NICHT
 * aufgenommen — das sind keine personenbezogenen Daten dieses Nutzers.
 * `kind = 'sick'` ist ein Gesundheitsdatum (Art. 9 DSGVO), muss deshalb Teil
 * der Selbstauskunft sein, seit S2 real vorhanden — S1 hatte nur
 * `calendar_time_entries` (Ist-Zeiten, keine Gesundheitsdaten) hier bereits
 * angemahnt, aber noch nicht nachgezogen.
 *
 * Schichtplan-Nachzug (Block S3, 09.08.2026): `calendar_shift_change_requests`
 * hängt ebenfalls an `worker_id`, nicht an `user_id` — gleiches Zwei-
 * Schritt-Prinzip wie `calendar_shifts`/`calendar_time_entries`/
 * `calendar_absences` oben, über dieselben bereits geladenen
 * `calendarWorkerIds`.
 *
 * Affiliate-Nachzug (Block B9, 17.09.2026, PLAN_Affiliate-System.md 7.8):
 * ZWEI GETRENNTE SICHTEN, weil ein und derselbe Mensch beides sein kann —
 * Partner UND geworbener Käufer. Wer als Partner wirbt und beim selben
 * Mandanten selbst kauft, hat zwei völlig verschiedene Rollen in diesem
 * Modul, und eine gemeinsame Liste ließe nicht erkennen, welche Zeile zu
 * welcher Rolle gehört:
 *
 *   `affiliate_partner` / `affiliate_commissions` / `affiliate_payouts` /
 *   `affiliate_billing_profile`     — er als WERBENDER,
 *   `affiliate_referrals` / `affiliate_customer_bindings`
 *                                   — er als GEWORBENER.
 *
 * ZWEI-SCHRITT-PRINZIP wie bei `tutor_messages` und `calendar_workers`:
 * `affiliate_commissions`, `affiliate_payouts` und
 * `affiliate_billing_profiles` haben KEINE `user_id`-Spalte, sie hängen
 * ausschließlich an `partner_id`. Ein Partner wird deshalb zuerst über
 * `affiliate_partners.user_id` gesucht (ein Nutzer kann bei mehreren
 * Mandanten Partner sein, deshalb eine Liste von IDs, kein einzelner Wert),
 * danach laufen die drei Abfragen über `partner_id in (…)`.
 *
 * `affiliate_clicks` ist NICHT dabei und kann es nicht sein: die Tabelle hat
 * keine `user_id`, die IP steht dort nur als HMAC mit täglich rotierendem
 * Salz (3.6) und ist nach der Rotation faktisch nicht mehr auf eine Person
 * zurückzuführen. Es gibt keinen Weg, die Klickzeilen EINES Nutzers zu
 * bestimmen, ohne genau die Wiedererkennbarkeit herzustellen, die das
 * rotierende Salz verhindert.
 *
 * `affiliate_daily_stats` fehlt bewusst: rein abgeleitete Tagessummen, aus
 * Klicks und Provisionen jederzeit neu berechenbar — dieselbe Begründung,
 * mit der der Mandanten-Export die Vektorspalte von `embeddings` auslässt.
 *
 * SPALTEN WERDEN NAMENTLICH GENANNT, kein `select("*")`. Zwei Gründe: die
 * fünf Affiliate-Tabellen tragen Spalten-Grants (3.3/3.13), an denen ein
 * `*` mit 42501 abbricht, sobald die Abfrage je gegen eine andere Rolle als
 * `service_role` läuft — und `affiliate_partners.terms_accepted_ip_hash` ist
 * der Zustimmungsnachweis (11.6), der in keiner Liste und keinem Export
 * etwas zu suchen hat, hier genauso wenig wie in `queries.ts`.
 */
export async function exportUserData(supabase: SupabaseClient, userId: string) {
  const [
    profileRes,
    membershipsRes,
    enrollmentsRes,
    progressRes,
    submissionsRes,
    attemptsRes,
    certificatesRes,
    ordersRes,
    tutorConversationsRes,
    calendarWorkersRes,
    affiliatePartnersRes,
    affiliateReferralsRes,
    affiliateBindingsRes,
  ] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    supabase.from("memberships").select("*").eq("user_id", userId),
    supabase.from("enrollments").select("*").eq("user_id", userId),
    supabase.from("progress").select("*").eq("user_id", userId),
    supabase.from("submissions").select("*").eq("user_id", userId),
    supabase.from("attempts").select("*").eq("user_id", userId),
    supabase.from("certificates").select("*").eq("user_id", userId),
    supabase.from("orders").select("*").eq("user_id", userId),
    supabase.from("tutor_conversations").select("*").eq("user_id", userId),
    supabase.from("calendar_workers").select("*").eq("user_id", userId),
    // Sicht 1 (WERBENDER): ein Nutzer kann bei mehreren Mandanten Partner
    // sein — deshalb eine Liste, kein `maybeSingle()`.
    supabase.from("affiliate_partners").select(AFFILIATE_PARTNER_EXPORT_COLUMNS).eq("user_id", userId),
    // Sicht 2 (GEWORBENER): `affiliate_referrals.user_id` ist der KÄUFER,
    // nicht der Partner (3.7, „Kontobindung nach Registrierung/Login").
    supabase.from("affiliate_referrals").select(AFFILIATE_REFERRAL_EXPORT_COLUMNS).eq("user_id", userId),
    supabase
      .from("affiliate_customer_bindings")
      .select(AFFILIATE_BINDING_EXPORT_COLUMNS)
      .eq("user_id", userId),
  ]);

  const conversations = tutorConversationsRes.data ?? [];
  const conversationIds = conversations.map((c) => c.id as string);

  let tutorMessages: unknown[] = [];
  if (conversationIds.length > 0) {
    const { data } = await supabase
      .from("tutor_messages")
      .select("*")
      .in("conversation_id", conversationIds);
    tutorMessages = data ?? [];
  }

  const calendarWorkers = calendarWorkersRes.data ?? [];
  const calendarWorkerIds = calendarWorkers.map((w) => w.id as string);

  let calendarShifts: unknown[] = [];
  let calendarTimeEntries: unknown[] = [];
  let calendarAbsences: unknown[] = [];
  let calendarChangeRequests: unknown[] = [];
  if (calendarWorkerIds.length > 0) {
    const [shiftsRes, timeEntriesRes, absencesRes, changeRequestsRes] = await Promise.all([
      supabase.from("calendar_shifts").select("*").in("worker_id", calendarWorkerIds),
      supabase.from("calendar_time_entries").select("*").in("worker_id", calendarWorkerIds),
      supabase.from("calendar_absences").select("*").in("worker_id", calendarWorkerIds),
      supabase.from("calendar_shift_change_requests").select("*").in("worker_id", calendarWorkerIds),
    ]);
    calendarShifts = shiftsRes.data ?? [];
    calendarTimeEntries = timeEntriesRes.data ?? [];
    calendarAbsences = absencesRes.data ?? [];
    calendarChangeRequests = changeRequestsRes.data ?? [];
  }

  // --- Affiliate, zweiter Schritt (7.8) ---------------------------------
  // `affiliate_commissions`, `affiliate_payouts` und
  // `affiliate_billing_profiles` hängen an `partner_id`, nicht an `user_id`.
  // Die Zeilenform kommt aus einer Spalten-ZEICHENKETTE; der Supabase-Typ
  // kann sie ohne generierte Datenbanktypen nicht auflösen und liefert eine
  // Union mit `GenericStringError`. Deshalb eine ausdrückliche, enge
  // Zusicherung auf genau das eine Feld, das hier gebraucht wird.
  const affiliatePartners = (affiliatePartnersRes.data ?? []) as unknown as Array<{ id: string }>;
  const affiliatePartnerIds = affiliatePartners.map((p) => p.id);

  let affiliateCommissions: unknown[] = [];
  let affiliatePayouts: unknown[] = [];
  let affiliateBillingProfiles: unknown[] = [];
  if (affiliatePartnerIds.length > 0) {
    const [commissionsRes, payoutsRes, billingRes] = await Promise.all([
      supabase
        .from("affiliate_commissions")
        .select(AFFILIATE_COMMISSION_EXPORT_COLUMNS)
        .in("partner_id", affiliatePartnerIds),
      supabase
        .from("affiliate_payouts")
        .select(AFFILIATE_PAYOUT_EXPORT_COLUMNS)
        .in("partner_id", affiliatePartnerIds),
      supabase
        .from("affiliate_billing_profiles")
        .select(AFFILIATE_BILLING_EXPORT_COLUMNS)
        .in("partner_id", affiliatePartnerIds),
    ]);
    affiliateCommissions = commissionsRes.data ?? [];
    affiliatePayouts = payoutsRes.data ?? [];
    affiliateBillingProfiles = billingRes.data ?? [];
  }

  return {
    exported_at: new Date().toISOString(),
    profile: profileRes.data ?? null,
    memberships: membershipsRes.data ?? [],
    enrollments: enrollmentsRes.data ?? [],
    progress: progressRes.data ?? [],
    submissions: submissionsRes.data ?? [],
    attempts: attemptsRes.data ?? [],
    certificates: certificatesRes.data ?? [],
    orders: ordersRes.data ?? [],
    tutor_conversations: conversations,
    tutor_messages: tutorMessages,
    calendar_workers: calendarWorkers,
    calendar_shifts: calendarShifts,
    calendar_time_entries: calendarTimeEntries,
    calendar_absences: calendarAbsences,
    calendar_shift_change_requests: calendarChangeRequests,
    // Sicht WERBENDER (4 Schlüssel) …
    affiliate_partners: affiliatePartners,
    affiliate_commissions: affiliateCommissions,
    affiliate_payouts: affiliatePayouts,
    affiliate_billing_profiles: affiliateBillingProfiles,
    // … und Sicht GEWORBENER (2 Schlüssel), getrennt gehalten, siehe Kopf.
    affiliate_referrals: affiliateReferralsRes.data ?? [],
    affiliate_customer_bindings: affiliateBindingsRes.data ?? [],
  };
}
