/**
 * Erzeugt eine eindeutige, menschenlesbare Zertifikats-Seriennummer.
 * Format: CT-<Jahr>-<8-stelliger Crockford-Base32-Code>.
 *
 * Reine Funktion, kein I/O — diese Funktion selbst prüft NICHT auf
 * Eindeutigkeit in der DB (bei ~40 Bit Zufallsraum ist eine Kollision
 * praktisch ausgeschlossen). Die eigentliche Garantie liefert der
 * DB-Unique-Constraint `certificates.serial` (siehe 0001_init.sql) —
 * `src/lib/certificates/issue.ts` fängt einen Constraint-Konflikt ab,
 * statt hier vorab zu prüfen.
 *
 * Crockford-Alphabet (32 Zeichen, ohne I/L/O/U) statt Standard-Base32,
 * damit die Seriennummer nicht mit Ziffern 0/1 verwechselbar wird und
 * beim Vorlesen/Abtippen (Support-Fälle) weniger fehleranfällig ist.
 */

const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function toBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += CROCKFORD_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += CROCKFORD_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function generateCertificateSerial(date: Date = new Date()): string {
  const year = date.getFullYear();

  // 5 Byte (40 Bit) Zufall aus einer UUID -> exakt 8 Base32-Zeichen, keine
  // Füll-Padding-Zeichen nötig (40 ist durch 5 teilbar).
  const uuid = crypto.randomUUID().replace(/-/g, "");
  const hexPart = uuid.slice(0, 10);
  const bytes = new Uint8Array(hexPart.match(/.{2}/g)!.map((hexByte) => parseInt(hexByte, 16)));
  const shortCode = toBase32(bytes);

  return `CT-${year}-${shortCode}`;
}
