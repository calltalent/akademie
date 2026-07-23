"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Code,
  File as FileIcon,
  HelpCircle,
  Image as ImageIcon,
  Music,
  Plus,
  Trash2,
  Video as VideoIcon,
  AlignLeft,
  type LucideIcon,
} from "lucide-react";
import {
  BLOCK_TYPE_LABELS,
  blocksSchema,
  createEmptyBlock,
  type Block,
  type BlockType,
} from "@/lib/courses/schema";
import { saveLessonBlocks, updateLessonTitle } from "@/lib/courses/actions";
import { BlockForm, type CourseQuizOption } from "@/components/editor/block-form";

type SaveStatus = "idle" | "pending" | "saved" | "error";

/** Icon je Block-Typ für die Typ-Beschriftung oben links auf jeder Block-Karte. */
const BLOCK_TYPE_ICONS: Record<BlockType, LucideIcon> = {
  text: AlignLeft,
  image: ImageIcon,
  video: VideoIcon,
  audio: Music,
  file: FileIcon,
  quiz: HelpCircle,
  submission: ClipboardCheck,
  callout: AlertTriangle,
  embed: Code,
};

/**
 * Die vier häufigsten Block-Typen zuerst in der Block-Leiste (Design-Vorgabe,
 * AdminKursEditor.dc.html: "neun gleichwertige Buttons sind zu viel
 * Suchaufwand"), der Rest hinter „Weitere Blöcke". Nur die AUSWAHL ist hier
 * fest verdrahtet — die Beschriftungen selbst kommen weiterhin aus
 * `BLOCK_TYPE_LABELS` (schema.ts), nicht hart codiert.
 */
const PRIMARY_BLOCK_TYPES: BlockType[] = ["text", "video", "image", "quiz"];

/**
 * Block 3: Autosave mit 1s-Debounce nach jeder Änderung. Bewusst kein
 * Drag & Drop (Phase-1-Vereinfachung, siehe PHASENSTATUS.md) — Reihenfolge
 * per Auf/Ab-Pfeil. Validierung läuft doppelt: hier (UI-Feedback) und
 * serverseitig in saveLessonBlocks (zod, nicht umgehbar).
 *
 * Design-Update (AdminKursEditor.dc.html): weiße Karte mit sichtbarem Label
 * "Lektionstitel", Block-Karten mit Typ-Icon/-Label + beschrifteten
 * Icon-Buttons (aria-label + title, CLAUDE.md §3.4), Block-Leiste mit
 * "Weitere Blöcke"-Aufklapper.
 */
export function BlockEditor({
  lessonId,
  courseId,
  initialTitle,
  initialBlocks,
  courseQuizzes = [],
}: {
  lessonId: string;
  courseId: string;
  initialTitle: string;
  initialBlocks: Block[];
  /** Für den quiz-Block-Typ (Block 2/Phase 2) — Auswahl bestehender Quizze. */
  courseQuizzes?: CourseQuizOption[];
}) {
  const [title, setTitle] = useState(initialTitle);
  const [blocks, setBlocks] = useState<Block[]>(initialBlocks);
  const [status, setStatus] = useState<SaveStatus>("idle");
  // BUGFIX (23.07.2026, Block-Audit auf Josips Anfrage): "Fehler beim
  // Speichern" allein sagt nicht, WELCHER Block betroffen ist oder warum —
  // bei mehreren Blöcken in einer Lektion praktisch unauffindbar. Trägt jetzt
  // die zod-/Server-Fehlermeldung mit, angezeigt in SaveIndicator unten.
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Erste Render nicht speichern (initialBlocks == blocks)
    if (blocks === initialBlocks) return;

    // Korrektur (Josips Lint-Lauf, 12.07.2026): setStatus("pending") lief
    // vorher synchron im Effect-Body (react-hooks/set-state-in-effect —
    // erzwingt einen zusätzlichen, unnötigen Render direkt nach dem durch
    // die blocks-Änderung ausgelösten Render). Über setTimeout(…, 0) in
    // einen eigenen Callback verschoben, Verhalten für Nutzer unverändert
    // (unter 1ms Verzögerung, unterhalb der Wahrnehmungsschwelle).
    const pendingTimer = setTimeout(() => {
      setStatus("pending");
      setErrorMessage(null);
    }, 0);
    debounceRef.current = setTimeout(async () => {
      const parsed = blocksSchema.safeParse(blocks);
      if (!parsed.success) {
        setStatus("error");
        setErrorMessage(parsed.error.issues[0]?.message ?? "Ungültige Eingabe.");
        return;
      }
      const result = await saveLessonBlocks(lessonId, courseId, parsed.data);
      if (result.error) {
        setStatus("error");
        setErrorMessage(result.error);
      } else {
        setStatus("saved");
        setErrorMessage(null);
      }
    }, 1000);

    return () => {
      clearTimeout(pendingTimer);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks]);

  function updateBlock(index: number, next: Block) {
    setBlocks((prev) => prev.map((b, i) => (i === index ? next : b)));
  }

  function removeBlock(index: number) {
    setBlocks((prev) => prev.filter((_, i) => i !== index));
  }

  function moveBlock(index: number, direction: "up" | "down") {
    setBlocks((prev) => {
      const swapIdx = direction === "up" ? index - 1 : index + 1;
      if (swapIdx < 0 || swapIdx >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[swapIdx]] = [next[swapIdx], next[index]];
      return next;
    });
  }

  function addBlock(type: BlockType) {
    setBlocks((prev) => [...prev, createEmptyBlock(type)]);
  }

  return (
    <div className="rounded-2xl border bg-white p-6" style={{ borderColor: "#E7E8F2" }}>
      <div className="flex flex-wrap items-end gap-4">
        <label
          className="flex min-w-[240px] flex-1 flex-col gap-1.5 text-sm font-bold"
          style={{ color: "#3E3F66" }}
        >
          Lektionstitel
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => updateLessonTitle(lessonId, courseId, title)}
            className="w-full rounded-xl border px-4 py-3 text-lg font-bold"
            style={{ borderColor: "#D8DAEA", color: "#1A1A2E" }}
          />
        </label>
        <SaveIndicator status={status} errorMessage={errorMessage} />
      </div>

      <ul className="mt-5 flex flex-col gap-4">
        {blocks.map((block, index) => {
          const Icon = BLOCK_TYPE_ICONS[block.type];
          return (
            <li key={block.id} className="rounded-[14px] border px-4.5 py-4" style={{ borderColor: "#EEF0F7" }}>
              <div className="mb-3 flex items-center gap-2.5">
                <span
                  className="inline-flex items-center gap-1.5 text-[13px] font-extrabold"
                  style={{ color: "#5663AE", letterSpacing: "0.06em", textTransform: "uppercase" }}
                >
                  <Icon size={15} aria-hidden="true" />
                  {BLOCK_TYPE_LABELS[block.type]}
                </span>
                <div className="flex-1" />
                <BlockIconButton
                  label="Block nach oben"
                  disabled={index === 0}
                  onClick={() => moveBlock(index, "up")}
                >
                  <ChevronUp size={14} aria-hidden="true" />
                </BlockIconButton>
                <BlockIconButton
                  label="Block nach unten"
                  disabled={index === blocks.length - 1}
                  onClick={() => moveBlock(index, "down")}
                >
                  <ChevronDown size={14} aria-hidden="true" />
                </BlockIconButton>
                <BlockIconButton label="Block entfernen" danger onClick={() => removeBlock(index)}>
                  <Trash2 size={14} aria-hidden="true" />
                </BlockIconButton>
              </div>
              <BlockForm
                block={block}
                onChange={(next) => updateBlock(index, next)}
                courseId={courseId}
                courseQuizzes={courseQuizzes}
              />
            </li>
          );
        })}
      </ul>

      <AddBlockBar onAdd={addBlock} />
    </div>
  );
}

