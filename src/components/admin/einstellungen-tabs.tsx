"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { TenantSettingsForm } from "@/components/admin/tenant-settings-form";
import { SidebarLinksPanel } from "@/components/admin/sidebar-links-panel";
import { PromoCardsPanel } from "@/components/admin/promo-cards-panel";
import { TrainerProfilePanel } from "@/components/admin/trainer-profile-panel";
import { ApiKeysPanel } from "@/components/admin/api-keys-panel";
import { WebhooksPanel } from "@/components/admin/webhooks-panel";
import { CustomerAreaGroupsPanel } from "@/components/admin/customer-area-groups-panel";
import { CustomerAreaLinksPanel } from "@/components/admin/customer-area-links-panel";
import { CustomerAreaContactsPanel } from "@/components/admin/customer-area-contacts-panel";
import { CustomerAreaAnnouncementsPanel } from "@/components/admin/customer-area-announcements-panel";
import type { PromoCardRow, TrainerRow } from "@/lib/settings/actions";
import type { CustomerAreaGroupRow, CustomerAreaItemRow, CustomerAreaTenantMember } from "@/lib/customer-area/schema";
import type { Locale } from "@/i18n/config";

/**
 * Einstellungen als horizontale Reiter (Josips Auftrag, 25.07.2026: "als
 * horizontale Reiter zum Ausklappen anordnen, Design an die anderen
 * Unterseiten und das neue Design anpassen"). Vorher eine einzige lange
 * Seite mit sieben Karten untereinander (Grunddaten, Marken-Standard,
 * Sidebar-Links, Promo-Karten, Trainer, API-Keys, Webhooks) — jetzt in drei
 * thematische Reiter gruppiert, exakt dieselbe Reiter-Optik wie die
 * Status-Tabs in admin/kurse/page.tsx und admin/abgaben/page.tsx
 * (ausgefüllt/aktiv = #5663AE, sonst weiß mit Rahmen).
 *
 * Reine Umsortierung, keine Logikänderung: jede Unterkomponente
 * (TenantSettingsForm, SidebarLinksPanel, …) ist bereits eine eigenständige
 * Client-Komponente mit eigenen Server Actions — hier nur neu angeordnet,
 * nicht verändert. API-Keys/Webhooks bewusst in einem eigenen Reiter statt
 * einer Akkordeon-Karte zwischen den anderen: beides sicherheitsrelevant,
 * ein eigener Reiter macht den Kontextwechsel klarer als ein Aufklapp-Pfeil
 * mitten in der Seite.
 *
 * "kundenarea" NEU (05.08.2026, "Meine Kunden Area", Plan
 * verwende-den-planungs-agenten-sequential-frost.md Abschnitt 3) — neuer
 * Reiter nach "inhalte", vier neue Props (`customerAreaGroups`,
 * `customerAreaItems`, `tenantMembers` — plus das bereits bestehende
 * `trainers`, wiederverwendet vom Kontakte-Panel statt eines eigenen
 * Trainer-Datenpools).
 */
type TabKey = "allgemein" | "inhalte" | "kundenarea" | "integrationen";

