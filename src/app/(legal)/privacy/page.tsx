import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getTenant } from "@/lib/tenant/context";
import { isAffiliateEnabled } from "@/lib/tenant/types";
import { formatAddress, resolveLegalEntity } from "@/lib/legal/company";
import { LEGAL_LAST_UPDATED } from "@/lib/legal/updated";
import { LegalHeader, LegalSection } from "@/components/legal/legal-section";
import { isTurnstileConfigured } from "@/lib/security/turnstile";

/**
 * Datenschutzerklärung des Mandanten (24.08.2026, Josips Auftrag). Inhalt
 * bewusst am TATSÄCHLICHEN Verarbeitungsstand der Plattform ausgerichtet,
 * nicht an einem Mustertext: die Auftragsverarbeiter-Liste ist dieselbe wie
 * in Anlage 2 des AVV (`AVV_Calltalent-Akademie_2026-07-12.docx`,
 * PHASENSTATUS.md) — Supabase/AWS Frankfurt, Bunny.net, Stripe, Resend,
 * Anthropic, Voyage AI, Cloudflare.
 *
 * Verantwortliche Stelle kommt aus `tenants.legal.entity`, seit heute die
 * Calltalent LLC (Wyoming, USA). Genau deshalb hat diese Fassung einen
 * eigenen Abschnitt zur Drittlandsübermittlung (Art. 44 ff. DSGVO), den die
 * alte UK-Fassung der Marketplace-Seite nicht brauchte.
 *
 * Abschnitt "Spam- und Bot-Schutz" NEU (25.08.2026, nach dem Spam-Vorfall
 * am Kontaktformular — siehe PHASENSTATUS.md): beschreibt die tatsächlich
 * stattfindende Verarbeitung (IP, Absendezeitpunkt, Formularinhalt) samt
 * Rechtsgrundlage. Der Turnstile-Absatz wird NUR gerendert, wenn Turnstile
 * auch wirklich konfiguriert ist (`isTurnstileConfigured()`) — eine
 * Datenschutzerklärung, die eine Übermittlung an Cloudflare behauptet, die
 * gar nicht stattfindet, wäre genauso falsch wie eine, die eine
 * stattfindende verschweigt. Damit gibt es auch keine Reihenfolge-Falle
 * beim Scharfschalten: Schlüssel setzen genügt, der Text folgt von selbst.
 *
 * Abschnitt "Partner-Empfehlungen" NEU (10.09.2026, Affiliate-Modul Block B2,
 * PLAN_Affiliate-System.md Abschnitt 10/B2): Zweck, Rechtsgrundlage,
 * Speicherdauer, Empfänger und Widerruf für das Attributions-Cookie `ct_aff`
 * und das Einwilligungs-Cookie `ct_consent`. Er folgt derselben Regel wie der
 * Turnstile-Absatz darüber und wird NUR gerendert, wenn das Partnerprogramm
 * für diesen Mandanten freigeschaltet ist — sonst behauptete die Erklärung
 * eine Verarbeitung, die auf dieser Akademie gar nicht stattfindet.
 *
 * Gleichzeitig wurde `legal.privacy.cookiesText` entschärft: der Satz "Wir
 * setzen ausschließlich technisch notwendige Cookies … Kein Tracking" galt
 * für jeden Mandanten und wäre mit dem ersten freigeschalteten
 * Partnerprogramm falsch geworden. Die neue Fassung nennt die technisch
 * notwendigen Cookies weiterhin abschließend und sagt für alles andere zu,
 * dass es nur nach ausdrücklicher Einwilligung gesetzt und in dieser
 * Erklärung beschrieben wird — das stimmt mit und ohne Partnerprogramm.
 */
const PROCESSOR_KEYS = [
  "hosting",
  "video",
  "payment",
  "email",
  "ai",
  "embeddings",
  "cdn",
] as const;

export default async function PrivacyPage() {
  const [tenant, t, locale] = await Promise.all([
    getTenant(),
    getTranslations("legal.privacy"),
    getLocale(),
  ]);
  const entity = resolveLegalEntity(tenant?.legal);
  if (!entity) notFound();

  const updated = new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(
    new Date(LEGAL_LAST_UPDATED),
  );
  const turnstileActive = isTurnstileConfigured();
  const affiliateActive = isAffiliateEnabled(tenant);

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <LegalHeader title={t("title")} updated={t("updated", { date: updated })} />

      <LegalSection heading={t("controllerHeading")}>
        <p>{t("controllerText", { company: entity.name, address: formatAddress(entity), email: entity.email })}</p>
        <p className="text-muted-500">{t("controllerScope", { service: tenant?.name ?? entity.name })}</p>
      </LegalSection>

      <LegalSection heading={t("dataHeading")}>
        <p>{t("dataIntro")}</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>{t("dataAccount")}</li>
          <li>{t("dataProgress")}</li>
          <li>{t("dataContent")}</li>
          <li>{t("dataPayment")}</li>
          <li>{t("dataSupport")}</li>
          <li>{t("dataTechnical")}</li>
        </ul>
      </LegalSection>

      <LegalSection heading={t("purposeHeading")}>
        <p>{t("purposeContract")}</p>
        <p>{t("purposeLegitimate")}</p>
        <p>{t("purposeConsent")}</p>
        <p>{t("purposeObligation")}</p>
      </LegalSection>

      <LegalSection heading={t("aiHeading")}>
        <p>{t("aiText")}</p>
        <p>{t("aiNoTraining")}</p>
      </LegalSection>

      <LegalSection heading={t("processorsHeading")}>
        <p>{t("processorsIntro")}</p>
        <ul className="list-disc space-y-1 pl-5">
          {PROCESSOR_KEYS.map((key) => (
            <li key={key}>{t(`processor.${key}`)}</li>
          ))}
        </ul>
      </LegalSection>

      <LegalSection heading={t("transferHeading")}>
        <p>{t("transferText", { company: entity.name })}</p>
      </LegalSection>

      <LegalSection heading={t("cookiesHeading")}>
        <p>{t("cookiesText")}</p>
        {/* Das Einwilligungs-Cookie `ct_consent` entsteht erst, wenn der
            Einwilligungsdialog überhaupt erscheint — also nur bei
            freigeschaltetem Partnerprogramm. Deshalb steht es hier hinter
            demselben Schalter wie der Abschnitt unten. */}
        {affiliateActive && <p>{t("cookiesConsentText")}</p>}
      </LegalSection>

      {affiliateActive && (
        <LegalSection heading={t("affiliateHeading")}>
          <p>{t("affiliateText")}</p>
          <p>{t("affiliateLegalBasis")}</p>
          <p>{t("affiliateRecipients")}</p>
          <p>{t("affiliateRetention")}</p>
          <p>{t("affiliateWithdraw")}</p>
        </LegalSection>
      )}

      <LegalSection heading={t("botHeading")}>
        <p>{t("botText")}</p>
        {turnstileActive && <p>{t("botTurnstile")}</p>}
      </LegalSection>

      <LegalSection heading={t("retentionHeading")}>
        <p>{t("retentionText")}</p>
      </LegalSection>

      <LegalSection heading={t("rightsHeading")}>
        <p>{t("rightsText")}</p>
        <p>{t("rightsContact", { email: entity.email })}</p>
        <p className="text-muted-500">{t("complaintText")}</p>
      </LegalSection>

      <LegalSection heading={t("changesHeading")}>
        <p>{t("changesText")}</p>
      </LegalSection>
    </div>
  );
}