function BlockIconButton({
  label,
  onClick,
  disabled = false,
  danger = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg border bg-white disabled:opacity-30"
      style={{ borderColor: "#E7E8F2", color: danger ? "#B14A4A" : "#5663AE" }}
    >
      {children}
    </button>
  );
}

function SaveIndicator({ status, errorMessage }: { status: SaveStatus; errorMessage: string | null }) {
  if (status === "idle") {
    return <span role="status" className="sr-only" />;
  }

  const text: Record<Exclude<SaveStatus, "idle">, string> = {
    pending: "Speichert …",
    saved: "Gespeichert",
    error: "Fehler beim Speichern",
  };
  const meta: Record<Exclude<SaveStatus, "idle">, { color: string; bg: string }> = {
    pending: { color: "#66679B", bg: "#EEF0F7" },
    saved: { color: "#1F8A5B", bg: "#E3F2EA" },
    error: { color: "#B14A4A", bg: "#FBEAEA" },
  };
  const { color, bg } = meta[status];

  return (
    <span
      role="status"
      className="inline-flex flex-none flex-wrap items-center gap-1.5 rounded-[10px] px-3.5 py-2.5 text-sm font-bold"
      style={{ color, background: bg }}
    >
      {status === "saved" && <Check size={15} aria-hidden="true" />}
      {text[status]}
      {status === "error" && errorMessage && <span className="font-semibold">— {errorMessage}</span>}
    </span>
  );
}

function AddBlockBar({ onAdd }: { onAdd: (type: BlockType) => void }) {
  const secondaryTypes = (Object.keys(BLOCK_TYPE_LABELS) as BlockType[]).filter(
    (type) => !PRIMARY_BLOCK_TYPES.includes(type),
  );

  return (
    <div className="mt-5 pt-[18px]" style={{ borderTop: "1px solid #EEF0F7" }}>
      <div className="mb-2.5 text-[13px] font-bold" style={{ color: "#3E3F66" }}>
        Block hinzufügen
      </div>
      <div className="flex flex-wrap items-start gap-2.5">
        {PRIMARY_BLOCK_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => onAdd(type)}
            className="inline-flex items-center gap-1.5 rounded-[11px] border bg-white px-4 py-2.5 text-sm font-bold"
            style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
          >
            <Plus size={14} aria-hidden="true" style={{ color: "#5663AE" }} />
            {BLOCK_TYPE_LABELS[type]}
          </button>
        ))}
        <details className="relative">
          <summary
            className="flex cursor-pointer list-none items-center gap-1.5 rounded-[11px] border bg-white px-4 py-2.5 text-sm font-bold"
            style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
          >
            <ChevronDown size={14} aria-hidden="true" style={{ color: "#5663AE" }} />
            Weitere Blöcke
          </summary>
          <div
            className="absolute z-10 mt-2 flex w-max flex-col gap-1 rounded-xl border bg-white p-2"
            style={{ borderColor: "#E7E8F2" }}
          >
            {secondaryTypes.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => onAdd(type)}
                className="inline-flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-semibold"
                style={{ color: "#1A1A2E" }}
              >
                <Plus size={13} aria-hidden="true" style={{ color: "#5663AE" }} />
                {BLOCK_TYPE_LABELS[type]}
              </button>
            ))}
          </div>
        </details>
      </div>
    </div>
  );
}
