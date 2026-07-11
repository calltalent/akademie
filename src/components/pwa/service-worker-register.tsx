"use client";

import { useEffect } from "react";

/**
 * Registriert den Service Worker (public/sw.js) für Installierbarkeit +
 * Web-Push-Empfang (Phase 4, Block 5). Rein clientseitig, kein SSR-Risiko —
 * prüft selbst, ob die Browser-API existiert (ältere Browser/manche
 * In-App-Browser unterstützen keine Service Worker). Rendert nichts
 * sichtbares, deshalb in src/app/layout.tsx einfach im <body> platziert.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("[pwa] Service-Worker-Registrierung fehlgeschlagen:", error);
    });
  }, []);

  return null;
}
