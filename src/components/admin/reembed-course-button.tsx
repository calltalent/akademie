"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { reembedCourse } from "@/lib/ai/actions";

/**
 * Manueller Trigger für `reembedCourse()` (Phase 3, Block 2). Ohne diesen
 * Button wäre die Server Action aus `src/lib/ai/actions.ts` für Josip lokal
 * nicht testbar/nutzbar — es gab bisher keinen UI-Einstiegspunkt (bewusst,
 * siehe Dateikopf-Kommentar in `actions.ts`: kein Auto-Trigger bei Autosave).
 * Gleiches Muster wie `publish-toggle.tsx` (useTransition, Server Action
 * direkt aus Client-Komponente aufgerufen).
 *
 * Auffälligere Optik (25.07.2026, Josips Auftrag "etwas deutlicher
 * darstellen"): stand als reiner grauer Rahmen-Knopf neben dem blauen
 * "Fertig"-Knopf unter und ging optisch unter. Jetzt mit Akzentfarbe +
 * Sparkles-Icon (dieselbe KI-Bildsprache wie der "KI-Generator"-Link im
 * Dashboard) — bewusst NICHT vollflächig blau wie "Fertig", sonst zwei
 * gleich starke primäre Aktionen nebeneinander.
 */
export function ReembedCourseButton({ courseId }: { courseId: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setMessage(null);
          startTransition(async () => {
            const result = await reembedCourse(courseId);
            setMessage(result.message);
          });
        }}
        className="inline-flex items-center gap-2 rounded-[10px] border-2 bg-white px-4 py-3 text-[15px] font-bold disabled:opacity-50"
        style={{ borderColor: "#5663AE", color: "#5663AE" }}
      >
        <Sparkles size={16} aria-hidden="true" />
        {pending ? "Wird eingebettet …" : "Kurs für KI-Suche einbetten"}
      </button>
      {message ? (
        <span role="status" className="text-xs font-semibold" style={{ color: "#66679B" }}>
          {message}
        </span>
      ) : null}
    </div>
  );
}
