/**
 * Deutsche E-Mail-Vorlagen (Phase 2, Block 1). Reine Funktionen, kein I/O —
 * geben nur HTML-Strings zurück, der Versand passiert in `email/client.ts`.
 *
 * Sicherheitsregel: JEDE eingefügte Nutzereingabe (Namen, Kurstitel,
 * Feedback-Freitext, Login-URL) läuft durch `escapeHtml()`. Diese Daten
 * stammen aus `profiles.full_name`, `courses.title`, Bewertungs-Freitext
 * o. Ä. — ohne Escaping wäre HTML-Injection über diese Felder möglich
 * (vgl. den Stored-XSS-Fund im Text-Block, siehe PHASENSTATUS.md).
 */

const DEFAULT_ACCENT_COLOR = "#171717";
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Nur ein valides Hex-Farbformat durchlassen, sonst Fallback — Schutz gegen
 * CSS-Injection über Branding-Felder. Exportiert (Phase 2, Block 4), damit
 * `src/lib/certificates/pdf.ts` dieselbe Validierung/denselben Fallback für
 * die PDF-Akzentfarbe wiederverwenden kann statt sie zu duplizieren.
 */
export function safeAccentColor(accentColor?: string): string {
  return accentColor && HEX_COLOR_PATTERN.test(accentColor) ? accentColor : DEFAULT_ACCENT_COLOR;
}

type LayoutInput = {
  tenantName: string;
  accentColor?: string;
  heading: string;
  /** Muss bereits sicheres HTML sein (escapeHtml auf alle eingebetteten Werte angewendet). */
  bodyHtml: string;
};

