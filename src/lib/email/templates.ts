import { getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/config";

/**
 * E-Mail-Vorlagen (Phase 2, Block 1; mehrsprachig seit i18n Block C5a,
 * PLAN_Mehrsprachigkeit-i18n.md Abschnitt 6). Reine Funktionen bis auf den
 * Textabruf über `getTranslations()` — kein sonstiges I/O, geben nur
 * HTML-Strings zurück, der Versand passiert in `email/client.ts`.
 *
 * MEHRSPRACHIGKEIT — ANDERE MECHANIK ALS DIE ÜBRIGE OBERFLÄCHE: E-Mails
 * laufen außerhalb eines Request-Kontexts (Cron-Jobs, Server Actions ohne
 * aktive Locale-Middleware) — deshalb kein `useTranslations()`-Hook, sondern
 * `getTranslations({locale, namespace:"email"})` aus `next-intl/server` mit
 * EXPLIZIT übergebener Locale (funktioniert dadurch auch ohne
 * `headers()`-Zugriff). Jede Vorlagenfunktion braucht deshalb `locale:
 * Locale` im Parameterobjekt und ist dadurch `async`. Locale-Quelle ist laut
 * Josips Entscheidung die MANDANTEN-Standardsprache
 * (`tenant.settings.default_locale`), nicht `profiles.locale` des einzelnen
 * Empfängers — siehe Aufrufstellen (auth/actions.ts, certificates/issue.ts,
 * stripe/webhook/route.ts, platform/actions.ts, users/actions.ts,
 * users/import.ts, tutor/actions.ts). Ausnahme weiterhin Deutsch (kein
 * `locale`-Parameter): `contactFormNotification()` — die interne
 * Benachrichtigung geht an den Support-Posteingang, dessen Sprache das
 * Team selbst bestimmt, nicht an den anfragenden Endnutzer. Der Absender
 * ist aber seit 03.08.2026 (Josips Auftrag "eigene Kontaktdaten und
 * Support" pro Mandant) namentlich mandantenbezogen: `tenantName` kommt aus
 * `getTenant()` (contact/actions.ts), Fallback "Calltalent" ohne Mandant.
 *
 * Sicherheitsregel unverändert: JEDE eingefügte Nutzereingabe (Namen,
 * Kurstitel, Feedback-Freitext, Login-URL) läuft durch `escapeHtml()`. Diese
 * Daten stammen aus `profiles.full_name`, `courses.title`,
 * Bewertungs-Freitext o. Ä. — ohne Escaping wäre HTML-Injection über diese
 * Felder möglich (vgl. den Stored-XSS-Fund im Text-Block, siehe
 * PHASENSTATUS.md). Übersetzte Textbausteine selbst enthalten nie
 * unmaskierte Nutzereingaben direkt im ICU-Vorlagentext — Werte wie
 * `{tenantName}`/`{courseTitle}` werden VOR der Übergabe an `t()` escaped
 * und ggf. bereits mit `<strong>` umschlossen übergeben (ICU parst nur den
 * Vorlagentext, nicht die eingesetzten Werte — literale `<...>`-Tags im
 * Vorlagentext selbst wären nur über `t.rich()` zulässig, das hier bewusst
 * nicht verwendet wird, um die Vorlagen einfach zu halten).
 */

const DEFAULT_ACCENT_COLOR = "#171717";
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;

/** Typ des mit `namespace: "email"` skalierten Übersetzers — von `renderLayout()`/`greeting()` wiederverwendet. */
type EmailTranslator = Awaited<ReturnType<typeof getTranslations<"email">>>;

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
  locale: Locale;
  t: EmailTranslator;
};

