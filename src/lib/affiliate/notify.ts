import "server-only";
import { getTranslations } from "next-intl/server";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { Locale } from "@/i18n/config";
import { resolveTenantEmailLocale } from "@/i18n/config";
import {
  affiliateApplicationReceived,
  affiliateApproved,
  affiliatePayout,
  affiliateRejected,
  affiliateReversal,
  affiliateSale,
  type AffiliateReversalReason,
} from "@/lib/email/templates";
import { buildTenantUrl } from "@/lib/tenant/url";
import type { WebhookEvent } from "@/lib/webhooks/events";
import type { AffiliateCommissionKind, AffiliateCommissionStatus } from "./types";

/**
 * Affiliate-System, Block B9 — DER VERSAND (PLAN_Affiliate-System.md 10/B9).
 *
 * Die Vorlagen stehen in `src/lib/email/templates.ts` und sind reine
 * Funktionen. Diese Datei ist das Stück dazwischen: sie beantwortet für
 * jeden Anlass die fünf Fragen, die eine Vorlage nicht beantworten kann —
 * WER bekommt die Mail, WILL er sie überhaupt, in WELCHER Sprache, mit
 * welchem Betrag in welcher Währung, und unter welcher Domain liegt der
 * Link.
 *
 * ANLASS FÜR DIESE DATEI: `affiliateReversal()` existiert seit Block B5,
 * wurde aber von NIRGENDWO gerufen. Nach einer Erstattung verschwand die
 * Provision eines Partners kommentarlos aus seinem Saldo — er erfuhr davon
 * erst, wenn er selbst nachsah. Diese Lücke wird hier geschlossen, zusammen
 * mit den vier übrigen Anlässen.
 *
 * SECHS REGELN, die diese Datei trägt:
 *
 *  1. NICHTS HIER WIRFT. Jede Funktion ist ein Nebeneffekt eines Vorgangs,
 *     der bereits abgeschlossen ist: die Bewerbung ist gespeichert, die
 *     Provision gebucht, die Überweisung raus. Dass eine Mail scheitert,
 *     darf keinen dieser Vorgänge zurückdrehen — derselbe Vertrag wie in
 *     `email/client.ts` („sendEmail() wirft NIEMALS") und in
 *     `marketplace/fulfil.ts`.
 *
 *  2. DIE SCHALTER DES PARTNERS GELTEN. `notify_sale`, `notify_reversal`
 *     und `notify_payout` (3.3) werden VOR dem Rendern gelesen, nicht
 *     danach. Ein Partner, der die Provisionsmails abbestellt hat, kostet
 *     dann auch keinen Übersetzungsaufruf mehr.
 *
 *     KEINEN Schalter haben Freigabe und Ablehnung: das sind einmalige
 *     Entscheidungen über die Bewerbung selbst, und wer sie nicht erfährt,
 *     weiß nicht, dass es ein Konto gibt, in dem er etwas abbestellen
 *     könnte.
 *
 *  3. DIE SPRACHE IST DIE DES MANDANTEN, nicht die des Empfängers
 *     (`tenants.settings.default_locale`, Josips Entscheidung, siehe
 *     Kopfkommentar von `email/templates.ts`). Ein Partner hat in der Regel
 *     gar kein Profil mit `locale` — bis zur Freigabe existiert kein Konto.
 *
 *  4. BETRÄGE WERDEN HIER FORMATIERT, nicht in der Vorlage. Die Währung
 *     gehört zur Zeile (5.11), und eine Summe über zwei Währungen hinweg
 *     gibt es nie — `AffiliateReversalNotification` liefert deshalb je
 *     `(partner_id, currency)` eine eigene Zahl, und jede davon wird zu
 *     einer eigenen Mail.
 *
 *  5. KEINE KÄUFERDATEN AN PARTNER. In keiner dieser Mails steht ein Name,
 *     eine Adresse oder eine Bestellnummer eines Käufers. Was der Partner
 *     erfährt, ist Produktname, Betrag, Währung und Status — genau das, was
 *     er in seinem eigenen Kontoauszug ohnehin sieht (3.11, letzter Absatz).
 *
 *  6. §2.11 IM LOG. Kein Fehlerpfad protokolliert eine E-Mail-Adresse, einen
 *     Namen oder eine Bankreferenz. Was im Log landet, sind IDs und der
 *     Anlass — genug, um den Fall zu finden, zu wenig, um jemanden zu
 *     identifizieren.
 *
 * WEBHOOKS: die vier Namen aus 9.10 (`affiliate.application`,
 * `affiliate.approved`, `affiliate.commission`, `affiliate.reversal`) werden
 * an denselben Stellen ausgelöst wie die Mails. Die Nutzlast trägt IDs,
 * Beträge und Codes — keine E-Mail-Adresse und keinen Klartextnamen: ein
 * Webhook-Ziel ist eine vom Mandanten frei eingetragene fremde URL
 * (`url-safety.ts` prüft nur, dass sie nicht ins interne Netz zeigt), und
 * was dort hinausgeht, kommt nicht zurück.
 */

