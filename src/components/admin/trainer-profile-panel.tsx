"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ChevronUp, ChevronDown, User as UserIcon } from "lucide-react";
import {
  createTrainer,
  updateTrainer,
  deleteTrainer,
  moveTrainer,
  type TrainerRow,
  type TrainerInput,
} from "@/lib/settings/actions";
import { ThumbnailUpload } from "@/components/admin/thumbnail-upload";

type SubmitResult = { ok: boolean; error?: string };

/**
 * Trainer-/Ansprechperson-Profile für den Informations-Tab der Kurse
 * (Josips Auftrag, 24.07.2026 — Informations-Tab nach Baulig-Vorbild,
 * Migration 20260724130000_course_information.sql). Wiederverwendbares
 * Profil (Bild + Name + optional Rolle/Bio), im Kurs-Editor pro Kurs als
 * "Autor" auswählbar (course-info-editor.tsx). Strukturell 1:1 nach Vorbild
 * `promo-cards-panel.tsx`: Karte mit Anlegen-Formular oben, Liste darunter
 * mit Bearbeiten/Löschen/Auf-Ab — bewusst kein Drag-and-Drop (CLAUDE.md
 * §3.4).
 *
 * Bild-Upload nutzt `ThumbnailUpload` unverändert — `onUpload` schreibt nur
 * in lokalen State statt sofort zu persistieren, weil beim Anlegen noch
 * keine `trainers`-Zeile existiert; gespeichert wird erst beim
 * Formular-Submit zusammen mit Name/Rolle/Bio.
 */
export function TrainerProfilePanel({ trainers }: { trainers: TrainerRow[] }) {
  const router = useRouter();

  async function handleCreate(input: TrainerInput): Promise<SubmitResult> {
    const result = await createTrainer(input);
    if (!result.ok) return { ok: false, error: result.error };
    router.refresh();
    return { ok: true };
  }

  function handleDelete(id: string) {
    deleteTrainer(id).then(() => router.refresh());
  }

  return (
    <section className="rounded-[14px] border bg-white px-7 py-6" style={{ borderColor: "#E7E8F2" }}>
      <div className="mb-1.5 text-[17px] font-bold">Trainer-Profil</div>
      <div className="mb-4 text-sm" style={{ color: "#66679B" }}>
        Wiederverwendbare Trainer-/Ansprechpersonen-Profile — Bild, Name, optionale Rolle und Bio. Im
        Kurs-Editor pro Kurs als Autor auswählbar (Information-Tab).
      </div>

      <TrainerForm onSubmit={handleCreate} submitLabel="Trainer hinzufügen" />

      <ul className="mt-4 flex flex-col gap-2">
        {trainers.map((trainer, index) => (
          <TrainerRowItem
            key={trainer.id}
            trainer={trainer}
            onDelete={handleDelete}
            isFirst={index === 0}
            isLast={index === trainers.length - 1}
          />
        ))}
        {trainers.length === 0 && (
          <p className="text-sm" style={{ color: "#66679B" }}>
            Noch keine Trainer-Profile angelegt.
          </p>
        )}
      </ul>
    </section>
  );
}

function TrainerRowItem({
  trainer,
  onDelete,
  isFirst,
  isLast,
}: {
  trainer: TrainerRow;
  onDelete: (id: string) => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [moving, startMoving] = useTransition();

  function handleMove(direction: "up" | "down") {
    startMoving(async () => {
      await moveTrainer(trainer.id, direction);
      router.refresh();
    });
  }

  async function handleUpdate(input: TrainerInput): Promise<SubmitResult> {
    const result = await updateTrainer(trainer.id, input);
    if (!result.ok) return { ok: false, error: result.error };
    router.refresh();
    return { ok: true };
  }

  if (editing) {
    return (
      <li className="rounded-md border px-4 py-3" style={{ borderRadius: "var(--radius)" }}>
        <TrainerForm
          initial={trainer}
          onSubmit={handleUpdate}
          submitLabel="Speichern"
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li
      className="flex flex-wrap items-center justify-between gap-4 rounded-md border px-4 py-3 text-base"
      style={{ borderRadius: "var(--radius)" }}
    >
      <div className="flex min-w-0 items-center gap-3">
        {trainer.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- Storage-URL, kein next/image-Loader konfiguriert
          <img src={trainer.imageUrl} alt="" className="h-10 w-10 flex-none rounded-full object-cover" />
        ) : (
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-gray-100 text-gray-400">
            <UserIcon size={18} aria-hidden="true" />
          </span>
        )}
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-semibold">{trainer.name}</span>
          {trainer.role && <span className="truncate text-sm text-gray-500">{trainer.role}</span>}
        </div>
      </div>
      <div className="flex flex-none gap-2">
        <button
          type="button"
          aria-label={`Position nach oben: ${trainer.name}`}
          title="Nach oben"
          onClick={() => handleMove("up")}
          disabled={moving || isFirst}
          className="rounded-md border px-2 py-1 text-sm disabled:opacity-30"
        >
          <ChevronUp size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={`Position nach unten: ${trainer.name}`}
          title="Nach unten"
          onClick={() => handleMove("down")}
          disabled={moving || isLast}
          className="rounded-md border px-2 py-1 text-sm disabled:opacity-30"
        >
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => setEditing(true)}
          disabled={moving}
          className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
        >
          Bearbeiten
        </button>
        <button
          type="button"
          onClick={() => onDelete(trainer.id)}
          disabled={moving}
          className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
        >
          Löschen
        </button>
      </div>
    </li>
  );
}

function TrainerForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: TrainerRow;
  submitLabel: string;
  onSubmit: (input: TrainerInput) => Promise<SubmitResult>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [role, setRole] = useState(initial?.role ?? "");
  const [bio, setBio] = useState(initial?.bio ?? "");
  const [imageUrl, setImageUrl] = useState<string | null>(initial?.imageUrl ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await onSubmit({
        name,
        role: role.trim() || undefined,
        bio: bio.trim() || undefined,
        imageUrl: imageUrl ?? undefined,
      });
      if (!result.ok) {
        setError(result.error ?? "Fehler.");
        return;
      }
      if (!initial) {
        // Anlegen-Formular: Felder für das nächste Profil zurücksetzen.
        setName("");
        setRole("");
        setBio("");
        setImageUrl(null);
      } else {
        onCancel?.();
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <ThumbnailUpload
          initialUrl={imageUrl}
          entityLabel="Trainerbild"
          entityTitle={name || "Trainer"}
          onUpload={async (url) => {
            setImageUrl(url);
            return { error: null };
          }}
        />
        <div className="flex flex-1 flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Name
            <input
              type="text"
              required
              maxLength={150}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Max Mustermann"
              className="rounded-md border px-3 py-2 text-base"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Rolle (optional)
            <input
              type="text"
              maxLength={150}
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="Trainer, Ansprechpartner …"
              className="rounded-md border px-3 py-2 text-base"
            />
          </label>
        </div>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        Bio (optional)
        <textarea
          maxLength={2000}
          rows={3}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
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
          className="self-start rounded-md px-4 py-2 text-base font-semibold text-white disabled:opacity-50"
          style={{ background: "var(--color-primary)" }}
        >
          {pending ? "Wird gespeichert …" : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-md border px-4 py-2 text-base disabled:opacity-50"
          >
            Abbrechen
          </button>
        )}
      </div>
    </form>
  );
}
