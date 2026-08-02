"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
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
 *
 * Optik (25.07.2026, Josips Auftrag "Inhalte ... vom Stil her anpassen"):
 * Inputs/Zeilen/Buttons nutzten generisches Tailwind-Grau statt der
 * Design-Tokens der übrigen Karte. Reine Optik, keine Logikänderung.
 */
export function TrainerProfilePanel({ trainers }: { trainers: TrainerRow[] }) {
  const t = useTranslations("admin.trainers");
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
      <div className="mb-1.5 text-[17px] font-bold">{t("heading")}</div>
      <div className="mb-4 text-sm" style={{ color: "#66679B" }}>
        {t("description")}
      </div>

      <TrainerForm onSubmit={handleCreate} submitLabel={t("addButton")} />

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
          <p className="text-sm" style={{ color: "#A9AAC4" }}>
            {t("empty")}
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
  const t = useTranslations("admin.trainers");
  const tSettings = useTranslations("admin.settings");
  const tCommon = useTranslations("common");
  const tPosition = useTranslations("admin.courseEditor.position");
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
      <li className="rounded-[10px] border px-4 py-3" style={{ borderColor: "#E7E8F2" }}>
        <TrainerForm
          initial={trainer}
          onSubmit={handleUpdate}
          submitLabel={tCommon("save")}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li
      className="flex flex-wrap items-center justify-between gap-4 rounded-[10px] border px-4 py-3 text-base"
      style={{ borderColor: "#E7E8F2" }}
    >
      <div className="flex min-w-0 items-center gap-3">
        {trainer.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- Storage-URL, kein next/image-Loader konfiguriert
          <img src={trainer.imageUrl} alt="" className="h-10 w-10 flex-none rounded-full object-cover" />
        ) : (
          <span
            className="flex h-10 w-10 flex-none items-center justify-center rounded-full"
            style={{ background: "#EEF0F7", color: "#A9AAC4" }}
          >
            <UserIcon size={18} aria-hidden="true" />
          </span>
        )}
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-semibold">{trainer.name}</span>
          {trainer.role && (
            <span className="truncate text-sm" style={{ color: "#66679B" }}>
              {trainer.role}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-none gap-2">
        <button
          type="button"
          aria-label={t("moveUpAria", { name: trainer.name })}
          title={tPosition("moveUpTitle")}
          onClick={() => handleMove("up")}
          disabled={moving || isFirst}
          className="rounded-[9px] border bg-white px-2 py-1 text-sm disabled:opacity-30"
          style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
        >
          <ChevronUp size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={t("moveDownAria", { name: trainer.name })}
          title={tPosition("moveDownTitle")}
          onClick={() => handleMove("down")}
          disabled={moving || isLast}
          className="rounded-[9px] border bg-white px-2 py-1 text-sm disabled:opacity-30"
          style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
        >
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => setEditing(true)}
          disabled={moving}
          className="rounded-[9px] border bg-white px-3 py-1 text-sm font-semibold disabled:opacity-50"
          style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
        >
          {tSettings("editButton")}
        </button>
        <button
          type="button"
          onClick={() => onDelete(trainer.id)}
          disabled={moving}
          className="rounded-[9px] border bg-white px-3 py-1 text-sm font-semibold disabled:opacity-50"
          style={{ borderColor: "#E9CFCF", color: "#B14A4A" }}
        >
          {tSettings("deleteButton")}
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
  const t = useTranslations("admin.trainers");
  const tAdminCommon = useTranslations("admin.common");
  const tCommon = useTranslations("common");
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
        setError(result.error ?? t("genericError"));
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
          entityLabel={t("imageEntityLabel")}
          entityTitle={name || t("imageEntityFallbackTitle")}
          onUpload={async (url) => {
            setImageUrl(url);
            return { error: null };
          }}
        />
        <div className="flex flex-1 flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm font-semibold" style={{ color: "#3E3F66" }}>
            {t("nameLabel")}
            <input
              type="text"
              required
              maxLength={150}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("namePlaceholder")}
              className="rounded-[10px] border px-3.5 py-2.5 text-base font-normal"
              style={{ borderColor: "#D8DAEA" }}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold" style={{ color: "#3E3F66" }}>
            {t("roleLabel")}
            <input
              type="text"
              maxLength={150}
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder={t("rolePlaceholder")}
              className="rounded-[10px] border px-3.5 py-2.5 text-base font-normal"
              style={{ borderColor: "#D8DAEA" }}
            />
          </label>
        </div>
      </div>

      <label className="flex flex-col gap-1 text-sm font-semibold" style={{ color: "#3E3F66" }}>
        {t("bioLabel")}
        <textarea
          maxLength={2000}
          rows={3}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          className="rounded-[10px] border px-3.5 py-2.5 text-base font-normal"
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
          className="self-start rounded-[10px] px-4 py-2.5 text-base font-semibold text-white disabled:opacity-50"
          style={{ background: "#5663AE" }}
        >
          {pending ? tAdminCommon("saving") : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-[10px] border bg-white px-4 py-2.5 text-base font-semibold disabled:opacity-50"
            style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
          >
            {tCommon("cancel")}
          </button>
        )}
      </div>
    </form>
  );
}
