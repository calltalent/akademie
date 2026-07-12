import type { AuthError } from "@supabase/supabase-js";

/**
 * Übersetzung bekannter Supabase-Auth-Fehler (GoTrue) ins Deutsche.
 *
 * Josips Fund (12.07.2026): beim Passwort-setzen kam die rohe englische
 * GoTrue-Meldung durch ("Passwort konnte nicht gesetzt werden: New password
 * should be different from the old password.") — Vorgabe: Fehlermeldungen
 * IMMER auf Deutsch, nie ungefiltert `error.message` durchreichen.
 *
 * Bewusst über `error.code` (stabile, sprachunabhängige Kennung, siehe
 * @supabase/auth-js/dist/module/lib/error-codes.d.ts) statt über den
 * englischen `error.message`-Text gemappt — der Text kann sich zwischen
 * Supabase-Versionen ändern, der Code nicht. Unbekannte/neue Codes bekommen
 * einen generischen deutschen Text statt gar keine Übersetzung.
 */
const AUTH_ERROR_MESSAGES_DE: Record<string, string> = {
  same_password: "Das neue Passwort muss sich vom alten unterscheiden.",
  weak_password: "Das Passwort ist zu schwach. Bitte wähle ein längeres, sichereres Passwort.",
  email_exists: "Für diese E-Mail-Adresse existiert bereits ein Konto.",
  user_already_exists: "Für diese E-Mail-Adresse existiert bereits ein Konto.",
  invalid_credentials: "E-Mail oder Passwort ist falsch.",
  email_not_confirmed: "Bitte bestätige zuerst deine E-Mail-Adresse.",
  email_address_invalid: "Ungültige E-Mail-Adresse.",
  over_email_send_rate_limit: "Zu viele Anfragen. Bitte versuche es in ein paar Minuten erneut.",
  over_request_rate_limit: "Zu viele Anfragen. Bitte versuche es in ein paar Minuten erneut.",
  otp_expired: "Der Link ist abgelaufen. Bitte fordere einen neuen an.",
  session_expired: "Sitzung abgelaufen. Bitte fordere einen neuen Link an.",
  session_not_found: "Sitzung abgelaufen. Bitte fordere einen neuen Link an.",
  user_not_found: "Konto nicht gefunden.",
  user_banned: "Dieses Konto ist gesperrt.",
  signup_disabled: "Neuanmeldungen sind derzeit deaktiviert.",
  captcha_failed: "Sicherheitsprüfung fehlgeschlagen. Bitte versuche es erneut.",
};

const FALLBACK_MESSAGE_DE = "Da ist etwas schiefgelaufen. Bitte versuche es erneut.";

/** Übersetzt einen Supabase-AuthError (oder etwas Ähnliches) ins Deutsche. */
export function translateAuthError(error: Pick<AuthError, "code" | "message">): string {
  if (error.code && AUTH_ERROR_MESSAGES_DE[error.code]) {
    return AUTH_ERROR_MESSAGES_DE[error.code];
  }
  return FALLBACK_MESSAGE_DE;
}
