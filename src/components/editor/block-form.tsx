"use client";

import type { Block } from "@/lib/courses/schema";
import { VideoUpload } from "@/components/editor/video-upload";

/**
 * Ein Formular je Block-Typ. Bewusst einfach gehalten (Textarea/Input statt
 * Rich-Text-Editor) — Rich-Text-WYSIWYG ist eine spätere Verfeinerung,
 * kein Kern-DoD-Kriterium für Phase 1.
 */
export function BlockForm({
  block,
  onChange,
}: {
  block: Block;
  onChange: (next: Block) => void;
}) {
  switch (block.type) {
    case "text":
      return (
        <textarea
          value={block.html}
          onChange={(e) => onChange({ ...block, html: e.target.value })}
          rows={5}
          placeholder="Text (einfaches HTML möglich) …"
          className="w-full rounded-md border px-3 py-2 text-base"
        />
      );

    case "callout":
      return (
        <div className="flex flex-col gap-2">
          <select
            value={block.variant}
            onChange={(e) =>
              onChange({ ...block, variant: e.target.value as typeof block.variant })
            }
            className="rounded-md border px-3 py-2 text-base"
          >
            <option value="info">Info</option>
            <option value="warning">Warnung</option>
            <option value="success">Erfolg</option>
          </select>
          <textarea
            value={block.text}
            onChange={(e) => onChange({ ...block, text: e.target.value })}
            rows={3}
            placeholder="Hinweistext …"
            className="w-full rounded-md border px-3 py-2 text-base"
          />
        </div>
      );

    case "image":
      return (
        <div className="flex flex-col gap-2">
          <input
            value={block.url}
            onChange={(e) => onChange({ ...block, url: e.target.value })}
            placeholder="Bild-URL"
            className="w-full rounded-md border px-3 py-2 text-base"
          />
          <input
            value={block.alt}
            onChange={(e) => onChange({ ...block, alt: e.target.value })}
            placeholder="Alt-Text (Barrierefreiheit, Pflicht)"
            className="w-full rounded-md border px-3 py-2 text-base"
          />
        </div>
      );

    case "video":
      return (
        <VideoUpload
          currentVideoId={block.bunnyVideoId}
          onUploaded={(videoId) => onChange({ ...block, bunnyVideoId: videoId })}
        />
      );

    case "audio":
      return (
        <input
          value={block.url}
          onChange={(e) => onChange({ ...block, url: e.target.value })}
          placeholder="Audio-URL"
          className="w-full rounded-md border px-3 py-2 text-base"
        />
      );

    case "file":
      return (
        <div className="flex flex-col gap-2">
          <input
            value={block.url}
            onChange={(e) => onChange({ ...block, url: e.target.value })}
            placeholder="Datei-URL"
            className="w-full rounded-md border px-3 py-2 text-base"
          />
          <input
            value={block.filename}
            onChange={(e) => onChange({ ...block, filename: e.target.value })}
            placeholder="Dateiname"
            className="w-full rounded-md border px-3 py-2 text-base"
          />
        </div>
      );

    case "embed":
      return (
        <input
          value={block.url}
          onChange={(e) => onChange({ ...block, url: e.target.value })}
          placeholder="Einbettungs-URL (z. B. Google Slides, Figma)"
          className="w-full rounded-md border px-3 py-2 text-base"
        />
      );

    case "quiz":
      return (
        <p className="text-sm text-gray-500">
          Quiz-Erstellung folgt in Block 3b/Phase 2 (Fragen, Bestehensgrenze).
          Platzhalter: „{block.title || "Ohne Titel"}".
        </p>
      );

    case "submission":
      return (
        <textarea
          value={block.instructions}
          onChange={(e) => onChange({ ...block, instructions: e.target.value })}
          rows={3}
          placeholder="Anweisungen für die Abgabe …"
          className="w-full rounded-md border px-3 py-2 text-base"
        />
      );
  }
}
