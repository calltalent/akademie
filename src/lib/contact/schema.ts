import { z } from "zod";
import { containsLink, containsMarkup } from "@/lib/contact/patterns";

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
  "Feedback zu einer Lektion",
  "Zusammenarbeit",
  "Sonstiges",
] as const;

/**
 * Spam-Härtung (25.08.2026, siehe patterns.ts/spam.ts): Namensfelder dürfen weder Links
 * noch Markup enthalten. Genau darüber lief der gemeldete Vorfall — der Bot
 * schrieb seine Ziel-URL in den Vornamen, damit sie in der
 * Benachrichtigungsmail als klickbarer Link erscheint. Für einen echten
 * Namen ist beides nie nötig, die Regel erzeugt also keine falschen
 * Ablehnungen. Länge zusätzlich von 200 auf 80 reduziert (längster
 * dokumentierter realer Vorname weltweit liegt weit darunter).
 */
const personNameSchema = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} erforderlich.`)
    .max(80, `${label} ist zu lang.`)
    .refine((value) => !containsLink(value) && !value.includes("@"), {
      message: `${label} darf keine Links oder E-Mail-Adressen enthalten.`,
    })
    .refine((value) => !containsMarkup(value), {
      message: `${label} enthält unzulässige Zeichen.`,
    });

export const contactFormSchema = z.object({
  firstName: personNameSchema("Vorname"),
  lastName: personNameSchema("Nachname"),
  email: z.string().trim().email("Ungültige E-Mail-Adresse."),
  subject: z.enum(CONTACT_SUBJECTS, { message: "Bitte einen Betreff auswählen." }),
  message: z.string().trim().min(1, "Nachricht darf nicht leer sein.").max(5000),
});

export type ContactFormInput = z.infer<typeof contactFormSchema>;
