import { headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, isSupportedLocale } from "@/i18n/config";

/**
 * Liest die von middleware.ts aufgelöste Locale (`x-locale`-Header, gesetzt
 * direkt nach `x-tenant-data`, siehe middleware.ts). Der Header transportiert
 * letztlich Nutzereingabe (Cookie/Accept-Language sind vom Client
 * beeinflussbar) — deshalb Whitelist-Prüfung gegen SUPPORTED_LOCALES VOR dem
 * dynamischen Import (Path-Traversal-Schutz, PLAN_Mehrsprachigkeit-i18n.md
 * Abschnitt 8.1). Ein ungeprüfter Wert darf nie in den Template-String
 * gelangen — ein unbekanntes Kürzel fällt hier still auf DEFAULT_LOCALE
 * zurück statt einen Import-Fehler zu riskieren.
 */
export default getRequestConfig(async () => {
  const headerList = await headers();
  const requested = headerList.get("x-locale");
  const locale = requested && isSupportedLocale(requested) ? requested : DEFAULT_LOCALE;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
