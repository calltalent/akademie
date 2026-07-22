"use client";

import { useActionState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addTenantDomain, removeTenantDomain } from "@/lib/platform/actions";
import type { PlatformActionState } from "@/lib/platform/actions";

const initialState: PlatformActionState = { error: null };

type TenantDomain = { id: string; domain: string };

/**
 * FOLGEAUFTRAG (12.07.2026, Josip: "learning soll auch bleiben"): zusätzliche
 * Domains für denselben Mandanten neben der primären `custom_domain` (siehe
 * MandantEditForm) — Liste + Lösch-Button pro Zeile (useTransition-Muster
 * wie components/admin/membership-row-actions.tsx) + ein Formular zum
 * Hinzufügen (useActionState-Muster wie MandantEditForm, wegen Validierungs-
 * Rückmeldung).
 *
 * Design-Update (19.07.2026, Claude-Design-Import MandantenDetail.dc.html):
 * dunkles Karten-Layout, eigenständige Karte (nicht mehr in derselben
 * Bearbeiten-Karte wie MandantEditForm) sowie ein Icon-Button (X) statt des
 * Text-Links „Entfernen" je Zeile — `aria-label` ergänzt, da der Button
 * jetzt kein sichtbares Label mehr trägt.
 */
export function TenantDomainsSection({
  tenantId,
  domains,
}: {
  tenantId: string;
  domains: TenantDomain[];
}) {
  const boundAdd = addTenantDomain.bind(null, tenantId);
  const [state, formAction, pending] = useActionState(boundAdd, initialState);
  const [removing, startRemoving] = useTransition();
  const router = useRouter();

  function handleRemove(domainId: string) {
    startRemoving(async () => {
      await removeTenantDomain(tenantId, domainId);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-[18px] rounded-[14px] border p-7" style={{ borderColor: "#1e293b", background: "#0f172a" }}>
      <div className="text-[17px] font-bold text-slate-50">Zusätzliche Domains</div>
      <p className="-mt-2.5 text-[13px]" style={{ color: "#64748B" }}>
        Weitere Domains, die auf denselben Mandanten zeigen sollen (z. B. eine zweite
        Marketing-Domain). Die primäre Domain oben bleibt davon unberührt.
      </p>

      {domains.length > 0 && (
        <ul className="flex flex-col">
          {domains.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-3 border-b py-2.5 text-sm"
              style={{ borderColor: "#1e293b" }}
            >
              <span style={{ color: "#CBD5E1" }}>{d.domain}</span>
              <button
                type="button"
                onClick={() => handleRemove(d.id)}
                disabled={removing}
                aria-label={`Domain ${d.domain} entfernen`}
                className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border-none disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2 focus:ring-offset-slate-950"
                style={{ background: "#1e293b" }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F87171" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 6 6 18"></path>
                  <path d="M6 6l12 12"></path>
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* BUGFIX (22.07.2026, Josips Auftrag "Mandantenbereich für Mobile
          optimieren"): `flex items-end` ohne Umbruch lief auf schmalen
          Bildschirmen (live gemessen bei 390px) 15px über den Viewport
          hinaus, weil Eingabefeld + Button nebeneinander nicht mehr passten.
          `flex-col` unter `sm`, danach wie bisher nebeneinander. */}
      <form action={formAction} className="flex flex-col gap-2.5 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1.5 text-[13px] font-semibold" htmlFor="new-domain" style={{ color: "#94A3B8" }}>
          Domain hinzufügen
          <input
            id="new-domain"
            name="domain"
            type="text"
            placeholder="weitere-domain.de"
            className="w-full rounded-[10px] border px-3.5 py-2.5 text-base font-normal focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
            style={{ borderColor: "#1e293b", background: "#020617", color: "#F8FAFC" }}
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-[10px] border px-4 py-2.5 text-sm font-semibold disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
          style={{ borderColor: "#1e293b", color: "#CBD5E1" }}
        >
          {pending ? "Speichert …" : "Hinzufügen"}
        </button>
      </form>

      {state.error && (
        <p role="alert" className="text-sm text-red-400">
          {state.error}
        </p>
      )}
    </div>
  );
}
