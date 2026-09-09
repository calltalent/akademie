"use client";

import { useEffect, useRef } from "react";

/**
 * Cloudflare-Turnstile-Widget (Bot-Schutz, 25.08.2026 — siehe
 * `src/lib/security/turnstile.ts` für Hintergrund und Abschaltbarkeit).
 *
 * Bewusst generisch gehalten: aktuell nur im Kontaktformular eingesetzt,
 * lässt sich aber unverändert vor Login/Registrierung/Passwort-Reset hängen,
 * falls dort je Bot-Druck entsteht.
 *
 * Explizites Rendern (`turnstile.render()`) statt des impliziten
 * `class="cf-turnstile"`-Modus: das Formular ist eine Client-Komponente, das
 * Widget-Element existiert beim Laden des Skripts also nicht zwingend schon.
 * Das Widget legt selbst ein verstecktes Feld `cf-turnstile-response` in das
 * umgebende Formular — die Server Action liest genau dieses Feld.
 *
 * `resetSignal`: Turnstile-Token sind EINMALIG. Nach einer fehlgeschlagenen
 * Absendung (Validierungsfehler, Spam-Verdacht, Mailfehler) wäre das Token
 * verbraucht und der zweite Versuch scheiterte an "timeout-or-duplicate" —
 * die Elternkomponente reicht deshalb den Fehlerzustand durch, und bei
 * jeder Änderung wird das Widget zurückgesetzt.
 *
 * Barrierefreiheit (CLAUDE.md §3.4): Turnstile ist im Modus "Managed"
 * meistens unsichtbar und stellt nur im Zweifelsfall eine Aufgabe; die
 * bietet Cloudflare tastaturbedienbar und mit ARIA-Auszeichnung an. Die
 * Sprache wird explizit auf `de` gesetzt, damit die Aufgabe nicht in der
 * Browsersprache erscheint, während das Formular deutsch ist.
 */

type TurnstileApi = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string | undefined;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** Lädt das Skript genau einmal pro Seite, auch bei mehreren Widgets. */
function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();

  const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Turnstile-Skript nicht ladbar")));
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", () => resolve());
    script.addEventListener("error", () => reject(new Error("Turnstile-Skript nicht ladbar")));
    document.head.appendChild(script);
  });
}

export function TurnstileWidget({
  siteKey,
  resetSignal,
}: {
  siteKey: string;
  /** Wechselt der Wert, wird das verbrauchte Token verworfen. */
  resetSignal?: string | number | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(container, {
          sitekey: siteKey,
          language: "de",
          // Ein abgelaufenes Token still erneuern, statt den Nutzer beim
          // Absenden in einen Fehler laufen zu lassen.
          "refresh-expired": "auto",
        });
      })
      .catch((error: unknown) => {
        // Kein Blocker: schlägt das Laden fehl, fehlt beim Absenden das
        // Token. Die Server Action antwortet dann mit einer klaren,
        // korrigierbaren Meldung statt mit einem stummen Fehlschlag.
        console.error("Turnstile-Widget konnte nicht geladen werden.", error);
      });

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = undefined;
      }
    };
  }, [siteKey]);

  useEffect(() => {
    if (widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current);
  }, [resetSignal]);

  return <div ref={containerRef} />;
}
