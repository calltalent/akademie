/**
 * Übersetzung für den generischen "unerwarteter Fehler"-Fall (Catch-Block um
 * eine ganze Funktion, kein spezifischer Postgres-/Auth-Fehler mit stabilem
 * `.code`). Gleiches Muster wie `translateAuthError` (src/lib/auth/errors.ts)
 * und `translateDbError` (src/lib/errors/db.ts): der Nutzer bekommt NIE die
 * rohe `e.message` zu sehen (kann technischer/englischer Laufzeitfehler
 * sein, z. B. "fetch failed", "Cannot read properties of undefined") — die
 * echte Meldung gehört ins Server-Log (`console.error`), nicht in die UI.
 *
 * Ersetzt das bisher in ~20 Dateien duplizierte Muster
 * `e instanceof Error ? e.message : "Unbekannter Fehler."`.
 */
const FALLBACK_MESSAGE_DE = "Unbekannter Fehler. Bitte versuche es erneut.";

export function genericErrorMessage(e: unknown): string {
  // Nur lokal/Dev sichtbar (nie im Response-Body an den Client) — hilft beim
  // Debuggen, ohne dass die rohe Meldung je in der Produktions-UI landet.
  if (process.env.NODE_ENV !== "production") {
    console.debug("[genericErrorMessage] Original-Fehler:", e);
  }
  return FALLBACK_MESSAGE_DE;
}
