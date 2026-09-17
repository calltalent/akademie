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
 * ist Wiederholung, nie die Information selbst.
 *
 * KONTRAST (Korrektur 11.09.2026, Befunde A11Y-2 und A11Y-3). Hier stand
 * pauschal „jeweils über 4,5:1"; nachgemessen stimmte das für zwei Paare
 * NICHT — die Zusage war ungeprüft übernommen. Die Chips sind 13px und fett,
 * zählen also als Normaltext (Large Text beginnt erst bei 18,66px fett), die
 * Schwelle ist damit 4,5:1 und nicht 3:1.
 *
 * Jeder Wert unten ist einzeln nachgerechnet (WCAG 2.1, relative Luminanz):
 *
 *   #7D6119 auf #FBF1DC = 5,21:1  (vorher #8A6D1F = 4,37:1 — durchgefallen)
 *   #156F45 auf #E3F2EA = 5,35:1  (vorher #1F8A5B = 3,75:1 — durchgefallen)
 *   #B24343 auf #FBEAEA = 4,78:1
 *   #66679B auf #EEF0F7 = 4,64:1
 *   #3E3F66 auf #E7E8F2 = 8,17:1
 *
 * Die Flächen bleiben unverändert; nur die Vordergründe wurden abgedunkelt.
 * Wer hier eine Farbe ändert, rechnet den Wert nach und schreibt den
 * GEMESSENEN Wert in diese Liste — keine geschätzten Zahlen.
 */
export const PARTNER_STATUS_STYLE: Record<
  AffiliatePartnerStatus,
  { color: string; background: string }
> = {
  pending: { color: "#7D6119", background: "#FBF1DC" },
  active: { color: "#156F45", background: "#E3F2EA" },
  rejected: { color: "#B24343", background: "#FBEAEA" },
  suspended: { color: "#66679B", background: "#EEF0F7" },
};

export const COMMISSION_STATUS_STYLE: Record<
  AffiliateCommissionStatus,
  { color: string; background: string }
> = {
  pending: { color: "#66679B", background: "#EEF0F7" },
  on_hold: { color: "#7D6119", background: "#FBF1DC" },
  approved: { color: "#156F45", background: "#E3F2EA" },
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
 * Erfolgsgrün für Rückmeldungen auf weißem Kartengrund — der Satz, auf den
 * `useStatusFocus()` nach jeder Server Action den Fokus setzt.
 *
 * Korrektur 11.09.2026 (Befund A11Y-4): hier stand an elf Stellen das Literal
 * `#1F8A5B`. Gemessen sind das 4,33:1 auf Weiß und damit UNTER AA, obwohl der
 * Kommentar daneben „≈ 4,6:1" zusicherte — wieder ein geschätzter statt eines
 * gerechneten Werts. Jetzt #166B47 auf #FFFFFF = 6,51:1 (nachgerechnet),
 * dieselbe Farbe, die das Bewerbungsformular schon führt.
 *
 * Als KONSTANTE und nicht als Literal, damit die nächste Korrektur eine
 * Stelle hat statt elf. Die Partnerfläche hält in `partner-forms.tsx` eine
 * bewusste Zweitkopie (Begründung dort) — die beiden gehören zusammen
 * gepflegt.
 */
export const SUCCESS = "#166B47";

/**
 * Ein sichtbarer Fokusring an JEDEM Bedienelement (8.5). Als Konstante und
 * nicht als globale CSS-Regel, damit sie beim Lesen der Komponente sichtbar
 * ist und nicht versehentlich von einem `outline-none` überschrieben wird.
 */
export const FOCUS_RING =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3E3F66]";

/** Karte — überall gleich, damit die Seiten nicht auseinanderlaufen. */
export const CARD_CLASS = "rounded-[14px] border bg-white";
