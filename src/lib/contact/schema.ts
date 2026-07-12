import { z } from "zod";

/**
 * Design-Block 4 (12.07.2026, Claude-Design-Export "Kontakt.dc.html") —
 * öffentliches Kontaktformular, erreichbar ohne Login von /login und
 * /passwort-vergessen aus (siehe Kontakt.dc.html-Querverweise). Bewusst
 * KEIN Mandantenbezug (analog Login/PasswortVergessen-Seiten) — die Seite
 * ist die zentrale Calltalent-Akademie-Kontaktstelle, nicht pro Mandant.
 */
export const CONTACT_SUBJECTS = [
  "Zugang / Anmeldung",
  "Frage zu einem Kurs",
  "Zusammenarbeit",
  "Sonstiges",
] as const;

export const contactFormSchema = z.object({
  firstName: z.string().trim().min(1, "Vorname erforderlich.").max(200),
  lastName: z.string().trim().min(1, "Nachname erforderlich.").max(200),
  email: z.string().trim().email("Ungültige E-Mail-Adresse."),
  subject: z.enum(CONTACT_SUBJECTS, { message: "Bitte einen Betreff auswählen." }),
  message: z.string().trim().min(1, "Nachricht darf nicht leer sein.").max(5000),
});

export type ContactFormInput = z.infer<typeof contactFormSchema>;
