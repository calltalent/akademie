"use client";

import { useState } from "react";
import Link from "next/link";
import { TenantSettingsForm } from "@/components/admin/tenant-settings-form";
import { SidebarLinksPanel } from "@/components/admin/sidebar-links-panel";
import { PromoCardsPanel } from "@/components/admin/promo-cards-panel";
import { TrainerProfilePanel } from "@/components/admin/trainer-profile-panel";
import { ApiKeysPanel } from "@/components/admin/api-keys-panel";
import { WebhooksPanel } from "@/components/admin/webhooks-panel";
import type { PromoCardRow, TrainerRow } from "@/lib/settings/actions";
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
 */
const TABS = [
  { key: "allgemein" as const, label: "Allgemein" },
  { key: "inhalte" as const, label: "Inhalte" },
  { key: "integrationen" as const, label: "Integrationen" },
];
type TabKey = (typeof TABS)[number]["key"];

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
  apiKeys: { id: string; name: string; last_used: string | null; active: boolean; created_at: string }[];
  webhooks: { id: string; url: string; events: string[]; active: boolean; created_at: string }[];
  /** i18n Block B5 (PLAN_Mehrsprachigkeit-i18n.md Abschnitt 4). */
  enabledLocales: Locale[];
  defaultLocale: Locale;
}) {
  const [tab, setTab] = useState<TabKey>("allgemein");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-current={tab === t.key ? "true" : undefined}
            className="inline-flex rounded-[10px] px-[15px] py-[9px] text-sm font-semibold"
            style={
              tab === t.key
                ? { background: "#5663AE", color: "#fff" }
                : { background: "#fff", color: "#3E3F66", border: "1px solid #E7E8F2" }
            }
          >
            {t.label}
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
            <div className="mb-1.5 text-[17px] font-bold">Marken-Standard</div>
            <div className="mb-4 text-sm" style={{ color: "#66679B" }}>
              Aktuelle Markenwerte dieses Mandanten.
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
                Radius {brandingRadius}
              </div>
              <div className="text-sm" style={{ color: "#3E3F66" }}>
                Schrift: {brandingFont}
              </div>
              {isPlatformAdmin && (
                <Link href="/portal/mandanten" className="ml-auto text-sm font-semibold no-underline">
                  Mandanten verwalten →
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

      {tab === "integrationen" && (
        <div className="flex max-w-[820px] flex-col gap-8">
          <div>
            <h2 className="text-lg font-semibold">Integrationen</h2>
            <p className="text-sm text-gray-500">
              API-Keys und Webhooks für externe Integrationen (z. B. Zapier, Make) dieses Mandanten.
            </p>
          </div>
          <ApiKeysPanel apiKeys={apiKeys} />
          <WebhooksPanel webhooks={webhooks} />
        </div>
      )}
    </div>
  );
}
