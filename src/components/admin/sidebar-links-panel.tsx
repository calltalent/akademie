"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ChevronUp, ChevronDown } from "lucide-react";
import { createSidebarLink, deleteSidebarLink, moveSidebarLink, updateSidebarLink } from "@/lib/settings/actions";

type SidebarLinkRow = { id: string; label: string; url: string };

/**
 * Verwaltung der externen Links im "LINKS"-Bereich der Lernbereich-Sidebar
 * (Josips Auftrag, 23.07.2026, z. B. "Unser YouTube-Kanal", "Feedback
 * Gespräch"). Gleiches Muster wie `webhooks-panel.tsx` (Karte, Anlegen-
 * Formular oben, Liste darunter, `useTransition` + `router.refresh()`), nur
 * mit editierbaren Zeilen statt reinem Löschen — Admin ändert Name UND URL
 * zusammen in einem Inline-Formular statt zwei getrennten Feld-Aktionen.
 *
 * Reihenfolge per Auf/Ab (23.07.2026, Josips Folgeauftrag: "per Drag and
 * Drop nach oben oder unten ziehen") — bewusst kein echtes Drag-and-Drop,
 * gleiche Begründung wie bei `moveSidebarLink()` (src/lib/settings/
 * actions.ts) und `moveCourse()`: der Auftraggeber ist sehbehindert, reines
 * Maus-Ziehen wäre für ihn nicht bedienbar (CLAUDE.md §3.4). `links` kommt
 * bereits nach `position` sortiert aus `einstellungen/page.tsx`, daher
 * bestimmt einfach der Array-Index Anfang/Ende.
 *
 * Optik (25.07.2026, Josips Auftrag "Inhalte ... vom Stil her anpassen"):
 * Inputs/Zeilen/Buttons nutzten generisches Tailwind-Grau statt der
 * Design-Tokens der übrigen Karte. Reine Optik, keine Logikänderung.
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
        <label className="flex flex-col gap-1 text-sm font-semibold" style={{ color: "#3E3F66" }} htmlFor="sidebar-link-label">
          Name
          <input
            id="sidebar-link-label"
            type="text"
            required
            maxLength={60}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Unser YouTube-Kanal"
            className="rounded-[10px] border px-3.5 py-2.5 text-base font-normal"
            style={{ borderColor: "#D8DAEA" }}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold" style={{ color: "#3E3F66" }} htmlFor="sidebar-link-url">
          URL
          <input
            id="sidebar-link-url"
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://youtube.com/@calltalent"
            className="rounded-[10px] border px-3.5 py-2.5 text-base font-normal"
            style={{ borderColor: "#D8DAEA" }}
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="self-start rounded-[10px] px-4 py-2.5 text-base font-semibold text-white disabled:opacity-50"
          style={{ background: "#5663AE" }}
        >
          {pending ? "Wird angelegt …" : "Link hinzufügen"}
        </button>
      </form>
      {error && (
        <p role="alert" className="mb-3 text-sm font-semibold" style={{ color: "#B14A4A" }}>
          {error}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {links.map((link, index) => (
          <SidebarLinkRowItem
            key={link.id}
            link={link}
            pending={pending}
            onDelete={handleDelete}
            isFirst={index === 0}
            isLast={index === links.length - 1}
          />
        ))}
        {links.length === 0 && (
          <p className="text-sm" style={{ color: "#A9AAC4" }}>
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
  isFirst,
  isLast,
}: {
  link: SidebarLinkRow;
  pending: boolean;
  onDelete: (id: string) => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(link.label);
  const [url, setUrl] = useState(link.url);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleMove(direction: "up" | "down") {
    startTransition(async () => {
      await moveSidebarLink(link.id, direction);
      router.refresh();
    });
  }

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
      <li className="rounded-[10px] border px-4 py-3" style={{ borderColor: "#E7E8F2" }}>
        <form onSubmit={handleSave} className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-sm font-semibold" style={{ color: "#3E3F66" }} htmlFor={`edit-label-${link.id}`}>
            Name
            <input
              id={`edit-label-${link.id}`}
              type="text"
              required
              maxLength={60}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="rounded-[10px] border px-3.5 py-2.5 text-base"
              style={{ borderColor: "#D8DAEA" }}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold" style={{ color: "#3E3F66" }} htmlFor={`edit-url-${link.id}`}>
            URL
            <input
              id={`edit-url-${link.id}`}
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="rounded-[10px] border px-3.5 py-2.5 text-base"
              style={{ borderColor: "#D8DAEA" }}
            />
          </label>
          {error && (
            <p role="alert" className="text-sm font-semibold" style={{ color: "#B14A4A" }}>
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-[10px] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: "#5663AE" }}
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
              className="rounded-[10px] border bg-white px-3 py-1.5 text-sm font-semibold"
              style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
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
      className="flex items-center justify-between gap-4 rounded-[10px] border px-4 py-3 text-base"
      style={{ borderColor: "#E7E8F2" }}
    >
      <div className="flex min-w-0 flex-col">
        <span className="font-semibold">{link.label}</span>
        <span className="break-all text-sm" style={{ color: "#66679B" }}>
          {link.url}
        </span>
      </div>
      <div className="flex flex-none gap-2">
        <button
          type="button"
          aria-label={`Link nach oben: ${link.label}`}
          title="Nach oben"
          onClick={() => handleMove("up")}
          disabled={parentPending || pending || isFirst}
          className="rounded-[9px] border bg-white px-2 py-1 text-sm disabled:opacity-30"
          style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
        >
          <ChevronUp size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={`Link nach unten: ${link.label}`}
          title="Nach unten"
          onClick={() => handleMove("down")}
          disabled={parentPending || pending || isLast}
          className="rounded-[9px] border bg-white px-2 py-1 text-sm disabled:opacity-30"
          style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
        >
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => setEditing(true)}
          disabled={parentPending}
          className="rounded-[9px] border bg-white px-3 py-1 text-sm font-semibold disabled:opacity-50"
          style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
        >
          Bearbeiten
        </button>
        <button
          type="button"
          onClick={() => onDelete(link.id)}
          disabled={parentPending}
          className="rounded-[9px] border bg-white px-3 py-1 text-sm font-semibold disabled:opacity-50"
          style={{ borderColor: "#E9CFCF", color: "#B14A4A" }}
        >
          Löschen
        </button>
      </div>
    </li>
  );
}
