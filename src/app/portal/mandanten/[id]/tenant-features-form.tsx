"use client";

import { useActionState, useState } from "react";
import { updateTenantFeatures } from "@/lib/platform/actions";
import type { PlatformActionState } from "@/lib/platform/actions";

const initialState: PlatformActionState = { error: null };

/**
 * "Funktionen" (25.07.2026, Josips Auftrag: "wo aktiviere ich den
 * KI-Generator, bitte im jeweiligen Mandanten hinzufügen wo ich aktivieren
 * kann"). Drei Schalter, die bislang NUR direkt in der Datenbank setzbar
 * waren — siehe Kopfkommentar von `updateTenantFeatures`
 * (lib/platform/actions.ts) für die Gate-Stellen und die Polaritäts-Warnung.
 *
 * Native Checkboxen mit `accentColor` statt des Pill-Toggles aus
 * `tenant-settings-form.tsx` — dieses Portal ist dunkel gestaltet
 * (`#0f172a`-Karten), der helle Pill-Toggle dort ist auf diesem Hintergrund
 * nicht zu erkennen. Gleiches Muster wie die Plan-/Status-Radios in
 * `mandant-edit-form.tsx` (native Eingabe + `accentColor`).
 *
 * ERWEITERT (Marketplace M3, 03.08.2026, Plan Abschnitt 6/7): vierter
 * Schalter "Marketplace freischalten" (`marketplace_enabled`, gleiche
 * "aus, außer explizit true"-Polarität wie KI-Tutor/KI-Kursgenerator) plus
 * ein Provisionssatz-Feld, das nur bei aktiviertem Marketplace sichtbar ist
 * — lokaler `useState` statt eines zweiten Formulars/Absendens, da beide
 * Felder im selben Absenden (`updateTenantFeatures`) geschrieben werden.
 * Leeres Feld = Standardsatz aus `platform_settings` gilt (Platzhaltertext
 * zeigt den aktuellen globalen Wert an, keine Vorbelegung — ein Platzhalter
 * würde beim Absenden sonst fälschlich als "explizit gewählter Wert"
 * missverstanden werden können).
 */
export function TenantFeaturesForm({
  tenantId,
  paymentsEnabled,
  tutorEnabled,
  courseGeneratorEnabled,
  marketplaceEnabled,
  marketplaceCommissionPercent,
  defaultCommissionPercent,
}: {
  tenantId: string;
  paymentsEnabled: boolean;
  tutorEnabled: boolean;
  courseGeneratorEnabled: boolean;
  marketplaceEnabled: boolean;
  marketplaceCommissionPercent: string;
  defaultCommissionPercent: string;
}) {
  const boundUpdate = updateTenantFeatures.bind(null, tenantId);
  const [state, formAction, pending] = useActionState(boundUpdate, initialState);
  const [marketplaceChecked, setMarketplaceChecked] = useState(marketplaceEnabled);

  return (
    <form
      action={formAction}
      className="flex flex-col gap-[18px] rounded-[14px] border p-7"
      style={{ borderColor: "#1e293b", background: "#0f172a" }}
    >
      <div>
        <div className="text-[17px] font-bold text-slate-50">Funktionen</div>
        <div className="mt-0.5 text-[13px]" style={{ color: "#64748B" }}>
          Kostenpflichtige/optionale Funktionen für diesen Mandanten freischalten.
        </div>
      </div>

      <div className="flex flex-col gap-3.5">
        <FeatureCheckbox
          name="paymentsEnabled"
          label="Zahlungen (Stripe)"
          desc="Kostenpflichtige Kurse/Produkte im Checkout."
          defaultChecked={paymentsEnabled}
        />
        <FeatureCheckbox
          name="tutorEnabled"
          label="KI-Tutor"
          desc="Chat-Tutor in der Lernansicht der Lektionen."
          defaultChecked={tutorEnabled}
        />
        <FeatureCheckbox
          name="courseGeneratorEnabled"
          label="KI-Kursgenerator"
          desc="PDF-Upload → automatischer Kursentwurf unter /admin/ki."
          defaultChecked={courseGeneratorEnabled}
        />
        <FeatureCheckbox
          name="marketplaceEnabled"
          label="Marketplace freischalten"
          desc="Mandant darf Kurse im zentralen Calltalent-Marketplace einreichen."
          defaultChecked={marketplaceEnabled}
          onChange={setMarketplaceChecked}
        />
        {marketplaceChecked && (
          <div className="ml-[30px] flex flex-col gap-1.5">
            <label htmlFor="marketplaceCommissionPercent" className="text-sm font-semibold text-slate-200">
              Provisionssatz (%)
            </label>
            <input
              id="marketplaceCommissionPercent"
              name="marketplaceCommissionPercent"
              type="text"
              inputMode="decimal"
              defaultValue={marketplaceCommissionPercent}
              placeholder={`Standard: ${defaultCommissionPercent} %`}
              className="w-40 rounded-lg border bg-transparent px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-300"
              style={{ borderColor: "#1e293b" }}
              aria-describedby="marketplaceCommissionPercent-hint"
            />
            <p id="marketplaceCommissionPercent-hint" className="text-[13px]" style={{ color: "#64748B" }}>
              Leer lassen, um den Standardsatz von {defaultCommissionPercent} % zu verwenden.
            </p>
          </div>
        )}
      </div>

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

function FeatureCheckbox({
  name,
  label,
  desc,
  defaultChecked,
  onChange,
}: {
  name: string;
  label: string;
  desc: string;
  defaultChecked: boolean;
  /** NEU (Marketplace M3): optionaler Callback, damit `marketplaceEnabled`
   * das Provisionssatz-Feld ein-/ausblenden kann, ohne selbst kontrolliert
   * (`checked`+`onChange`-Pflichtpaar) zu werden — die restlichen drei
   * Checkboxen bleiben unverändert unkontrolliert (`defaultChecked` allein). */
  onChange?: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 text-sm" htmlFor={`feat-${name}`}>
      <input
        id={`feat-${name}`}
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        onChange={onChange ? (e) => onChange(e.target.checked) : undefined}
        className="mt-[3px] flex-none"
        style={{ accentColor: "#5663AE" }}
      />
      <span>
        <span className="block font-semibold text-slate-50">{label}</span>
        <span className="block text-[13px]" style={{ color: "#64748B" }}>
          {desc}
        </span>
      </span>
    </label>
  );
}
