"use client";

import { useActionState, useEffect, useRef } from "react";
import { importCourseFromFile } from "@/lib/import/actions";
import { initialImportActionState } from "@/lib/import/state";

/**
 * Migrations-Importer-Formular (Phase 4, Block 4): einfacher JSON-Upload,
 * kein Client-JS für das Datei-Lesen nötig — der Browser übernimmt das über
 * den normalen Formular-Upload (`formData.get("file")` in der Server
 * Action). Muster wie src/app/portal/mandanten/neu/page.tsx: `action` direkt
 * an `<form>` gebunden, Seiteneffekte (Datei-Feld leeren) per `useEffect`
 * auf `state`. Barrierefreiheit: `label`/`htmlFor`, sichtbarer Fokus-Ring,
 * `role="alert"`/`role="status"` für Fehler/Erfolg (CLAUDE.md §3.4).
 */
export function CourseImportForm() {
  const [state, action, pending] = useActionState(
    importCourseFromFile,
    initialImportActionState,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.success && fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [state]);

  return (
    <div
      className="flex flex-col gap-4 rounded-md border p-4"
      style={{ borderRadius: "var(--radius)" }}
    >
      <div>
        <h2 className="text-lg font-medium">Kurs aus JSON importieren</h2>
        <p className="mt-1 text-sm text-gray-600">
          Für den Umzug eigener Altdaten (Kursstruktur mit Modulen, Lektionen
          und Blöcken). Video-Blöcke können statt einer Bunny-Video-ID eine{" "}
          <code>sourceUrl</code> enthalten — das Video wird dann automatisch
          zu Bunny übernommen. Maximal 5 MB, maximal 50 Module, maximal 100
          Lektionen je Modul.
        </p>
      </div>

      <form action={action} className="flex flex-col gap-3">
        <label htmlFor="import-file" className="flex flex-col gap-1 text-sm">
          JSON-Datei
          <input
            ref={fileInputRef}
            id="import-file"
            name="file"
            type="file"
            accept=".json,application/json"
            required
            className="rounded-md border px-3 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            style={{ borderRadius: "var(--radius)" }}
          />
        </label>

        <button
          type="submit"
          disabled={pending}
          className="self-start rounded-md px-4 py-2 text-base text-white disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          style={{ background: "var(--color-primary)", borderRadius: "var(--radius)" }}
        >
          {pending ? "Importiere …" : "Import starten"}
        </button>
      </form>

      {state.error && (
        <div role="alert" className="flex flex-col gap-1 text-sm text-red-600">
          <p>{state.error}</p>
          {state.errors && state.errors.length > 0 && (
            <ul className="list-disc pl-5">
              {state.errors.map((msg, i) => (
                <li key={i}>{msg}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {state.success && (
        <div role="status" className="flex flex-col gap-1 text-sm text-green-700">
          <p>
            Import erfolgreich: {state.moduleCount} Modul(e), {state.lessonCount}{" "}
            Lektion(en), {state.videoCount} Video(s) übernommen.
          </p>
          <a
            href={`/admin/kurse/${state.courseId}`}
            className="underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          >
            Zum importierten Kurs
          </a>
        </div>
      )}
    </div>
  );
}
