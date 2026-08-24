import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getTenant } from "@/lib/tenant/context";
import { formatAddress, resolveLegalEntity } from "@/lib/legal/company";
import { LEGAL_LAST_UPDATED } from "@/lib/legal/updated";
import { LegalHeader, LegalSection } from "@/components/legal/legal-section";

/**
 * AGB/Terms des Mandanten-Rechtsträgers (24.08.2026, Josips Auftrag).
 * Vertragspartner ist seit heute die Calltalent LLC (Wyoming, USA), nicht
 * mehr die Calltalent Ltd. — die Angabe kommt aus `tenants.legal.entity`,
 * damit ein späterer White-Label-Kunde mit eigenem Rechtsträger dieselben
 * Seiten mit SEINEN Daten bekommt.
 *
 * Der Widerrufs-Abschnitt bleibt drin, obwohl der Anbieter jetzt eine
 * US-Gesellschaft ist: er richtet sich an Verbraucher in der EU/im EWR,
 * deren zwingende Rechte (Art. 6 Abs. 2 Rom-I-VO) durch eine Rechtswahl
 * nicht entfallen. Für den Kauf über die Plattform gilt weiterhin, was in
 * `src/app/(learn)/kaufen/` tatsächlich umgesetzt ist — keine Klausel, die
 * einen Ablauf beschreibt, den es im Produkt nicht gibt.
 */
export default async function TermsPage() {
  const [tenant, t, locale] = await Promise.all([
    getTenant(),
    getTranslations("legal.terms"),
    getLocale(),
  ]);
  const entity = resolveLegalEntity(tenant?.legal);
  if (!entity) notFound();

  const updated = new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(
    new Date(LEGAL_LAST_UPDATED),
  );
  const service = tenant?.name ?? entity.name;

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <LegalHeader title={t("title")} updated={t("updated", { date: updated })} />

      <LegalSection heading={t("scopeHeading")}>
        <p>{t("scopeText", { company: entity.name, address: formatAddress(entity), service })}</p>
      </LegalSection>

      <LegalSection heading={t("servicesHeading")}>
        <p>{t("servicesText")}</p>
      </LegalSection>

      <LegalSection heading={t("accountHeading")}>
        <p>{t("accountText")}</p>
        <p>{t("accountSecurityText")}</p>
      </LegalSection>

      <LegalSection heading={t("pricesHeading")}>
        <p>{t("pricesText")}</p>
      </LegalSection>

      <LegalSection heading={t("withdrawalHeading")}>
        <p>{t("withdrawalText")}</p>
        <p>{t("withdrawalContactText", { email: entity.email })}</p>
      </LegalSection>

      <LegalSection heading={t("contentHeading")}>
        <p>{t("contentText", { company: entity.name })}</p>
        <p>{t("contentUserText")}</p>
      </LegalSection>

      <LegalSection heading={t("aiHeading")}>
        <p>{t("aiText")}</p>
      </LegalSection>

      <LegalSection heading={t("availabilityHeading")}>
        <p>{t("availabilityText")}</p>
      </LegalSection>

      <LegalSection heading={t("conductHeading")}>
        <p>{t("conductText")}</p>
      </LegalSection>

      <LegalSection heading={t("liabilityHeading")}>
        <p>{t("liabilityText")}</p>
      </LegalSection>

      <LegalSection heading={t("terminationHeading")}>
        <p>{t("terminationText")}</p>
      </LegalSection>

      <LegalSection heading={t("lawHeading")}>
        <p>{t("lawText")}</p>
        <p>{t("consumerText")}</p>
      </LegalSection>

      <LegalSection heading={t("changesHeading")}>
        <p>{t("changesText")}</p>
      </LegalSection>

      <LegalSection heading={t("contactHeading")}>
        <p>{t("contactText", { company: entity.name, email: entity.email })}</p>
      </LegalSection>
    </div>
  );
}