type Admin = ReturnType<typeof createAdminClient>;

/** Was jede dieser Mails vom Mandanten braucht. */
type TenantContext = {
  id: string;
  name: string;
  slug: string;
  customDomain: string | null;
  accentColor?: string;
  locale: Locale;
};

/**
 * Der Empfänger einer Partner-Mail. `email` ist `null`, wenn der Partner
 * anonymisiert wurde (`anonymize.ts` setzt `…@invalid`, RFC 2606) — dann
 * unterbleibt der Versand, statt einem garantiert unzustellbaren Postfach
 * hinterherzulaufen.
 */
type PartnerRecipient = {
  id: string;
  email: string | null;
  name: string | null;
  code: string;
  notifySale: boolean;
  notifyReversal: boolean;
  notifyPayout: boolean;
};

const PARTNER_NOTIFY_COLUMNS =
  "id, applicant_email, display_name, code, notify_sale, notify_reversal, notify_payout";

function logFailure(context: string, detail: Record<string, unknown>): void {
  // Nur IDs und Anlässe (CLAUDE.md §2.11) — nie `to`, nie ein Name.
  console.error(`[affiliate/notify] ${context}`, detail);
}

/**
 * Webhook-Auslösung, aus demselben Grund dynamisch geladen wie der
 * Mailversand (siehe `deliver()` unten): `@/lib/webhooks/dispatch` zieht
 * `createAdminClient()` als WERT nach, und das validiert über `@/lib/env`
 * die Umgebung schon beim Import. `notify.ts` hängt an `process.ts`
 * (Cron), an `payout.ts` und an den Server Actions — alle drei bekommen
 * ihren Admin-Client als Parameter herein und sollen nicht über den Umweg
 * einer Benachrichtigung eine eigene Env-Abhängigkeit erben.
 *
 * `WEBHOOK_EVENTS` bleibt trotzdem die einzige Quelle der Ereignisnamen:
 * der Parameter ist auf `WebhookEvent` typisiert, ein Tippfehler fällt
 * beim Übersetzen auf.
 */
async function dispatchAffiliateWebhook(
  tenantId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  const { dispatchWebhookEvent } = await import("@/lib/webhooks/dispatch");
  await dispatchWebhookEvent(tenantId, event, payload);
}

/**
 * Betrag in deutscher Schreibweise plus ISO-Währungscode („188,60 EUR").
 *
 * BEWUSSTE DOPPELUNG von `formatCreditNoteAmount()` (credit-note.ts) statt
 * eines Imports: jene Datei zieht `pdf-lib`, `@pdf-lib/fontkit` und die
 * base64-kodierten Montserrat-Schnitte mit. Für einen Zahlenformatierer
 * dieselbe Font-Nutzlast in jeden Mailpfad und damit in jeden Cron-Tick zu
 * laden, wäre in der 3-MiB-Worker-Grenze des Cloudflare-Plans teuer erkauft
 * (siehe die Resend-Begründung in `email/client.ts`). Auch hier von Hand und
 * nicht über `Intl.NumberFormat`: der Workers-Laufzeit fehlt je nach Build
 * die vollständige ICU-Datenbank, und „118.88" statt „118,88" in einer
 * deutschen Mail ist ein Fehler, den niemand meldet und jeder sieht.
 */
