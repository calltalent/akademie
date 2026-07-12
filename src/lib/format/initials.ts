/**
 * Design-Block 6 (13.07.2026): aus submission-inbox.tsx extrahiert, damit
 * AdminTeilnehmer (Namens-/E-Mail-Kürzel im Avatar, wie AdminAbgaben) dieselbe
 * Logik nutzt statt sie zu duplizieren. Verhalten unverändert.
 */
export function initialsFor(name: string | null, email: string): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    const first = parts[0]?.[0] ?? "";
    const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
    return (first + last).toUpperCase() || "?";
  }
  return (email.slice(0, 2) || "?").toUpperCase();
}
