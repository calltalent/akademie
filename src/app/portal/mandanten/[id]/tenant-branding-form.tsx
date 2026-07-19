"use client";

import { useActionState, useState } from "react";
import { updateTenantBranding, type PlatformActionState } from "@/lib/platform/actions";
import { TENANT_ACCENT_SWATCHES } from "@/lib/platform/schema";

const initialState: PlatformActionState = { error: null };

/**
 * Design-Block 6 (13.07.2026, Mandanten.dc.html "Branding & Theming"): echte
 * Bearbeitung von `tenants.branding.color_primary`/`radius` mit Live-
 * Vorschau — vorher gab es dafür GAR KEINE UI (siehe updateTenantBranding()
 * in lib/platform/actions.ts). Lokaler State für Swatch/Radius VOR dem
 * Speichern (Vorschau reagiert sofort, wie im Export per Client-State),
 * „Zurücksetzen" wirft nur den lokalen State auf den zuletzt gespeicherten
 * Stand zurück (kein Server-Roundtrip nötig).
 *
 * Design-Update (19.07.2026, Claude-Design-Import MandantenDetail.dc.html):
 * dunkles Karten-Layout im neuen Muster übernommen. Die Live-Vorschau bleibt
 * bewusst die BESTEHENDE, reichhaltigere Kurskarten-Simulation (Fortschritts-
 * balken + „Fortsetzen"-Button) statt auf das einfache Radius-Rechteck des
 * frischen Exports zurückzufallen — realistischer für das, was ein Mandant
 * tatsächlich in seiner eigenen Oberfläche sieht.
 */
export function TenantBrandingForm({
  tenantId,
  initial,
  tenantName,
}: {
  tenantId: string;
  initial: { colorPrimary: string; radius: number };
  tenantName: string;
}) {
  const boundUpdate = updateTenantBranding.bind(null, tenantId);
  const [state, formAction, pending] = useActionState(boundUpdate, initialState);

  const [colorPrimary, setColorPrimary] = useState(initial.colorPrimary);
  const [radius, setRadius] = useState(initial.radius);

  const initials = tenantName.trim().slice(0, 1).toUpperCase() || "?";

  return (
    <form
      action={formAction}
      className="flex flex-col gap-5 rounded-[14px] border p-7"
      style={{ borderColor: "#1e293b", background: "#0f172a" }}
    >
      <input type="hidden" name="colorPrimary" value={colorPrimary} />
      <input type="hidden" name="radius" value={radius} />

      <div>
        <div className="text-[17px] font-bold text-slate-50">Branding &amp; Theming</div>
        <div className="mt-1 text-[13px]" style={{ color: "#64748B" }}>
          Akzentfarbe &amp; Radius der hellen Mandanten-Oberfläche (nicht dieses Portals).
        </div>
      </div>

      <div>
        <div className="mb-2.5 text-[13px] font-semibold" style={{ color: "#94A3B8" }}>
          Akzentfarbe
        </div>
        <div className="flex gap-2.5">
          {TENANT_ACCENT_SWATCHES.map((hex) => (
            <button
              key={hex}
              type="button"
              title={hex}
              onClick={() => setColorPrimary(hex)}
              className="h-10 w-10 rounded-[10px]"
              style={{
                background: hex,
                border: `3px solid ${colorPrimary === hex ? "#F8FAFC" : "transparent"}`,
              }}
            />
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[13px] font-semibold" style={{ color: "#94A3B8" }}>
            Eckenradius
          </span>
          <span className="text-[13px] font-bold text-slate-50">{radius}px</span>
        </div>
        <input
          type="range"
          min={4}
          max={24}
          value={radius}
          onChange={(e) => setRadius(Number(e.target.value))}
          className="w-full"
          style={{ accentColor: colorPrimary }}
        />
      </div>

      <div>
        <div className="mb-2.5 text-xs" style={{ color: "#64748B" }}>
          Live-Vorschau
        </div>
        <div className="overflow-hidden rounded-md border border-slate-800">
          <div className="flex items-center gap-2.5 px-4 py-3" style={{ background: colorPrimary }}>
            <span
              className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] text-[13px] font-bold text-white"
              style={{ background: "rgba(255,255,255,.25)" }}
            >
              {initials}
            </span>
            <span className="text-sm font-bold text-white">{tenantName}</span>
          </div>
          <div className="p-4">
            <div className="border p-4" style={{ borderColor: "#334155", borderRadius: `${radius}px` }}>
              <div className="mb-2 text-sm text-slate-400">Kursfortschritt</div>
              <div className="mb-3.5 h-2 overflow-hidden rounded-md bg-slate-800">
                <div className="h-full rounded-md" style={{ width: "62%", background: colorPrimary }} />
              </div>
              <div
                className="inline-flex px-4 py-2 text-[13px] font-bold text-white"
                style={{ background: colorPrimary, borderRadius: `${Math.max(6, radius - 4)}px` }}
              >
                Fortsetzen
              </div>
            </div>
          </div>
        </div>
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

      <div className="flex gap-2.5">
        <button
          type="submit"
          disabled={pending}
          className="rounded-[10px] px-[18px] py-2.5 text-sm font-bold text-white disabled:opacity-50"
          style={{ background: "var(--color-primary)" }}
        >
          {pending ? "Speichert …" : "Speichern"}
        </button>
        <button
          type="button"
          onClick={() => {
            setColorPrimary(initial.colorPrimary);
            setRadius(initial.radius);
          }}
          className="rounded-[10px] border px-[18px] py-2.5 text-sm font-semibold"
          style={{ borderColor: "#1e293b", color: "#CBD5E1" }}
        >
          Zurücksetzen
        </button>
      </div>
    </form>
  );
}
