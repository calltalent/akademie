/**
 * Affiliate-System, Block B1 (PLAN_Affiliate-System.md, Abschnitte 2, 3, 5, 6).
 *
 * Diese Datei ist der Typ-Vertrag des gesamten Moduls: die Aufzählungen als
 * `as const`-Tupel (eine Quelle für TypeScript UND zod, siehe
 * `src/lib/affiliate/schema.ts`) und die Zeilentypen der Tabellen aus
 * Plan-Abschnitt 3. Sie enthält bewusst KEINE Logik und keine Importe aus
 * anderen Affiliate-Dateien — `compute.ts`, `queries.ts`, `actions.ts`,
 * `payout.ts` und die Oberflächen hängen alle an ihr.
 *
 * Zeilentypen in snake_case, ABWEICHEND von `calendar/schema.ts` (dort
 * camelCase-Zeilen plus private `…DbRow`-Typen). Begründung: die
 * Provisionszeilen sind Buchhaltung. Sie werden vom Cron-Verarbeiter, von der
 * Buchungs-RPC (`book_affiliate_commissions(jsonb)`) und von den reinen
 * Rechenfunktionen in `compute.ts` in genau der Form gelesen und geschrieben,
 * in der sie in der Datenbank stehen; ein Mapping-Layer wäre eine zweite
 * Stelle, an der ein Spaltenname abweichen kann, ohne dass der Compiler es
 * merkt (G4 verlangt, dass der Beleg aus den Daten reproduzierbar bleibt).
 * Wo eine Oberfläche eine aufbereitete Sicht braucht (z. B. Partnername an der
 * Buchungszeile), definiert sie ihren eigenen Anzeigetyp — nicht diese Datei.
 *
 * Anzeigetexte gehören NICHT hierher, sondern nach `messages/{de,en,bs}.json`
 * (eigener Arbeitsbereich). Konvention für die Schlüssel, damit alle
 * Folgeblöcke dieselben benutzen:
 *   affiliate.programStatus.<wert>      affiliate.partnerStatus.<wert>
 *   affiliate.commissionKind.<wert>     affiliate.commissionStatus.<wert>
 *   affiliate.cancelReason.<wert>       affiliate.balance.<eimer>
 *   affiliate.taxMode.<wert>            affiliate.payoutMethod.<wert>
 *   affiliate.recurringMode.<wert>      affiliate.attributionModel.<wert>
 */

// --- Aufzählungen (Quelle für zod und TypeScript) ------------------------

/** `affiliate_programs.status` (3.2). Nur ein `active` Programm gibt frei (6.4). */
export const AFFILIATE_PROGRAM_STATUSES = ["draft", "active", "paused"] as const;
export type AffiliateProgramStatus = (typeof AFFILIATE_PROGRAM_STATUSES)[number];

/** `affiliate_programs.visibility` (3.2/8.3): `public` gelistet, `link` nur per Direktlink, `private` = 404. */
export const AFFILIATE_PROGRAM_VISIBILITIES = ["private", "link", "public"] as const;
export type AffiliateProgramVisibility = (typeof AFFILIATE_PROGRAM_VISIBILITIES)[number];

/** `affiliate_programs.approval_mode` (3.2). */
export const AFFILIATE_APPROVAL_MODES = ["manual", "auto"] as const;
export type AffiliateApprovalMode = (typeof AFFILIATE_APPROVAL_MODES)[number];

/** Satzart einer Kondition (3.2/3.5/5.3): Prozentsatz in Basispunkten oder fester Cent-Betrag. */
export const AFFILIATE_RATE_KINDS = ["percent", "fixed"] as const;
export type AffiliateRateKind = (typeof AFFILIATE_RATE_KINDS)[number];

/**
 * Basisart (5.1). Bewusst nur zwei Werte: „netto nach Zahlungsgebühr" wäre
 * eine erfundene Zahl (die echte Stripe-Gebühr steht auf der
 * Balance-Transaction und ist tagelang nicht final) — dafür gibt es
 * `fee_deduction_bp`.
 */