export function EinstellungenTabs({
  tenantName,
  supportEmail,
  selfSignupEnabled,
  certificatesEnabled,
  maintenanceEnabled,
  brandingColor,
  brandingRadius,
  brandingFont,
  isPlatformAdmin,
  sidebarLinks,
  promoCards,
  trainers,
  customerAreaGroups,
  customerAreaItems,
  tenantMembers,
  apiKeys,
  webhooks,
  enabledLocales,
  defaultLocale,
}: {
  tenantName: string;
  supportEmail: string;
  selfSignupEnabled: boolean;
  certificatesEnabled: boolean;
  maintenanceEnabled: boolean;
  brandingColor: string;
  brandingRadius: string;
  brandingFont: string;
  isPlatformAdmin: boolean;
  sidebarLinks: { id: string; label: string; url: string }[];
  promoCards: PromoCardRow[];
  trainers: TrainerRow[];
  customerAreaGroups: CustomerAreaGroupRow[];
  customerAreaItems: CustomerAreaItemRow[];
  tenantMembers: CustomerAreaTenantMember[];
  apiKeys: { id: string; name: string; last_used: string | null; active: boolean; created_at: string }[];
  webhooks: { id: string; url: string; events: string[]; active: boolean; created_at: string }[];
  /** i18n Block B5 (PLAN_Mehrsprachigkeit-i18n.md Abschnitt 4). */
  enabledLocales: Locale[];
  defaultLocale: Locale;
}) {
  const t = useTranslations("admin.settings");
  const [tab, setTab] = useState<TabKey>("allgemein");
  const TABS: { key: TabKey; label: string }[] = [
    { key: "allgemein", label: t("tabs.general") },
    { key: "inhalte", label: t("tabs.content") },
    { key: "kundenarea", label: t("tabs.customerArea") },
    { key: "integrationen", label: t("tabs.integrations") },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2.5">
        {TABS.map((tabItem) => (
          <button
            key={tabItem.key}
            type="button"
            onClick={() => setTab(tabItem.key)}
            aria-current={tab === tabItem.key ? "true" : undefined}
            className="inline-flex rounded-[10px] px-[15px] py-[9px] text-sm font-semibold"
            style={
              tab === tabItem.key
                ? { background: "#5663AE", color: "#fff" }
                : { background: "#fff", color: "#3E3F66", border: "1px solid #E7E8F2" }
            }
          >
            {tabItem.label}
          </button>
        ))}
      </div>

      {tab === "allgemein" && (
        <div className="flex max-w-[820px] flex-col gap-[22px]">
          <TenantSettingsForm
            name={tenantName}
            supportEmail={supportEmail}
            selfSignupEnabled={selfSignupEnabled}
            certificatesEnabled={certificatesEnabled}
            maintenanceEnabled={maintenanceEnabled}
            enabledLocales={enabledLocales}
            defaultLocale={defaultLocale}
          />

          <div className="rounded-[14px] border bg-white px-7 py-6" style={{ borderColor: "#E7E8F2" }}>
            <div className="mb-1.5 text-[17px] font-bold">{t("branding.heading")}</div>
            <div className="mb-4 text-sm" style={{ color: "#66679B" }}>
              {t("branding.subtitle")}
            </div>
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="h-[34px] w-[34px] flex-none rounded-[9px]"
                  style={{ background: brandingColor }}
                />
                <span className="text-sm" style={{ color: "#3E3F66" }}>
                  {brandingColor}
                </span>
              </div>
              <div className="text-sm" style={{ color: "#3E3F66" }}>
                {t("branding.radiusLabel", { radius: brandingRadius })}
              </div>
              <div className="text-sm" style={{ color: "#3E3F66" }}>
                {t("branding.fontLabel", { font: brandingFont })}
              </div>
              {isPlatformAdmin && (
                <Link href="/portal/mandanten" className="ml-auto text-sm font-semibold no-underline">
                  {t("branding.manageTenantsLink")}
                </Link>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === "inhalte" && (
        <div className="flex max-w-[820px] flex-col gap-[22px]">
          <SidebarLinksPanel links={sidebarLinks} />
          <PromoCardsPanel cards={promoCards} />
          <TrainerProfilePanel trainers={trainers} />
        </div>
      )}

      {tab === "kundenarea" && (
        <div className="flex max-w-[820px] flex-col gap-[22px]">
          <CustomerAreaGroupsPanel groups={customerAreaGroups} tenantMembers={tenantMembers} />
          <CustomerAreaLinksPanel
            items={customerAreaItems.filter((i) => i.kind === "link")}
            groups={customerAreaGroups}
            tenantMembers={tenantMembers}
          />
          <CustomerAreaContactsPanel
            items={customerAreaItems.filter((i) => i.kind === "contact")}
            trainers={trainers}
            groups={customerAreaGroups}
            tenantMembers={tenantMembers}
          />
          <CustomerAreaAnnouncementsPanel
            items={customerAreaItems.filter((i) => i.kind === "announcement")}
            groups={customerAreaGroups}
            tenantMembers={tenantMembers}
          />
        </div>
      )}

      {tab === "integrationen" && (
        <div className="flex max-w-[820px] flex-col gap-8">
          <div>
            <h2 className="text-lg font-semibold">{t("integrationsHeading")}</h2>
            <p className="text-sm text-gray-500">{t("integrationsSubtitle")}</p>
          </div>
          <ApiKeysPanel apiKeys={apiKeys} />
          <WebhooksPanel webhooks={webhooks} />
        </div>
      )}
    </div>
  );
}
