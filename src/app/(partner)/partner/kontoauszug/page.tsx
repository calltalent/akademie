import { getFormatter, getTranslations } from "next-intl/server";
import { checkAffiliatePartnerAccess } from "@/lib/affiliate/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  AFFILIATE_STATEMENT_COLUMNS,
  buildStatement,
  collectPages,
  statementCurrencies,
  statementKindKey,
  type AffiliateStatementRow,
} from "@/lib/affiliate/statement";
import {
  PartnerAccessNotice,
  PartnerShell,
  PARTNER_BORDER,
  PARTNER_BUTTON_BG,
  PARTNER_BUTTON_CLASS,
  PARTNER_CARD_CLASS,
  PARTNER_FOCUS_RING,
  PARTNER_HAIRLINE,
  PARTNER_INK,
  PARTNER_MUTED,
} from "@/components/affiliate/partner-shell";

/**
 * Affiliate-System, Block B7-A — `/partner/kontoauszug`
 * (PLAN_Affiliate-System.md 8.2 Zeile 4 und letzter Absatz, 5.10, 5.11, 8.5).
 *
 * ## DIE HARTE REGEL: KEINE KÄUFERDATEN
 *
 * Der Auszug zeigt Datum, Vorgang, Produkt, Kampagne, Betrag, laufenden
 * Saldo und Status — mehr nicht. Kein Name, keine E-Mail, keine Anschrift,
 * keine Bestellnummer. Sichergestellt ist das an vier Stellen, von denen
 * DREI nicht in dieser Datei liegen:
 *
 *   1. `affiliate_commissions` trägt überhaupt keine Käuferspalte (3.11).
 *   2. Das SELECT-Spaltenrecht des Partners lässt `order_id`,
 *      `stripe_invoice_id`, `stripe_charge_id`, `stripe_subscription_id`,
 *      `note`, `flag_reason` und `condition_snapshot` aus (Migration
 *      20260911130000). Eine Abfrage, die eine davon nennt, bricht mit 42501
 *      ab — sie kann nicht versehentlich durchrutschen.
 *   3. `AFFILIATE_STATEMENT_COLUMNS` und `AffiliateStatementRow`
 *      (statement.ts) sind noch einmal kürzer und tragen die Begründung.
 *   4. Und erst dann diese Seite, die aus diesen Spalten auswählt.
 *
 * Der einzige Fremdschlüssel, der zu einem Namen aufgelöst wird, ist
 * `product_id` → Produkttitel. Das ist ein Angebot des Händlers, keine
 * Person. Aufgelöst wird er über `createAdminClient()` NACH dem Gate mit
 * ausdrücklicher Spaltenliste (8.2, 11.10) — ein Partner liest `products`
 * nicht per RLS.
 *
 * ## Laufender Saldo und Währungen
 *
 * `buildStatement()` rechnet je Währung getrennt (5.11) und nach denselben
 * zwei Ausschlüssen wie `computeBalances()` — `is_test` und `cancelled`.
 * Läuft eines davon auseinander, zeigt der Auszug einen anderen Stand als
 * die Saldo-Karten auf der Übersicht, und jede Erklärung dafür ist falsch.
 *
 * ## Aufklappbare Rechnung
 *
 * Natives `<details>`/`<summary>` statt eines JS-Akkordeons: es ist
 * tastaturbedienbar, wird vom Screenreader als „erweiterbar" angesagt und
 * funktioniert auch, wenn das Skript nicht lädt. Drinnen stehen Basis, Satz
 * und Reserve — die Zahlen, aus denen der Betrag entstanden ist. Der
 * vollständige `condition_snapshot` steht dem Partner nicht zur Verfügung
 * (Spaltenrecht, Punkt 2 oben); die vier Werte aus der Zeile selbst
 * beantworten die Frage „wie kommt dieser Betrag zustande?" trotzdem.
 */

/**
 * Sieben Spalten, und die siebte ist die aufklappbare Rechnung. Sie ist eine
 * echte Zelle und kein zusätzliches Element in der Zeile: `role="row"` darf
 * ausschließlich Zellen enthalten — ein `<details>` daneben wäre für einen
 * Screenreader eine kaputte Tabelle, und genau diese Nutzer sind der Grund
 * für die Rollen.
 */
const COLS = "1fr 1.1fr 1.6fr 1fr 1fr 1fr 1.2fr";