export const AFFILIATE_BASIS_KINDS = ["net", "gross"] as const;
export type AffiliateBasisKind = (typeof AFFILIATE_BASIS_KINDS)[number];

/** `affiliate_programs.attribution_model` (3.2/4.4). */
export const AFFILIATE_ATTRIBUTION_MODELS = ["last", "first"] as const;
export type AffiliateAttributionModel = (typeof AFFILIATE_ATTRIBUTION_MODELS)[number];

/** `affiliate_programs.overwrite_policy` (3.2/4.2 Schritt 7a): darf ein zweiter Klick die Zuordnung überschreiben? */
export const AFFILIATE_OVERWRITE_POLICIES = ["allow", "deny"] as const;
export type AffiliateOverwritePolicy = (typeof AFFILIATE_OVERWRITE_POLICIES)[number];

/**
 * `affiliate_programs.self_referral` (3.2/6.2): `block` storniert die Zeile
 * sofort (`cancel_reason='self_referral'`), `allow_flagged` bucht sie mit
 * `flagged=true` und überlässt die Entscheidung einem Menschen.
 */
export const AFFILIATE_SELF_REFERRAL_MODES = ["block", "allow_flagged"] as const;
export type AffiliateSelfReferralMode = (typeof AFFILIATE_SELF_REFERRAL_MODES)[number];

/** Abo-Modus (3.2/5.7). */
export const AFFILIATE_RECURRING_MODES = ["first_only", "n_periods", "all"] as const;
export type AffiliateRecurringMode = (typeof AFFILIATE_RECURRING_MODES)[number];

/** Bezugsgröße der zweiten Stufe (3.2/5.5): Provision des Verkäufers oder Umsatz. */
export const AFFILIATE_TIER2_BASES = ["commission", "revenue"] as const;
export type AffiliateTier2Basis = (typeof AFFILIATE_TIER2_BASES)[number];

/** `affiliate_programs.payout_schedule` (3.2/7.1). */
export const AFFILIATE_PAYOUT_SCHEDULES = ["weekly", "semi_monthly", "monthly"] as const;
export type AffiliatePayoutSchedule = (typeof AFFILIATE_PAYOUT_SCHEDULES)[number];

/** `affiliate_partners.status` (3.3). Nur `active` löst im Klick-Endpunkt auf (4.2 Schritt 3). */
export const AFFILIATE_PARTNER_STATUSES = ["pending", "active", "rejected", "suspended"] as const;
export type AffiliatePartnerStatus = (typeof AFFILIATE_PARTNER_STATUSES)[number];

/**
 * Buchungsarten (3.11). `reserve`/`recurring_reserve` sind eigene physische
 * Zeilen und kein Attribut (G5); `reversal` ist immer negativ, `recredit`
 * immer positiv; `manual` verlangt eine Notiz.
 */
export const AFFILIATE_COMMISSION_KINDS = [
  "sale",
  "reserve",
  "recurring",
  "recurring_reserve",
  "tier2",
  "reversal",
  "recredit",
  "manual",
] as const;
export type AffiliateCommissionKind = (typeof AFFILIATE_COMMISSION_KINDS)[number];

/**
 * Die beiden Reserve-Arten. Eigene Konstante, weil sowohl `computeBalances()`
 * (5.10, Eimer „in Reserve") als auch die Auszahlungsansicht diese Menge
 * brauchen — ein `kind.endsWith("reserve")` wäre dieselbe Regel, nur ohne
 * Typprüfung und mit einer stillen Falle, sobald eine Art `…reserve` heißt,
 * aber keine ist.
 */
export const AFFILIATE_RESERVE_KINDS = ["reserve", "recurring_reserve"] as const;
export type AffiliateReserveKind = (typeof AFFILIATE_RESERVE_KINDS)[number];

/**
 * Zustände einer Provisionszeile (6.1). Es gibt bewusst KEINEN Zustand
 * `reversed`: eine Rücknahme ist immer eine zweite Zeile (G6), sonst zöge
 * derselbe Betrag zweimal ab.
 */
