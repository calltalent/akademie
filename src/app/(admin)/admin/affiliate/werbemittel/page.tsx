import { getTranslations } from "next-intl/server";
import { checkAffiliateManagerAccess } from "@/lib/affiliate/access";
import { AffiliateAccessNotice, AffiliateShell } from "../affiliate-shell";
import { CARD_BORDER, CARD_CLASS, INK, MUTED } from "../affiliate-format";

/**
 * Affiliate-System, Block B6-B — `/admin/affiliate/werbemittel`
 * (PLAN_Affiliate-System.md 8.1 Zeile 8, 3.15).
 *
 * WARUM HIER KEINE LISTE UND KEIN FORMULAR STEHT, und warum das keine
 * Bequemlichkeit ist:
 *
 * Die Tabelle `affiliate_creatives` (Plan 3.15) ist in keiner der sechs
 * angewandten Migrationen enthalten — `20260910120000_affiliate_core.sql`
 * legt `affiliate_programs`, `_groups`, `_partners`, `_conditions`,
 * `_billing_profiles` und `_audit_log` an, `20260911120000` und
 * `20260911130000`/`20260911140000` den Tracking- und Buchungsteil. Es gibt
 * damit weder eine Tabelle noch eine Server Action noch einen Storage-Pfad
 * für Werbemittel.
 *
 * Eine Seite mit Upload-Formular wäre an dieser Stelle eine Zusage, die beim
 * ersten Klick bricht: das Formular sähe vollständig aus, der Upload liefe
 * ins Leere, und ein sehbehinderter Betreiber erführe das erst aus einer
 * Fehlermeldung nach dem Absenden. Deshalb steht hier, was tatsächlich gilt —
 * mit dem Weg, der heute schon funktioniert: der Empfehlungslink des Partners
 * entsteht allein aus seinem Code (4.2) und steht auf der Partnerseite.
 *
 * Was die Seite bekommt, sobald die Tabelle da ist (3.15/8.1): Liste je Art,
 * Formular mit Typ- und Größen-Whitelist, Storage-Pfad
 * `{tenant_id}/affiliate/creatives/`, Vorschau, Aktiv-Schalter und der
 * Platzhalter-Hinweis für E-Mail-Vorlagen.
 */
export default async function AdminAffiliateCreativesPage() {
  const access = await checkAffiliateManagerAccess();
  if (!access.ok) return <AffiliateAccessNotice reason={access.reason} />;

  const t = await getTranslations("admin.affiliate");

  return (
    <AffiliateShell active="creatives" title={t("creatives.title")}>
      <section
        aria-labelledby="affiliate-creatives-heading"
        className={`${CARD_CLASS} max-w-3xl p-[22px_24px]`}
        style={{ borderColor: CARD_BORDER }}
      >
        <h2
          id="affiliate-creatives-heading"
          className="text-[17px] font-bold"
          style={{ color: INK }}
        >
          {t("creatives.notAvailableHeading")}
        </h2>
        <p className="mt-2 text-[15px]" style={{ color: MUTED }}>
          {t("creatives.notAvailableBody")}
        </p>
        <p className="mt-3 text-[15px]" style={{ color: MUTED }}>
          {t("creatives.linkHint")}
        </p>
        <h3 className="mt-5 text-[15px] font-bold" style={{ color: INK }}>
          {t("creatives.plannedHeading")}
        </h3>
        <ul
          className="mt-2 flex list-disc flex-col gap-1 pl-5 text-[15px]"
          style={{ color: MUTED }}
        >
          <li>{t("creatives.kind.banner")}</li>
          <li>{t("creatives.kind.email")}</li>
          <li>{t("creatives.kind.text")}</li>
          <li>{t("creatives.kind.file")}</li>
        </ul>
      </section>
    </AffiliateShell>
  );
}
