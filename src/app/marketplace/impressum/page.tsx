import { getTranslations } from "next-intl/server";
import { CALLTALENT_LLC } from "@/lib/legal/company";

/**
 * Impressum für `marketplace.calltalent.ai` (Marketplace M4, Plan Abschnitt 9:
 * "eigenständiges Telemedienangebot — eigenes Impressum"). Nicht aus dem
 * Mandanten-Branding — auf dieser Domain gibt es keinen Mandanten.
 *
 * RECHTSTRÄGER-WECHSEL (24.08.2026, Josips Auftrag "alles auf Calltalent
 * LLC"): Betreiber ist die Calltalent LLC (Wyoming, USA) statt der
 * bisherigen Calltalent Ltd. (England und Wales). Die Firmendaten stehen
 * seitdem NUR noch in `lib/legal/company.ts` — vorher lagen sie dreifach in
 * den Sprachdateien (de/en/bs) und hätten hier einzeln nachgezogen werden
 * müssen.
 */
export default async function MarketplaceImpressumPage() {
  const t = await getTranslations("marketplace.legal.impressum");
  const entity = CALLTALENT_LLC;

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-[28px] font-extrabold text-ink">{t("title")}</h1>

      <section className="mt-8">
        <h2 className="text-sm font-bold uppercase tracking-[0.03em] text-muted-400">{t("companyHeading")}</h2>
        <p className="mt-2 text-base font-semibold text-ink">{entity.name}</p>
        {entity.addressLines.map((line) => (
          <p key={line} className="text-base text-muted-500">
            {line}
          </p>
        ))}
        <p className="text-base text-muted-500">{t("companyForm", { company: entity.name })}</p>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-bold uppercase tracking-[0.03em] text-muted-400">{t("contactHeading")}</h2>
        <p className="mt-2 text-base text-ink">{t("email", { email: entity.email })}</p>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-bold uppercase tracking-[0.03em] text-muted-400">{t("representativeHeading")}</h2>
        <p className="mt-2 text-base text-ink">{t("representativeText", { company: entity.name })}</p>
      </section>

      {entity.registrationNumber && (
        <section className="mt-6">
          <h2 className="text-sm font-bold uppercase tracking-[0.03em] text-muted-400">{t("registerHeading")}</h2>
          <p className="mt-2 text-base text-ink">{t("registerText", { number: entity.registrationNumber })}</p>
        </section>
      )}

    </div>
  );
}