export const AFFILIATE_COMMISSION_STATUSES = [
  "pending",
  "on_hold",
  "approved",
  "paid",
  "cancelled",
] as const;
export type AffiliateCommissionStatus = (typeof AFFILIATE_COMMISSION_STATUSES)[number];

/** `affiliate_commissions.cancel_reason` (3.11). */
export const AFFILIATE_CANCEL_REASONS = [
  "self_referral",
  "test_order",
  "zero_amount",
  "fraud_suspicion",
  "manual",
  "reassigned",
] as const;
export type AffiliateCancelReason = (typeof AFFILIATE_CANCEL_REASONS)[number];

/**
 * Steuermodi (3.12/7.4). Abgeleitet aus dem Abrechnungsprofil, nie frei
 * wählbar, und auf dem Auszahlungssatz eingefroren. Die beiden blockierenden
 * Fälle (Privatperson, EU ohne gültige USt-IdNr.) sind KEIN Modus — sie
 * verhindern die Auszahlung, siehe 7.4.
 */
export const AFFILIATE_TAX_MODES = [
  "regular",
  "small_business",
  "reverse_charge",
  "non_eu",
] as const;
export type AffiliateTaxMode = (typeof AFFILIATE_TAX_MODES)[number];

/** `affiliate_billing_profiles.entity_kind` (3.13). */
export const AFFILIATE_ENTITY_KINDS = ["business", "private"] as const;
export type AffiliateEntityKind = (typeof AFFILIATE_ENTITY_KINDS)[number];

/** `affiliate_billing_profiles.payout_method` (3.13) und `affiliate_payouts.method` (3.12). */
export const AFFILIATE_PAYOUT_METHODS = ["sepa", "paypal", "manual"] as const;
export type AffiliatePayoutMethod = (typeof AFFILIATE_PAYOUT_METHODS)[number];

/** `affiliate_billing_profiles.vat_check_result` (3.13/7.5). Fail-closed: `unchecked` blockiert. */
export const AFFILIATE_VAT_CHECK_RESULTS = ["valid", "invalid", "unchecked"] as const;
export type AffiliateVatCheckResult = (typeof AFFILIATE_VAT_CHECK_RESULTS)[number];

/** `affiliate_audit_log.actor_kind` (3.16). */
export const AFFILIATE_AUDIT_ACTOR_KINDS = ["manager", "partner", "system"] as const;
export type AffiliateAuditActorKind = (typeof AFFILIATE_AUDIT_ACTOR_KINDS)[number];

/** `affiliate_audit_log.entity` (3.16). */
export const AFFILIATE_AUDIT_ENTITIES = [
  "program",
  "partner",
  "condition",
  "group",
  "commission",
  "payout",
  "profile",
  "referral",
  "creative",
] as const;
export type AffiliateAuditEntity = (typeof AFFILIATE_AUDIT_ENTITIES)[number];

// --- jsonb-Formen -------------------------------------------------------

/**
 * Ein Feld des Bewerbungsformulars (`affiliate_programs.application_fields`).
 * Der Plan legt die Form dieses jsonb nicht fest; nach CLAUDE.md §4.5 hier
 * die einfachste tragfähige Form: Schlüssel, Beschriftung, Pflichtkennzeichen
 * und eine kleine Auswahl an Eingabearten. `key` ist zugleich der Schlüssel
 * der Antwort in `affiliate_partners.application`.
 */
export const AFFILIATE_APPLICATION_FIELD_TYPES = ["text", "textarea", "url"] as const;
export type AffiliateApplicationFieldType = (typeof AFFILIATE_APPLICATION_FIELD_TYPES)[number];

export type AffiliateApplicationField = {
  key: string;
  label: string;
  type: AffiliateApplicationFieldType;
  required: boolean;
};

/** Antworten der Bewerbung (`affiliate_partners.application`), Schlüssel = `AffiliateApplicationField.key`. */
export type AffiliateApplicationAnswers = Record<string, string>;

