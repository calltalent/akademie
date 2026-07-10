"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type ImportRowResult = { email: string; status: "created" | "linked" | "error"; message?: string };
type ImportResponse = {
  total: number;
  created: number;
  linked: number;
  errors: number;
  elapsedMs: number;
  results: ImportRowResult[];
  parseErrors: { line: number; message: string }[];
  error?: string;
};

/**
 * Client-Upload -> liest Datei lokal, schickt Text an /api/admin/users/import.
 * Zeigt Fortschritt/Ergebnis inkl. Dauer (Kern-DoD: 100 Nutzer < 30 s).
 */
export function CsvImportForm() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [parseErrors, setParseErrors] = useState<{ line: number; message: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setParseErrors([]);
    setResult(null);

    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError("Bitte eine CSV-Datei auswählen.");
      return;
    }

    setBusy(true);
    try {
      const csv = await file.text();
      const res = await fetch("/api/admin/users/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      const data: ImportResponse = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Import fehlgeschlagen.");
        // Auch im Fehlerfall Zeilendetails zeigen (z. B. fehlende Kopfzeile,
        // ungültige E-Mails) — sonst bleibt die Ursache für den Nutzer unsichtbar.
        setParseErrors(data.parseErrors ?? []);
        return;
      }
      setResult(data);
      router.refresh();
    } catch {
      setError("Netzwerkfehler beim Import.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="flex flex-col gap-3 rounded-md border p-4"
      style={{ borderRadius: "var(--radius)" }}
    >
      <h2 className="text-lg font-medium">CSV-Import (Bulk)</h2>
      <p className="text-sm text-gray-600">
        Format: Kopfzeile <code>email,full_name,course_slug</code> — <code>course_slug</code>{" "}
        optional. Maximal 500 Zeilen pro Import.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          required
          className="text-base"
        />
        {error && (
          <div role="alert" className="flex flex-col gap-1 text-sm text-red-600">
            <p>{error}</p>
            {parseErrors.length > 0 && (
              <ul className="list-disc pl-5">
                {parseErrors.map((pe, i) => (
                  <li key={i}>
                    Zeile {pe.line}: {pe.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <button
          type="submit"
          disabled={busy}
          className="self-start rounded-md px-4 py-2 text-base text-white disabled:opacity-50"
          style={{ background: "var(--color-primary)" }}
        >
          {busy ? "Importiere …" : "Import starten"}
        </button>
      </form>

      {result && (
        <div className="mt-2 flex flex-col gap-2 text-sm">
          <p>
            {result.total} Zeilen verarbeitet in {(result.elapsedMs / 1000).toFixed(1)} s —{" "}
            {result.created} Konten neu angelegt, {result.linked} bestehenden Nutzern zugeordnet,{" "}
            {result.errors} Fehler.
          </p>
          <p className="text-xs text-gray-500">
            Hinweis: Es wird noch keine Einladungs-Mail verschickt (folgt in Phase 2 über Resend).
            Neue Konten sind aber sofort als Mitglied aktiv.
          </p>
          {result.parseErrors.length > 0 && (
            <details>
              <summary className="cursor-pointer text-amber-700">
                {result.parseErrors.length} Zeile(n) beim Einlesen übersprungen
              </summary>
              <ul className="mt-1 list-disc pl-5">
                {result.parseErrors.map((pe, i) => (
                  <li key={i}>
                    Zeile {pe.line}: {pe.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {result.errors > 0 && (
            <details>
              <summary className="cursor-pointer text-red-700">
                {result.errors} Import-Fehler anzeigen
              </summary>
              <ul className="mt-1 list-disc pl-5">
                {result.results
                  .filter((r) => r.status === "error")
                  .map((r, i) => (
                    <li key={i}>
                      {r.email}: {r.message}
                    </li>
                  ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
