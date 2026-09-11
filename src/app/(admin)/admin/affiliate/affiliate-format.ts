import type {
  AffiliateCommissionStatus,
  AffiliatePartnerStatus,
} from "@/lib/affiliate/types";

/**
 * Affiliate-System, Block B6-B — Darstellungshelfer der Mandanten-Oberfläche.
 *
 * Reine Funktionen und Konstanten, KEIN `server-only`: dieselben Werte
 * brauchen die Server Components (Partnerdetail) und die
 * `"use client"`-Zeilen (Partnerliste, Provisionsliste). Zwei Kopien wären
 * die sichere Art, Chip-Farben und Satzformat auseinanderlaufen zu lassen.
 *
 * Hier wird NICHT gerechnet. Jeder Geldbetrag und jeder Satz kommt fertig aus
 * `compute.ts` bzw. aus der Buchungszeile; diese Datei formatiert nur
 * (CLAUDE.md-Auftrag B6-B: „zwei Rechenwege, die auseinanderlaufen, sind ein
 * Streit mit dem Partner").
 */

/**
 * Statusfarben. Jede dieser Flächen trägt in der Oberfläche ZUSÄTZLICH den
 * ausgeschriebenen Statustext (8.5: „Status nie nur über Farbe") — die Farbe
 * ist Wiederholung, nie die Information selbst. Vordergrund auf Fläche
 * jeweils über 4,5:1.
 */
export const PARTNER_STATUS_STYLE: Record<
  AffiliatePartnerStatus,
  { color: string; background: string }
> = {
  pending: { color: "#8A6D1F", background: "#FBF1DC" },
  active: { color: "#1F8A5B", background: "#E3F2EA" },
  rejected: { color: "#B24343", background: "#FBEAEA" },
  suspended: { color: "#66679B", background: "#EEF0F7" },
};

export const COMMISSION_STATUS_STYLE: Record<
  AffiliateCommissionStatus,
  { color: string; background: string }
> = {
  pending: { color: "#66679B", background: "#EEF0F7" },
  on_hold: { color: "#8A6D1F", background: "#FBF1DC" },
  approved: { color: "#1F8A5B", background: "#E3F2EA" },
  paid: { color: "#3E3F66", background: "#E7E8F2" },
  cancelled: { color: "#B24343", background: "#FBEAEA" },
};

/**
 * Basispunkte als Anteil für `format.number(…, { style: "percent" })`.
 * 3500 bp -> 0,35 -> „35 %". Absichtlich kein eigener Prozenttext: die
 * Dezimaltrennung gehört in die Locale, nicht in eine handgeschriebene
 * Zeichenkette.
 */
export function bpToRatio(bp: number): number {
  return bp / 10000;
}

/** Cent als Betrag für `format.number(…, { style: "currency" })`. */
export function centsToAmount(cents: number): number {
  return cents / 100;
}

/**
 * Währungskürzel der Datenbank (`eur`, kleingeschrieben) in die Form, die
 * `Intl.NumberFormat` erwartet (`EUR`). Ein leeres oder unsinniges Kürzel
 * ließe den Formatter werfen und risse die ganze Seite ab — deshalb der
 * Rückfall auf `EUR`, der Programmvorgabe aus 3.2.
 */
export function currencyCode(currency: string | null | undefined): string {
  const code = (currency ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : "EUR";
}

/** `JJJJ-MM-TT` aus einem ISO-Zeitstempel, ohne Zeitzonenverschiebung. */
export function isoDay(value: string): string {
  return value.slice(0, 10);
}

/**
 * Der Geltungsbereich einer Kondition als Schlüsselpaar für `t()`.
 * Partner und Gruppe schließen sich aus (CHECK in 3.5), deshalb genügt eine
 * dreistufige Entscheidung.
 */
export function conditionScopeKind(row: {
  partner_id: string | null;
  group_id: string | null;
}): "partner" | "group" | "all" {
  if (row.partner_id !== null) return "partner";
  if (row.group_id !== null) return "group";
  return "all";
}

// --- Farben, Fokusring, Kartenform --------------------------------------

/**
 * Diese sieben Konstanten stehen in DIESER Datei und nicht in
 * `affiliate-shell.tsx`, und das ist kein Ordnungsgeschmack: die Shell ist
 * eine Server Component und importiert `next-intl/server`. Zöge eine
 * `"use client"`-Datei eine Farbe von dort, landete der Server-Teil im
 * Browser-Bündel und der Build bräche. Hier ist nichts serverseitig.
 */

/** Sekundärtext, Spaltenüberschriften, Leerzustände (8.5: rund 5,3:1 auf Weiß). */
export const MUTED = "#66679B";
/** Überschriften, Zahlen und jeder Wert, auf den es ankommt. */
export const INK = "#1A1A2E";
export const NAVY = "#3E3F66";
export const CARD_BORDER = "#E7E8F2";
export const HAIRLINE = "#EEF0F7";

/**
 * Ein sichtbarer Fokusring an JEDEM Bedienelement (8.5). Als Konstante und
 * nicht als globale CSS-Regel, damit sie beim Lesen der Komponente sichtbar
 * ist und nicht versehentlich von einem `outline-none` überschrieben wird.
 */
export const FOCUS_RING =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3E3F66]";

/** Karte — überall gleich, damit die Seiten nicht auseinanderlaufen. */
export const CARD_CLASS = "rounded-[14px] border bg-white";
