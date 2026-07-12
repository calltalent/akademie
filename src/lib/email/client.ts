import "server-only";
import { getServerEnv } from "@/lib/env";
import { genericErrorMessage } from "@/lib/errors/generic";

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
 *
 * UPDATE (Phase 5, Block 8, 12.07.2026): ruft die Resend-REST-API direkt per
 * `fetch()` auf statt über das `resend`-NPM-Paket — dieses zieht transitiv
 * `@react-email/render` inkl. `prettier` (~250 KB) mit, obwohl wir nirgends
 * den `react`-Parameter nutzen (nur `html`, siehe SendEmailInput unten).
 * Unter dem Turbopack-Build fiel das nicht auf, aber der Webpack-Build-
 * Workaround (Turbopack-SSR-Chunk-Bug, siehe PHASENSTATUS.md) konnte das
 * nicht wegschütteln und sprengte damit die 3-MiB-Worker-Grenze des
 * Cloudflare Free-Plans. `resend` ist seitdem keine Abhängigkeit mehr
 * (aus package.json entfernt). Anfrage-/Antwortformat 1:1 nach
 * https://resend.com/docs/api-reference/emails/send-email.
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
    const rawMessage = e instanceof Error ? e.message : "Unbekannter Fehler beim Lesen der Server-Umgebung.";
    console.error("[email/client] Server-Umgebung konnte nicht gelesen werden.", {
      to,
      subject,
      error: rawMessage,
    });
    return { success: false, error: genericErrorMessage(e) };
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
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html }),
    });

    if (!response.ok) {
      let errorMessage = `Resend-API antwortete mit Status ${response.status}.`;
      try {
        const body = (await response.json()) as { message?: string };
        if (body.message) errorMessage = body.message;
      } catch {
        // Antwortkörper war kein JSON (z. B. bei einem 5xx-Gateway-Fehler) —
        // dann bleibt es bei der Status-basierten Fehlermeldung oben.
      }
      console.error("[email/client] Resend-API-Fehler.", { to, subject, error: errorMessage });
      return { success: false, error: errorMessage };
    }

    const data = (await response.json()) as { id?: string };
    if (!data.id) {
      console.error("[email/client] Resend lieferte keine Bestätigungsdaten zurück.", {
        to,
        subject,
      });
      return { success: false, error: "Resend lieferte keine Bestätigungsdaten zurück." };
    }

    return { success: true, id: data.id };
  } catch (e) {
    const rawMessage = e instanceof Error ? e.message : "Unbekannter Fehler beim Mailversand.";
    console.error("[email/client] Ausnahme beim Mailversand.", { to, subject, error: rawMessage });
    return { success: false, error: genericErrorMessage(e) };
  }
}
