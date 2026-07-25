"use client";

import { useState } from "react";
import { MandantEditForm } from "./mandant-edit-form";
import { MandantDeleteForm } from "./mandant-delete-form";
import { TenantDomainsSection } from "./tenant-domains-section";
import { TenantBrandingForm } from "./tenant-branding-form";
import { TenantLoginContentForm } from "./tenant-login-content-form";
import { TenantFeaturesForm } from "./tenant-features-form";
import type { TenantPlan, TenantStatus } from "@/lib/platform/schema";

const AI_JOB_KIND_LABELS: Record<string, string> = {
  course_gen: "Kurs-Generierung",
  quiz_gen: "Quiz-Generierung",
  transcript: "Transkript",
  summary: "Zusammenfassung",
  embed: "Embeddings",
  translation: "Untertitel-Übersetzung",
};

function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}

const TABS = [
  { key: "uebersicht" as const, label: "Übersicht" },
  { key: "bearbeiten" as const, label: "Bearbeiten" },
  { key: "funktionen" as const, label: "Funktionen" },
  { key: "branding" as const, label: "Branding" },
  { key: "domains" as const, label: "Domains" },
];
type TabKey = (typeof TABS)[number]["key"];

/**
 * Mandanten-Detailseite als horizontale Reiter (25.07.2026, Josips Auftrag:
 * "die Untersektionen wie Bearbeiten, Branding als Reiter horizontal
 * einfügen, der erste Reiter soll die Übersicht mit der Option zum Löschen
 * sein"). Vorher sieben Karten (Bearbeiten, Funktionen, Domains, Branding,
 * Login-Inhalt, Nutzungsübersicht, Gefahrenzone) untereinander auf einer
 * langen Seite — jetzt in fünf Reiter gruppiert, gleiche Reiter-Optik wie
 * einstellungen-tabs.tsx, nur in der dunklen Portal-Palette (`#0f172a`-
 * Karten, `#1e293b`-Rahmen) statt der hellen Akademie-Palette.
 *
 * "Löschen" bewusst im Übersicht-Reiter statt einem eigenen "Gefahrenzone"-
 * Reiter (expliziter Auftrag) — Übersicht ist der Reiter, den ein
 * Platform-Admin zuerst sieht, die destruktive Aktion bleibt dadurch nicht
 * hinter einem zusätzlichen Klick in einen sonst ungesehenen Reiter
 * versteckt.
 *
 * Branding & Login-Inhalt bewusst EIN Reiter (nicht "wie Bearbeiten,
 * Branding" wörtlich 1:1 in genau diese zwei Reiter aufgeteilt) — beide
 * betreffen dieselbe Frage ("wie sieht die Mandanten-Oberfläche/-Login
 * aus"), ein eigener Reiter nur für vier Textfelder (Login-Inhalt) wäre
 * Reiter-Wildwuchs für zu wenig Inhalt.
 *
 * Reine Umsortierung, keine Logikänderung: jede Unterkomponente bleibt
 * unverändert, nur neu angeordnet.
 */
export function MandantDetailTabs({
  tenantId,
  slug,
  editable,
  features,
  domains,
  brandingInitial,
  tenantName,
  loginContentInitial,
  usage,
}: {
  tenantId: string;
  slug: string;
  editable: { id: string; name: string; plan: TenantPlan; status: TenantStatus; customDomain: string | null };
  features: { paymentsEnabled: boolean; tutorEnabled: boolean; courseGeneratorEnabled: boolean };
  domains: { id: string; domain: string }[];
  brandingInitial: { colorPrimary: string; radius: number; logoUrl: string | null };
  tenantName: string;
  loginContentInitial: { bgOpacity: number; heading: string | null; subheading: string | null; copyright: string | null };
  usage: {
    memberCount: number;
    courseCount: number;
    tutorAnswers: number;
    courseGens: number;
    costs: [string, number][];
  };
}) {
  const [tab, setTab] = useState<TabKey>("uebersicht");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-current={tab === t.key ? "true" : undefined}
            className="inline-flex rounded-[10px] px-[15px] py-[9px] text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
            style={
              tab === t.key
                ? { background: "#5663AE", color: "#fff" }
                : { background: "#0f172a", color: "#94A3B8", border: "1px solid #1e293b" }
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "uebersicht" && (
        <div className="flex flex-col gap-6">
          <section
            aria-labelledby="usage-heading"
            className="flex flex-col gap-[26px] rounded-[14px] border p-7"
            style={{ borderColor: "#1e293b", background: "#0f172a" }}
          >
            <h2 id="usage-heading" className="text-[17px] font-bold text-slate-50">
              Nutzungsübersicht
            </h2>

            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <UsageStat label="Aktive Teilnehmer" value={usage.memberCount} />
              <UsageStat label="Kurse gesamt" value={usage.courseCount} />
              <UsageStat label="Tutor-Antworten (Monat)" value={usage.tutorAnswers} />
              <UsageStat label="Kurs-Generierungen (Monat)" value={usage.courseGens} />
            </dl>

            <div>
              <div className="mb-3 text-sm font-bold" style={{ color: "#CBD5E1" }}>
                KI-Kosten letzte 90 Tage
              </div>
              <div className="overflow-hidden rounded-xl border" style={{ borderColor: "#1e293b" }}>
                <div
                  className="grid grid-cols-2 px-[18px] py-3 text-[13px] font-bold"
                  style={{ color: "#64748B", borderBottom: "1px solid #1e293b" }}
                >
                  <div>Art</div>
                  <div className="text-right">Kosten (USD)</div>
                </div>
                {usage.costs.length === 0 ? (
                  <p className="px-[18px] py-4 text-sm" style={{ color: "#64748B" }}>
                    Keine KI-Aufrufe im Zeitraum.
                  </p>
                ) : (
                  usage.costs.map(([kind, cost]) => (
                    <div
                      key={kind}
                      className="grid grid-cols-2 px-[18px] py-2.5 text-sm"
                      style={{ borderBottom: "1px solid #1e293b", color: "#CBD5E1" }}
                    >
                      <div>{AI_JOB_KIND_LABELS[kind] ?? kind}</div>
                      <div className="text-right font-bold text-slate-50">{formatUsd(cost)}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>

          <MandantDeleteForm tenantId={tenantId} slug={slug} />
        </div>
      )}

      {tab === "bearbeiten" && <MandantEditForm tenant={editable} />}

      {tab === "funktionen" && (
        <TenantFeaturesForm
          tenantId={tenantId}
          paymentsEnabled={features.paymentsEnabled}
          tutorEnabled={features.tutorEnabled}
          courseGeneratorEnabled={features.courseGeneratorEnabled}
        />
      )}

      {tab === "branding" && (
        <div className="flex flex-col gap-6">
          <TenantBrandingForm tenantId={tenantId} tenantName={tenantName} initial={brandingInitial} />
          <TenantLoginContentForm tenantId={tenantId} initial={loginContentInitial} />
        </div>
      )}

      {tab === "domains" && <TenantDomainsSection tenantId={tenantId} domains={domains} />}
    </div>
  );
}

function UsageStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col rounded-xl border p-[18px]" style={{ borderColor: "#1e293b", background: "#020617" }}>
      <dt className="text-xs font-semibold leading-tight" style={{ color: "#64748B" }}>
        {label}
      </dt>
      <dd className="mt-auto pt-2.5 text-[28px] font-extrabold text-slate-50" style={{ letterSpacing: "-0.01em" }}>
        {value}
      </dd>
    </div>
  );
}
