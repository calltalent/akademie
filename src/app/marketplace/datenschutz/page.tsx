import { getTranslations } from "next-intl/server";
import { CALLTALENT_LLC, formatAddress } from "@/lib/legal/company";

/**
 * Datenschutzerklärung für `marketplace.calltalent.ai` (Marketplace M4, Plan
 * Abschnitt 9). Platzhalter-Struktur mit sinnvollen Überschriften (Auftrags-
 * text: "kein vollständiger Rechtstext nötig, aber Struktur/Überschriften
 * sollten sinnvoll sein: verantwortliche Stelle, welche Daten, Zweck,
 * Rechtsgrundlage grob benannt") — kein Kauf existiert in M4, daher keine
 * Zahlungsdiensteanbieter-Klausel mit konkreten Details, nur als Ankündigung
 * genannt.
 *
 * RECHTSTRÄGER-WECHSEL (24.08.2026): verantwortliche Stelle ist jetzt die
 * Calltalent LLC (Wyoming, USA), Firmendaten aus `lib/legal/company.ts`.
 * Neu dadurch: `transferText` — bei einem Verantwortlichen außerhalb der
 * EU/des EWR gehört die Drittlandsübermittlung (Art. 44 ff. DSGVO) in den
 * Text, die alte UK-Fassung brauchte den Abschnitt nicht.
 */
export default async function MarketplaceDatenschutzPage() {
  const t = await getTranslations("marketplace.legal.datenschutz");
  const entity = CALLTALENT_LLC;

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-[28px] font-extrabold text-ink">{t("title")}</h1>

      <section className="mt-8">
        <h2 className="text-sm font-bold uppercase tracking-[0.03em] text-muted-400">{t("controllerHeading")}</h2>
        <p className="mt-2 text-base leading-relaxed text-ink">
          {t("controllerText", { company: entity.name, address: formatAddress(entity), email: entity.email })}
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-bold uppercase tracking-[0.03em] text-muted-400">{t("dataHeading")}</h2>
        <p className="mt-2 text-base leading-relaxed text-ink">{t("dataText")}</p>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-bold uppercase tracking-[0.03em] text-muted-400">{t("purposeHeading")}</h2>
        <p className="mt-2 text-base leading-relaxed text-ink">{t("purposeText")}</p>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-bold uppercase tracking-[0.03em] text-muted-400">{t("recipientsHeading")}</h2>
        <p className="mt-2 text-base leading-relaxed text-ink">{t("recipientsText")}</p>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-bold uppercase tracking-[0.03em] text-muted-400">{t("transferHeading")}</h2>
        <p className="mt-2 text-base leading-relaxed text-ink">{t("transferText", { company: entity.name })}</p>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-bold uppercase tracking-[0.03em] text-muted-400">{t("rightsHeading")}</h2>
        <p className="mt-2 text-base leading-relaxed text-ink">{t("rightsText", { email: entity.email })}</p>
      </section>
    </div>
  );
}
