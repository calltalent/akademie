import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { checkAffiliateManagerAccess } from "@/lib/affiliate/access";
import {
  getAffiliatePartnerListData,
  getAffiliateProgram,
} from "@/lib/affiliate/queries";
import { AFFILIATE_PARTNER_STATUSES } from "@/lib/affiliate/types";
import { buildTenantUrl } from "@/lib/tenant/url";
import {
  AffiliateAccessNotice,
  AffiliateProgramMissing,
  AffiliateShell,
} from "../affiliate-shell";
import {
  CARD_BORDER,
  CARD_CLASS,
  FOCUS_RING,
  INK,
  MUTED,
  NAVY,
  centsToAmount,
  currencyCode,
} from "../affiliate-format";
import { PartnerList, type PartnerListRow } from "./partner-list";
import { PartnerInviteForm } from "./partner-invite-form";
import { PartnerGroups } from "./partner-groups";

/**
 * Affiliate-System, Block B6-B — `/admin/affiliate/partner`, die Arbeitsansicht
 * des Programm-Managers (PLAN_Affiliate-System.md 8.1, Zeile 2; 8.5; 8.6).
 *
 * Aufteilung wie im Plan: links die Liste mit Statusreitern und Suche, rechts
 * sticky das Einladungsformular. Darunter die Gruppenverwaltung — sie steht
 * hier und nicht auf einer eigenen Seite, weil eine Gruppe ohne Partnerliste
 * nichts bedeutet und `createAffiliateGroup()` genau diesen Pfad
 * revalidiert (`actions.ts`).
 *
 * STATUSREITER: der Wert aus `searchParams` läuft gegen die `as const`-Liste
 * `AFFILIATE_PARTNER_STATUSES` (Muster `abgaben/page.tsx:40-41`, Plan 11.12).
 * Alles andere ist „Alle" — kein Wert aus der Adresszeile erreicht je einen
 * Filterausdruck.
 *
 * SUCHE: clientseitig über Name und E-Mail (`partner-list.tsx`), weil die
 * Liste ohnehin vollständig geladen ist (`fetchAllRows()` in `queries.ts`,
 * PostgREST kappt sonst still bei 1000 Zeilen). Ein Rundlauf je Tastendruck
 * wäre für den Betreiber langsamer und für die Datenbank teurer.
 */

const PARTNER_TABS = ["all", ...AFFILIATE_PARTNER_STATUSES] as const;

export default async function AdminAffiliatePartnerPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const access = await checkAffiliateManagerAccess();
  if (!access.ok) return <AffiliateAccessNotice reason={access.reason} />;

  const t = await getTranslations("admin.affiliate");
  const format = await getFormatter();
  const { status } = await searchParams;

  const activeTab = PARTNER_TABS.find((value) => value === status) ?? "all";
  const statusFilter = activeTab === "all" ? null : activeTab;

  const [program, data] = await Promise.all([
    getAffiliateProgram(access.tenant.id),
    getAffiliatePartnerListData(access.tenant.id, { status: statusFilter }),
  ]);

  if (program === null) {
    return (
      <AffiliateShell active="partners" title={t("partners.title")}>
        <AffiliateProgramMissing />
      </AffiliateShell>
    );
  }

  const money = (cents: number, currency: string) =>
    format.number(centsToAmount(cents), {
      style: "currency",
      currency: currencyCode(currency),
    });

  const rows: PartnerListRow[] = data.rows.map((row) => ({
    id: row.partner.id,
    displayName: row.partner.display_name,
    email: row.partner.applicant_email,
    code: row.partner.code,
    groupName: row.groupName,
    status: row.partner.status,
    payoutHold: row.partner.payout_hold,
    clicksText: format.number(row.clicks30d),
    ordersText: format.number(row.orders30d),
    // Salden je Währung getrennt (5.11) — nie eine Summe über Währungen.
    availableText:
      row.balances.length === 0
        ? money(0, program.currency)
        : row.balances
            .map((balance) => money(balance.available_cents, balance.currency))
            .join("; "),
  }));

  return (
    <AffiliateShell active="partners" title={t("partners.title")}>
      {/* Statusreiter. Echte Links statt Schaltflächen: der Zustand steht in
          der Adresse, ist teilbar und überlebt den Zurück-Knopf. */}
      <nav aria-label={t("partners.tabsLabel")}>
        <ul className="flex flex-wrap gap-2 p-0" style={{ listStyle: "none" }}>
          {PARTNER_TABS.map((tab) => {
            const isActive = tab === activeTab;
            return (
              <li key={tab}>
                <Link
                  href={
                    tab === "all"
                      ? "/admin/affiliate/partner"
                      : `/admin/affiliate/partner?status=${tab}`
                  }
                  prefetch={false}
                  aria-current={isActive ? "page" : undefined}
                  className={`inline-flex min-h-[40px] items-center rounded-[11px] border px-[14px] text-[15px] no-underline ${FOCUS_RING}`}
                  style={
                    isActive
                      ? {
                          background: "#EDEEF7",
                          borderColor: NAVY,
                          color: NAVY,
                          fontWeight: 700,
                        }
                      : {
                          background: "#FFFFFF",
                          borderColor: CARD_BORDER,
                          color: MUTED,
                          fontWeight: 600,
                        }
                  }
                >
                  {tab === "all"
                    ? t("partners.tabs.all")
                    : t(`partners.tabs.${tab}`)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {!data.ok && (
        <p
          role="alert"
          className="rounded-[14px] border p-[16px_20px] text-[15px] font-semibold"
          style={{
            borderColor: "#E7C98F",
            background: "#FBF1DC",
            color: "#6B5312",
          }}
        >
          {t("partners.incompleteWarning")}
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.7fr_1fr]">
        <PartnerList rows={rows} />

        <div className="flex flex-col gap-6 xl:sticky xl:top-4 xl:self-start">
          <section
            aria-labelledby="affiliate-invite-heading"
            className={`${CARD_CLASS} p-[22px_24px]`}
            style={{ borderColor: CARD_BORDER }}
          >
            <h2
              id="affiliate-invite-heading"
              className="text-[17px] font-bold"
              style={{ color: INK }}
            >
              {t("partners.invite.heading")}
            </h2>
            <p className="mt-1 text-[15px]" style={{ color: MUTED }}>
              {t("partners.invite.description")}
            </p>
            <PartnerInviteForm
              groups={data.groups.map((group) => ({
                id: group.id,
                name: group.name,
              }))}
              /* Der Empfehlungslink des Partners entsteht rein aus seinem
                 Code (4.2) — er ist sofort gültig, sobald die Zeile
                 `active` ist, und braucht keinen zweiten Datensatz. */
              linkPrefix={buildTenantUrl(access.tenant, "/api/aff/k?c=")}
            />
          </section>

          <PartnerGroups
            groups={data.groups.map((group) => ({
              id: group.id,
              name: group.name,
            }))}
          />
        </div>
      </div>
    </AffiliateShell>
  );
}
