"use client";

import { useActionState } from "react";
import { updateTenantSettings } from "@/lib/tenant/actions";
import { initialCourseActionState } from "@/lib/courses/state";

function ToggleRow({
  name,
  label,
  desc,
  defaultChecked,
}: {
  name: string;
  label: string;
  desc: string;
  defaultChecked: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5" style={{ borderTop: "1px solid #F2F3F9" }}>
      <div>
        <div className="text-[15px] font-semibold">{label}</div>
        <div className="text-[13px]" style={{ color: "#A9AAC4" }}>
          {desc}
        </div>
      </div>
      <label className="relative inline-flex h-[26px] w-11 flex-none cursor-pointer items-center">
        <input type="checkbox" name={name} defaultChecked={defaultChecked} className="peer sr-only" />
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full transition-colors"
          style={{ background: "#D8DAEA" }}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-full opacity-0 transition-opacity peer-checked:opacity-100"
          style={{ background: "#5663AE" }}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-[3px] h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-[18px]"
        />
      </label>
    </div>
  );
}

/**
 * Design-Block 6 (13.07.2026, AdminEinstellungen.dc.html): echte, gespeicherte
 * Version der "Akademie"- und "Plattform-Optionen"-Karten. Alle drei Schalter
 * sind ECHT persistiert (tenants.settings) und wirken sich tatsächlich aus
 * (Selbstregistrierung: auth/actions.ts, Zertifikate: certificates/issue.ts)
 * — bis auf "Wartungsmodus": der wird gespeichert, sperrt das Portal aber
 * noch NICHT (siehe Hinweistext unten + PHASENSTATUS.md, offener Punkt).
 */
export function TenantSettingsForm({
  name,
  supportEmail,
  selfSignupEnabled,
  certificatesEnabled,
  maintenanceEnabled,
}: {
  name: string;
  supportEmail: string;
  selfSignupEnabled: boolean;
  certificatesEnabled: boolean;
  maintenanceEnabled: boolean;
}) {
  const [state, action, pending] = useActionState(updateTenantSettings, initialCourseActionState);

  return (
    <form action={action} className="flex flex-col gap-[22px]">
      <div className="rounded-[14px] border bg-white px-7 py-[26px]" style={{ borderColor: "#E7E8F2" }}>
        <div className="mb-1 text-[17px] font-bold">Akademie</div>
        <div className="mb-5 text-sm" style={{ color: "#A9AAC4" }}>
          Grunddaten der Plattform.
        </div>
        <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2">
          <label className="flex flex-col gap-[7px] text-sm font-semibold" style={{ color: "#3E3F66" }}>
            Name
            <input
              name="name"
              type="text"
              required
              defaultValue={name}
              className="rounded-[11px] border px-[15px] py-[13px] text-base font-normal"
              style={{ borderColor: "#D8DAEA" }}
            />
          </label>
          <label className="flex flex-col gap-[7px] text-sm font-semibold" style={{ color: "#3E3F66" }}>
            Support-E-Mail
            <input
              name="supportEmail"
              type="email"
              defaultValue={supportEmail}
              className="rounded-[11px] border px-[15px] py-[13px] text-base font-normal"
              style={{ borderColor: "#D8DAEA" }}
            />
          </label>
        </div>
      </div>

      <div className="rounded-[14px] border bg-white px-7 py-6" style={{ borderColor: "#E7E8F2" }}>
        <div className="mb-1 text-[17px] font-bold">Plattform-Optionen</div>
        <ToggleRow
          name="selfSignup"
          label="Selbstregistrierung erlauben"
          desc="Teilnehmer können sich ohne Einladung anmelden."
          defaultChecked={selfSignupEnabled}
        />
        <ToggleRow
          name="certificates"
          label="Zertifikate ausstellen"
          desc="Nach Kursabschluss automatisch ein Zertifikat erzeugen."
          defaultChecked={certificatesEnabled}
        />
        <ToggleRow
          name="maintenance"
          label="Wartungsmodus"
          desc="Wird gespeichert, sperrt das Portal aktuell noch nicht (folgt in einem späteren Block)."
          defaultChecked={maintenanceEnabled}
        />
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      {state.success && !state.error && (
        <p role="status" aria-live="polite" className="text-sm" style={{ color: "#1F8A5B" }}>
          Gespeichert.
        </p>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex rounded-[11px] px-6 py-[13px] text-[15px] font-bold text-white disabled:opacity-50"
          style={{ background: "#5663AE" }}
        >
          {pending ? "Speichert …" : "Speichern"}
        </button>
      </div>
    </form>
  );
}
