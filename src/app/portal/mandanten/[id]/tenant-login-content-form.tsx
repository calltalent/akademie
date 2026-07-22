"use client";

import { useActionState, useState } from "react";
import { updateTenantLoginContent, type PlatformActionState } from "@/lib/platform/actions";

const initialState: PlatformActionState = { error: null };

const DEFAULT_HEADING = "Verkaufen ist erlernbar.";
const DEFAULT_SUBHEADING =
  "Willkommen in deiner Akademie für Vertrieb am Telefon. Setze fort, wo du aufgehört hast.";
const DEFAULT_COPYRIGHT = "Calltalent-Akademie";

/**
 * NEU (22.07.2026, Josips Auftrag: "Login-Bildschirm anpassbar machen").
 * Eigene Karte neben TenantBrandingForm (Farbe/Radius/Logo) — betrifft
 * ausschließlich das Marken-Panel links auf der Mandanten-Login-Seite
 * ((auth)/login/login-form.tsx), nicht die Akademie-Oberfläche selbst.
 *
 * Platzhalter-Texte (grau, nicht editierbare Werte) zeigen den Calltalent-
 * Standard, der greift, wenn ein Feld leer bleibt — genau wie im
 * ausgelieferten Login-Formular selbst (leeres Feld -> Standardtext).
 *
 * Transparenz wirkt NUR auf das Streifenmuster, nicht auf Logo/Text darüber
 * (siehe login-form.tsx: das Muster liegt als eigene, absolut positionierte
 * Ebene hinter dem Inhalt) — bei 0 % bleibt die einfarbige Marken-Fläche
 * (#3E3F66) stehen, Text/Logo bleiben immer voll lesbar.
 */
export function TenantLoginContentForm({
  tenantId,
  initial,
}: {
  tenantId: string;
  initial: { bgOpacity: number; heading: string | null; subheading: string | null; copyright: string | null };
}) {
  const boundUpdate = updateTenantLoginContent.bind(null, tenantId);
  const [state, formAction, pending] = useActionState(boundUpdate, initialState);

  const [bgOpacity, setBgOpacity] = useState(initial.bgOpacity);
  const [heading, setHeading] = useState(initial.heading ?? "");
  const [subheading, setSubheading] = useState(initial.subheading ?? "");
  const [copyright, setCopyright] = useState(initial.copyright ?? "");

  return (
    <form
      action={formAction}
      className="flex flex-col gap-5 rounded-[14px] border p-7"
      style={{ borderColor: "#1e293b", background: "#0f172a" }}
    >
      <input type="hidden" name="loginBgOpacity" value={bgOpacity} />

      <div>
        <div className="text-[17px] font-bold text-slate-50">Login-Bildschirm</div>
        <div className="mt-1 text-[13px]" style={{ color: "#64748B" }}>
          Marken-Panel links auf der Anmeldeseite dieses Mandanten. Leeres Feld = Calltalent-Standardtext.
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[13px] font-semibold" style={{ color: "#94A3B8" }}>
            Hintergrund-Transparenz (Streifenmuster)
          </span>
          <span className="text-[13px] font-bold text-slate-50">{bgOpacity}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={bgOpacity}
          onChange={(e) => setBgOpacity(Number(e.target.value))}
          className="w-full"
          style={{ accentColor: "var(--color-primary)" }}
        />
      </div>

      <label className="flex flex-col gap-1.5 text-[13px] font-semibold" style={{ color: "#94A3B8" }}>
        Überschrift
        <input
          name="loginHeading"
          type="text"
          maxLength={200}
          value={heading}
          onChange={(e) => setHeading(e.target.value)}
          placeholder={DEFAULT_HEADING}
          className="rounded-[10px] border px-3 py-2.5 text-sm font-normal"
          style={{ borderColor: "#1e293b", background: "#020617", color: "#F8FAFC" }}
        />
      </label>

      <label className="flex flex-col gap-1.5 text-[13px] font-semibold" style={{ color: "#94A3B8" }}>
        Beschreibung
        <textarea
          name="loginSubheading"
          rows={3}
          maxLength={500}
          value={subheading}
          onChange={(e) => setSubheading(e.target.value)}
          placeholder={DEFAULT_SUBHEADING}
          className="resize-none rounded-[10px] border px-3 py-2.5 text-sm font-normal"
          style={{ borderColor: "#1e293b", background: "#020617", color: "#F8FAFC" }}
        />
      </label>

      <label className="flex flex-col gap-1.5 text-[13px] font-semibold" style={{ color: "#94A3B8" }}>
        Copyright-Text (nach „© {new Date().getFullYear()}“)
        <input
          name="loginCopyright"
          type="text"
          maxLength={200}
          value={copyright}
          onChange={(e) => setCopyright(e.target.value)}
          placeholder={DEFAULT_COPYRIGHT}
          className="rounded-[10px] border px-3 py-2.5 text-sm font-normal"
          style={{ borderColor: "#1e293b", background: "#020617", color: "#F8FAFC" }}
        />
      </label>

      <div>
        <div className="mb-2.5 text-xs" style={{ color: "#64748B" }}>
          Live-Vorschau
        </div>
        <div className="relative overflow-hidden rounded-md" style={{ background: "#3E3F66", height: 220 }}>
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{
              opacity: bgOpacity / 100,
              background:
                "repeating-linear-gradient(135deg, rgba(86,99,174,.55) 0 14px, rgba(62,63,102,.55) 14px 28px)",
            }}
          />
          <div className="relative flex h-full flex-col justify-between p-5">
            <div className="flex items-center gap-2">
              <div
                className="flex h-7 w-7 items-center justify-center rounded-[8px] text-sm font-extrabold"
                style={{ background: "var(--color-primary)", color: "var(--color-cream)" }}
              >
                C
              </div>
              <span className="text-xs font-extrabold tracking-tight text-white">CALLTALENT</span>
            </div>
            <div>
              <div className="mb-1 text-lg font-extrabold leading-tight text-white">
                {heading || DEFAULT_HEADING}
              </div>
              <div className="text-xs" style={{ color: "#DDDEEE" }}>
                {subheading || DEFAULT_SUBHEADING}
              </div>
            </div>
            <div className="text-[11px]" style={{ color: "#B9BBDA" }}>
              © {new Date().getFullYear()} {copyright || DEFAULT_COPYRIGHT}
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
            setBgOpacity(initial.bgOpacity);
            setHeading(initial.heading ?? "");
            setSubheading(initial.subheading ?? "");
            setCopyright(initial.copyright ?? "");
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
