import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getTenant } from "@/lib/tenant/context";
import { formatAddress, resolveLegalEntity } from "@/lib/legal/company";
import { LegalHeader, LegalSection } from "@/components/legal/legal-section";

/**
 * Impressum/Legal notice des Mandanten-Rechtsträgers (24.08.2026). Die
 * Firmendaten kommen aus `tenants.legal.entity` (lib/legal/company.ts), NICHT
 * aus dem Branding und nicht aus den Sprachdateien — für die eigenen Marken
 * (salestalent.app, academy.calltalent.ai) steht dort seit heute die
 * Calltalent LLC (Wyoming, USA) statt der bisherigen Calltalent Ltd.
 *
 * Der Registerabschnitt wird nur gerendert, wenn eine Nummer hinterlegt ist
 * (Wyoming Filing ID liegt noch nicht vor) — lieber ein fehlender Abschnitt
 * als eine erfundene Registernummer auf einer Rechtsseite.
 *
 * Die `notFound()`-Prüfung steht zusätzlich zum Layout: ein Next.js-Layout
 * ist keine Sicherheitsgrenze, an der eine Seite zwingend vorbeimuss.
 */
export default async function LegalNoticePage() {
  const [tenant, t] = await Promise.all([getTenant(), getTranslations("legal.notice")]);
  const entity = resolveLegalEntity(tenant?.legal);
  if (!entity) notFound();

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <LegalHeader title={t("title")} />

      <LegalSection heading={t("providerHeading")}>
        <p className="font-semibold">{entity.name}</p>
        {entity.addressLines.map((line) => (
          <p key={line} className="!mt-0 text-muted-500">
            {line}
          </p>
        ))}
        <p className="text-muted-500">{t("formText", { company: entity.name })}</p>
      </LegalSection>

      <LegalSection heading={t("contactHeading")}>
        <p>
          {t("contactLabel")}{" "}
          <a href={`mailto:${entity.email}`} className="font-semibold underline underline-offset-2">
            {entity.email}
          </a>
        </p>
        <p className="text-muted-500">{t("contactText")}</p>
      </LegalSection>

      <LegalSection heading={t("representativeHeading")}>
        <p>{t("representativeText", { company: entity.name })}</p>
      </LegalSection>

      {entity.registrationNumber && (
        <LegalSection heading={t("registerHeading")}>
          <p>{t("registerText", { number: entity.registrationNumber })}</p>
        </LegalSection>
      )}

      <LegalSection heading={t("responsibleHeading")}>
        <p>{t("responsibleText", { company: entity.name, address: formatAddress(entity) })}</p>
      </LegalSection>

      <LegalSection heading={t("disputeHeading")}>
        <p>{t("disputeText")}</p>
      </LegalSection>
    </div>
  );
}
