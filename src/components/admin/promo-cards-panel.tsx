"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ChevronUp, ChevronDown, Image as ImageIcon, Video as VideoIcon } from "lucide-react";
import {
  createPromoCard,
  updatePromoCard,
  deletePromoCard,
  movePromoCard,
  type PromoCardRow,
  type PromoCardInput,
} from "@/lib/settings/actions";
import { ThumbnailUpload } from "@/components/admin/thumbnail-upload";
import { VideoUpload } from "@/components/editor/video-upload";

type SubmitResult = { ok: boolean; error?: string };

/**
 * Verwaltung der "Positionen" in der rechten Spalte der Kurs-/
 * Lektionsansicht (Josips Auftrag, 24.07.2026 — ersetzt die bisher fest
 * verdrahteten "Kostenloses Erstgespräch buchen"/"Nutze die Calltalent-
 * App"-Kärtchen, siehe promo-cards.tsx auf der Lernseite). Gleiches
 * Grundmuster wie `sidebar-links-panel.tsx` (Karte, Anlegen-Formular oben,
 * Liste mit Bearbeiten/Löschen/Auf-Ab darunter — bewusst kein Drag-and-Drop,
 * CLAUDE.md §3.4), das Formular selbst ist wegen der Medien-Felder (Bild-
 * ODER Video-Upload) als eigene `PromoCardForm`-Komponente ausgelagert und
 * wird sowohl für "Anlegen" (oben, ohne `initial`) als auch für "Bearbeiten"
 * (inline je Zeile, mit `initial`) wiederverwendet.
 *
 * Bild-Upload nutzt `ThumbnailUpload` unverändert — `onUpload` schreibt hier
 * nur in lokalen State statt sofort zu persistieren, weil beim Anlegen noch
 * keine `promo_cards`-Zeile existiert; gespeichert wird erst beim Formular-
 * Submit zusammen mit Titel/Beschreibung/Link. Video-Upload nutzt
 * `VideoUpload` (Bunny Stream direkt, TUS) — nie Video-Dateien in Supabase
 * Storage (CLAUDE.md §1.3).
 */
export function PromoCardsPanel({ cards }: { cards: PromoCardRow[] }) {
  const router = useRouter();

  async function handleCreate(input: PromoCardInput): Promise<SubmitResult> {
    const result = await createPromoCard(input);
    if (!result.ok) return { ok: false, error: result.error };
    router.refresh();
    return { ok: true };
  }

  function handleDelete(id: string) {
    deletePromoCard(id).then(() => router.refresh());
  }

  return (
    <section className="rounded-[14px] border bg-white px-7 py-6" style={{ borderColor: "#E7E8F2" }}>
      <div className="mb-1.5 text-[17px] font-bold">Positionen</div>
      <div className="mb-4 text-sm" style={{ color: "#66679B" }}>
        Kärtchen in der rechten Spalte der Kurs-/Lektionsansicht — Bild oder Video, Titel, Beschreibung und
        optionaler Link.
      </div>

      <PromoCardForm onSubmit={handleCreate} submitLabel="Position hinzufügen" />

      <ul className="mt-4 flex flex-col gap-2">
        {cards.map((card, index) => (
          <PromoCardRowItem
            key={card.id}
            card={card}
            onDelete={handleDelete}
            isFirst={index === 0}
            isLast={index === cards.length - 1}
          />
        ))}
        {cards.length === 0 && (
          <p className="text-sm" style={{ color: "#66679B" }}>
            Noch keine Positionen angelegt.
          </p>
        )}
      </ul>
    </section>
  );
}

