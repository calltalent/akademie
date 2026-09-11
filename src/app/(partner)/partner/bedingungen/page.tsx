import { getFormatter, getTranslations } from "next-intl/server";
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
import { TermsAcceptForm } from "@/components/affiliate/partner-forms";

/**
 * Affiliate-System, Block B7-A — `/partner/bedingungen`
 * (PLAN_Affiliate-System.md 8.2 Zeile 8, 11.6, Art. 7 Abs. 1 DSGVO).
 *
 * Zweck laut Plan: „Sperren durchsetzbar machen." Der Volltext steht hier
 * IMMER — auch wenn nichts zu tun ist. Eine Regel, die man nur im Moment der
 * Zustimmung zu sehen bekommt, ist im Streitfall keine.
 *
 * Diese Seite ist die EINZIGE, die die Bedingungssperre aus dem Layout nicht
 * blockiert: sie ist der Ort, an dem die Sperre aufgelöst wird. Das Layout
 * erkennt sie am Pfad (`x-portal-pathname`), nicht an einem Flag, das eine
 * spätere Seite vergessen könnte.
 *
 * Die Zustimmung selbst schreibt ausschließlich der Server
 * (`acceptAffiliateTerms()`): `terms_version_accepted`, `terms_accepted_at`
 * und `terms_accepted_ip_hash` stehen nicht im UPDATE-Recht von
 * `authenticated`. Ein Nachweis, den der Nachzuweisende selbst schreibt, ist
 * keiner.
 *
 * Der Volltext kommt aus `affiliate_programs.terms_text` und wird als
 * VORFORMATIERTER TEXT ausgegeben (`whitespace-pre-wrap`), nicht als HTML
 * oder Markdown. Der Text stammt aus dem Einstellungsformular des Händlers;
 * ihn als HTML zu rendern wäre gespeichertes XSS gegen jeden Partner dieses
 * Mandanten — und der Plan verlangt an keiner Stelle Formatierung.
 */
export default async function PartnerBedingungenPage() {
  const access = await checkAffiliatePartnerAccess();
  if (!access.ok) return <PartnerAccessNotice reason={access.reason} />;

  const supabase = await createClient();
  const t = await getTranslations("affiliate.terms");
  const format = await getFormatter();

  const [{ data: program }, { data: partner }] = await Promise.all([
    supabase
      .from("affiliate_programs")
      .select("id, terms_text, terms_version, tier2_enabled")
      .eq("tenant_id", access.tenant.id)
      .maybeSingle(),
    supabase
      .from("affiliate_partners")
      .select("id, terms_version_accepted, terms_accepted_at")
      .eq("tenant_id", access.tenant.id)
      .eq("id", access.partnerId)
      .maybeSingle(),
  ]);

  const version = Number(program?.terms_version ?? 0);
  const accepted = Number(partner?.terms_version_accepted ?? 0);
  const outdated = program !== null && version > accepted;

  return (
    <PartnerShell
      active="terms"
      title={t("title")}
      tenantName={access.tenant.name}
      logoUrl={access.tenant.branding?.logo_url ?? null}
      showTeam={program?.tier2_enabled === true}
    >
      {outdated && (
        <div
          className={`${PARTNER_CARD_CLASS} p-[18px_20px]`}
          style={{ borderColor: "#E4C07A", background: "#FBF1DC" }}
        >
          <h2 className="text-[17px] font-bold" style={{ color: "#5A4512" }}>
            {t("updatedHeading")}
          </h2>
          <p className="mt-1 text-[15px]" style={{ color: "#5A4512" }}>
            {t("updatedBody")}
          </p>
        </div>
      )}

      <section
        className={`${PARTNER_CARD_CLASS} p-[22px_24px]`}
        style={{ borderColor: PARTNER_BORDER }}
      >
        <h2 className="text-[17px] font-bold" style={{ color: PARTNER_INK }}>
          {t("currentVersion", { version })}
        </h2>
        <p className="mt-1 text-[15px]" style={{ color: PARTNER_MUTED }}>
          {partner?.terms_accepted_at == null
            ? t("notAcceptedYet")
            : t("acceptedVersion", {
                version: accepted,
                date: format.dateTime(new Date(partner.terms_accepted_at), {
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                }),
              })}
        </p>

        <div
          className="mt-4 whitespace-pre-wrap text-[15px] leading-[1.6]"
          style={{ color: PARTNER_INK }}
        >
          {program?.terms_text?.trim() === "" || program?.terms_text == null
            ? t("noText")
            : program.terms_text}
        </div>

        {outdated && (
          <div className="mt-5">
            <TermsAcceptForm version={version} />
          </div>
        )}
      </section>
    </PartnerShell>
  );
}
