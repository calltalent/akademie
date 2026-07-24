"use client";

import { useEffect, useRef } from "react";

/**
 * Bunny-iframe-Player. Client Component (24.07.2026, Josips Auftrag: auf dem
 * Handy soll das Antippen von Bunnys eigenem Vollbild-Symbol im Player
 * direkt in die Queransicht drehen) — vorher Server Component, jetzt wegen
 * `useEffect`/Ref auf Client umgestellt (Props kommen unverändert
 * server-seitig vorbereitet von block-renderer.tsx, keine eigene
 * Datenabfrage hier).
 *
 * Bunnys Vollbild-Button liegt INNERHALB des cross-origin iframe
 * (iframe.mediadelivery.net) — dessen Klick können wir wegen der
 * Same-Origin-Policy nicht direkt abfangen. Die Fullscreen API propagiert
 * den Vollbild-Zustand aber bis in unser Top-Dokument hoch:
 * `document.fullscreenElement` zeigt dann auf UNSER iframe-Element, dafür
 * feuert ein `fullscreenchange`-Event auch bei uns. Genau darauf reagieren
 * wir mit `screen.orientation.lock("landscape")`.
 *
 * Nur unter dem `sm`-Breakpoint (< 640px, gleiche Grenze wie der Rest der
 * App, siehe course-hero-header.tsx) — auf dem Desktop ergibt eine
 * erzwungene Bildschirmausrichtung keinen Sinn. Nur Android-Chrome/-Firefox
 * unterstützen die Orientation-Lock-API im Vollbildmodus; iOS Safari kennt
 * `lock()` gar nicht — dort dreht sich das Bild wie gewohnt erst beim
 * tatsächlichen Drehen des Geräts, ein Fehlschlag dort ist also kein Bug,
 * daher der stille Fallback statt einer Fehlermeldung.
 */
type FullscreenDocument = Document & { webkitFullscreenElement?: Element | null };
// TypeScripts DOM-Lib kennt `ScreenOrientation.lock()` nicht mehr (aus dem
// Standard-Entwurf entfernt, von Android-Chrome/-Firefox aber weiter
// implementiert) — lokale Erweiterung statt eines globalen `.d.ts`-Eingriffs,
// da nur dieser eine Aufruf sie braucht.
type LockableScreenOrientation = ScreenOrientation & {
  lock?: (orientation: "landscape") => Promise<void>;
};

export function BunnyPlayer({
  libraryId,
  videoId,
}: {
  libraryId: string;
  videoId: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    function handleFullscreenChange() {
      const iframe = iframeRef.current;
      if (!iframe) return;
      if (!window.matchMedia("(max-width: 639px)").matches) return;

      const fullscreenElement =
        document.fullscreenElement ?? (document as FullscreenDocument).webkitFullscreenElement ?? null;
      if (fullscreenElement !== iframe) return;

      try {
        const orientation = screen.orientation as LockableScreenOrientation | undefined;
        if (typeof orientation?.lock === "function") {
          orientation.lock("landscape").catch(() => {});
        }
      } catch {
        // iOS Safari kennt lock() nicht — kein Bug, siehe Kopfkommentar.
      }
    }

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
    };
  }, []);

  const src = `https://iframe.mediadelivery.net/embed/${libraryId}/${videoId}?autoplay=false&preload=true`;

  return (
    <div className="aspect-video w-full overflow-hidden rounded-md border">
      <iframe
        ref={iframeRef}
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