function PromoCardRowItem({
  card,
  onDelete,
  isFirst,
  isLast,
}: {
  card: PromoCardRow;
  onDelete: (id: string) => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [moving, startMoving] = useTransition();

  function handleMove(direction: "up" | "down") {
    startMoving(async () => {
      await movePromoCard(card.id, direction);
      router.refresh();
    });
  }

  async function handleUpdate(input: PromoCardInput): Promise<SubmitResult> {
    const result = await updatePromoCard(card.id, input);
    if (!result.ok) return { ok: false, error: result.error };
    router.refresh();
    return { ok: true };
  }

  if (editing) {
    return (
      <li className="rounded-md border px-4 py-3" style={{ borderRadius: "var(--radius)" }}>
        <PromoCardForm initial={card} onSubmit={handleUpdate} submitLabel="Speichern" onCancel={() => setEditing(false)} />
      </li>
    );
  }

  return (
    <li
      className="flex flex-wrap items-center justify-between gap-4 rounded-md border px-4 py-3 text-base"
      style={{ borderRadius: "var(--radius)" }}
    >
      <div className="flex min-w-0 items-center gap-3">
        {card.mediaKind === "image" && card.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- Storage-URL, kein next/image-Loader konfiguriert
          <img src={card.imageUrl} alt="" className="h-10 w-16 flex-none rounded-md object-cover" />
        ) : (
          <span className="flex h-10 w-16 flex-none items-center justify-center rounded-md bg-gray-100 text-gray-400">
            {card.mediaKind === "video" ? (
              <VideoIcon size={18} aria-hidden="true" />
            ) : (
              <ImageIcon size={18} aria-hidden="true" />
            )}
          </span>
        )}
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-semibold">{card.title}</span>
          {card.description && (
            <span className="truncate text-sm text-gray-500">{card.description}</span>
          )}
          {card.linkUrl && <span className="truncate text-sm text-gray-400">{card.linkUrl}</span>}
        </div>
      </div>
      <div className="flex flex-none gap-2">
        <button
          type="button"
          aria-label={`Position nach oben: ${card.title}`}
          title="Nach oben"
          onClick={() => handleMove("up")}
          disabled={moving || isFirst}
          className="rounded-md border px-2 py-1 text-sm disabled:opacity-30"
        >
          <ChevronUp size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={`Position nach unten: ${card.title}`}
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
          onClick={() => onDelete(card.id)}
          disabled={moving}
          className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
        >
          Löschen
        </button>
      </div>
    </li>
  );
}

function PromoCardForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: PromoCardRow;
  submitLabel: string;
  onSubmit: (input: PromoCardInput) => Promise<SubmitResult>;
  onCancel?: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [mediaKind, setMediaKind] = useState<"image" | "video">(initial?.mediaKind ?? "image");
  const [imageUrl, setImageUrl] = useState<string | null>(initial?.imageUrl ?? null);
  const [bunnyVideoId, setBunnyVideoId] = useState<string | null>(initial?.bunnyVideoId ?? null);
  const [linkUrl, setLinkUrl] = useState(initial?.linkUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await onSubmit({
        title,
        description: description.trim() || undefined,
        mediaKind,
        imageUrl: imageUrl ?? undefined,
        bunnyVideoId: bunnyVideoId ?? undefined,
        linkUrl: linkUrl.trim() || undefined,
      });
      if (!result.ok) {
        setError(result.error ?? "Fehler.");
        return;
      }
      if (!initial) {
        // Anlegen-Formular: Felder für die nächste Position zurücksetzen.
        setTitle("");
        setDescription("");
        setMediaKind("image");
        setImageUrl(null);
        setBunnyVideoId(null);
        setLinkUrl("");
      } else {
        onCancel?.();
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Titel
        <input
          type="text"
          required
          maxLength={150}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Kostenloses Erstgespräch buchen"
          className="rounded-md border px-3 py-2 text-base"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Beschreibung (optional)
        <textarea
          maxLength={500}
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="rounded-md border px-3 py-2 text-base"
        />
      </label>

      <div className="flex flex-col gap-1.5 text-sm">
        Medium
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMediaKind("image")}
            aria-pressed={mediaKind === "image"}
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm"
            style={
              mediaKind === "image"
                ? { background: "var(--color-primary)", color: "#fff", borderColor: "var(--color-primary)" }
                : undefined
            }
          >
            <ImageIcon size={15} aria-hidden="true" /> Bild
          </button>
          <button
            type="button"
            onClick={() => setMediaKind("video")}
            aria-pressed={mediaKind === "video"}
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm"
            style={
              mediaKind === "video"
                ? { background: "var(--color-primary)", color: "#fff", borderColor: "var(--color-primary)" }
                : undefined
            }
          >
            <VideoIcon size={15} aria-hidden="true" /> Video
          </button>
        </div>
      </div>

      {mediaKind === "image" ? (
        <ThumbnailUpload
          initialUrl={imageUrl}
          entityLabel="Positionsbild"
          entityTitle={title || "Position"}
          onUpload={async (url) => {
            setImageUrl(url);
            return { error: null };
          }}
        />
      ) : (
        <VideoUpload currentVideoId={bunnyVideoId} onUploaded={setBunnyVideoId} />
      )}

      <label className="flex flex-col gap-1 text-sm">
        Link (optional)
        <input
          type="text"
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          placeholder="/kontakt oder https://…"
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
