import { getTranslations } from "next-intl/server";

/**
 * AGB für `marketplace.calltalent.ai` (Marketplace M4, Plan Abschnitt 9:
 * "AGB mit Widerrufsbelehrung, §356 Abs. 5 BGB, digitale Inhalte" — als
 * Platzhalter-Abschnitt, "wird erst in M5 mit echtem Kauf-Text ausgefüllt").
 * `pendingNotice` stellt ausdrücklich klar, dass der Kauf hier noch nicht
 * existiert — keine bindende Widerrufsregelung für ein nicht vorhandenes
 * Kaufrecht vortäuschen.
 */
export default async function MarketplaceAgbPage() {
  const t = await getTranslations("marketplace.legal.agb");

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-[28px] font-extrabold text-ink">{t("title")}</h1>

      <section className="mt-8">
        <h2 className="text-sm font-bold uppercase tracking-[0.03em] text-muted-400">{t("scopeHeading")}</h2>
        <p className="mt-2 text-base leading-relaxed text-ink">{t("scopeText")}</p>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-bold uppercase tracking-[0.03em] text-muted-400">{t("contentHeading")}</h2>
        <p className="mt-2 text-base leading-relaxed text-ink">{t("contentText")}</p>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-bold uppercase tracking-[0.03em] text-muted-400">{t("withdrawalHeading")}</h2>
        <p className="mt-2 text-base leading-relaxed text-ink">{t("withdrawalText")}</p>
      </section>

      <p className="mt-8 rounded-xl border border-border-100 bg-white p-4 text-sm text-muted-500">
        {t("pendingNotice")}
      </p>
    </div>
  );
}