/**
 * Der eingefrorene Rechenweg einer Buchungszeile
 * (`affiliate_commissions.condition_snapshot`).
 *
 * Warum so vollständig: für eine Abo-Folgerate wird der Satz NICHT neu
 * aufgelöst, sondern aus dem Snapshot der Ursprungszeile gelesen (5.7) — die
 * Bedingungen bei Vertragsschluss regieren die ganze Laufzeit. Damit muss
 * hier alles stehen, was `computeCommissionParts()` für eine Folgerate
 * braucht, sonst müsste die Rate doch wieder aus der aktuellen
 * Programmzeile rechnen, und ein Händler könnte laufende Abos rückwirkend
 * billiger machen.
 */
export type AffiliateConditionSnapshot = {
  /** `null` = kein Konditionstreffer, es galt der Programmstandard (5.2). */
  condition_id: string | null;
  source: "condition" | "program_default";
  rate_kind: AffiliateRateKind;
  rate_bp: number;
  fixed_cents: number;
  basis_kind: AffiliateBasisKind;
  fee_deduction_bp: number;
  min_commission_cents: number | null;
  max_commission_cents: number | null;
  reserve_bp: number;
  hold_days: number;
  reserve_days: number;
  tier2_enabled: boolean;
  tier2_basis: AffiliateTier2Basis;
  tier2_rate_bp: number;
};

/**
 * Rohprotokoll der USt-IdNr.-Prüfung (`affiliate_billing_profiles.vat_check_log`,
 * 7.5). Absichtlich offen typisiert: gespeichert wird die unveränderte
 * VIES-Antwort, sie ist der Nachweis bei einer Betriebsprüfung und darf nicht
 * durch eine zu enge Typannahme beschnitten werden. `manual_override` setzt
 * ein Admin mit Pflichtbegründung.
 */
export type AffiliateVatCheckLog = Record<string, unknown>;

// --- Zeilentypen (Spalten exakt wie in Plan-Abschnitt 3) ----------------

/** `affiliate_programs` (3.2). Je Mandant genau eine Zeile (`unique (tenant_id)`). */
export type AffiliateProgramRow = {
  id: string;
  tenant_id: string;
  status: AffiliateProgramStatus;
  visibility: AffiliateProgramVisibility;
  approval_mode: AffiliateApprovalMode;

  // Standardkondition (unterste Stufe der Vorrangkette)
  rate_kind: AffiliateRateKind;
  rate_bp: number;
  fixed_cents: number;
  min_commission_cents: number | null;
  max_commission_cents: number | null;

  // Provisionsbasis
  basis_kind: AffiliateBasisKind;
  fee_deduction_bp: number;
  currency: string;

  // Attribution
  attribution_model: AffiliateAttributionModel;
  cookie_ttl_days: number;
  overwrite_policy: AffiliateOverwritePolicy;
  lifetime_binding: boolean;
  self_referral: AffiliateSelfReferralMode;
  /** Hostnamen, deren Referer keine Zuordnung erzeugt (4.2 Schritt 5). */
  referrer_blocklist: string[];

  // Abo
  recurring_mode: AffiliateRecurringMode;
  recurring_max_periods: number;

  // Zweite Stufe
  tier2_enabled: boolean;
  tier2_basis: AffiliateTier2Basis;
  tier2_rate_bp: number;

  // Geld und Fristen
  hold_days: number;
  reserve_bp: number;
  reserve_days: number;
  min_payout_cents: number;
  payout_schedule: AffiliatePayoutSchedule;
  /**
   * Abgeschlossener Abrechnungszeitraum (G14), ISO-Datum `JJJJ-MM-TT`. Nur
   * `service_role` schreibt hier; die Buchungs-RPC datiert eine Zeile, die in
   * einen abgeschlossenen Zeitraum fiele, auf heute um.
   */
  books_closed_until: string | null;

  // Texte
  description_md: string;
  terms_text: string;
  terms_version: number;
  application_note: string;
  application_fields: AffiliateApplicationField[];

  test_mode: boolean;
  created_at: string;
  updated_at: string;
};

