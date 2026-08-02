"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("admin.settings.webhookSecretDialog");
  const tDialog = useTranslations("admin.settings.secretDialog");
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
          {t.rich("createdTitle", { url, urlTag: (chunks) => <span className="break-all">{chunks}</span> })}
        </h3>
        <p className="text-sm text-red-600">
          {t.rich("warning", { code: (chunks) => <code>{chunks}</code> })}
        </p>
        <code className="break-all rounded-md bg-gray-100 p-3 text-sm">{secret}</code>
        <div className="flex items-center gap-2">
          <button type="button" onClick={handleCopy} className="rounded-md border px-3 py-2 text-sm">
            {tDialog("copyButton")}
          </button>
          <span role="status" aria-live="polite" className="text-sm">
            {copyStatus === "ok" && <span className="text-green-700">{tDialog("copiedStatus")}</span>}
            {copyStatus === "failed" && (
              <span className="text-red-600">{tDialog("copyFailedStatus")}</span>
            )}
          </span>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            autoFocus
            className="rounded-md px-3 py-2 text-sm text-white"
            style={{ background: "var(--color-primary)" }}
          >
            {tDialog("closeButton")}
          </button>
        </div>
      </div>
    </dialog>
  );
}
