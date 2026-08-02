"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useFormatter } from "next-intl";

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
 *
 * Optik (25.07.2026, Josips Auftrag "Einladungsoption als integriertes
 * Design darstellen"): nutzte generisches Tailwind-Grau statt der
 * Design-Tokens der übrigen Karten. Reine Optik, keine Logikänderung.
 */
export function CsvImportForm() {
  const t = useTranslations("admin.invite");
  const tCommon = useTranslations("admin.common");
  const format = useFormatter();
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
      setError(t("csvSelectFileError"));
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
        setError(data.error ?? t("csvGenericError"));
        // Auch im Fehlerfall Zeilendetails zeigen (z. B. fehlende Kopfzeile,
        // ungültige E-Mails) — sonst bleibt die Ursache für den Nutzer unsichtbar.
        setParseErrors(data.parseErrors ?? []);
        return;
      }
      setResult(data);
      router.refresh();
    } catch {
      setError(t("csvNetworkError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-[14px] border bg-white px-6 py-5" style={{ borderColor: "#E7E8F2" }}>
      <div className="text-[17px] font-bold" style={{ color: "#1A1A2E" }}>
        {t("csvHeading")}
      </div>
      <p className="text-sm" style={{ color: "#66679B" }}>
        {t.rich("csvFormatHint", { code: (chunks) => <code>{chunks}</code> })}
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input ref={fileInputRef} type="file" accept=".csv,text/csv" required className="text-base" />
        {error && (
          <div role="alert" className="flex flex-col gap-1 text-sm font-semibold" style={{ color: "#B14A4A" }}>
            <p>{error}</p>
            {parseErrors.length > 0 && (
              <ul className="list-disc pl-5">
                {parseErrors.map((pe, i) => (
                  <li key={i}>{t("csvLineError", { line: pe.line, message: pe.message })}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <button
          type="submit"
          disabled={busy}
          className="self-start rounded-[10px] px-4 py-2.5 text-base font-semibold text-white disabled:opacity-50"
          style={{ background: "#5663AE" }}
        >
          {busy ? tCommon("importing") : tCommon("startImportButton")}
        </button>
      </form>

      {result && (
        <div className="mt-2 flex flex-col gap-2 text-sm">
          <p style={{ color: "#3E3F66" }}>
            {t("csvSummary", {
              total: result.total,
              elapsed: format.number(result.elapsedMs / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
              created: result.created,
              linked: result.linked,
              errors: result.errors,
            })}
          </p>
          <p className="text-xs" style={{ color: "#A9AAC4" }}>
            {t("csvWelcomeHint")}
          </p>
          {result.parseErrors.length > 0 && (
            <details>
              <summary className="cursor-pointer font-semibold" style={{ color: "#8A6D1F" }}>
                {t("csvSkippedSummary", { count: result.parseErrors.length })}
              </summary>
              <ul className="mt-1 list-disc pl-5">
                {result.parseErrors.map((pe, i) => (
                  <li key={i}>{t("csvLineError", { line: pe.line, message: pe.message })}</li>
                ))}
              </ul>
            </details>
          )}
          {result.errors > 0 && (
            <details>
              <summary className="cursor-pointer font-semibold" style={{ color: "#B14A4A" }}>
                {t("csvErrorsSummary", { count: result.errors })}
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