/**
 * Spalten der Programmzeile, die die öffentliche Seite `/partnerprogramm`
 * lesen darf (8.3). Gelesen wird über `createAdminClient()` mit
 * ausdrücklicher Spaltenliste — Muster `src/lib/marketplace/catalog.ts`,
 * dessen Test festhält, dass nie interne Spalten herausfallen.
 *
 * Bewusst NICHT enthalten: `terms_text` und `books_closed_until` (Plan 3.2),
 * `referrer_blocklist` (verrät die Partnerstruktur des Händlers),
 * `self_referral` (verrät, ob Selbst-Empfehlung nur markiert statt gesperrt
 * wird), `test_mode` sowie die Zeitstempel. Eine Spalte hier aufzunehmen ist
 * eine bewusste Entscheidung, kein Nebeneffekt.
 */
export const AFFILIATE_PROGRAM_PUBLIC_COLUMNS = [
  "id",
  "tenant_id",
  "status",
  "visibility",
  "approval_mode",
  "rate_kind",
  "rate_bp",
  "fixed_cents",
  "min_commission_cents",
  "max_commission_cents",
  "basis_kind",
  "fee_deduction_bp",
  "currency",
  "attribution_model",
  "cookie_ttl_days",
  "overwrite_policy",
  "lifetime_binding",
  "recurring_mode",
  "recurring_max_periods",
  "tier2_enabled",
  "tier2_basis",
  "tier2_rate_bp",
  "hold_days",
  "reserve_bp",
  "reserve_days",
  "min_payout_cents",
  "payout_schedule",
  "description_md",
  "terms_version",
  "application_note",
  "application_fields",
] as const;

export type AffiliateProgramPublicRow = Pick<
  AffiliateProgramRow,
  (typeof AFFILIATE_PROGRAM_PUBLIC_COLUMNS)[number]
>;

/** `affiliate_partners` (3.3). `user_id` ist nullable — eine Bewerbung setzt kein Konto voraus. */
export type AffiliatePartnerRow = {
  id: string;
  tenant_id: string;
  program_id: string;
  user_id: string | null;
  /** Normalisiert: `lower(trim(...))`, `+`-Suffix entfernt. */
  applicant_email: string;
  display_name: string;
  company: string | null;
  code: string;
  status: AffiliatePartnerStatus;
  status_reason: string | null;
  group_id: string | null;
  /** Werber (zweite Stufe), genau eine Ebene (5.5). */
  referred_by: string | null;
  payout_hold: boolean;
  payout_hold_reason: string | null;
  internal_note: string | null;
  application: AffiliateApplicationAnswers;

  terms_version_accepted: number | null;
  terms_accepted_at: string | null;
  /** HMAC mit statischem Salz; erscheint im Auditprotokoll nur redigiert (3.16). */
  terms_accepted_ip_hash: string | null;

  notify_sale: boolean;
  notify_reversal: boolean;
  notify_payout: boolean;

  created_at: string;
  updated_at: string;
};

/**
 * Die Spalten, die `authenticated` auf `affiliate_partners` überhaupt lesen
 * darf (Spalten-Grant in 3.3) — RLS trennt keine Spalten, deshalb ist die
 * Liste die eigentliche Grenze. `internal_note`, `status_reason`,
 * `application` und `terms_accepted_ip_hash` fehlen hier absichtlich; die
 * Admin-Oberfläche holt sie über eine Server-Route mit `requireAdminTenant()`
 * und `createAdminClient()`.
 */
export const AFFILIATE_PARTNER_CLIENT_COLUMNS = [
  "id",
  "tenant_id",
  "program_id",
  "user_id",
  "display_name",
  "company",
  "code",
  "status",
  "group_id",
  "referred_by",
  "payout_hold",
  "payout_hold_reason",
  "terms_version_accepted",
  "terms_accepted_at",
  "notify_sale",
  "notify_reversal",
  "notify_payout",
  "created_at",
  "updated_at",
] as const;

