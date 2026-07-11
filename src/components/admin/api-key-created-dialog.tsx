"use client";

import { useEffect, useRef, useState } from "react";
import { copyToClipboard } from "@/lib/clipboard";

/**
 * Einmal-Anzeige des Klartext-API-Keys direkt nach der Erzeugung (danach
 * nicht mehr abrufbar, nur der Hash ist gespeichert). Natives `<dialog>`
 * statt einer eigenen Modal-Implementierung: `showModal()` liefert
 * Fokus-Falle und ESC-zum-Schließen ohne zusätzlichen Code
 * (Barrierefreiheit, CLAUDE.md §3.4).
 */
export function ApiKeyCreatedDialog({
  name,
  plaintext,
  onClose,
}: {
  name: string;
  plaintext: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "ok" | "failed">("idle");

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  async function handleCopy() {
    const ok = await copyToClipboard(plaintext);
    setCopyStatus(ok ? "ok" : "failed");
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby="api-key-created-title"
      onClose={onClose}
      className="rounded-md border p-6 backdrop:bg-black/40"
      style={{ borderRadius: "var(--radius)" }}
    >
      <div className="flex max-w-md flex-col gap-3">
        <h3 id="api-key-created-title" className="text-lg font-medium">
          API-Key „{name}“ erzeugt
        </h3>
        <p className="text-sm text-red-600">
          Dieser Schlüssel wird jetzt nur einmalig angezeigt und ist danach nicht mehr abrufbar. Bitte
          jetzt sicher speichern.
        </p>
        <code className="break-all rounded-md bg-gray-100 p-3 text-sm">{plaintext}</code>
        <div className="flex items-center gap-2">
          <button type="button" onClick={handleCopy} className="rounded-md border px-3 py-2 text-sm">
            Kopieren
          </button>
          <span role="status" aria-live="polite" className="text-sm">
            {copyStatus === "ok" && <span className="text-green-700">Kopiert.</span>}
            {copyStatus === "failed" && (
              <span className="text-red-600">Kopieren fehlgeschlagen — bitte oben manuell markieren.</span>
            )}
          </span>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            autoFocus
            className="rounded-md px-3 py-2 text-sm text-white"
            style={{ background: "var(--color-primary)" }}
          >
            Schließen
          </button>
        </div>
      </div>
    </dialog>
  );
}