/** Gemeinsamer Layout-Helper: Kopf mit Mandantenname, Akzentfarbe, Fuß mit Hinweis. */
function renderLayout({ tenantName, accentColor, heading, bodyHtml, locale, t }: LayoutInput): string {
  const safeTenantName = escapeHtml(tenantName);
  const color = safeAccentColor(accentColor);

  return `<!DOCTYPE html>
<html lang="${locale}">
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
                  ${t("common.footerNotice", { tenantName: safeTenantName })}
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

function greeting(recipientName: string | undefined, t: EmailTranslator): string {
  return recipientName
    ? t("common.greetingNamed", { name: escapeHtml(recipientName) })
    : t("common.greetingGeneric");
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
export async function welcomeInvite({
  tenantName,
  recipientName,
  loginUrl,
  accentColor,
  locale,
}: {
  tenantName: string;
  recipientName?: string;
  loginUrl: string;
  accentColor?: string;
  locale: Locale;
}): Promise<string> {
  const t = await getTranslations({ locale, namespace: "email" });
  const bodyHtml = `
    <p style="margin:0 0 16px 0;">${greeting(recipientName, t)}</p>
    <p style="margin:0 0 16px 0;">${t("welcomeInvite.body", { tenantName: `<strong>${escapeHtml(tenantName)}</strong>` })}</p>
    ${actionButton(loginUrl, t("welcomeInvite.button"), accentColor)}
    <p style="margin:0;font-size:13px;color:#6b7280;">${t("welcomeInvite.notice")}</p>
  `;
  return renderLayout({ tenantName, accentColor, heading: t("welcomeInvite.heading"), bodyHtml, locale, t });
}

export async function submissionGraded({
  tenantName,
  recipientName,
  courseTitle,
  lessonTitle,
  status,
  feedback,
  accentColor,
  locale,
}: {
  tenantName: string;
  recipientName?: string;
  courseTitle: string;
  lessonTitle: string;
  status: "approved" | "rejected" | (string & {});
  feedback?: string;
  accentColor?: string;
  locale: Locale;
}): Promise<string> {
  const t = await getTranslations({ locale, namespace: "email" });
  const statusLabel =
    status === "approved"
      ? t("submissionGraded.statusApproved")
      : status === "rejected"
        ? t("submissionGraded.statusRejected")
        : escapeHtml(status);
  const feedbackHtml = feedback
    ? `<div style="margin:16px 0 0 0;padding:12px 16px;background:#f9fafb;border-radius:6px;font-size:14px;">${escapeHtml(feedback).replace(/\n/g, "<br>")}</div>`
    : "";
  const bodyHtml = `
    <p style="margin:0 0 16px 0;">${greeting(recipientName, t)}</p>
    <p style="margin:0 0 16px 0;">${t("submissionGraded.body", {
      courseTitle: `<strong>${escapeHtml(courseTitle)}</strong>`,
      lessonTitle: `<strong>${escapeHtml(lessonTitle)}</strong>`,
      status: `<strong>${statusLabel}</strong>`,
    })}</p>
    ${feedbackHtml}
  `;
  return renderLayout({ tenantName, accentColor, heading: t("submissionGraded.heading"), bodyHtml, locale, t });
}

export async function certificateIssued({
  tenantName,
  recipientName,
  courseTitle,
  accentColor,
  locale,
}: {
  tenantName: string;
  recipientName?: string;
  courseTitle: string;
  accentColor?: string;
  locale: Locale;
}): Promise<string> {
  const t = await getTranslations({ locale, namespace: "email" });
  const bodyHtml = `
    <p style="margin:0 0 16px 0;">${greeting(recipientName, t)}</p>
    <p style="margin:0 0 16px 0;">${t("certificateIssued.body", { courseTitle: `<strong>${escapeHtml(courseTitle)}</strong>` })}</p>
    <p style="margin:0;font-size:13px;color:#6b7280;">${t("certificateIssued.hint")}</p>
  `;
  return renderLayout({ tenantName, accentColor, heading: t("certificateIssued.heading"), bodyHtml, locale, t });
}

/**
 * Eskalations-Mail an ein Staff-Mitglied (Phase 3, Block 4 — Tutor-Chat,
 * "An Trainer weiterleiten"). Kein Tiefen-Link zu einer Admin-Ansicht, da es
 * in diesem Block keine eskalierte-Konversationen-Inbox gibt (bewusste
 * Vereinfachung, siehe PHASENSTATUS.md) — reicht ein Hinweistext mit
 * Konversations-ID/Kursname/Lernenden-Name.
 *
 * KI-Transparenz (CLAUDE.md §3.6, Art. 50 KI-VO): der Hinweis auf den
 * „KI-Assistenten" bleibt Teil des übersetzten Textbausteins
 * (`email.tutorEscalation.body`) und läuft damit über dieselbe
 * Übersetzung wie der Rest der Mail.
 */
export async function tutorEscalation({
  tenantName,
  recipientName,
  learnerName,
  courseTitle,
  conversationId,
  accentColor,
  locale,
}: {
  tenantName: string;
  recipientName?: string;
  learnerName: string;
  courseTitle: string;
  conversationId: string;
  accentColor?: string;
  locale: Locale;
}): Promise<string> {
  const t = await getTranslations({ locale, namespace: "email" });
  const bodyHtml = `
    <p style="margin:0 0 16px 0;">${greeting(recipientName, t)}</p>
    <p style="margin:0 0 16px 0;">${t("tutorEscalation.body", {
      learnerName: `<strong>${escapeHtml(learnerName)}</strong>`,
      courseTitle: `<strong>${escapeHtml(courseTitle)}</strong>`,
    })}</p>
    <p style="margin:0;font-size:13px;color:#6b7280;">${t("tutorEscalation.conversationIdLabel", { conversationId: escapeHtml(conversationId) })}</p>
  `;
  return renderLayout({ tenantName, accentColor, heading: t("tutorEscalation.heading"), bodyHtml, locale, t });
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
export async function passwordReset({
  tenantName,
  recipientName,
  resetUrl,
  accentColor,
  locale,
}: {
  tenantName: string;
  recipientName?: string;
  resetUrl: string;
  accentColor?: string;
  locale: Locale;
}): Promise<string> {
  const t = await getTranslations({ locale, namespace: "email" });
  const bodyHtml = `
    <p style="margin:0 0 16px 0;">${greeting(recipientName, t)}</p>
    <p style="margin:0 0 16px 0;">${t("passwordReset.body", { tenantName: `<strong>${escapeHtml(tenantName)}</strong>` })}</p>
    ${actionButton(resetUrl, t("passwordReset.button"), accentColor)}
    <p style="margin:0;font-size:13px;color:#6b7280;">${t("passwordReset.notice")}</p>
  `;
  return renderLayout({ tenantName, accentColor, heading: t("passwordReset.heading"), bodyHtml, locale, t });
}

/**
 * Magic-Link-Anmeldung (19.07.2026, gleicher Auftrag). Ersetzt Supabases
 * eigene Magic-Link-Mail (`supabase.auth.signInWithOtp()`) durch denselben
 * `admin.auth.admin.generateLink({type:"magiclink"})` + eigener Versand wie
 * bei `passwordReset()` oben — aus Nutzersicht identischer Effekt (Link führt
 * über `/auth/callback` zu einer angemeldeten Session), nur im gebrandeten
 * Layout statt Supabases generischer Standardmail.
 */
export async function magicLinkEmail({
  tenantName,
  recipientName,
  loginUrl,
  accentColor,
  locale,
}: {
  tenantName: string;
  recipientName?: string;
  loginUrl: string;
  accentColor?: string;
  locale: Locale;
}): Promise<string> {
  const t = await getTranslations({ locale, namespace: "email" });
  const bodyHtml = `
    <p style="margin:0 0 16px 0;">${greeting(recipientName, t)}</p>
    <p style="margin:0 0 16px 0;">${t("magicLinkEmail.body", { tenantName: `<strong>${escapeHtml(tenantName)}</strong>` })}</p>
    ${actionButton(loginUrl, t("magicLinkEmail.button"), accentColor)}
    <p style="margin:0;font-size:13px;color:#6b7280;">${t("magicLinkEmail.notice")}</p>
  `;
  return renderLayout({ tenantName, accentColor, heading: t("magicLinkEmail.heading"), bodyHtml, locale, t });
}

/**
 * Kontaktformular-Benachrichtigung an office@calltalent.ai (19.07.2026,
 * gleicher Auftrag — `contact/actions.ts` baute bisher rohes, unformatiertes
 * HTML ohne die gemeinsame Kartenoptik). Kein Mandant im eigentlichen Sinn
 * (interne Calltalent-eigene Benachrichtigung) — `tenantName` fest auf
 * "Calltalent", damit Kopf-/Fußzeile trotzdem zum gemeinsamen Layout passen.
 *
 * BEWUSSTE AUSNAHME von der Mehrsprachigkeit (i18n Block C5a,
 * PLAN_Mehrsprachigkeit-i18n.md Abschnitt 6, Josips Entscheidung): geht an
 * den Support-Posteingang des Mandanten (oder Calltalent selbst ohne
 * Mandantenkontext), nicht an einen Endnutzer, dessen Sprache man aus
 * `default_locale` ableiten müsste. Bleibt deshalb fest Deutsch, kein
 * `locale`-Parameter, kein `getTranslations()`. `tenantName` (NEU,
 * 03.08.2026) macht nur Absender-Kopf/-Fußzeile mandantenbezogen — siehe
 * Kopfkommentar dieser Datei.
 */
export function contactFormNotification({
  firstName,
  lastName,
  email,
  subject,
  message,
  tenantName,
}: {
  firstName: string;
  lastName: string;
  email: string;
  subject: string;
  message: string;
  tenantName: string;
}): string {
  const safeTenantName = escapeHtml(tenantName);
  const bodyHtml = `
    <p style="margin:0 0 12px 0;"><strong>Von:</strong> ${escapeHtml(firstName)} ${escapeHtml(lastName)} (${escapeHtml(email)})</p>
    <p style="margin:0 0 12px 0;"><strong>Betreff:</strong> ${escapeHtml(subject)}</p>
    <p style="margin:0;white-space:pre-wrap;">${escapeHtml(message)}</p>
  `;
  return `<!DOCTYPE html>
<html lang="de">
  <body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#171717;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:8px;border-top:4px solid ${DEFAULT_ACCENT_COLOR};overflow:hidden;">
            <tr>
              <td style="padding:24px 32px 0 32px;">
                <p style="margin:0;font-size:14px;color:#6b7280;">${safeTenantName}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 0 32px;">
                <h1 style="margin:0 0 16px 0;font-size:20px;color:${DEFAULT_ACCENT_COLOR};">Neue Kontaktanfrage</h1>
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
export async function confirmSignup({
  tenantName,
  recipientName,
  confirmUrl,
  accentColor,
  locale,
}: {
  tenantName: string;
  recipientName?: string;
  confirmUrl: string;
  accentColor?: string;
  locale: Locale;
}): Promise<string> {
  const t = await getTranslations({ locale, namespace: "email" });
  const bodyHtml = `
    <p style="margin:0 0 16px 0;">${greeting(recipientName, t)}</p>
    <p style="margin:0 0 16px 0;">${t("confirmSignup.body", { tenantName: `<strong>${escapeHtml(tenantName)}</strong>` })}</p>
    ${actionButton(confirmUrl, t("confirmSignup.button"), accentColor)}
    <p style="margin:0;font-size:13px;color:#6b7280;">${t("confirmSignup.notice")}</p>
  `;
  return renderLayout({ tenantName, accentColor, heading: t("confirmSignup.heading"), bodyHtml, locale, t });
}

export async function orderPaid({
  tenantName,
  recipientName,
  productName,
  accentColor,
  locale,
}: {
  tenantName: string;
  recipientName?: string;
  productName: string;
  accentColor?: string;
  locale: Locale;
}): Promise<string> {
  const t = await getTranslations({ locale, namespace: "email" });
  const bodyHtml = `
    <p style="margin:0 0 16px 0;">${greeting(recipientName, t)}</p>
    <p style="margin:0 0 16px 0;">${t("orderPaid.body", {
      productName: `<strong>${escapeHtml(productName)}</strong>`,
      tenantName: `<strong>${escapeHtml(tenantName)}</strong>`,
    })}</p>
  `;
  return renderLayout({ tenantName, accentColor, heading: t("orderPaid.heading"), bodyHtml, locale, t });
}
