"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteTenant } from "@/lib/platform/actions";
import type { PlatformActionState } from "@/lib/platform/actions";

const initialState: PlatformActionState = { error: null };

/**
 * Lösch-Formular für einen Mandanten (Betreiber-Portal, Phase 5, Block 8 —
 * Josips Fund: "Es fehlt die Option zum Löschen der Mandanten").
 *
 * Bestätigung per Eingabe der Subdomain (nicht nur ein Klick/Checkbox) —
 * Standardmuster für irreversible, destruktive Aktionen, hier zusätzlich
 * gerechtfertigt durch den Cascade-Umfang (~25 Tabellen, siehe
 * actions.ts-Kommentar bei `deleteTenant`). Der Button bleibt deaktiviert,
 * bis die Eingabe exakt der Subdomain entspricht — die Server Action prüft
 * das zusätzlich noch einmal serverseitig (nie nur Client-seitige Prüfung
 * bei einer destruktiven Aktion).
 *
 * BUGFIX (12.07.2026, Josips Fund "weißer Bildschirm nach dem Löschen"),
 * WIEDER GEÄNDERT (26.07.2026, Josips Fund "Löschen dauert sehr lange"):
 * lag zwischenzeitlich an einem serverseitigen `redirect()` DIREKT in
 * `deleteTenant()` — behob den weißen Bildschirm, kostete aber 20+ Sekunden
 * (siehe ausführliche Begründung im dortigen Kopfkommentar). Jetzt navigiert
 * dieser Client wieder selbst per `router.push()`, sobald `state.success`
 * eintrifft — der frühere weiße Bildschirm ist stattdessen dort behoben
 * (`/portal/mandanten/[id]/page.tsx` wirft bei fehlendem Mandanten kein
 * `notFound()` mehr, sondern zeigt eine gewöhnliche Inline-Meldung).
 *
 * Design-Update (19.07.2026, Claude-Design-Import MandantenDetail.dc.html,
 * „Gefahrenzone"): dunkles Karten-Layout mit rotem Rahmen statt Slate
 * übernommen. BEWUSST NICHT übernommen: die Bestätigung per Mandantenname
 * aus dem Export — Bestätigung per SUBDOMAIN bleibt bestehen (eindeutiger,
 * technischer Bezeichner statt eines potenziell mehrdeutigen Anzeigenamens;
 * bereits vor diesem Redesign so entschieden, siehe Kommentar oben).
 */
export function MandantDeleteForm({ tenantId, slug }: { tenantId: string; slug: string }) {
  const boundDelete = deleteTenant.bind(null, tenantId, slug);
  const [state, formAction, pending] = useActionState(boundDelete, initialState);
  const [confirmValue, setConfirmValue] = useState("");
  const canDelete = confirmValue.trim().toLowerCase() === slug;
  const router = useRouter();

  useEffect(() => {
    if (state.success) router.push("/portal/mandanten");
  }, [state.success, router]);

  return (
    <form
      action={formAction}
      className="flex flex-col gap-[18px] rounded-[14px] border p-7"
      style={{ borderColor: "#7F1D1D", background: "rgba(127,29,29,.08)" }}
    >
      <div>
        <p className="text-[17px] font-bold" style={{ color: "#F87171" }}>
          Gefahrenzone
        </p>
        <p className="mt-2 text-sm" style={{ color: "#CBD5E1" }}>
          Löscht den Mandanten und ALLE zugehörigen Daten (Mitglieder, Kurse, Bestellungen,
          Zertifikate, Fortschritt, u. a.) dauerhaft aus der Datenbank. NICHT automatisch
          mitgelöscht: hochgeladene Dateien im Storage (Branding, Kursmaterial, Zertifikate),
          Bunny-CDN-Videos und ein eventuell laufendes Stripe-Abo — diese müssen separat geprüft
          und ggf. manuell bereinigt werden.
        </p>
      </div>

      <label className="flex flex-col gap-1.5 text-[13px] font-semibold" htmlFor="confirmSlug" style={{ color: "#94A3B8" }}>
        Zum Bestätigen Subdomain eingeben: <span className="font-mono">{slug}</span>
        <input
          id="confirmSlug"
          name="confirmSlug"
          type="text"
          required
          autoComplete="off"
          value={confirmValue}
          onChange={(e) => setConfirmValue(e.target.value)}
          placeholder={slug}
          className="max-w-xs rounded-[10px] border px-3.5 py-2.5 text-base font-normal focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2 focus:ring-offset-slate-950"
          style={{ borderColor: "#7F1D1D", background: "#020617", color: "#F8FAFC" }}
        />
      </label>

      {state.error && (
        <p role="alert" className="text-sm text-red-400">
          {state.error}
        </p>
      )}

      <div>
        <button
          type="submit"
          disabled={pending || !canDelete}
          className="rounded-[10px] px-5 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2 focus:ring-offset-slate-950"
          style={{
            background: canDelete ? "#B91C1C" : "#3F1D1D",
            color: canDelete ? "#fff" : "#7F1D1D",
            cursor: canDelete ? "pointer" : "not-allowed",
          }}
        >
          {pending ? "Wird gelöscht …" : "Mandant endgültig löschen"}
        </button>
      </div>
    </form>
  );
}
