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
 *
 * Design-Update (19.07.2026, Claude-Design-Import MandantenDetail.dc.html):
 * dunkles Karten-Layout mit eigenem Abschnittstitel „Bearbeiten" (vorher ein
 * Seiten-`<h2>` außerhalb dieser Komponente, siehe [id]/page.tsx) sowie
 * horizontale statt vertikale Radio-Gruppen für Paket/Status, wie im Export.
 */
export function MandantEditForm({ tenant }: { tenant: EditableTenant }) {
  const boundUpdate = updateTenant.bind(null, tenant.id);
  const [state, formAction, pending] = useActionState(boundUpdate, initialState);

  const inputStyle = { width: "100%", borderColor: "#1e293b", background: "#020617", color: "#F8FAFC" };

  return (
    <form
      action={formAction}
      className="flex flex-col gap-[18px] rounded-[14px] border p-7"
      style={{ borderColor: "#1e293b", background: "#0f172a" }}
    >
      <div className="text-[17px] font-bold text-slate-50">Bearbeiten</div>

      <label className="flex flex-col gap-1.5 text-[13px] font-semibold" htmlFor="edit-name" style={{ color: "#94A3B8" }}>
        Name
        <input
          id="edit-name"
          name="name"
          type="text"
          required
          maxLength={200}
          defaultValue={tenant.name}
          className="rounded-[10px] border px-3.5 py-2.5 text-base font-normal focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
          style={inputStyle}
        />
      </label>

      <fieldset className="flex flex-col gap-2.5">
        <legend className="mb-1 text-[13px] font-semibold" style={{ color: "#94A3B8" }}>
          Paket
        </legend>
        <div className="flex flex-wrap gap-[18px]">
          {TENANT_PLANS.map((plan) => (
            <label key={plan} className="flex items-center gap-2.5 text-sm" htmlFor={`edit-plan-${plan}`}>
              <input
                id={`edit-plan-${plan}`}
                type="radio"
                name="plan"
                value={plan}
                defaultChecked={tenant.plan === plan}
                style={{ accentColor: "#5663AE" }}
              />
              {TENANT_PLAN_LABELS[plan]}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2.5">
        <legend className="mb-1 text-[13px] font-semibold" style={{ color: "#94A3B8" }}>
          Status
        </legend>
        <div className="flex flex-wrap gap-[18px]">
          {TENANT_STATUSES.map((status) => (
            <label key={status} className="flex items-center gap-2.5 text-sm" htmlFor={`edit-status-${status}`}>
              <input
                id={`edit-status-${status}`}
                type="radio"
                name="status"
                value={status}
                defaultChecked={tenant.status === status}
                style={{ accentColor: "#5663AE" }}
              />
              {TENANT_STATUS_LABELS[status]}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex flex-col gap-1.5 text-[13px] font-semibold" htmlFor="edit-domain" style={{ color: "#94A3B8" }}>
        Custom Domain (optional)
        <input
          id="edit-domain"
          name="customDomain"
          type="text"
          defaultValue={tenant.customDomain ?? ""}
          placeholder="lernen.kunde.de"
          aria-describedby="edit-domain-hint"
          className="rounded-[10px] border px-3.5 py-2.5 text-base font-normal focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
          style={inputStyle}
        />
        <span id="edit-domain-hint" className="text-[13px] font-normal" style={{ color: "#64748B" }}>
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
        className="w-fit rounded-[10px] px-[18px] py-2.5 text-sm font-bold text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
        style={{ background: "var(--color-primary)" }}
      >
        {pending ? "Speichert …" : "Änderungen speichern"}
      </button>
    </form>
  );
}
