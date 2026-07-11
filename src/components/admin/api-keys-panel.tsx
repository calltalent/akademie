"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createApiKey, revokeApiKey } from "@/lib/settings/actions";
import { ApiKeyCreatedDialog } from "@/components/admin/api-key-created-dialog";

type ApiKeyRow = {
  id: string;
  name: string;
  last_used: string | null;
  active: boolean;
  created_at: string;
};

export function ApiKeysPanel({ apiKeys }: { apiKeys: ApiKeyRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; plaintext: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createApiKey(name);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCreated({ name: result.name, plaintext: result.plaintext });
      setName("");
      router.refresh();
    });
  }

  function handleRevoke(id: string) {
    startTransition(async () => {
      await revokeApiKey(id);
      router.refresh();
    });
  }

  return (
    <section className="flex flex-col gap-4 rounded-md border p-4" style={{ borderRadius: "var(--radius)" }}>
      <div>
        <h2 className="text-lg font-medium">API-Keys</h2>
        <p className="text-sm text-gray-500">
          Für externe Integrationen (z. B. Zapier, Make) — Header{" "}
          <code>Authorization: Bearer &lt;key&gt;</code> gegen <code>/api/v1/…</code>.
        </p>
      </div>

      <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm" htmlFor="api-key-name">
          Name
          <input
            id="api-key-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z. B. Zapier-Integration"
            className="rounded-md border px-3 py-2 text-base"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md px-4 py-2 text-base text-white disabled:opacity-50"
          style={{ background: "var(--color-primary)" }}
        >
          {pending ? "Wird erzeugt …" : "Neuen Key erzeugen"}
        </button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {apiKeys.map((key) => (
          <li
            key={key.id}
            className="flex items-center justify-between gap-4 rounded-md border px-4 py-3 text-base"
            style={{ borderRadius: "var(--radius)" }}
          >
            <div className="flex flex-col">
              <span>{key.name}</span>
              <span className="text-sm text-gray-500">
                {key.active ? "aktiv" : "deaktiviert"} — zuletzt genutzt:{" "}
                {key.last_used ? new Date(key.last_used).toLocaleString("de-DE") : "nie"}
              </span>
            </div>
            {key.active && (
              <button
                type="button"
                onClick={() => handleRevoke(key.id)}
                disabled={pending}
                className="shrink-0 rounded-md border px-3 py-1 text-sm disabled:opacity-50"
              >
                Deaktivieren
              </button>
            )}
          </li>
        ))}
        {apiKeys.length === 0 && <p className="text-base text-gray-500">Noch keine API-Keys angelegt.</p>}
      </ul>

      {created && (
        <ApiKeyCreatedDialog name={created.name} plaintext={created.plaintext} onClose={() => setCreated(null)} />
      )}
    </section>
  );
}
