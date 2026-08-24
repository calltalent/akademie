import { z } from "zod";

/**
 * Rechtsträger-Daten für die Rechtstexte (Impressum/Legal notice,
 * Datenschutz, AGB).
 *
 * WECHSEL DES RECHTSTRÄGERS (24.08.2026, Josips Auftrag "AGB und Privacy für
 * salestalent.app müssen auf Calltalent LLC umgestellt werden"): Betreiber
 * aller eigenen Angebote (salestalent.app, academy.calltalent.ai,
 * marketplace.calltalent.ai) ist ab sofort die **Calltalent LLC** (Wyoming,
 * USA) statt der bisherigen Calltalent Ltd. (England und Wales, Company No.
 * 16591113). Die alten UK-Daten stehen bewusst NICHT mehr im Code — sie
 * würden sonst über eine vergessene Fundstelle wieder auf einer Rechtsseite
 * landen. Historie steht in PHASENSTATUS.md.
 *
 * Warum eine Datei statt Werte in `messages/*.json`: Rechtsträger-Angaben
 * sind Daten, keine Übersetzung — dieselbe Anschrift stand vorher dreifach
 * (de/en/bs) in den Sprachdateien und hätte bei diesem Wechsel an sechs
 * Stellen gleichzeitig geändert werden müssen. Übersetzt wird nur der
 * umgebende Fließtext (ICU-Platzhalter `{company}`/`{address}`/`{email}`).
 */
export const legalEntitySchema = z.object({
  /** Vollständige Firmierung, z. B. "Calltalent LLC". */
  name: z.string().min(1),
  /** Anschrift zeilenweise, in der eingetragenen Schreibweise (nicht übersetzt). */
  addressLines: z.array(z.string().min(1)).min(1),
  /** Kontaktadresse für Betroffenenrechte und Rechtsauskünfte. */
  email: z.string().email(),
  /**
   * Registernummer, falls vorhanden (Wyoming: "Filing ID"). `null`, solange
   * sie nicht belegt ist — die Rechtsseiten lassen den Abschnitt dann
   * vollständig weg, statt eine Nummer zu erfinden.
   */
  registrationNumber: z.string().min(1).nullable().default(null),
});

export type LegalEntity = z.infer<typeof legalEntitySchema>;

/**
 * Anschrift laut Josips Angabe vom 24.08.2026. Registernummer (Wyoming
 * Filing ID) liegt noch nicht vor -> `null`, siehe Feldkommentar oben.
 */
export const CALLTALENT_LLC: LegalEntity = {
  name: "Calltalent LLC",
  addressLines: ["1309 Coffeen Avenue STE 1200", "Sheridan, WY 82801", "United States"],
  email: "office@calltalent.ai",
  registrationNumber: null,
};

/** Einzeilige Anschrift für Fließtext ("… , Sheridan, WY 82801, United States"). */
export function formatAddress(entity: LegalEntity): string {
  return entity.addressLines.join(", ");
}

/**
 * Liest den Rechtsträger eines Mandanten aus `tenants.legal.entity`
 * (jsonb, siehe supabase/migrations/0001_init.sql). Bewusst über zod statt
 * per Cast: der Wert kommt aus der Datenbank und wird auf einer öffentlichen
 * Rechtsseite gerendert — eine halb ausgefüllte Zeile (Name ohne Anschrift)
 * wäre dort schlimmer als gar keine Seite.
 *
 * `null` heißt: dieser Mandant hat keinen hinterlegten Rechtsträger. Die
 * Rechtsseiten antworten dann mit 404 — auf einer White-Label-Domain eines
 * Kunden darf niemals Calltalents eigenes Impressum erscheinen.
 */
export function resolveLegalEntity(legal: unknown): LegalEntity | null {
  const entity = (legal as { entity?: unknown } | null | undefined)?.entity;
  const parsed = legalEntitySchema.safeParse(entity);
  return parsed.success ? parsed.data : null;
}
