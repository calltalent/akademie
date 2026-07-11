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
    <p style="margin:0 0 16px 0;">für dich wurde ein Konto bei <strong>${escapeHtml(tenantName)}</strong> angelegt. Du kannst dich ab sofort anmelden.</p>
    ${actionButton(loginUrl, "Jetzt anmelden", accentColor)}
    <p style="margin:0;font-size:13px;color:#6b7280;">Falls du noch kein Passwort gesetzt hast, nutze auf der Login-Seite „Passwort vergessen" oder melde dich per Magic-Link mit deiner E-Mail-Adresse an.</p>
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
