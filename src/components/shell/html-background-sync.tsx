"use client";

import { useEffect } from "react";

/**
 * BUGFIX (23.07.2026, Josips Fund: "weißer Balken im Footer" auf der
 * Kurs-Editor-Seite). Admin-Bereich (admin-shell.tsx) und Lernbereich
 * (learn/app-shell.tsx) nutzen beide denselben festen Lavendel-Grundton
 * (`#F4F5FA`/`bg-bg`) hinter ihrer dunklen Sidebar — unabhängig vom
 * Mandanten-Branding (Admin-UI ist bewusst nicht mandanten-gebrandet, siehe
 * AdminSidebar.tsx-Kommentar). `<html>`/`<body>` kennen dieses Schema aber
 * nicht, die setzen weiterhin `--color-background` (Mandanten-Branding,
 * meist Weiß). Beim Überscrollen mit dem Mausrad (Windows-Chrome-"Rubber-
 * Band"-Effekt) wird kurz die Fläche HINTER `<body>` sichtbar — dort passt
 * Weiß nicht zum Lavendel-Grund dieser Bereiche, sichtbar als weißer Balken
 * am unteren Rand.
 *
 * Setzt `document.documentElement.style.background` beim Mounten auf den
 * übergebenen Grundton und räumt beim Verlassen wieder auf (sonst bliebe
 * z. B. die Login-Seite fälschlich lavendelfarben, falls von Admin/
 * Lernbereich aus dorthin navigiert wird — `<html>`s eigentlicher
 * CSS-Hintergrund, `var(--color-background)`, bleibt dabei unverändert,
 * dieser Effekt setzt nur einen zusätzlichen Inline-Style-Override obendrauf).
 */
export function HtmlBackgroundSync({ color }: { color: string }) {
  useEffect(() => {
    const html = document.documentElement;
    const previous = html.style.background;
    html.style.background = color;
    return () => {
      html.style.background = previous;
    };
  }, [color]);

  return null;
}