export type AffiliatePartnerClientRow = Pick<
  AffiliatePartnerRow,
  (typeof AFFILIATE_PARTNER_CLIENT_COLUMNS)[number]
>;

/** `affiliate_groups` (3.4). Trägt selbst keinen Satz — der steht als Kondition mit `group_id`. */
export type AffiliateGroupRow = {
  id: string;
  tenant_id: string;
  program_id: string;
  name: string;
  created_at: string;
};

/**
 * `affiliate_conditions` (3.5). `specificity` ist eine generierte Spalte
 * (Partner 20 + Gruppe 10 + Produkt 5) und damit nicht durch einen Tippfehler
 * kippbar — nur lesen, nie schreiben.
 */
export type AffiliateConditionRow = {
  id: string;
  tenant_id: string;
  program_id: string;
  /** `null` = gilt für alle Partner. */
  partner_id: string | null;
  /** `null` = gilt für alle Gruppen. */
  group_id: string | null;
  /** `null` = gilt für alle Produkte. */
  product_id: string | null;
  rate_kind: AffiliateRateKind;
  rate_bp: number;
  fixed_cents: number;
  valid_from: string;
  valid_to: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  /** Generiert (`generated always as … stored`), nur lesbar. */
  specificity: number;
};

/**
 * `affiliate_commissions` (3.11) — das Provisionsbuch. Unveränderlich bis auf
 * `status`, `cancel_reason`, `payout_id`, `paid_at`, `flagged`, `flag_reason`,
 * `note` und `updated_at` (G4, durchgesetzt vom Guard-Trigger, auch gegen
 * `service_role`). `amount_cents` ist vorzeichenbehaftet: `reversal` negativ,
 * `recredit` positiv.
 *
 * Die Tabelle trägt keine Käuferspalte. Der Bezug zum Käufer läuft über
 * `order_id`, und `orders` liest ein Partner nicht — damit ist „ein Partner
 * sieht nie Käuferdaten" strukturell gesichert und nicht nur eine
 * Spaltenauswahl.
 */
export type AffiliateCommissionRow = {
  id: string;
  tenant_id: string;
  program_id: string;
  partner_id: string;
  kind: AffiliateCommissionKind;

  // Herkunft
  order_id: string | null;
  stripe_invoice_id: string | null;
  stripe_subscription_id: string | null;
  stripe_charge_id: string | null;
  product_id: string | null;
  campaign: string | null;
  referral_id: string | null;
  /** `tier2`/`reserve`/`recurring_reserve` → die `sale`-Zeile. */
  parent_id: string | null;
  /** `reversal` → die stornierte Zeile, `recredit` → die Gegenbuchung. */
  reverses_id: string | null;

  // Eingefrorener Rechenweg
  base_cents: number;
  basis_kind: AffiliateBasisKind;
  rate_kind: AffiliateRateKind;
  rate_bp: number;
  fixed_cents: number;
  amount_cents: number;
  currency: string;
  condition_id: string | null;
  condition_snapshot: AffiliateConditionSnapshot;

  status: AffiliateCommissionStatus;
  cancel_reason: AffiliateCancelReason | null;
  hold_until: string;
  /** Abrechnungsperiode als ISO-Datum `JJJJ-MM-TT` (G14). */
  booked_at: string;
  payout_id: string | null;
  paid_at: string | null;
  flagged: boolean;
  flag_reason: string | null;
  is_test: boolean;
  note: string | null;
  /** Einzige Idempotenzachse, `unique (tenant_id, dedup_key)` (G3). */
  dedup_key: string;
  created_at: string;
  updated_at: string;
};

/**
 * `affiliate_billing_profiles` (3.13) — Anschrift, Steuerstatus und
 * Zahlungsverbindung. Getrennt von den Stammdaten, damit keine Partnerliste
 * und kein Export sie versehentlich mitselektiert. Ändern darf ausschließlich
 * der Partner selbst; die drei `vat_check_*`-Felder schreibt nur
 * `service_role` (sonst könnte ein Partner sich selbst Reverse Charge und die
 * Auszahlungsfreigabe erzeugen).
 */
