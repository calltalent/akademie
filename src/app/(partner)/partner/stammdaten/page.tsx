import { getTranslations } from "next-intl/server";
import { checkAffiliatePartnerAccess } from "@/lib/affiliate/access";
import { createClient } from "@/lib/supabase/server";
import {
  PartnerAccessNotice,
  PartnerShell,
  PARTNER_BORDER,
  PARTNER_CARD_CLASS,
  PARTNER_INK,
  PARTNER_MUTED,
} from "@/components/affiliate/partner-shell";
import {
  BillingProfileForm,
  PartnerSelfForm,
  type BillingProfileInitial,
} from "@/components/affiliate/partner-forms";

/**
 * Affiliate-System, Block B7-A — `/partner/stammdaten`
 * (PLAN_Affiliate-System.md 8.2 Zeile 7, 3.3, 3.13, 7.5).
 *
 * ## Zwei getrennte Formulare, mit Absicht
 *
 * Name/Firma/Benachrichtigungen gehören zur Partnerzeile, Anschrift/
 * Steuerdaten/Zahlungsverbindung zum Abrechnungsprofil — zwei Tabellen, zwei
 * Rechtelagen, zwei Server Actions. Sie in EIN Formular zu legen hieße, bei
 * jedem Namenswechsel die Bankdaten mitzuschreiben; ein Fehler in der
 * IBAN-Prüfung verhinderte dann auch die Namensänderung.
 *
 * ## Was hier NICHT angezeigt wird, und warum
 *
 * IBAN, BIC, Kontoinhaber, PayPal-Adresse und Steuernummer stehen NICHT im
 * SELECT-Spaltenrecht des Partners (Migration 20260910120000, Abschnitt 6) —
 * auch nicht für ihn selbst. Das ist kein Versehen: wären sie lesbar, wäre
 * jede übernommene Sitzung ein Bankdatenleck, und die Spalte ließe sich über
 * PostgREST auch aus jeder anderen Ansicht ziehen. Die Seite zeigt deshalb
 * NUR, ob etwas hinterlegt ist, und das Formular setzt die Werte neu.
 *
 * Der Prüfstatus der USt-IdNr. steht im Klartext da (8.2) und nicht als
 * Farbpunkt: „Geprüft und gültig" / „Noch nicht geprüft" ist eine Aussage
 * über Geld, die ein sehbehinderter Nutzer lesen können muss. Setzen kann
 * ihn nur `service_role` nach der VIES-Prüfung (7.5) — der Guard-Trigger
 * nullt jeden Versuch des Partners.
 *
 * ## Datenexport und Löschantrag
 *
 * Der Plan nennt beides für diese Seite. Beides gehört zum DSGVO-Paket in
 * Block B9 (Anonymisierung statt Löschung, 7.8) und hat dort seine Route und
 * seinen Ablauf. Ein Knopf, der nichts tut, oder ein Löschantrag, dessen
 * Folge niemand festgelegt hat, wäre an dieser Stelle schlimmer als sein
 * Fehlen. Stattdessen steht hier der Hinweis, was mit den Daten geschieht,
 * und der Weg über das bestehende Profil (`/profil`), das den Löschantrag
 * bereits kennt.
 */
