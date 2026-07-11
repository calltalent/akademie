"use client";

import { useActionState } from "react";
import { updateTenant } from "@/lib/platform/actions";
import type { PlatformActionState } from "@/lib/platform/actions";
import {
  TENANT_PLANS,
  TENANT_PLAN_LABELS,
  TENANT_STATUSES,
  TENANT_STATUS_LABELS,
} from "@/lib/platform/schema";
import type { TenantPlan, TenantStatus } from "@/lib/platform/schema";

const initialState: PlatformActionState = { error: null };

type EditableTenant = {
  id: string;
  name: string;
  plan: TenantPlan;
  status: TenantStatus;
  customDomain: string | null;
};

/**
 * Bearbeiten-Formular fuer einen bestehenden Mandanten (Betreiber-Portal,
 * Phase 4 Block 2). Muster fuer eine id-gebundene Server Action in einer
 * Client-Komponente uebernommen von
 * src/components/admin/membership-row-actions.tsx (bind der ID) und
 * src/components/admin/product-form.tsx (useActionState + Formular-Layout).
 *
 * `custom_domain` bekommt bewusst kein Freitext-Placeholder-Beispiel mit
 * echter Domain, um nicht versehentlich wie ein Default-Wert auszusehen.
 */
export function MandantEditForm({ tenant }: { tenant: EditableTenant }) {
  const boundUpdate = updateTenant.bind(null, tenant.id);
  const [state, formAction, pending] = useActionState(boundUpdate, initialState);

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4 rounded-md border border-slate-800 p-4"
    >
      <label className="flex flex-col gap-1 text-sm" htmlFor="edit-name">
        Name
        <input
          id="edit-name"
          name="name"
          type="text"
          required
          maxLength={200}
          defaultValue={tenant.name}
          className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-base text-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
        />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Paket</legend>
        {TENANT_PLANS.map((plan) => (
          <label
            key={plan}
            className="flex items-center gap-2 text-base"
            htmlFor={`edit-plan-${plan}`}
          >
            <input
              id={`edit-plan-${plan}`}
              type="radio"
              name="plan"
              value={plan}
              defaultChecked={tenant.plan === plan}
            />
            {TENANT_PLAN_LABELS[plan]}
          </label>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Status</legend>
        {TENANT_STATUSES.map((status) => (
          <label
            key={status}
            className="flex items-center gap-2 text-base"
            htmlFor={`edit-status-${status}`}
          >
            <input
              id={`edit-status-${status}`}
              type="radio"
              name="status"
              value={status}
              defaultChecked={tenant.status === status}
            />
            {TENANT_STATUS_LABELS[status]}
          </label>
        ))}
      </fieldset>

      <label className="flex flex-col gap-1 text-sm" htmlFor="edit-domain">
        Custom Domain (optional)
        <input
          id="edit-domain"
          name="customDomain"
          type="text"
          defaultValue={tenant.customDomain ?? ""}
          placeholder="akademie.beispiel.de"
          aria-describedby="edit-domain-hint"
          className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-base text-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
        />
        <span id="edit-domain-hint" className="text-xs text-slate-500">
          Nur Eintrag des Feldes — DNS/SSL-Einrichtung erfolgt separat außerhalb der App.
        </span>
      </label>

      {state.error && (
        <p role="alert" className="text-sm text-red-400">
          {state.error}
        </p>
      )}
      {state.success && !state.error && (
        <p role="status" aria-live="polite" className="text-sm text-green-400">
          Gespeichert.
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-md bg-slate-50 px-4 py-2 text-base font-medium text-slate-950 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
      >
        {pending ? "Speichert …" : "Änderungen speichern"}
      </button>
    </form>
  );
}
