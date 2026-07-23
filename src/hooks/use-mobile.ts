"use client";

import { useEffect, useState } from "react";

/**
 * Mobile-Umbau (23.07.2026, Josips Auftrag) — genutzt von TopBar.tsx, um die
 * Benachrichtigungen-/Profil-Dropdowns unter `lg` per JS-gemessener
 * Header-Höhe zu positionieren (siehe dortiger Kommentar).
 *
 * Initialwert LAZY über `useState(() => …)` statt eines `useEffect`, der
 * synchron `setState` aufruft — genau das flaggt ESLint-Regel
 * `react-hooks/set-state-in-effect` (erster Anlauf dieser Datei scheiterte
 * daran, siehe Git-Historie). Der verbleibende Effekt ruft `setIsMobile`
 * nur noch aus dem `change`-Callback des MediaQueryList auf ("Subscribe für
 * Updates von einem externen System" — laut react.dev "you-might-not-need-
 * an-effect" genau der erlaubte Fall), nicht mehr synchron im Effekt-Body.
 */
export function useIsMobile(breakpoint = 1024): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < breakpoint : false,
  );

  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    function handleChange(e: MediaQueryListEvent) {
      setIsMobile(e.matches);
    }
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, [breakpoint]);

  return isMobile;
}
