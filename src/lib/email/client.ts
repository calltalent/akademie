import "server-only";
import { Resend } from "resend";
import { getServerEnv } from "@/lib/env";

/**
 * Resend-Wrapper (Phase 2, Block 1 — E-Mail-Fundament).
 *
 * Sicherheitsregel CLAUDE.md §2.2: RESEND_API_KEY existiert nur serverseitig
 * (`getServerEnv()`), diese Datei ist über `import "server-only"` gegen
 * versehentlichen Import in Client-Bundles abgesichert.
 *
 * FAIL-SOFT (bewusst, mit Josip abgestimmt): `sendEmail()` wirft NIEMALS.
 * Ein Mailversand ist immer ein Nebeneffekt eines eigentlichen Vorgangs
 * (Kontoerstellung, Kauf, Bewertung, Zertifikat) — dieser Vorgang darf nie
 * daran scheitern, dass RESEND_API_KEY fehlt oder die Resend-API down ist.
 * Bei Fehler: `console.error` mit Kontext, Rückgabe `{ success: false }`.
 * Aufrufer entscheiden selbst, ob/wie sie einen Fehlschlag anzeigen.
 */

const DEFAULT_FROM_NAME = "Calltalent-Akademie";
const FROM_ADDRESS = "noreply@calltalent.ai";

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  /** Wenn gesetzt, wird der Mandantenname als Absender-Anzeigename genutzt. */
  tenant?: { name: string };
};

export type SendEmailResult =
  | { success: true; id: string }
  | { success: false; error: string };

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const { to, subject, html, tenant } = input;

  let apiKey: string | undefined;
  try {
    apiKey = getServerEnv().RESEND_API_KEY;
  } catch (e) {
    // getServerEnv() wirft bei ungültigen Server-Env-Variablen insgesamt —
    // auch das darf den Mailversand nur scheitern lassen, nie den Aufrufer.
    const message = e instanceof Error ? e.message : "Unbekannter Fehler beim Lesen der Server-Umgebung.";
    console.error("[email/client] Server-Umgebung konnte nicht gelesen werden.", {
      to,
      subject,
      error: message,
    });
    return { success: false, error: message };
  }

  if (!apiKey) {
    console.error("[email/client] RESEND_API_KEY nicht gesetzt — Mailversand übersprungen.", {
      to,
      subject,
    });
    return { success: false, error: "RESEND_API_KEY nicht gesetzt." };
  }

  const fromName = tenant?.name ? tenant.name : DEFAULT_FROM_NAME;
  const from = `${fromName} <${FROM_ADDRESS}>`;

  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({ from, to, subject, html });

    if (error) {
      console.error("[email/client] Resend-API-Fehler.", { to, subject, error });
      return { success: false, error: error.message ?? "Unbekannter Resend-Fehler." };
    }
    if (!data) {
      console.error("[email/client] Resend lieferte keine Bestätigungsdaten zurück.", {
        to,
        subject,
      });
      return { success: false, error: "Resend lieferte keine Bestätigungsdaten zurück." };
    }

    return { success: true, id: data.id };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unbekannter Fehler beim Mailversand.";
    console.error("[email/client] Ausnahme beim Mailversand.", { to, subject, error: message });
    return { success: false, error: message };
  }
}
