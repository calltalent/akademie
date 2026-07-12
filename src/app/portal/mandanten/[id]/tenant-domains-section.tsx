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
    <div className="flex flex-col gap-3 rounded-md border border-slate-800 p-4">
      <h3 className="text-sm font-medium">Zusätzliche Domains</h3>
      <p className="text-xs text-slate-500">
        Weitere Domains, die auf denselben Mandanten zeigen sollen (z. B. eine zweite
        Marketing-Domain). Die primäre Domain oben bleibt davon unberührt.
      </p>

      {domains.length > 0 && (
        <ul className="flex flex-col gap-2">
          {domains.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-3 rounded-md border border-slate-800 bg-slate-900/50 px-3 py-2 text-sm"
            >
              <span>{d.domain}</span>
              <button
                type="button"
                onClick={() => handleRemove(d.id)}
                disabled={removing}
                className="text-red-300 underline-offset-2 hover:underline disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2 focus:ring-offset-slate-950"
              >
                Entfernen
              </button>
            </li>
          ))}
        </ul>
      )}

      <form action={formAction} className="flex items-end gap-2">
        <label className="flex flex-1 flex-col gap-1 text-sm" htmlFor="new-domain">
          Domain hinzufügen
          <input
            id="new-domain"
            name="domain"
            type="text"
            placeholder="zweite-domain.beispiel.de"
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-base text-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-slate-700 px-4 py-2 text-sm font-medium text-slate-50 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
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
