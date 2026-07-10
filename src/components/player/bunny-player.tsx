/**
 * Bunny-iframe-Player. Server Component (kein "use client" nötig) — Library-ID
 * kommt server-only aus getPlayerConfig(), landet aber zwangsläufig in der
 * HTML-Antwort (Embed-URLs sind grundsätzlich öffentlich, keine Secrets).
 *
 * Performance-Budget CLAUDE.md §3.3 (Player-Start < 500 ms): iframe mit
 * `loading="eager"`, Bunny liefert HLS über eigenes CDN — Ladezeit liegt
 * primär bei Bunny, nicht in unserer Kontrolle.
 */
export function BunnyPlayer({
  libraryId,
  videoId,
}: {
  libraryId: string;
  videoId: string;
}) {
  const src = `https://iframe.mediadelivery.net/embed/${libraryId}/${videoId}?autoplay=false&preload=true`;

  return (
    <div className="aspect-video w-full overflow-hidden rounded-md border">
      <iframe
        src={src}
        loading="eager"
        allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
        className="h-full w-full"
        title="Video-Player"
      />
    </div>
  );
}
