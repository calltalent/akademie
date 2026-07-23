"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Clock } from "lucide-react";
import { checkLessonVideoStatus } from "@/lib/video/actions";

const POLL_INTERVAL_MS = 5000;

/**
 * Ersetzt den Bunny-iframe-Player, solange `block-renderer.tsx` das Video
 * (noch) nicht als fertig verarbeitet einstuft (Josips Meldung, 23.07.2026:
 * Bunnys eigener "Processing video"-Overlay aktualisiert sich nie von
 * selbst — ohne manuellen Seiten-Reload bleibt er stehen, obwohl Bunny
 * längst fertig ist). Pollt `checkLessonVideoStatus()` alle 5s und löst bei
 * "ready" `router.refresh()` aus — das lädt den Server-Component-Baum neu,
 * `block-renderer.tsx` sieht dann den fertigen Status und rendert den
 * echten `BunnyPlayer`.
 *
 * `unmountedRef` schützt den `setState`/`router.refresh()`-Aufruf nach dem
 * `await` davor, nach einem Navigations-Wechsel (Nutzer verlässt die
 * Lektion während des Wartens) noch auf einer entfernten Komponente zu
 * feuern — gleiches Muster wie `unmountedRef` in video-recorder.tsx.
 */
export function VideoProcessingStatus({ lessonId }: { lessonId: string }) {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      try {
        const result = await checkLessonVideoStatus(lessonId);
        if (unmountedRef.current) return;
        if (result.ready) {
          router.refresh();
          return;
        }
        if (result.failed) {
          setFailed(true);
          return;
        }
      } catch {
        // Weiterpollen statt hängenzubleiben — nächster Tick versucht es erneut.
      }
      timer = setTimeout(poll, POLL_INTERVAL_MS);
    }

    timer = setTimeout(poll, POLL_INTERVAL_MS);
    return () => {
      unmountedRef.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [lessonId, router]);

  if (failed) {
    return (
      <div
        role="alert"
        className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-md border p-6 text-center"
        style={{ borderColor: "#E9CFCF", background: "#FBEAEA" }}
      >
        <AlertTriangle size={22} aria-hidden="true" style={{ color: "#B14A4A" }} />
        <p className="text-base font-bold" style={{ color: "#B14A4A" }}>
          Video konnte nicht verarbeitet werden. Bitte im Kurs-Editor erneut hochladen.
        </p>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-md border p-6 text-center"
      style={{ borderColor: "#E7E8F2", background: "#F4F5FA" }}
    >
      <Clock size={22} aria-hidden="true" style={{ color: "#5663AE" }} />
      <p className="text-base font-bold" style={{ color: "#1A1A2E" }}>
        Video wird noch verarbeitet …
      </p>
      <p className="max-w-sm text-sm" style={{ color: "#66679B" }}>
        Das kann bei frisch hochgeladenen Videos einige Minuten dauern. Diese Seite aktualisiert sich automatisch,
        sobald es fertig ist.
      </p>
    </div>
  );
}