export default async function PartnerStammdatenPage() {
  const access = await checkAffiliatePartnerAccess();
  if (!access.ok) return <PartnerAccessNotice reason={access.reason} />;

  const supabase = await createClient();
  const t = await getTranslations("affiliate.profile");

  const [{ data: program }, { data: partner }, { data: profile }] = await Promise.all([
    supabase
      .from("affiliate_programs")
      .select("id, tier2_enabled")
      .eq("tenant_id", access.tenant.id)
      .maybeSingle(),
    // Spalten benennen — Spalten-Grant, `select("*")` bricht mit 42501 ab.
    supabase
      .from("affiliate_partners")
      .select("id, display_name, company, notify_sale, notify_reversal, notify_payout")
      .eq("tenant_id", access.tenant.id)
      .eq("id", access.partnerId)
      .maybeSingle(),
    supabase
      .from("affiliate_billing_profiles")
      .select(
        "partner_id, entity_kind, legal_name, street, postal_code, city, country, small_business, vat_id, vat_check_result, vat_checked_at, payout_method",
      )
      .eq("tenant_id", access.tenant.id)
      .eq("partner_id", access.partnerId)
      .maybeSingle(),
  ]);

  const initial: BillingProfileInitial = {
    entityKind: profile?.entity_kind ?? "",
    legalName: profile?.legal_name ?? "",
    street: profile?.street ?? "",
    postalCode: profile?.postal_code ?? "",
    city: profile?.city ?? "",
    country: profile?.country ?? "DE",
    smallBusiness: profile?.small_business === true,
    vatId: profile?.vat_id ?? "",
    payoutMethod: profile?.payout_method ?? "",
    // Keine Werte, nur Ja/Nein — und selbst das nur abgeleitet aus dem, was
    // die Oberfläche überhaupt lesen darf: ist ein Zahlweg gesetzt, wurde bei
    // dessen Pflichtfeldern auch etwas hinterlegt (das Schema erzwingt das).
    hasIban: profile?.payout_method === "sepa",
    hasPaypal: profile?.payout_method === "paypal",
    hasTaxNumber: false,
  };

  const vatStatusText =
    profile?.vat_check_result === "valid"
      ? t("vatStatusValid")
      : profile?.vat_check_result === "invalid"
        ? t("vatStatusInvalid")
        : t("vatStatusUnchecked");

  return (
    <PartnerShell
      active="profile"
      title={t("title")}
      tenantName={access.tenant.name}
      logoUrl={access.tenant.branding?.logo_url ?? null}
      showTeam={program?.tier2_enabled === true}
    >
      <section
        className={`${PARTNER_CARD_CLASS} p-[22px_24px]`}
        style={{ borderColor: PARTNER_BORDER }}
      >
        <h2 className="mb-4 text-[17px] font-bold" style={{ color: PARTNER_INK }}>
          {t("title")}
        </h2>
        <PartnerSelfForm
          displayName={partner?.display_name ?? ""}
          company={partner?.company ?? ""}
          notifySale={partner?.notify_sale !== false}
          notifyReversal={partner?.notify_reversal !== false}
          notifyPayout={partner?.notify_payout !== false}
        />
      </section>

      <section
        className={`${PARTNER_CARD_CLASS} p-[22px_24px]`}
        style={{ borderColor: PARTNER_BORDER }}
      >
        <h2 className="mb-1 text-[17px] font-bold" style={{ color: PARTNER_INK }}>
          {t("billingHeading")}
        </h2>
        <p className="mb-2 text-[15px]" style={{ color: PARTNER_MUTED }}>
          {t("billingHint")}
        </p>
        {/* Prüfstatus als Satz, nicht als Farbe (8.5). */}
        <p className="mb-4 text-[15px]" style={{ color: PARTNER_INK }}>
          {t("vatStatusLabel")}: <span className="font-semibold">{vatStatusText}</span>
        </p>
        <BillingProfileForm initial={initial} />
      </section>

      <section
        className={`${PARTNER_CARD_CLASS} p-[22px_24px]`}
        style={{ borderColor: PARTNER_BORDER }}
      >
        <h2 className="text-[17px] font-bold" style={{ color: PARTNER_INK }}>
          {t("dataHeading")}
        </h2>
        <p className="mt-2 text-[15px]" style={{ color: PARTNER_MUTED }}>
          {t("dataDeleteHint")}
        </p>
        <p className="mt-2 text-[15px]" style={{ color: PARTNER_MUTED }}>
          {t("dataViaProfile")}
        </p>
      </section>
    </PartnerShell>
  );
}
