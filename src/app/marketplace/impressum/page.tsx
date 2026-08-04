import { getTranslations } from "next-intl/server";

/**
 * Impressum für `marketplace.calltalent.ai` (Marketplace M4, Plan Abschnitt 9:
 * "eigenständiges Telemedienangebot — eigenes Impressum, §5 DDG, UK-Pflicht-
 * angaben Calltalent Ltd."). Unternehmensdaten exakt aus HOME.md/CLAUDE.md
 * (Vault "Calltalent Ltd"), nicht aus dem Mandanten-Branding — auf dieser
 * Domain gibt es keinen Mandanten.
 */
export default async function MarketplaceImpressumPage() {
  const t = await getTranslations("marketplace.legal.impressum");

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-[28px] font-extrabold text-ink">{t("title")}</h1>

      <section className="mt-8">
        <h2 className="text-sm font-bold uppercase tracking-[0.03em] text-muted-400">{t("companyHeading")}</h2>
        <p className="mt-2 text-base text-ink">{t("companyName")}</p>
        <p className="text-base text-muted-500">{t("companyForm")}</p>
        <p className="text-base text-muted-500">{t("companyNumber")}</p>
        <p className="text-base text-muted-500">{t("address")}</p>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-bold uppercase tracking-[0.03em] text-muted-400">{t("contactHeading")}</h2>
        <p className="mt-2 text-base text-ink">{t("email")}</p>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-bold uppercase tracking-[0.03em] text-muted-400">{t("representativeHeading")}</h2>
        <p className="mt-2 text-base text-ink">{t("representativeText")}</p>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-bold uppercase tracking-[0.03em] text-muted-400">{t("registerHeading")}</h2>
        <p className="mt-2 text-base text-ink">{t("registerText")}</p>
      </section>
    </div>
  );
}
