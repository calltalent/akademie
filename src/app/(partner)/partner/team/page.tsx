import { getFormatter, getTranslations } from "next-intl/server";
import { checkAffiliatePartnerAccess } from "@/lib/affiliate/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { tenantOrigin } from "@/lib/tenant/url";
import {
  PartnerAccessNotice,
  PartnerShell,
  PARTNER_BORDER,
  PARTNER_CARD_CLASS,
  PARTNER_HAIRLINE,
  PARTNER_INK,
  PARTNER_MUTED,
} from "@/components/affiliate/partner-shell";

/**
 * Affiliate-System, Block B7-A — `/partner/team`, die zweite Stufe
 * (PLAN_Affiliate-System.md 8.2 Zeile 6, 5.5, 3.1, 11.15).
 *
 * ## WARUM DIESE SEITE NICHT PER POSTGREST LÄDT
 *
 * Der naheliegende Weg wäre ein zweiter Zweig in der SELECT-Policy von
 * `affiliate_partners`: `or referred_by = affiliate_partner_id(tenant_id)`.
 * Er ist ausdrücklich verboten (Migration 20260910120000, Abschnitt 8), und
 * der Grund steht dort wörtlich: RLS trennt keine SPALTEN. Ein solcher Zweig
 * gäbe dem Werber über PostgREST die VOLLEN Zeilen seiner Geworbenen — samt
 * `application` (dem Bewerbungstext), `internal_note` (dem Vermerk des
 * Händlers über diese Person) und `terms_accepted_ip_hash`. Aus einer
 * Provisionsfrage würde eine Personenakte.
 *
 * Deshalb läuft die Sicht in zwei Schritten, beide serverseitig und beide
 * NACH dem Gate:
 *
 *   1. `affiliate_downline_ids(tenant)` — eine Security-Definer-Funktion,
 *      die an `auth.uid()` des AUFRUFERS hängt. Sie liefert IDs, sonst
 *      nichts. Aufgerufen mit dem Session-Client: die Bindung an den
 *      eingeloggten Partner ist damit nicht von dieser Datei abhängig,
 *      sondern von der Datenbank.
 *   2. Erst danach `createAdminClient()` mit einer AUSDRÜCKLICHEN
 *      Spaltenliste über genau diese IDs — `id`, `display_name`,
 *      `created_at`, mehr nicht. Die Bedingungen aus 11.10 sind erfüllt:
 *      Gate davor, Spaltenliste, `.eq("tenant_id", …)`, und die ID-Menge
 *      stammt aus der Datenbankfunktion, nicht aus dem Client.
 *
 * Die Reihenfolge ist der Schutz: der Admin-Client sieht nur IDs, die die
 * Datenbank dem Aufrufer selbst zugeordnet hat.
 *
 * ## Was der Werber sieht und was nicht
 *
 * Name, Beitrittsdatum, Umsatz und die daraus entstandene
 * Zweitstufen-Provision (8.2). NICHT: Bewerbungstext, interne Notiz,
 * E-Mail-Adresse, Anschrift, Bankdaten, Status. Und ganz sicher nicht die
 * Käufer der Geworbenen — die Umsatzsumme ist eine Zahl, keine Liste.
 *
 * ## Die Seite existiert nur bei `tier2_enabled`
 *
 * Ist die zweite Stufe aus, zeigt die Seite den Grund statt einer leeren
 * Tabelle — und der Menüpunkt erscheint gar nicht erst (`showTeam` in
 * `PartnerShell`).
 */

const COLS = "1.6fr 1fr 1fr 1fr";

type Tier2Row = {
  id: string;
  parent_id: string | null;
  amount_cents: number;
  currency: string;
  status: string;
  is_test: boolean;
};

