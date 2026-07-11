/**
 * Phase 3, Block 7 — Bugfix (Cowork-Verifikation, 11.07.2026): der
 * "Kopieren"-Button in `ApiKeyCreatedDialog`/`WebhookSecretCreatedDialog`
 * nutzte ausschließlich `navigator.clipboard?.writeText(...).catch(() =>
 * {})` — in diesem Testkontext (`demo-blau.localhost:3000`) war
 * `navigator.clipboard` nicht verfügbar (kein "secure context" laut
 * Browser), der Button tat dadurch wortlos gar nichts (Optional Chaining
 * lässt die gesamte Kette inkl. `.catch()` bei `undefined` verschwinden,
 * kein Fehler sichtbar). Reiner Client-Helfer (kein React-Import), damit er
 * unabhängig testbar/wiederverwendbar bleibt.
 *
 * Fallback: unsichtbares `<textarea>` + `document.execCommand("copy")`
 * (veraltet, aber funktioniert weiterhin in JEDEM Browser ohne
 * Secure-Context-Einschränkung — bewusst als Fallback, nicht als
 * Erstversuch, da `navigator.clipboard` der moderne, bevorzugte Weg ist).
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fällt durch zum Fallback unten (z. B. fehlende Berechtigung).
    }
  }

  if (typeof document === "undefined") return false;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  } finally {
    document.body.removeChild(textarea);
  }
  return ok;
}