export type AffiliateBillingProfileRow = {
  partner_id: string;
  tenant_id: string;
  entity_kind: AffiliateEntityKind | null;
  legal_name: string | null;
  street: string | null;
  postal_code: string | null;
  city: string | null;
  /** ISO-3166-1 alpha-2, Großbuchstaben (DB-CHECK `^[A-Z]{2}$`). */
  country: string | null;
  /** § 19 UStG. */
  small_business: boolean;
  vat_id: string | null;
  tax_number: string | null;
  vat_checked_at: string | null;
  vat_check_result: AffiliateVatCheckResult | null;
  vat_check_log: AffiliateVatCheckLog;
  payout_method: AffiliatePayoutMethod | null;
  account_holder: string | null;
  iban: string | null;
  bic: string | null;
  paypal_email: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * `affiliate_audit_log` (3.16). `action` hat in der Datenbank bewusst KEIN
 * CHECK — die Liste der Vorgänge wächst mit jedem Block. Konvention für alle
 * Schreiber: `<entity>.<verb>` in Englisch, z. B. `partner.approve`,
 * `commission.flag`, `payout.mark_paid`.
 *
 * `before`/`after` werden VOR dem Schreiben redigiert: IBAN, `paypal_email`,
 * `tax_number`, `vat_id` und `terms_accepted_ip_hash` erscheinen dort nur als
 * `"***"` mit Änderungsmarker, nie im Klartext.
 */
export type AffiliateAuditLogRow = {
  id: string;
  tenant_id: string;
  actor_user_id: string | null;
  actor_kind: AffiliateAuditActorKind;
  entity: AffiliateAuditEntity;
  entity_id: string | null;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  created_at: string;
};

// --- Salden (5.10) ------------------------------------------------------

/**
 * Die fünf Saldo-Eimer. Getrennt und nie zu einer Summe verdichtet — der
 * Auszahlungslauf sammelt eine Zeile ganz oder gar nicht ein, eine
 * Gesamtsumme würde zwangsläufig von ihm abweichen (G5).
 */
export const AFFILIATE_BALANCE_BUCKETS = [
  "open",
  "reserved",
  "in_review",
  "available",
  "paid",
] as const;
export type AffiliateBalanceBucket = (typeof AFFILIATE_BALANCE_BUCKETS)[number];

/**
 * Salden je `(partner_id, currency)` — nie über Währungen hinweg summiert
 * (5.11). Alle Beträge in Cent, `is_test`-Zeilen zählen nirgends mit.
 *
 * open      — `pending`, Nicht-Reserve-Arten („offen")
 * reserved  — `pending`, Reserve-Arten („in Reserve")
 * in_review — `on_hold` („in Prüfung")
 * available — `approved` ohne `payout_id` („verfügbar", darf negativ sein)
 * paid      — `paid` („ausgezahlt")
 */
export type AffiliateBalances = {
  partner_id: string;
  currency: string;
  open_cents: number;
  reserved_cents: number;
  in_review_cents: number;
  available_cents: number;
  paid_cents: number;
};

/**
 * Eingabeform von `computeBalances(rows)` (compute.ts). Bewusst nur die
 * Spalten, die für die Eimer-Zuordnung nötig sind: `reverses_id` braucht die
 * Funktion, weil eine Gegenbuchung in den Eimer ihres Elternteils gehört
 * (eine Gegenbuchung zu einer Reserve-Zeile zählt zur Reserve, nicht zu
 * „offen"). `id` ist deshalb Pflicht — ohne sie lässt sich das Elternteil
 * nicht auflösen.
 */
export type AffiliateBalanceInput = Pick<
  AffiliateCommissionRow,
  | "id"
  | "partner_id"
  | "currency"
  | "kind"
  | "status"
  | "amount_cents"
  | "payout_id"
  | "reverses_id"
  | "is_test"
>;
