import type messages from "../messages/de.json";
import type { Locale } from "@/i18n/config";

/**
 * Offizielles next-intl-v4-Muster (next-intl.dev/docs/workflows/typescript):
 * `de.json` ist die Struktur-Referenz (Plan Abschnitt 5) — jeder spätere
 * `t()`-Aufruf bekommt dadurch Autovervollständigung/Typfehler auf echte
 * Message-Keys, sobald Block C sie tatsächlich verwendet. Keine Laufzeit-
 * Wirkung, reine Typdeklaration.
 */
declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof messages;
  }
}