/** Gemeinsamer Layout-Helper: Kopf mit Mandantenname, Akzentfarbe, Fuß mit Hinweis. */
function renderLayout({ tenantName, accentColor, heading, bodyHtml }: LayoutInput): string {
  const safeTenantName = escapeHtml(tenantName);
  const color = safeAccentColor(accentColor);

  return `<!DOCTYPE html>
<html lang="de">
  <body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#171717;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:8px;border-top:4px solid ${color};overflow:hidden;">
            <tr>
              <td style="padding:24px 32px 0 32px;">
                <p style="margin:0;font-size:14px;color:#6b7280;">${safeTenantName}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 0 32px;">
                <h1 style="margin:0 0 16px 0;font-size:20px;color:${color};">${escapeHtml(heading)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 24px 32px;font-size:15px;line-height:1.6;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;border-top:1px solid #e5e7eb;">
                <p style="margin:0;font-size:12px;color:#9ca3af;">
                  Diese E-Mail wurde automatisch von ${safeTenantName} versendet.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function greeting(recipientName?: string): string {
  return recipientName ? `Hallo ${escapeHtml(recipientName)},` : "Hallo,";
}

function actionButton(url: string, label: string, accentColor?: string): string {
  const color = safeAccentColor(accentColor);
  return `<p style="margin:0 0 24px 0;">
    <a href="${escapeHtml(url)}" style="display:inline-block;padding:10px 20px;background:${color};color:#ffffff;text-decoration:none;border-radius:6px;">${escapeHtml(label)}</a>
  </p>`;
}

/**
 * UPDATE (Phase 5, Block 8, 12.07.2026 — Josips Fund): `loginUrl` zeigte
 * bisher auf die reine Login-Seite, obwohl das Konto ohne Passwort angelegt
 * wird — der Button führte damit ins Leere. Seit diesem Block liefert
 * `users/import.ts` (`buildSetPasswordLink()`) hier einen echten, einmaligen
 * Passwort-setzen-Link (Supabase `generateLink({type:"recovery"})`), der
 * direkt auf /passwort-setzen führt. Parametername `loginUrl` bewusst
 * beibehalten (auch vom Mandanten-Besitzer-Einladungsflow wiederverwendet,
 * siehe platform/actions.ts) — Button-Text/Beschreibung unten an die neue
 * Realität angepasst.
 */
export function welcomeInvite({
  tenantName,
  recipientName,
  loginUrl,
  accentColor,
}: {
  tenantName: string;
  recipientName?: string;
  loginUrl: string;
  accentColor?: string;
}): string {
  const bodyHtml = `
    <p style="margin:0 0 16px 0;">${greeting(recipientName)}</p>
    <p style="margin:0 0 16px 0;">für dich wurde ein Konto bei <strong>${escapeHtml(tenantName)}</strong> angelegt. Lege jetzt dein Passwort fest, um dich anzumelden.</p>
    ${actionButton(loginUrl, "Passwort festlegen", accentColor)}
    <p style="margin:0;font-size:13px;color:#6b7280;">Dieser Link ist nur einmal gültig und läuft nach einiger Zeit ab. Falls er nicht mehr funktioniert, kannst du auf der Login-Seite jederzeit „Passwort vergessen" nutzen.</p>
  `;
  return renderLayout({ tenantName, accentColor, heading: "Willkommen", bodyHtml });
}

export function submissionGraded({
  tenantName,
  recipientName,
  courseTitle,
  lessonTitle,
  status,
  feedback,
  accentColor,
}: {
  tenantName: string;
  recipientName?: string;
  courseTitle: string;
  lessonTitle: string;
  status: "approved" | "rejected" | (string & {});
  feedback?: string;
  accentColor?: string;
}): string {
  const statusLabel =
    status === "approved" ? "angenommen" : status === "rejected" ? "abgelehnt" : escapeHtml(status);
  const feedbackHtml = feedback
    ? `<div style="margin:16px 0 0 0;padding:12px 16px;background:#f9fafb;border-radius:6px;font-size:14px;">${escapeHtml(feedback).replace(/\n/g, "<br>")}</div>`
    : "";
  const bodyHtml = `
    <p style="margin:0 0 16px 0;">${greeting(recipientName)}</p>
    <p style="margin:0 0 16px 0;">deine Abgabe in <strong>${escapeHtml(courseTitle)}</strong> — Lektion <strong>${escapeHtml(lessonTitle)}</strong> wurde bewertet: <strong>${statusLabel}</strong>.</p>
    ${feedbackHtml}
  `;
  return renderLayout({ tenantName, accentColor, heading: "Abgabe bewertet", bodyHtml });
}

export function certificateIssued({
  tenantName,
  recipientName,
  courseTitle,
  accentColor,
}: {
  tenantName: string;
  recipientName?: string;
  courseTitle: string;
  accentColor?: string;
}): string {
  const bodyHtml = `
    <p style="margin:0 0 16px 0;">${greeting(recipientName)}</p>
    <p style="margin:0 0 16px 0;">herzlichen Glückwunsch! Du hast den Kurs <strong>${escapeHtml(courseTitle)}</strong> erfolgreich abgeschlossen — dein Zertifikat ist bereit.</p>
    <p style="margin:0;font-size:13px;color:#6b7280;">Du findest dein Zertifikat in deinem Profil unter „Zertifikate".</p>
  `;
  return renderLayout({ tenantName, accentColor, heading: "Zertifikat ausgestellt", bodyHtml });
}

/**
 * Eskalations-Mail an ein Staff-Mitglied (Phase 3, Block 4 — Tutor-Chat,
 * "An Trainer weiterleiten"). Kein Tiefen-Link zu einer Admin-Ansicht, da es
 * in diesem Block keine eskalierte-Konversationen-Inbox gibt (bewusste
 * Vereinfachung, siehe PHASENSTATUS.md) — reicht ein Hinweistext mit
 * Konversations-ID/Kursname/Lernenden-Name.
 */
export function tutorEscalation({
  tenantName,
  recipientName,
  learnerName,
  courseTitle,
  conversationId,
  accentColor,
}: {
  tenantName: string;
  recipientName?: string;
  learnerName: string;
  courseTitle: string;
  conversationId: string;
  accentColor?: string;
}): string {
  const bodyHtml = `
    <p style="margin:0 0 16px 0;">${greeting(recipientName)}</p>
    <p style="margin:0 0 16px 0;"><strong>${escapeHtml(learnerName)}</strong> hat eine Tutor-Konversation im Kurs <strong>${escapeHtml(courseTitle)}</strong> an dich als Trainer weitergeleitet, weil der KI-Assistent die Frage nicht aus dem Kursinhalt beantworten konnte.</p>
    <p style="margin:0;font-size:13px;color:#6b7280;">Konversations-ID: ${escapeHtml(conversationId)}</p>
  `;
  return renderLayout({ tenantName, accentColor, heading: "Tutor-Frage weitergeleitet", bodyHtml });
}

/**
 * "Passwort vergessen" (19.07.2026, Josips Auftrag: "alle E-Mails diesem
 * Layout anpassen"). Vorher verschickte `supabase.auth.resetPasswordForEmail()`
 * DIREKT Supabases eigene, unmarkierte Standard-Vorlage — dieselbe Lücke wie
 * beim Magic-Link (siehe `magicLinkEmail()` unten). `auth/actions.ts` erzeugt
 * den Link jetzt selbst über `admin.auth.admin.generateLink({type:"recovery"})`
 * (genau wie `buildSetPasswordLink()` in `users/import.ts`) und verschickt ihn
 * über diese Vorlage statt über Supabases eigenen Mailversand.
 */
export function passwordReset({
  tenantName,
  recipientName,
  resetUrl,
  accentColor,
}: {
  tenantName: string;
  recipientName?: string;
  resetUrl: string;
  accentColor?: string;
}): string {
  const bodyHtml = `
    <p style="margin:0 0 16px 0;">${greeting(recipientName)}</p>
    <p style="margin:0 0 16px 0;">für dein Konto bei <strong>${escapeHtml(tenantName)}</strong> wurde ein neues Passwort angefordert. Klicke auf den Button, um ein neues Passwort festzulegen.</p>
    ${actionButton(resetUrl, "Neues Passwort festlegen", accentColor)}
    <p style="margin:0;font-size:13px;color:#6b7280;">Dieser Link ist nur einmal gültig und läuft nach einiger Zeit ab. Falls du das nicht angefordert hast, kannst du diese E-Mail einfach ignorieren.</p>
  `;
  return renderLayout({ tenantName, accentColor, heading: "Passwort zurücksetzen", bodyHtml });
}

/**
 * Magic-Link-Anmeldung (19.07.2026, gleicher Auftrag). Ersetzt Supabases
 * eigene Magic-Link-Mail (`supabase.auth.signInWithOtp()`) durch denselben
 * `admin.auth.admin.generateLink({type:"magiclink"})` + eigener Versand wie
 * bei `passwordReset()` oben — aus Nutzersicht identischer Effekt (Link führt
 * über `/auth/callback` zu einer angemeldeten Session), nur im gebrandeten
 * Layout statt Supabases generischer Standardmail.
 */
export function magicLinkEmail({
  tenantName,
  recipientName,
  loginUrl,
  accentColor,
}: {
  tenantName: string;
  recipientName?: string;
  loginUrl: string;
  accentColor?: string;
}): string {
  const bodyHtml = `
    <p style="margin:0 0 16px 0;">${greeting(recipientName)}</p>
    <p style="margin:0 0 16px 0;">klicke auf den Button, um dich bei <strong>${escapeHtml(tenantName)}</strong> anzumelden.</p>
    ${actionButton(loginUrl, "Anmelden", accentColor)}
    <p style="margin:0;font-size:13px;color:#6b7280;">Dieser Link ist nur einmal gültig und läuft nach einiger Zeit ab. Falls du diese Anmeldung nicht angefordert hast, kannst du diese E-Mail einfach ignorieren.</p>
  `;
  return renderLayout({ tenantName, accentColor, heading: "Dein Login-Link", bodyHtml });
}

/**
 * Kontaktformular-Benachrichtigung an office@calltalent.ai (19.07.2026,
 * gleicher Auftrag — `contact/actions.ts` baute bisher rohes, unformatiertes
 * HTML ohne die gemeinsame Kartenoptik). Kein Mandant im eigentlichen Sinn
 * (interne Calltalent-eigene Benachrichtigung) — `tenantName` fest auf
 * "Calltalent", damit Kopf-/Fußzeile trotzdem zum gemeinsamen Layout passen.
 */
export function contactFormNotification({
  firstName,
  lastName,
  email,
  subject,
  message,
}: {
  firstName: string;
  lastName: string;
  email: string;
  subject: string;
  message: string;
}): string {
  const bodyHtml = `
    <p style="margin:0 0 12px 0;"><strong>Von:</strong> ${escapeHtml(firstName)} ${escapeHtml(lastName)} (${escapeHtml(email)})</p>
    <p style="margin:0 0 12px 0;"><strong>Betreff:</strong> ${escapeHtml(subject)}</p>
    <p style="margin:0;white-space:pre-wrap;">${escapeHtml(message)}</p>
  `;
  return renderLayout({ tenantName: "Calltalent", heading: "Neue Kontaktanfrage", bodyHtml });
}

/**
 * Registrierungsbestätigung (19.07.2026, gleicher Auftrag wie `passwordReset()`/
 * `magicLinkEmail()`). Ersetzt Supabases eigene "Confirm signup"-Mail
 * (`supabase.auth.signUp()`), die bisher direkt verschickt wurde — mit
 * Supabases generischer Standardvorlage statt unseres gebrandeten Layouts.
 * `auth/actions.ts` legt das Konto jetzt über
 * `admin.auth.admin.generateLink({type:"signup"})` an (verschickt dabei KEINE
 * Mail, erzeugt aber denselben Bestätigungslink) und verschickt ihn über
 * diese Vorlage.
 */
export function confirmSignup({
  tenantName,
  recipientName,
  confirmUrl,
  accentColor,
}: {
  tenantName: string;
  recipientName?: string;
  confirmUrl: string;
  accentColor?: string;
}): string {
  const bodyHtml = `
    <p style="margin:0 0 16px 0;">${greeting(recipientName)}</p>
    <p style="margin:0 0 16px 0;">bitte bestätige deine E-Mail-Adresse, um dein Konto bei <strong>${escapeHtml(tenantName)}</strong> zu aktivieren.</p>
    ${actionButton(confirmUrl, "E-Mail-Adresse bestätigen", accentColor)}
    <p style="margin:0;font-size:13px;color:#6b7280;">Dieser Link ist nur einmal gültig und läuft nach einiger Zeit ab. Falls du dieses Konto nicht angelegt hast, kannst du diese E-Mail einfach ignorieren.</p>
  `;
  return renderLayout({ tenantName, accentColor, heading: "Bestätige deine E-Mail-Adresse", bodyHtml });
}

export function orderPaid({
  tenantName,
  recipientName,
  productName,
  accentColor,
}: {
  tenantName: string;
  recipientName?: string;
  productName: string;
  accentColor?: string;
}): string {
  const bodyHtml = `
    <p style="margin:0 0 16px 0;">${greeting(recipientName)}</p>
    <p style="margin:0 0 16px 0;">vielen Dank für deinen Kauf von <strong>${escapeHtml(productName)}</strong> bei <strong>${escapeHtml(tenantName)}</strong>. Die Zahlung ist eingegangen und dein Zugang ist freigeschaltet.</p>
  `;
  return renderLayout({ tenantName, accentColor, heading: "Zahlung erhalten", bodyHtml });
}
