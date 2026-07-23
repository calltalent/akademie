"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createSidebarLink, deleteSidebarLink, updateSidebarLink } from "@/lib/settings/actions";

type SidebarLinkRow = { id: string; label: string; url: string };

/**
 * Verwaltung der externen Links im "LINKS"-Bereich der Lernbereich-Sidebar
 * (Josips Auftrag, 23.07.2026, z. B. "Unser YouTube-Kanal", "Feedback
 * Gespräch"). Gleiches Muster wie `webhooks-panel.tsx` (Karte, Anlegen-
 * Formular oben, Liste darunter, `useTransition` + `router.refresh()`), nur
 * mit editierbaren Zeilen statt reinem Löschen — Admin ändert Name UND URL
 * zusammen in einem Inline-Formular statt zwei getrennten Feld-Aktionen.
 */
export function SidebarLinksPanel({ links }: { links: SidebarLinkRow[] }) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createSidebarLink(label, url);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setLabel("");
      setUrl("");
      router.refresh();
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteSidebarLink(id);
      router.refresh();
    });
  }

  return (
    <section className="rounded-[14px] border bg-white px-7 py-6" style={{ borderColor: "#E7E8F2" }}>
      <div className="mb-1.5 text-[17px] font-bold">Sidebar-Links</div>
      <div className="mb-4 text-sm" style={{ color: "#66679B" }}>
        Zusätzliche Links im Bereich &quot;LINKS&quot; der Lernbereich-Sidebar, z. B. euer YouTube-Kanal oder ein
        Terminbuchungslink für Feedback-Gespräche.
      </div>

      <form onSubmit={handleCreate} className="mb-4 flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm" htmlFor="sidebar-link-label">
          Name
          <input
            id="sidebar-link-label"
            type="text"
            required
            maxLength={60}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Unser YouTube-Kanal"
            className="rounded-md border px-3 py-2 text-base"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm" htmlFor="sidebar-link-url">
          URL
          <input
            id="sidebar-link-url"
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://youtube.com/@calltalent"
            className="rounded-md border px-3 py-2 text-base"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="self-start rounded-md px-4 py-2 text-base text-white disabled:opacity-50"
          style={{ background: "var(--color-primary)" }}
        >
          {pending ? "Wird angelegt …" : "Link hinzufügen"}
        </button>
      </form>
      {error && (
        <p role="alert" className="mb-3 text-sm text-red-600">
          {error}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {links.map((link) => (
          <SidebarLinkRowItem key={link.id} link={link} pending={pending} onDelete={handleDelete} />
        ))}
        {links.length === 0 && (
          <p className="text-sm" style={{ color: "#66679B" }}>
            Noch keine Sidebar-Links angelegt.
          </p>
        )}
      </ul>
    </section>
  );
}

function SidebarLinkRowItem({
  link,
  pending: parentPending,
  onDelete,
}: {
  link: SidebarLinkRow;
  pending: boolean;
  onDelete: (id: string) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(link.label);
  const [url, setUrl] = useState(link.url);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await updateSidebarLink(link.id, label, url);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  if (editing) {
    return (
      <li className="rounded-md border px-4 py-3" style={{ borderRadius: "var(--radius)" }}>
        <form onSubmit={handleSave} className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-sm" htmlFor={`edit-label-${link.id}`}>
            Name
            <input
              id={`edit-label-${link.id}`}
              type="text"
              required
              maxLength={60}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="rounded-md border px-3 py-2 text-base"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm" htmlFor={`edit-url-${link.id}`}>
            URL
            <input
              id={`edit-url-${link.id}`}
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="rounded-md border px-3 py-2 text-base"
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: "var(--color-primary)" }}
            >
              {pending ? "Wird gespeichert …" : "Speichern"}
            </button>
            <button
              type="button"
              onClick={() => {
                setLabel(link.label);
                setUrl(link.url);
                setError(null);
                setEditing(false);
              }}
              className="rounded-md border px-3 py-1.5 text-sm"
            >
              Abbrechen
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li
      className="flex items-center justify-between gap-4 rounded-md border px-4 py-3 text-base"
      style={{ borderRadius: "var(--radius)" }}
    >
      <div className="flex min-w-0 flex-col">
        <span className="font-semibold">{link.label}</span>
        <span className="break-all text-sm text-gray-500">{link.url}</span>
      </div>
      <div className="flex flex-none gap-2">
        <button
          type="button"
          onClick={() => setEditing(true)}
          disabled={parentPending}
          className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
        >
          Bearbeiten
        </button>
        <button
          type="button"
          onClick={() => onDelete(link.id)}
          disabled={parentPending}
          className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
        >
          Löschen
        </button>
      </div>
    </li>
  );
}
