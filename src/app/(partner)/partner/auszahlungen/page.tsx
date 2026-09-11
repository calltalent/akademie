import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { checkAffiliatePartnerAccess } from "@/lib/affiliate/access";
import { createClient } from "@/lib/supabase/server";
import {
  PartnerAccessNotice,
  PartnerShell,
  PARTNER_BORDER,
  PARTNER_CARD_CLASS,
  PARTNER_FOCUS_RING,
  PARTNER_INK,
  PARTNER_MUTED,
} from "@/components/affiliate/partner-shell";

/**
 * Affiliate-System, Block B7-A — `/partner/auszahlungen`
 * (PLAN_Affiliate-System.md 8.2 Zeile 5).
 *
 * ## ABWEICHUNG VOM PLAN, bewusst und benannt
 *
 * Der Plan beschreibt hier „Datum, Zeitraum, Betrag, Steuermodus, Referenz,
 * Beleg-Download über eine Route mit Besitzprüfung". Die Tabelle
 * `affiliate_payouts` entsteht aber erst mit Block B8 (3.12; die Migration
 * 20260911130000 hält an `payout_id` ausdrücklich fest: „KEIN
 * Fremdschlüssel: `affiliate_payouts` entsteht erst mit Block B8"). Es gibt
 * also nichts zu lesen — und einen Beleg, den niemand erzeugt hat, auch
 * nicht.
 *
 * Zwei Möglichkeiten, damit umzugehen, und die Wahl zwischen ihnen ist
 * keine Geschmacksfrage:
 *   (a) Die Seite weglassen. Dann führt der Menüpunkt ins Leere — oder er
 *       fehlt, und der Partner sucht ihn.
 *   (b) Die Seite bauen und ehrlich sagen, dass noch keine Auszahlung
 *       stattgefunden hat und wo der freigegebene Betrag steht.
 * Gewählt ist (b). Was NICHT passiert: eine erfundene Tabelle mit
 * Platzhaltern, ein „demnächst"-Datum oder ein Knopf, der nichts tut. Bei
 * Geld ist eine leere, erklärte Seite besser als eine gefüllte, die nichts
 * bedeutet — und für einen sehbehinderten Nutzer ist ein Knopf ohne Wirkung
 * die teuerste Art von Fehler.
 *
 * Sobald B8 `affiliate_payouts` anlegt, wird aus dem Hinweis eine Liste:
 * die Abfrage gehört an genau diese Stelle, mit ausdrücklicher Spaltenliste
 * und `.eq("partner_id", access.partnerId)`; der Beleg-Download läuft über
 * eine eigene Route mit Besitzprüfung und kurzlebiger Signed URL (11.5) —
 * nie über eine direkt verlinkte signierte URL.
 */
export default async function PartnerAuszahlungenPage() {
  const access = await checkAffiliatePartnerAccess();
  if (!access.ok) return <PartnerAccessNotice reason={access.reason} />;

  const supabase = await createClient();
  const t = await getTranslations("affiliate.payouts");

  const { data: program } = await supabase
    .from("affiliate_programs")
    .select("id, tier2_enabled")
    .eq("tenant_id", access.tenant.id)
    .maybeSingle();

  return (
    <PartnerShell
      active="payouts"
      title={t("title")}
      tenantName={access.tenant.name}
      logoUrl={access.tenant.branding?.logo_url ?? null}
      showTeam={program?.tier2_enabled === true}
    >
      <div
        className={`${PARTNER_CARD_CLASS} p-[22px_24px]`}
        style={{ borderColor: PARTNER_BORDER }}
      >
        <p className="text-[15px]" style={{ color: PARTNER_INK }}>
          {t("notAvailableYet")}
        </p>
        <p className="mt-2 text-[15px]" style={{ color: PARTNER_MUTED }}>
          {t("balanceHint")}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href="/partner"
            prefetch={false}
            className={`inline-flex min-h-[40px] items-center rounded-[11px] border px-[14px] text-[15px] font-semibold no-underline ${PARTNER_FOCUS_RING}`}
            style={{ borderColor: PARTNER_BORDER, color: PARTNER_INK }}
          >
            {t("toOverview")}
          </Link>
          <Link
            href="/partner/kontoauszug"
            prefetch={false}
            className={`inline-flex min-h-[40px] items-center rounded-[11px] border px-[14px] text-[15px] font-semibold no-underline ${PARTNER_FOCUS_RING}`}
            style={{ borderColor: PARTNER_BORDER, color: PARTNER_INK }}
          >
            {t("toStatement")}
          </Link>
        </div>
      </div>
    </PartnerShell>
  );
}