export default async function PartnerTeamPage() {
  const access = await checkAffiliatePartnerAccess();
  if (!access.ok) return <PartnerAccessNotice reason={access.reason} />;

  const supabase = await createClient();
  const t = await getTranslations("affiliate.team");
  const format = await getFormatter();

  const [{ data: program }, { data: partner }, { data: downlineIds }] = await Promise.all([
    supabase
      .from("affiliate_programs")
      .select("id, currency, tier2_enabled")
      .eq("tenant_id", access.tenant.id)
      .maybeSingle(),
    supabase
      .from("affiliate_partners")
      .select("id, code")
      .eq("tenant_id", access.tenant.id)
      .eq("id", access.partnerId)
      .maybeSingle(),
    // Schritt 1: nur IDs, gebunden an `auth.uid()` des Aufrufers.
    supabase.rpc("affiliate_downline_ids", { t: access.tenant.id }),
  ]);

  const tier2Enabled = program?.tier2_enabled === true;
  const currency = program?.currency ?? "eur";
  const money = (cents: number): string =>
    format.number(cents / 100, {
      style: "currency",
      currency: /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : "EUR",
    });

  /**
   * Die RPC liefert `setof uuid`. PostgREST gibt das je nach Zeilenzahl als
   * Array von Strings zurück; die Prüfung hier ist bewusst eng, damit kein
   * `any` aus der untypisierten RPC weiterläuft (gleiche Vorsicht wie in
   * `checkAffiliatePartnerAccess()`).
   */
  const ids: string[] = Array.isArray(downlineIds)
    ? downlineIds.filter((value): value is string => typeof value === "string")
    : [];

  let rows: Array<{
    id: string;
    name: string;
    joinedAt: string;
    revenueCents: number;
    commissionCents: number;
  }> = [];

  if (tier2Enabled && ids.length > 0) {
    const admin = createAdminClient();

    const [{ data: partners }, { data: sales }, { data: tier2 }] = await Promise.all([
      // Schritt 2: ausdrückliche, kurze Spaltenliste.
      admin
        .from("affiliate_partners")
        .select("id, display_name, created_at")
        .eq("tenant_id", access.tenant.id)
        .in("id", ids)
        .order("created_at", { ascending: true }),
      // Umsatz der Geworbenen: die Bemessungsgrundlage ihrer Verkaufszeilen.
      // Keine Käuferspalte, keine Bestellnummer — nur Summanden.
      admin
        .from("affiliate_commissions")
        .select("id, partner_id, base_cents, status, is_test")
        .eq("tenant_id", access.tenant.id)
        .in("partner_id", ids)
        .eq("kind", "sale"),
      // Die eigene Zweitstufen-Provision. Über den SESSION-Client wäre sie
      // auch lesbar, aber `parent_id` ließe sich dann nicht auf den Partner
      // auflösen (die Elternzeile gehört jemand anderem). Deshalb beides in
      // einem Zug über den Admin-Client — eingegrenzt auf die EIGENEN Zeilen.
      admin
        .from("affiliate_commissions")
        .select("id, parent_id, amount_cents, currency, status, is_test")
        .eq("tenant_id", access.tenant.id)
        .eq("partner_id", access.partnerId)
        .eq("kind", "tier2"),
    ]);

    const saleOwner = new Map<string, string>();
    const revenueByPartner = new Map<string, number>();
    for (const sale of sales ?? []) {
      saleOwner.set(sale.id as string, sale.partner_id as string);
      if (sale.is_test === true || sale.status === "cancelled") continue;
      const key = sale.partner_id as string;
      revenueByPartner.set(key, (revenueByPartner.get(key) ?? 0) + Number(sale.base_cents ?? 0));
    }

    const commissionByPartner = new Map<string, number>();
    for (const row of (tier2 ?? []) as Tier2Row[]) {
      if (row.is_test || row.status === "cancelled" || row.parent_id === null) continue;
      if (row.currency !== currency) continue;
      const owner = saleOwner.get(row.parent_id);
      if (owner === undefined) continue;
      commissionByPartner.set(
        owner,
        (commissionByPartner.get(owner) ?? 0) + Number(row.amount_cents ?? 0),
      );
    }

    rows = (partners ?? []).map((row) => ({
      id: row.id as string,
      name: row.display_name as string,
      joinedAt: row.created_at as string,
      revenueCents: revenueByPartner.get(row.id as string) ?? 0,
      commissionCents: commissionByPartner.get(row.id as string) ?? 0,
    }));
  }

  const recruitLink = `${tenantOrigin(access.tenant)}/partnerprogramm?ref=${encodeURIComponent(
    partner?.code ?? "",
  )}`;

  return (
    <PartnerShell
      active="team"
      title={t("title")}
      description={t("description")}
      tenantName={access.tenant.name}
      logoUrl={access.tenant.branding?.logo_url ?? null}
      showTeam={tier2Enabled}
    >
      {!tier2Enabled ? (
        <p className="text-[15px]" style={{ color: PARTNER_MUTED }}>
          {t("disabled")}
        </p>
      ) : (
        <>
          <div
            className={`${PARTNER_CARD_CLASS} p-[22px_24px]`}
            style={{ borderColor: PARTNER_BORDER }}
          >
            <h2 className="text-[17px] font-bold" style={{ color: PARTNER_INK }}>
              {t("linkLabel")}
            </h2>
            {/* Auswählbarer Text statt Kopierknopf: der Baukasten mit
                Zwischenablage steht auf `/partner/links`, und ein zweiter
                Kopierknopf mit eigener Live-Region wäre eine zweite Stelle,
                die dasselbe anders macht. */}
            <p className="mt-2 break-all text-[15px] font-semibold" style={{ color: PARTNER_INK }}>
              {recruitLink}
            </p>
            <p className="mt-2 text-[15px]" style={{ color: PARTNER_MUTED }}>
              {t("linkHint")}
            </p>
          </div>

          {rows.length === 0 ? (
            <p className="text-[15px]" style={{ color: PARTNER_MUTED }}>
              {t("empty")}
            </p>
          ) : (
            <div
              role="table"
              aria-label={t("title")}
              className={`${PARTNER_CARD_CLASS} overflow-hidden`}
              style={{ borderColor: PARTNER_BORDER }}
            >
              <div
                role="row"
                className="rgrid-header px-[18px] py-3 text-[13px] font-bold lg:px-[24px]"
                style={
                  {
                    "--rgrid-cols": COLS,
                    color: PARTNER_MUTED,
                    borderBottom: `1px solid ${PARTNER_HAIRLINE}`,
                  } as React.CSSProperties
                }
              >
                <div role="columnheader">{t("columnName")}</div>
                <div role="columnheader">{t("columnJoined")}</div>
                <div role="columnheader">{t("columnRevenue")}</div>
                <div role="columnheader">{t("columnCommission")}</div>
              </div>
              {rows.map((row) => (
                <div
                  key={row.id}
                  role="row"
                  className="rgrid-row px-[18px] py-3 text-[15px] lg:px-[24px]"
                  style={
                    {
                      "--rgrid-cols": COLS,
                      borderBottom: `1px solid ${PARTNER_HAIRLINE}`,
                      color: PARTNER_INK,
                    } as React.CSSProperties
                  }
                >
                  <div role="cell" className="font-semibold">
                    {row.name}
                  </div>
                  <div role="cell">
                    <span className="rgrid-label">{t("columnJoined")}</span>
                    {format.dateTime(new Date(row.joinedAt), {
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                    })}
                  </div>
                  <div role="cell">
                    <span className="rgrid-label">{t("columnRevenue")}</span>
                    {money(row.revenueCents)}
                  </div>
                  <div role="cell">
                    <span className="rgrid-label">{t("columnCommission")}</span>
                    {money(row.commissionCents)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </PartnerShell>
  );
}
