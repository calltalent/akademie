"use client";

import { useEffect, useRef, useState } from "react";
import { copyToClipboard } from "@/lib/clipboard";

/** Einmal-Anzeige des Webhook-Secrets — gleiches Muster wie ApiKeyCreatedDialog. */
export function WebhookSecretCreatedDialog({
  url,
  secret,
  onClose,
}: {
  url: string;
  secret: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "ok" | "failed">("idle");

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  async function handleCopy() {
    const ok = await copyToClipboard(secret);
    setCopyStatus(ok ? "ok" : "failed");
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby="webhook-secret-created-title"
      onClose={onClose}
      className="rounded-md border p-6 backdrop:bg-black/40"
      style={{ borderRadius: "var(--radius)" }}
    >
      <div className="flex max-w-md flex-col gap-3">
        <h3 id="webhook-secret-created-title" className="text-lg font-medium">
          Webhook für <span className="break-all">{url}</span> angelegt
        </h3>
        <p className="text-sm text-red-600">
          Dieses Secret wird jetzt nur einmalig angezeigt und ist danach nicht mehr abrufbar. Damit wird
          jede Zustellung per HMAC-SHA256 signiert (Header <code>X-Calltalent-Signature</code>) — bitte
          jetzt sicher speichern.
        </p>
        <code className="break-all rounded-md bg-gray-100 p-3 text-sm">{secret}</code>
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
