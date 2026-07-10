import type { Block } from "@/lib/courses/schema";

/**
 * Read-only-Darstellung der Blöcke in der Lernansicht.
 * `text.html` kommt aus dem Editor (Block 3), der nur eigene Staff-Nutzer
 * schreiben können (RLS `lessons_staff_write`) — daher kein zusätzliches
 * Sanitizing hier nötig (kein nutzergenerierter Fremdinhalt), aber die
 * grundsätzliche XSS-Fläche ist bewusst dokumentiert für den
 * security-reviewer.
 */
export function BlockRenderer({ blocks }: { blocks: Block[] }) {
  return (
    <div className="flex flex-col gap-4">
      {blocks.map((block) => (
        <BlockView key={block.id} block={block} />
      ))}
      {blocks.length === 0 && (
        <p className="text-base text-gray-500">Diese Lektion hat noch keinen Inhalt.</p>
      )}
    </div>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "text":
      return (
        // eslint-disable-next-line react/no-danger -- Inhalt stammt nur von Staff (RLS lessons_staff_write)
        <div className="text-base leading-relaxed" dangerouslySetInnerHTML={{ __html: block.html }} />
      );

    case "callout": {
      const bg =
        block.variant === "warning"
          ? "bg-amber-50 border-amber-300"
          : block.variant === "success"
            ? "bg-green-50 border-green-300"
            : "bg-blue-50 border-blue-300";
      return <div className={`rounded-md border p-4 text-base ${bg}`}>{block.text}</div>;
    }

    case "image":
      // eslint-disable-next-line @next/next/no-img-element -- externe/Storage-URLs, kein next/image-Loader konfiguriert
      return <img src={block.url} alt={block.alt} className="w-full rounded-md" />;

    case "video":
      return (
        <div className="rounded-md border p-6 text-center text-base text-gray-500">
          {block.bunnyVideoId
            ? `Video-Player folgt in Block 4 (Bunny-ID: ${block.bunnyVideoId})`
            : "Kein Video zugewiesen."}
        </div>
      );

    case "audio":
      return <audio controls src={block.url} className="w-full" />;

    case "file":
      return (
        <a href={block.url} className="text-base underline" style={{ color: "var(--color-primary)" }}>
          Datei herunterladen: {block.filename}
        </a>
      );

    case "embed":
      return (
        <iframe
          src={block.url}
          className="aspect-video w-full rounded-md border"
          title="Eingebetteter Inhalt"
        />
      );

    case "quiz":
      return (
        <div className="rounded-md border p-4 text-base text-gray-500">
          Quiz „{block.title || "Ohne Titel"}" — Auswertung folgt in Phase 2.
        </div>
      );

    case "submission":
      return (
        <div className="rounded-md border p-4 text-base">
          <p className="mb-2 font-medium">Abgabe</p>
          <p className="text-gray-700">{block.instructions}</p>
          <p className="mt-2 text-sm text-gray-500">Upload-Funktion folgt in Phase 2.</p>
        </div>
      );
  }
}
