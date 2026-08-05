import { z } from "zod";

/**
 * `trainerSchema` ausgelagert aus `settings/actions.ts` (05.08.2026,
 * "Meine Kunden Area", Plan
 * verwende-den-planungs-agenten-sequential-frost.md, Abschnitt 2 +
 * Abweichung siehe PHASENSTATUS.md): `settings/actions.ts` trägt
 * `"use server"` — eine solche Datei darf laut Next.js ausschließlich async
 * Server Actions exportieren, kein zod-Schema als Laufzeitwert. Damit
 * `src/lib/customer-area/schema.test.ts` das ECHTE, in Produktion genutzte
 * Trainer-Schema testen kann (statt einer Testkopie, die unbemerkt
 * auseinanderlaufen könnte), lebt es hier — analog zur bestehenden Trennung
 * `src/lib/marketplace/{schema,actions}.ts`.
 *
 * `phone`/`email` NEU: Kunden-Area-Ansprechpartner (customer_area_items,
 * kind='contact') zeigen diese Felder zusätzlich zu Name/Rolle/Bild —
 * Migration 20260805090000_customer_area.sql. Beide optional, kein
 * Bestandsschutz-Insert nötig (nullable ohne Default, Risiko 8.2 im Plan).
 */
export const trainerSchema = z.object({
  name: z.string().trim().min(1, "Name erforderlich.").max(150),
  role: z.string().trim().max(150).optional(),
  bio: z.string().trim().max(2000).optional(),
  imageUrl: z.string().trim().url("Ungültige Bild-URL.").optional(),
  phone: z.string().trim().max(30, "Höchstens 30 Zeichen.").optional(),
  email: z.string().trim().max(150).email("Ungültige E-Mail-Adresse.").optional(),
});

export type TrainerInput = z.infer<typeof trainerSchema>;
