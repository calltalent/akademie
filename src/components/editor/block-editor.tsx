"use client";

import { useEffect, useRef, useState } from "react";
import {
  BLOCK_TYPE_LABELS,
  blocksSchema,
  createEmptyBlock,
  type Block,
  type BlockType,
} from "@/lib/courses/schema";
import { saveLessonBlocks, updateLessonTitle } from "@/lib/courses/actions";
import { BlockForm } from "@/components/editor/block-form";

type SaveStatus = "idle" | "pending" | "saved" | "error";

/**
 * Block 3: Autosave mit 1s-Debounce nach jeder Änderung. Bewusst kein
 * Drag & Drop (Phase-1-Vereinfachung, siehe PHASENSTATUS.md) — Reihenfolge
 * per Auf/Ab-Pfeil. Validierung läuft doppelt: hier (UI-Feedback) und
 * serverseitig in saveLessonBlocks (zod, nicht umgehbar).
 */
export function BlockEditor({
  lessonId,
  courseId,
  initialTitle,
  initialBlocks,
}: {
  lessonId: string;
  courseId: string;
  initialTitle: string;
  initialBlocks: Block[];
}) {
  const [title, setTitle] = useState(initialTitle);
  const [blocks, setBlocks] = useState<Block[]>(initialBlocks);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Erste Render nicht speichern (initialBlocks == blocks)
    if (blocks === initialBlocks) return;

    setStatus("pending");
    debounceRef.current = setTimeout(async () => {
      const parsed = blocksSchema.safeParse(blocks);
      if (!parsed.success) {
        setStatus("error");
        return;
      }
      const result = await saveLessonBlocks(lessonId, courseId, parsed.data);
      setStatus(result.error ? "error" : "saved");
    }, 1000);

    return () => {
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
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => updateLessonTitle(lessonId, courseId, title)}
          className="flex-1 rounded-md border px-3 py-2 text-xl font-semibold"
        />
        <SaveIndicator status={status} />
      </div>

      <ul className="flex flex-col gap-3">
        {blocks.map((block, index) => (
          <li key={block.id} className="rounded-md border p-3" style={{ borderRadius: "var(--radius)" }}>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-500">
                {BLOCK_TYPE_LABELS[block.type]}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  aria-label="Block nach oben"
                  disabled={index === 0}
                  onClick={() => moveBlock(index, "up")}
                  className="text-sm disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label="Block nach unten"
                  disabled={index === blocks.length - 1}
                  onClick={() => moveBlock(index, "down")}
                  className="text-sm disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label="Block entfernen"
                  onClick={() => removeBlock(index)}
                  className="text-sm text-red-600"
                >
                  Entfernen
                </button>
              </div>
            </div>
            <BlockForm block={block} onChange={(next) => updateBlock(index, next)} />
          </li>
        ))}
      </ul>

      <AddBlockBar onAdd={addBlock} />
    </div>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  const text: Record<SaveStatus, string> = {
    idle: "",
    pending: "Speichert …",
    saved: "Gespeichert",
    error: "Fehler beim Speichern",
  };
  const color =
    status === "error" ? "text-red-600" : status === "saved" ? "text-green-700" : "text-gray-500";
  return (
    <span role="status" className={`text-sm ${color}`}>
      {text[status]}
    </span>
  );
}

function AddBlockBar({ onAdd }: { onAdd: (type: BlockType) => void }) {
  return (
    <div className="flex flex-wrap gap-2 border-t pt-4">
      {(Object.keys(BLOCK_TYPE_LABELS) as BlockType[]).map((type) => (
        <button
          key={type}
          type="button"
          onClick={() => onAdd(type)}
          className="rounded-md border px-3 py-1 text-sm"
          style={{ borderRadius: "var(--radius)" }}
        >
          + {BLOCK_TYPE_LABELS[type]}
        </button>
      ))}
    </div>
  );
}
