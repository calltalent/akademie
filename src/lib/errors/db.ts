/**
 * Übersetzung bekannter Postgres/PostgREST-Fehler (aus Supabase
 * `.from(...).insert/update/delete/upsert`) ins Deutsche.
 *
 * Gleiches Muster wie `src/lib/auth/errors.ts` (translateAuthError): Mapping
 * über den stabilen, sprachunabhängigen Postgres-Fehlercode (`error.code`,
 * SQLSTATE) statt über den englischen `error.message`-Text — der Text kann
 * sich zwischen Postgres-/PostgREST-Versionen ändern und enthält oft rohe
 * Tabellen-/Constraint-Namen, die Nutzern nichts sagen. Unbekannte/neue
 * Codes bekommen einen generischen deutschen Text statt gar keine
 * Übersetzung oder die rohe Meldung.
 *
 * Referenz SQLSTATE-Codes: https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
const DB_ERROR_MESSAGES_DE: Record<string, string> = {
  "23505": "Dieser Eintrag existiert bereits.", // unique_violation
  "23503": "Der referenzierte Datensatz wurde nicht gefunden oder ist nicht verknüpfbar.", // foreign_key_violation
  "23502": "Ein Pflichtfeld fehlt.", // not_null_violation
  "23514": "Die Eingabe erfüllt nicht die erforderlichen Bedingungen.", // check_violation
  "42501": "Du hast keine Berechtigung für diese Aktion.", // insufficient_privilege (RLS)
  "PGRST301": "Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.", // JWT expired
  "PGRST116": "Der angeforderte Datensatz wurde nicht gefunden.", // no rows / not a single row
  // Schichtplan (Block S1, 07.08.2026, supabase/migrations/20260807090000_shift_calendar.sql):
  "23P01": "Diese Zeit überschneidet sich mit einer bestehenden Schicht.", // exclusion_violation (Postgres-Standard, EXCLUDE-Constraint)
  "CT001": "Dieses Zeitfenster ist bereits voll belegt.", // calendar_slot_capacity_guard()
  "CT002": "Die gewählte Zeit liegt außerhalb des freigegebenen Zeitfensters.", // calendar_slot_capacity_guard()
};

const FALLBACK_MESSAGE_DE = "Da ist etwas schiefgelaufen. Bitte versuche es erneut.";

/**
 * Übersetzt einen Postgres-/PostgREST-Fehler (oder etwas Ähnliches mit
 * `code`) ins Deutsche. Bei fehlendem/unbekanntem Code wird ein generischer
 * Fallback-Text geliefert — die rohe `error.message` wird NIE an den Nutzer
 * durchgereicht (ggf. separat loggen, siehe Aufrufstellen).
 */
export function translateDbError(error: { code?: string | null; message?: string } | null | undefined): string {
  if (error?.code && DB_ERROR_MESSAGES_DE[error.code]) {
    return DB_ERROR_MESSAGES_DE[error.code];
  }
  return FALLBACK_MESSAGE_DE;
}
