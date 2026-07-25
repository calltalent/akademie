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

/**
 * Optik (25.07.2026, Josips Auftrag "Inhalte und Integration vom Stil her
 * an das neue Design anpassen"): hatte als einzige der Einstellungen-Karten
 * weder `bg-white` noch die Design-Tokens der übrigen Karten (`#E7E8F2`-
 * Rahmen, `rounded-[14px]`) — nur generisches Tailwind-Grau. Reine Optik,
 * keine Logikänderung.
 */
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
    <section className="flex flex-col gap-4 rounded-[14px] border bg-white px-7 py-6" style={{ borderColor: "#E7E8F2" }}>
      <div>
        <div className="mb-1.5 text-[17px] font-bold">API-Keys</div>
        <p className="text-sm" style={{ color: "#66679B" }}>
          Für externe Integrationen (z. B. Zapier, Make) — Header{" "}
          <code>Authorization: Bearer &lt;key&gt;</code> gegen <code>/api/v1/…</code>.
        </p>
      </div>

      <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm font-semibold" style={{ color: "#3E3F66" }} htmlFor="api-key-name">
          Name
          <input
            id="api-key-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z. B. Zapier-Integration"
            className="rounded-[10px] border px-3.5 py-2.5 text-base font-normal"
            style={{ borderColor: "#D8DAEA" }}
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-[10px] px-4 py-2.5 text-base font-semibold text-white disabled:opacity-50"
          style={{ background: "#5663AE" }}
        >
          {pending ? "Wird erzeugt …" : "Neuen Key erzeugen"}
        </button>
      </form>
      {error && (
        <p role="alert" className="text-sm font-semibold" style={{ color: "#B14A4A" }}>
          {error}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {apiKeys.map((key) => (
          <li
            key={key.id}
            className="flex items-center justify-between gap-4 rounded-[10px] border px-4 py-3 text-base"
            style={{ borderColor: "#E7E8F2" }}
          >
            <div className="flex flex-col">
              <span className="font-semibold">{key.name}</span>
              <span className="text-sm" style={{ color: "#66679B" }}>
                {key.active ? "aktiv" : "deaktiviert"} — zuletzt genutzt:{" "}
                {key.last_used ? new Date(key.last_used).toLocaleString("de-DE") : "nie"}
              </span>
            </div>
            {key.active && (
              <button
                type="button"
                onClick={() => handleRevoke(key.id)}
                disabled={pending}
                className="shrink-0 rounded-[10px] border bg-white px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
                style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
              >
                Deaktivieren
              </button>
            )}
          </li>
        ))}
        {apiKeys.length === 0 && (
          <p className="text-base" style={{ color: "#A9AAC4" }}>
            Noch keine API-Keys angelegt.
          </p>
        )}
      </ul>

      {created && (
        <ApiKeyCreatedDialog name={created.name} plaintext={created.plaintext} onClose={() => setCreated(null)} />
      )}
    </section>
  );
}