export default async function PartnerKontoauszugPage() {
  const access = await checkAffiliatePartnerAccess();
  if (!access.ok) return <PartnerAccessNotice reason={access.reason} />;

  const supabase = await createClient();
  const t = await getTranslations("affiliate.statement");
  const tStatus = await getTranslations("affiliate.status.commission");
  const format = await getFormatter();

  const [{ data: program }, commissions] = await Promise.all([
    supabase
      .from("affiliate_programs")
      .select("id, tier2_enabled")
      .eq("tenant_id", access.tenant.id)
      .maybeSingle(),
    collectPages<AffiliateStatementRow>((rangeFrom, rangeTo) =>
      supabase
        .from("affiliate_commissions")
        .select(AFFILIATE_STATEMENT_COLUMNS)
        .eq("tenant_id", access.tenant.id)
        .eq("partner_id", access.partnerId)
        .order("id", { ascending: true })
        .range(rangeFrom, rangeTo) as unknown as PromiseLike<{
        data: AffiliateStatementRow[] | null;
        error: unknown;
      }>,
    ),
  ]);

  const productIds = [
    ...new Set(commissions.rows.map((row) => row.product_id).filter((id): id is string => id !== null)),
  ];
  const productTitles = new Map<string, string>();
  if (productIds.length > 0) {
    const admin = createAdminClient();
    const { data: products } = await admin
      .from("products")
      .select("id, title")
      .eq("tenant_id", access.tenant.id)
      .in("id", productIds);
    for (const product of products ?? []) productTitles.set(product.id, product.title);
  }

  const currencies = statementCurrencies(commissions.rows);
  const statements = currencies.map((currency) =>
    buildStatement(commissions.rows, { currency, order: "desc" }),
  );

  const money = (cents: number, currency: string): string =>
    format.number(cents / 100, {
      style: "currency",
      currency: /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : "EUR",
    });
  const day = (iso: string): string =>
    format.dateTime(new Date(`${iso.slice(0, 10)}T00:00:00.000Z`), {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  const percent = (bp: number): string =>
    format.number(bp / 10000, { style: "percent", maximumFractionDigits: 2 });

  return (
    <PartnerShell
      active="statement"
      title={t("title")}
      tenantName={access.tenant.name}
      logoUrl={access.tenant.branding?.logo_url ?? null}
      showTeam={program?.tier2_enabled === true}
    >
      {!commissions.ok && (
        <p role="alert" className="text-[15px] font-semibold" style={{ color: "#B24343" }}>
          {t("incomplete")}
        </p>
      )}

      <p className="text-[15px]" style={{ color: PARTNER_MUTED }}>
        {t("privacyNote")}
      </p>

      {statements.length === 0 ? (
        <p className="text-[15px]" style={{ color: PARTNER_MUTED }}>
          {t("empty")}
        </p>
      ) : (
        statements.map((statement) => (
          <section key={statement.currency} className="flex flex-col gap-3">
            {statements.length > 1 && (
              <h2 className="text-[17px] font-bold" style={{ color: PARTNER_INK }}>
                {statement.currency.toUpperCase()}
              </h2>
            )}
            <p className="text-[15px] font-bold" style={{ color: PARTNER_INK }}>
              {t("closingBalance", {
                amount: money(statement.closing_balance_cents, statement.currency),
              })}
            </p>

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
                <div role="columnheader">{t("columnDate")}</div>
                <div role="columnheader">{t("columnKind")}</div>
                <div role="columnheader">{t("columnProduct")}</div>
                <div role="columnheader">{t("columnAmount")}</div>
                <div role="columnheader">{t("columnBalance")}</div>
                <div role="columnheader">{t("columnStatus")}</div>
                <div role="columnheader">{t("columnDetails")}</div>
              </div>

              {statement.entries.map((entry) => {
                const row = entry.row;
                return (
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
                    <div role="cell">
                      <span className="rgrid-label">{t("columnDate")}</span>
                      {day(row.booked_at)}
                    </div>
                    <div role="cell">
                      <span className="rgrid-label">{t("columnKind")}</span>
                      {t(statementKindKey(row.kind))}
                    </div>
                    <div role="cell">
                      <span className="rgrid-label">{t("columnProduct")}</span>
                      <span className="block truncate">
                        {row.product_id === null
                          ? "—"
                          : (productTitles.get(row.product_id) ?? "—")}
                      </span>
                      {row.campaign !== null && row.campaign !== "" && (
                        <span className="block text-[13px]" style={{ color: PARTNER_MUTED }}>
                          {t("columnCampaign")}: {row.campaign}
                        </span>
                      )}
                    </div>
                    <div role="cell" className="font-semibold">
                      <span className="rgrid-label">{t("columnAmount")}</span>
                      {money(row.amount_cents, row.currency)}
                    </div>
                    <div role="cell">
                      <span className="rgrid-label">{t("columnBalance")}</span>
                      {/* Eine stornierte Zeile verändert den Saldo nicht. Das
                          steht als Wort da, nicht als leere Zelle. */}
                      {entry.counts ? money(entry.balance_cents, row.currency) : t("notCounted")}
                    </div>
                    <div role="cell">
                      <span className="rgrid-label">{t("columnStatus")}</span>
                      {/* Status immer als Text, nie nur als Farbe (8.5). */}
                      <span className="font-semibold">{tStatus(row.status)}</span>
                      {row.status === "pending" && (
                        <span className="block text-[13px]" style={{ color: PARTNER_MUTED }}>
                          {t("freeFrom", { date: day(row.hold_until) })}
                        </span>
                      )}
                    </div>

                    {/* Die Rechnung: natives <details>, siehe Kopfkommentar. */}
                    <div role="cell">
                    <details>
                      <summary
                        className={`cursor-pointer py-2 text-[13px] font-semibold ${PARTNER_FOCUS_RING}`}
                        style={{ color: PARTNER_MUTED }}
                      >
                        {t("detailsOpen")}
                      </summary>
                      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
                        <dt style={{ color: PARTNER_MUTED }}>{t("baseLabel")}</dt>
                        <dd style={{ color: PARTNER_INK }}>
                          {money(row.base_cents, row.currency)} ({t(`basis.${row.basis_kind}`)})
                        </dd>
                        <dt style={{ color: PARTNER_MUTED }}>{t("rateLabel")}</dt>
                        <dd style={{ color: PARTNER_INK }}>
                          {row.rate_kind === "percent"
                            ? percent(row.rate_bp)
                            : money(row.fixed_cents, row.currency)}
                        </dd>
                      </dl>
                    </details>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}

      <form action="/api/affiliate/csv" method="post">
        <input type="hidden" name="type" value="statement" />
        <button
          type="submit"
          className={`${PARTNER_BUTTON_CLASS} ${PARTNER_FOCUS_RING}`}
          style={{ background: PARTNER_BUTTON_BG }}
        >
          {t("exportCsv")}
        </button>
      </form>
    </PartnerShell>
  );
}
