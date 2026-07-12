"use client";

import { useActionState, useState } from "react";
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
 * BUGFIX (12.07.2026, Josips Fund "weißer Bildschirm nach dem Löschen"):
 * die Weiterleitung nach erfolgreichem Löschen passiert jetzt serverseitig
 * per `redirect()` DIREKT in `deleteTenant()` (siehe dortiger Kommentar) —
 * kein client-seitiges `router.push()` mehr nötig. Der `state.success`-Fall
 * tritt praktisch nie ein (bei Erfolg leitet die Server Action um, bevor
 * ein Rückgabewert beim Client ankommt); es bleibt nur noch der
 * Fehler-Zweig zu behandeln.
 */
export function MandantDeleteForm({ tenantId, slug }: { tenantId: string; slug: string }) {
  const boundDelete = deleteTenant.bind(null, tenantId, slug);
  const [state, formAction, pending] = useActionState(boundDelete, initialState);
  const [confirmValue, setConfirmValue] = useState("");

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4 rounded-md border border-red-900 bg-red-950/20 p-4"
    >
      <div className="text-sm text-red-200">
        <p className="font-medium">Mandant unwiderruflich löschen</p>
        <p className="mt-1 text-red-300/90">
          Löscht den Mandanten und ALLE zugehörigen Daten (Mitglieder, Kurse, Bestellungen,
          Zertifikate, Fortschritt, u. a.) dauerhaft aus der Datenbank. NICHT automatisch
          mitgelöscht: hochgeladene Dateien im Storage (Branding, Kursmaterial, Zertifikate),
          Bunny-CDN-Videos und ein eventuell laufendes Stripe-Abo — diese müssen separat geprüft
          und ggf. manuell bereinigt werden.
        </p>
      </div>

      <label className="flex flex-col gap-1 text-sm" htmlFor="confirmSlug">
        Zum Bestätigen Subdomain eingeben: <span className="font-mono">{slug}</span>
        <input
          id="confirmSlug"
          name="confirmSlug"
          type="text"
          required
          autoComplete="off"
          value={confirmValue}
          onChange={(e) => setConfirmValue(e.target.value)}
          className="rounded-md border border-red-800 bg-slate-900 px-3 py-2 text-base text-slate-50 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2 focus:ring-offset-slate-950"
        />
      </label>

      {state.error && (
        <p role="alert" className="text-sm text-red-400">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || confirmValue.trim().toLowerCase() !== slug}
        className="w-fit rounded-md bg-red-700 px-4 py-2 text-base font-medium text-slate-50 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2 focus:ring-offset-slate-950"
      >
        {pending ? "Wird gelöscht …" : "Mandant endgültig löschen"}
      </button>
    </form>
  );
}