function formatAmount(cents: number, currency: string): string {
  const negative = cents < 0;
  const absolute = Math.abs(Math.trunc(cents));
  const rest = String(absolute % 100).padStart(2, "0");
  const grouped = String(Math.trunc(absolute / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}${grouped},${rest} ${currency.toUpperCase()}`;
}

/** ISO-Datum `JJJJ-MM-TT` als `TT.MM.JJJJ`; unlesbare Eingabe bleibt stehen. */
function formatDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  return match === null ? isoDate : `${match[3]}.${match[2]}.${match[1]}`;
}

async function loadTenantContext(admin: Admin, tenantId: string): Promise<TenantContext | null> {
  const { data, error } = await admin
    .from("tenants")
    .select("id, name, slug, custom_domain, branding, settings")
    .eq("id", tenantId)
    .maybeSingle();
  if (error || !data) {
    if (error) logFailure("Mandant nicht lesbar", { tenantId, code: error.code });
    return null;
  }
  const row = data as {
    id: string;
    name: string | null;
    slug: string;
    custom_domain: string | null;
    branding: { color_primary?: string } | null;
    settings: { default_locale?: string } | null;
  };
  return {
    id: row.id,
    name: row.name ?? "Calltalent-Akademie",
    slug: row.slug,
    customDomain: row.custom_domain,
    accentColor: row.branding?.color_primary,
    locale: resolveTenantEmailLocale(row.settings?.default_locale),
  };
}

async function loadPartner(
  admin: Admin,
  tenantId: string,
  partnerId: string,
): Promise<PartnerRecipient | null> {
  // Spalten namentlich: `select("*")` bricht auf `affiliate_partners` an den
  // Spalten-Grants aus 3.3 mit 42501 ab, sobald die Abfrage je gegen eine
  // andere Rolle als `service_role` läuft.
  const { data, error } = await admin
    .from("affiliate_partners")
    .select(PARTNER_NOTIFY_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("id", partnerId)
    .maybeSingle();
  if (error || !data) {
    if (error) logFailure("Partner nicht lesbar", { tenantId, partnerId, code: error.code });
    return null;
  }
  const row = data as {
    id: string;
    applicant_email: string | null;
    display_name: string | null;
    code: string;
    notify_sale: boolean;
    notify_reversal: boolean;
    notify_payout: boolean;
  };
  const email = row.applicant_email?.trim() ?? "";
  return {
    id: row.id,
    email: email.length > 0 && !email.toLowerCase().endsWith("@invalid") ? email : null,
    name: row.display_name,
    code: row.code,
    notifySale: row.notify_sale,
    notifyReversal: row.notify_reversal,
    notifyPayout: row.notify_payout,
  };
}

function partnerUrl(tenant: TenantContext, path: string): string {
  return buildTenantUrl({ slug: tenant.slug, custom_domain: tenant.customDomain }, path);
}

/**
 * Der eigentliche Versand.
 *
 * `@/lib/email/client` wird ERST HIER geladen, nicht am Dateikopf. Grund:
 * `@/lib/env` validiert die öffentlichen Umgebungsvariablen auf Modulebene
 * (`export const publicEnv = parsePublicEnv()`), und `email/client.ts`
 * importiert es. Ein statischer Import machte damit JEDE Datei, die
 * `notify.ts` einbindet, vom Vorhandensein einer vollständigen `.env`
 * abhängig — auch `process.ts`, also der Cron-Verarbeiter, der ohne eine
 * einzige Mail auskommt, wenn kein Partner benachrichtigt werden will. Der
 * dynamische Import hält diese Abhängigkeit dort, wo sie hingehört: an der
 * Stelle, an der wirklich eine Mail hinausgeht.
 */
async function deliver(params: {
  to: string;
  subject: string;
  html: string;
  tenantName: string;
  context: string;
  detail: Record<string, unknown>;
}): Promise<void> {
  const { sendEmail } = await import("@/lib/email/client");
  const result = await sendEmail({
    to: params.to,
    subject: params.subject,
    html: params.html,
    tenant: { name: params.tenantName },
  });
  if (!result.success) {
    logFailure(params.context, { ...params.detail, error: result.error });
  }
}

// =======================================================================
// 1. Neue Bewerbung — an die Manager des Mandanten
// =======================================================================

/**
 * Empfänger sind die `memberships` mit `role in ('owner','admin')` und
 * `status='active'` — dieselbe Rollenliste, die `requireAffiliateManager()`
 * für die Entscheidung über die Bewerbung verlangt (access.ts, G10).
 * Trainer bekommen die Mail NICHT: sie dürfen über einen Partner nicht
 * entscheiden, also ist die Nachricht für sie eine Handlungsaufforderung
 * ohne Handlung.
 */
export async function notifyAffiliateApplicationReceived(
  admin: Admin,
  params: { tenantId: string; partnerId: string; applicantName: string },
): Promise<void> {
  try {
    const tenant = await loadTenantContext(admin, params.tenantId);
    if (tenant === null) return;

    const { data: memberships } = await admin
      .from("memberships")
      .select("user_id")
      .eq("tenant_id", params.tenantId)
      .eq("status", "active")
      .in("role", ["owner", "admin"]);
    const managerIds = (memberships ?? [])
      .map((m) => (m as { user_id: string | null }).user_id)
      .filter((id): id is string => Boolean(id));
    if (managerIds.length === 0) return;

    const { data: profiles } = await admin
      .from("profiles")
      .select("email, full_name")
      .in("id", managerIds);
    const recipients = (profiles ?? []) as Array<{ email: string | null; full_name: string | null }>;

    const t = await getTranslations({ locale: tenant.locale, namespace: "email" });
    const actionUrl = partnerUrl(tenant, `/admin/affiliate/partner/${params.partnerId}`);

    for (const recipient of recipients) {
      if (!recipient.email) continue;
      const html = await affiliateApplicationReceived({
        tenantName: tenant.name,
        recipientName: recipient.full_name ?? undefined,
        applicantName: params.applicantName,
        accentColor: tenant.accentColor,
        locale: tenant.locale,
        actionUrl,
      });
      await deliver({
        to: recipient.email,
        subject: t("affiliateApplicationReceived.subject"),
        html,
        tenantName: tenant.name,
        context: "Bewerbungsmeldung an Manager fehlgeschlagen",
        detail: { tenantId: params.tenantId, partnerId: params.partnerId },
      });
    }

    await dispatchAffiliateWebhook(params.tenantId, "affiliate.application", {
      partner_id: params.partnerId,
    });
  } catch (e) {
    logFailure("Ausnahme bei der Bewerbungsmeldung", {
      tenantId: params.tenantId,
      partnerId: params.partnerId,
      error: e instanceof Error ? e.name : "unbekannt",
    });
  }
}

// =======================================================================
// 2. Freigabe und Ablehnung — an den Bewerber
// =======================================================================

export async function notifyAffiliatePartnerDecision(
  admin: Admin,
  params: {
    tenantId: string;
    partnerId: string;
    decision: "approved" | "rejected";
    /** Nur bei `rejected`: die Begründung aus `status_reason` (Pflichtfeld). */
    reason?: string | null;
  },
): Promise<void> {
  try {
    const [tenant, partner] = await Promise.all([
      loadTenantContext(admin, params.tenantId),
      loadPartner(admin, params.tenantId, params.partnerId),
    ]);
    if (tenant === null || partner === null || partner.email === null) return;

    const t = await getTranslations({ locale: tenant.locale, namespace: "email" });

    if (params.decision === "approved") {
      const html = await affiliateApproved({
        tenantName: tenant.name,
        recipientName: partner.name ?? undefined,
        partnerCode: partner.code,
        accentColor: tenant.accentColor,
        locale: tenant.locale,
        actionUrl: partnerUrl(tenant, "/partner"),
      });
      await deliver({
        to: partner.email,
        subject: t("affiliateApproved.subject"),
        html,
        tenantName: tenant.name,
        context: "Freigabemail fehlgeschlagen",
        detail: { tenantId: params.tenantId, partnerId: params.partnerId },
      });
      await dispatchAffiliateWebhook(params.tenantId, "affiliate.approved", {
        partner_id: params.partnerId,
        code: partner.code,
      });
      return;
    }

    const html = await affiliateRejected({
      tenantName: tenant.name,
      recipientName: partner.name ?? undefined,
      reason: params.reason ?? undefined,
      accentColor: tenant.accentColor,
      locale: tenant.locale,
    });
    await deliver({
      to: partner.email,
      subject: t("affiliateRejected.subject"),
      html,
      tenantName: tenant.name,
      context: "Ablehnungsmail fehlgeschlagen",
      detail: { tenantId: params.tenantId, partnerId: params.partnerId },
    });
    // KEIN Webhook für die Ablehnung: 9.10 nennt vier Namen, und
    // `affiliate.approved` ist der einzige davon für eine Entscheidung. Eine
    // Ablehnung nach draußen zu melden, wäre außerdem die Weitergabe einer
    // negativen Bewertung über eine Person an ein fremdes System.
  } catch (e) {
    logFailure("Ausnahme bei der Entscheidungsmail", {
      tenantId: params.tenantId,
      partnerId: params.partnerId,
      decision: params.decision,
      error: e instanceof Error ? e.name : "unbekannt",
    });
  }
}

// =======================================================================
// 3. Neue Provision — an den Partner
// =======================================================================

/**
 * Welche Buchungsarten eine Mail auslösen.
 *
 * `reserve`/`recurring_reserve` sind bewusst NICHT dabei: der
 * Sicherheitseinbehalt ist eine eigene physische Zeile derselben Vermittlung
 * (G5), keine zweite Vermittlung. Zwei Mails für einen Verkauf wären für den
 * Partner nicht erklärbar, und die zweite trüge einen Betrag, den er nie
 * bestellt hat. Der Einbehalt steht im Kontoauszug, auf den die Mail
 * verlinkt.
 *
 * `reversal`/`recredit` laufen über `notifyAffiliateReversal()` mit eigener
 * Vorlage; `manual` ist eine Handbuchung des Managers, der den Partner selbst
 * informiert.
 */
const NOTIFIED_COMMISSION_KINDS: readonly AffiliateCommissionKind[] = ["sale", "recurring", "tier2"];

export type AffiliateSaleNotification = {
  partner_id: string;
  kind: AffiliateCommissionKind;
  amount_cents: number;
  currency: string;
  status: AffiliateCommissionStatus;
  product_id: string | null;
  is_test: boolean;
};

/**
 * Meldet neu gebuchte Provisionszeilen. Wird aus `bookAffiliateRows()`
 * (process.ts) gerufen — dem einen Punkt, durch den JEDE Buchung läuft
 * (Direktkauf, Abo-Folgerate, zweite Stufe). Drei Aufrufstellen mit
 * demselben Block wären drei Orte, an denen eine davon vergessen wird.
 */
export async function notifyAffiliateCommissions(
  admin: Admin,
  params: { tenantId: string; rows: readonly AffiliateSaleNotification[] },
): Promise<void> {
  // Testbuchungen und stornierte Zeilen (Eigenempfehlung, 0 Cent) erzeugen
  // keine Gutschrift und deshalb auch keine Nachricht (4.5).
  const relevant = params.rows.filter(
    (row) =>
      !row.is_test &&
      row.status !== "cancelled" &&
      row.amount_cents > 0 &&
      NOTIFIED_COMMISSION_KINDS.includes(row.kind),
  );
  if (relevant.length === 0) return;

  try {
    const tenant = await loadTenantContext(admin, params.tenantId);
    if (tenant === null) return;

    const [t, tStatus] = await Promise.all([
      getTranslations({ locale: tenant.locale, namespace: "email" }),
      getTranslations({ locale: tenant.locale, namespace: "affiliate" }),
    ]);
    const actionUrl = partnerUrl(tenant, "/partner/kontoauszug");

    // Produktnamen in EINER Abfrage, nicht je Zeile.
    const productIds = [...new Set(relevant.map((r) => r.product_id).filter((id): id is string => Boolean(id)))];
    const productNames = new Map<string, string>();
    if (productIds.length > 0) {
      const { data } = await admin
        .from("products")
        .select("id, title")
        .eq("tenant_id", params.tenantId)
        .in("id", productIds);
      for (const row of (data ?? []) as Array<{ id: string; title: string | null }>) {
        if (row.title) productNames.set(row.id, row.title);
      }
    }

    // Der Partner wird je Zeile höchstens einmal geladen: eine Bestellung
    // kann zwei Zeilen für DENSELBEN Partner erzeugen (Direktprovision und,
    // bei einer Selbstwerber-Kette, die zweite Stufe).
    const partners = new Map<string, PartnerRecipient | null>();

    for (const row of relevant) {
      if (!partners.has(row.partner_id)) {
        partners.set(row.partner_id, await loadPartner(admin, params.tenantId, row.partner_id));
      }
      const partner = partners.get(row.partner_id) ?? null;

      await dispatchAffiliateWebhook(params.tenantId, "affiliate.commission", {
        partner_id: row.partner_id,
        kind: row.kind,
        amount_cents: row.amount_cents,
        currency: row.currency,
        status: row.status,
      });

      if (partner === null || partner.email === null || !partner.notifySale) continue;

      const html = await affiliateSale({
        tenantName: tenant.name,
        recipientName: partner.name ?? undefined,
        amountLabel: formatAmount(row.amount_cents, row.currency),
        // Der übersetzte Zustand der Zeile („Sperrfrist läuft"), aus dem
        // Namensraum `affiliate.status.commission.*` — derselbe Text, den der
        // Partner gleich im Kontoauszug wiederfindet.
        statusLabel: tStatus(`status.commission.${row.status}`),
        productName: row.product_id ? productNames.get(row.product_id) : undefined,
        accentColor: tenant.accentColor,
        locale: tenant.locale,
        actionUrl,
      });
      await deliver({
        to: partner.email,
        subject: t("affiliateSale.subject"),
        html,
        tenantName: tenant.name,
        context: "Provisionsmail fehlgeschlagen",
        detail: { tenantId: params.tenantId, partnerId: row.partner_id, kind: row.kind },
      });
    }
  } catch (e) {
    logFailure("Ausnahme bei der Provisionsmail", {
      tenantId: params.tenantId,
      error: e instanceof Error ? e.name : "unbekannt",
    });
  }
}

// =======================================================================
// 4. Storno, Rückbuchung, Wiedergutschrift — an den Partner
// =======================================================================

/**
 * Schließt die Lücke aus Block B5: `affiliateReversal()` gab es, gerufen hat
 * es niemand.
 *
 * `notifications` kommt unverändert aus `AffiliateReversalResult` — je
 * `(partner_id, currency)` eine POSITIVE Summe (`summarise()` in
 * reversal.ts). Eine Zeile davon wird eine Mail; zwei Währungen ergeben zwei
 * Mails und nie eine addierte Zahl (5.11).
 */
export async function notifyAffiliateReversal(
  admin: Admin,
  params: {
    tenantId: string;
    reason: AffiliateReversalReason;
    notifications: ReadonlyArray<{ partner_id: string; currency: string; amount_cents: number }>;
  },
): Promise<void> {
  if (params.notifications.length === 0) return;

  try {
    const tenant = await loadTenantContext(admin, params.tenantId);
    if (tenant === null) return;

    const t = await getTranslations({ locale: tenant.locale, namespace: "email" });
    const actionUrl = partnerUrl(tenant, "/partner/kontoauszug");

    for (const entry of params.notifications) {
      await dispatchAffiliateWebhook(params.tenantId, "affiliate.reversal", {
        partner_id: entry.partner_id,
        reason: params.reason,
        amount_cents: entry.amount_cents,
        currency: entry.currency,
      });

      const partner = await loadPartner(admin, params.tenantId, entry.partner_id);
      if (partner === null || partner.email === null || !partner.notifyReversal) continue;

      const html = await affiliateReversal({
        tenantName: tenant.name,
        recipientName: partner.name ?? undefined,
        reason: params.reason,
        amountLabel: formatAmount(entry.amount_cents, entry.currency),
        accentColor: tenant.accentColor,
        locale: tenant.locale,
        actionUrl,
      });
      // `affiliateReversal` hat als einzige der sechs Affiliate-Vorlagen
      // keinen eigenen `subject`-Schlüssel (`email.affiliateReversal.*`, seit
      // B5). Die Überschrift ist hier der Betreff — inhaltlich dasselbe
      // („Provision zurückgenommen" / „Provision wieder gutgeschrieben"), und
      // ein neuer Schlüssel müsste in allen drei Sprachdateien gepflegt
      // werden, die einem anderen Block gehören.
      await deliver({
        to: partner.email,
        subject:
          params.reason === "recredit"
            ? t("affiliateReversal.headingRecredit")
            : t("affiliateReversal.headingReversal"),
        html,
        tenantName: tenant.name,
        context: "Stornomail fehlgeschlagen",
        detail: { tenantId: params.tenantId, partnerId: entry.partner_id, reason: params.reason },
      });
    }
  } catch (e) {
    logFailure("Ausnahme bei der Stornomail", {
      tenantId: params.tenantId,
      reason: params.reason,
      error: e instanceof Error ? e.name : "unbekannt",
    });
  }
}

// =======================================================================
// 5. Auszahlung überwiesen — an den Partner
// =======================================================================

/**
 * Wird aus `markAffiliatePayoutPaid()` gerufen, NACHDEM Satz und
 * Provisionszeilen auf `paid` stehen (7.7). Vorher wäre die Mail eine
 * Ankündigung, die ein Abbruch zwischen den beiden Anweisungen zur
 * Falschaussage machte.
 */
export async function notifyAffiliatePayoutPaid(
  admin: Admin,
  params: { tenantId: string; payoutId: string },
): Promise<void> {
  try {
    const { data, error } = await admin
      .from("affiliate_payouts")
      .select("id, partner_id, period_from, period_to, total_cents, currency, reference")
      .eq("tenant_id", params.tenantId)
      .eq("id", params.payoutId)
      .maybeSingle();
    if (error || !data) {
      if (error) {
        logFailure("Auszahlungssatz nicht lesbar", {
          tenantId: params.tenantId,
          payoutId: params.payoutId,
          code: error.code,
        });
      }
      return;
    }
    const payout = data as {
      partner_id: string;
      period_from: string;
      period_to: string;
      total_cents: number;
      currency: string;
      reference: string | null;
    };

    const [tenant, partner] = await Promise.all([
      loadTenantContext(admin, params.tenantId),
      loadPartner(admin, params.tenantId, payout.partner_id),
    ]);
    if (tenant === null || partner === null || partner.email === null || !partner.notifyPayout) return;

    const t = await getTranslations({ locale: tenant.locale, namespace: "email" });
    const html = await affiliatePayout({
      tenantName: tenant.name,
      recipientName: partner.name ?? undefined,
      amountLabel: formatAmount(payout.total_cents, payout.currency),
      periodLabel: `${formatDate(payout.period_from)}–${formatDate(payout.period_to)}`,
      // Die BANKREFERENZ aus dem Abgleich, nicht die IBAN — eine
      // Kontonummer gehört in keine Mail.
      reference: payout.reference ?? undefined,
      accentColor: tenant.accentColor,
      locale: tenant.locale,
      actionUrl: partnerUrl(tenant, "/partner/auszahlungen"),
    });
    await deliver({
      to: partner.email,
      subject: t("affiliatePayout.subject"),
      html,
      tenantName: tenant.name,
      context: "Auszahlungsmail fehlgeschlagen",
      detail: { tenantId: params.tenantId, payoutId: params.payoutId },
    });
  } catch (e) {
    logFailure("Ausnahme bei der Auszahlungsmail", {
      tenantId: params.tenantId,
      payoutId: params.payoutId,
      error: e instanceof Error ? e.name : "unbekannt",
    });
  }
}
