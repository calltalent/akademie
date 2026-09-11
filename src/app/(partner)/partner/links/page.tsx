import { getTranslations } from "next-intl/server";
import { checkAffiliatePartnerAccess } from "@/lib/affiliate/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { tenantOrigin } from "@/lib/tenant/url";
import {
  PartnerAccessNotice,
  PartnerShell,
  PARTNER_BORDER,
  PARTNER_CARD_CLASS,
  PARTNER_INK,
  PARTNER_MUTED,
} from "@/components/affiliate/partner-shell";
import { LinkBuilder, type PartnerLinkTarget } from "@/components/affiliate/partner-forms";

/**
 * Affiliate-System, Block B7-A — `/partner/links`
 * (PLAN_Affiliate-System.md 8.2 Zeile 2, 4.1, 4.2, 4.7, G11, 11.10).
 *
 * „Link in drei Klicks": Ziel wählen, Kampagne ergänzen, kopieren.
 *
 * ## Warum die Titel über `createAdminClient()` kommen
 *
 * Der Plan schreibt es für diesen Bereich ausdrücklich vor (8.2): „Produkt-
 * und Kurstitel liest der Bereich über `createAdminClient()` mit
 * ausdrücklicher Spaltenliste NACH dem Gate, nicht über RLS." Grund: ein
 * Partner ist kein Mitglied (G9) — `courses_member_select` liefert ihm
 * nichts, und ein Policy-Zweig „Partner dürfen Kurse lesen" wäre genau der
 * Gast-Fund vom 03.08.2026 in neuer Form. Die Bedingungen dieses
 * Admin-Client-Aufrufs stehen in 11.10 und sind hier alle erfüllt: Gate
 * davor, ausdrückliche Spaltenliste, `.eq("tenant_id", …)` auf jeder
 * Abfrage, und ausgewählt werden nur veröffentlichte bzw. aktive Zeilen —
 * ein Partner soll keine unveröffentlichten Kurstitel des Händlers erfahren.
 *
 * ## Warum der Link aus `tenantOrigin()` gebaut wird
 *
 * G11 verbietet `buildTenantUrl()` als ZIEL DES REDIRECTS im Klick-Endpunkt
 * — dort muss das Cookie auf demselben Host gesetzt werden, auf dem die
 * Anfrage ankam. Hier ist die Lage umgekehrt: der Partner verteilt diesen
 * Link an Fremde, er braucht also die kanonische Adresse des Mandanten
 * (Custom Domain, sonst `{slug}.calltalent.ai`) und nicht den Host, unter dem
 * er selbst gerade eingeloggt ist. Genau dafür gibt es `tenantOrigin()`.
 *
 * ## Marketplace-Ziele werden nicht angeboten (4.7)
 *
 * Die Auswahl enthält nur Ziele auf der Mandanten-Domain (`kurs/<slug>`,
 * `kaufen/<slug>`) — dieselbe Positivliste, die `inspectClickTarget()`
 * durchlässt. Ein Ziel, das der Klick-Endpunkt ablehnen würde, gehört nicht
 * in ein Auswahlfeld: der Partner bekäme einen Link, der still ohne
 * Zuordnung weiterleitet.
 */
export default async function PartnerLinksPage() {
  const access = await checkAffiliatePartnerAccess();
  if (!access.ok) return <PartnerAccessNotice reason={access.reason} />;

  const supabase = await createClient();
  const admin = createAdminClient();
  const t = await getTranslations("affiliate.links");

  const [{ data: program }, { data: partner }, { data: courses }, { data: products }] =
    await Promise.all([
      supabase
        .from("affiliate_programs")
        .select("id, cookie_ttl_days, tier2_enabled")
        .eq("tenant_id", access.tenant.id)
        .maybeSingle(),
      // Spalten benennen: das SELECT-Recht auf `affiliate_partners` ist ein
      // Spalten-Grant, `select("*")` bricht mit 42501 ab.
      supabase
        .from("affiliate_partners")
        .select("id, code")
        .eq("tenant_id", access.tenant.id)
        .eq("id", access.partnerId)
        .maybeSingle(),
      admin
        .from("courses")
        .select("id, title, slug, status")
        .eq("tenant_id", access.tenant.id)
        .eq("status", "published")
        .order("title", { ascending: true }),
      admin
        .from("products")
        .select("id, title, slug, active")
        .eq("tenant_id", access.tenant.id)
        .eq("active", true)
        .order("title", { ascending: true }),
    ]);

  const targets: PartnerLinkTarget[] = [
    ...(courses ?? []).map((course) => ({
      value: `kurs/${course.slug}`,
      label: t("targetCourse", { title: course.title }),
    })),
    ...(products ?? []).map((product) => ({
      value: `kaufen/${product.slug}`,
      label: t("targetProduct", { title: product.title }),
    })),
  ];

  const code = partner?.code ?? "";

  return (
    <PartnerShell
      active="links"
      title={t("title")}
      description={t("description")}
      tenantName={access.tenant.name}
      logoUrl={access.tenant.branding?.logo_url ?? null}
      showTeam={program?.tier2_enabled === true}
    >
      <div
        className={`${PARTNER_CARD_CLASS} p-[22px_24px]`}
        style={{ borderColor: PARTNER_BORDER }}
      >
        <LinkBuilder
          origin={tenantOrigin(access.tenant)}
          code={code}
          targets={targets}
          cookieTtlDays={Number(program?.cookie_ttl_days ?? 30)}
        />
      </div>

      <div
        className={`${PARTNER_CARD_CLASS} p-[22px_24px]`}
        style={{ borderColor: PARTNER_BORDER }}
      >
        <h2 className="text-[17px] font-bold" style={{ color: PARTNER_INK }}>
          {t("codeHeading")}
        </h2>
        {/* Der Code steht als auswählbarer Text, nicht nur im Link: er
            funktioniert auch ohne Link — im Podcast, auf Papier, am
            Telefon. */}
        <p className="mt-2 text-[22px] font-extrabold" style={{ color: PARTNER_INK }}>
          {code}
        </p>
        <p className="mt-1 text-[15px]" style={{ color: PARTNER_MUTED }}>
          {t("codeHint")}
        </p>
      </div>
    </PartnerShell>
  );
}
