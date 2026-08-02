"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
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
 *
 * Optik (25.07.2026, Josips Auftrag "Inhalte ... vom Stil her anpassen"):
 * Inputs/Zeilen/Buttons nutzten generisches Tailwind-Grau statt der
 * Design-Tokens der übrigen Karte. Reine Optik, keine Logikänderung.
 */
export function PromoCardsPanel({ cards }: { cards: PromoCardRow[] }) {
  const t = useTranslations("admin.settings.promoCards");
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
      <div className="mb-1.5 text-[17px] font-bold">{t("heading")}</div>
      <div className="mb-4 text-sm" style={{ color: "#66679B" }}>
        {t("description")}
      </div>

      <PromoCardForm onSubmit={handleCreate} submitLabel={t("addButton")} />

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
          <p className="text-sm" style={{ color: "#A9AAC4" }}>
            {t("empty")}
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
  const t = useTranslations("admin.settings.promoCards");
  const tSettings = useTranslations("admin.settings");
  const tCommon = useTranslations("common");
  const tPosition = useTranslations("admin.courseEditor.position");
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
      <li className="rounded-[10px] border px-4 py-3" style={{ borderColor: "#E7E8F2" }}>
        <PromoCardForm initial={card} onSubmit={handleUpdate} submitLabel={tCommon("save")} onCancel={() => setEditing(false)} />
      </li>
    );
  }

  return (
    <li
      className="flex flex-wrap items-center justify-between gap-4 rounded-[10px] border px-4 py-3 text-base"
      style={{ borderColor: "#E7E8F2" }}
    >
      <div className="flex min-w-0 items-center gap-3">
        {card.mediaKind === "image" && card.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- Storage-URL, kein next/image-Loader konfiguriert
          <img src={card.imageUrl} alt="" className="h-10 w-16 flex-none rounded-[8px] object-cover" />
        ) : (
          <span
            className="flex h-10 w-16 flex-none items-center justify-center rounded-[8px]"
            style={{ background: "#EEF0F7", color: "#A9AAC4" }}
          >
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
            <span className="truncate text-sm" style={{ color: "#66679B" }}>
              {card.description}
            </span>
          )}
          {card.linkUrl && (
            <span className="truncate text-sm" style={{ color: "#A9AAC4" }}>
              {card.linkUrl}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-none gap-2">
        <button
          type="button"
          aria-label={t("moveUpAria", { title: card.title })}
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
          aria-label={t("moveDownAria", { title: card.title })}
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
          onClick={() => onDelete(card.id)}
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
  const t = useTranslations("admin.settings.promoCards");
  const tAdminCommon = useTranslations("admin.common");
  const tCommon = useTranslations("common");
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
        setError(result.error ?? t("genericError"));
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
      <label className="flex flex-col gap-1 text-sm font-semibold" style={{ color: "#3E3F66" }}>
        {t("titleLabel")}
        <input
          type="text"
          required
          maxLength={150}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("titlePlaceholder")}
          className="rounded-[10px] border px-3.5 py-2.5 text-base font-normal"
          style={{ borderColor: "#D8DAEA" }}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold" style={{ color: "#3E3F66" }}>
        {t("descriptionLabel")}
        <textarea
          maxLength={500}
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="rounded-[10px] border px-3.5 py-2.5 text-base font-normal"
          style={{ borderColor: "#D8DAEA" }}
        />
      </label>

      <div className="flex flex-col gap-1.5 text-sm font-semibold" style={{ color: "#3E3F66" }}>
        {t("mediaLabel")}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMediaKind("image")}
            aria-pressed={mediaKind === "image"}
            className="flex items-center gap-1.5 rounded-[10px] border px-3 py-1.5 text-sm font-semibold"
            style={
              mediaKind === "image"
                ? { background: "#5663AE", color: "#fff", borderColor: "#5663AE" }
                : { background: "#fff", color: "#3E3F66", borderColor: "#E7E8F2" }
            }
          >
            <ImageIcon size={15} aria-hidden="true" /> {t("imageButton")}
          </button>
          <button
            type="button"
            onClick={() => setMediaKind("video")}
            aria-pressed={mediaKind === "video"}
            className="flex items-center gap-1.5 rounded-[10px] border px-3 py-1.5 text-sm font-semibold"
            style={
              mediaKind === "video"
                ? { background: "#5663AE", color: "#fff", borderColor: "#5663AE" }
                : { background: "#fff", color: "#3E3F66", borderColor: "#E7E8F2" }
            }
          >
            <VideoIcon size={15} aria-hidden="true" /> {t("videoButton")}
          </button>
        </div>
      </div>

      {mediaKind === "image" ? (
        <ThumbnailUpload
          initialUrl={imageUrl}
          entityLabel={t("imageEntityLabel")}
          entityTitle={title || t("imageEntityFallbackTitle")}
          onUpload={async (url) => {
            setImageUrl(url);
            return { error: null };
          }}
        />
      ) : (
        <VideoUpload currentVideoId={bunnyVideoId} onUploaded={setBunnyVideoId} />
      )}

      <label className="flex flex-col gap-1 text-sm font-semibold" style={{ color: "#3E3F66" }}>
        {t("linkLabel")}
        <input
          type="text"
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          placeholder={t("linkPlaceholder")}
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
