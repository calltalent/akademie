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
 *
 * ABWEICHUNG vom ursprünglichen Block-A-Stand (i18n Block C5a, 02.08.2026,
 * dokumentiert wie CLAUDE.md §4.1 verlangt): `getRequestConfig()` reicht dem
 * Callback ein `requestLocale`-Argument durch, das bislang ungenutzt blieb.
 * Für E-Mail-Vorlagen (`email/templates.ts`) wird `getTranslations({locale,
 * namespace})` jetzt MIT EXPLIZITER Locale außerhalb der Request-Middleware
 * aufgerufen (Mandanten-Standardsprache statt `x-locale`-Header) — next-intl
 * reicht diese explizite Locale genau über `requestLocale` durch, OHNE
 * `headers()` aufzurufen (das ist der Mechanismus, der den Einsatz
 * außerhalb eines Request-Kontexts erst ermöglicht, siehe next-intl-Quelle
 * `RequestConfig.receiveRuntimeConfigImpl`). Ohne diese Ergänzung hätte jeder
 * `getTranslations({locale})`-Aufruf die übergebene Locale STILLSCHWEIGEND
 * ignoriert und stattdessen immer den `x-locale`-Header gelesen — für
 * E-Mails falsch (Mandanten-Standardsprache verlangt) und in einem echten
 * Cron-Kontext ohne Request sogar ein harter Fehler (`headers()` wirft ohne
 * Request-Scope). Bestehende Aufrufe ohne Override
 * (`getTranslations("namespace")`, ~60 Fundstellen aus Block C1–C4) bleiben
 * unverändert: `requestLocale` ist dort `undefined` (next-intls interner
 * `getRequestLocale()`-Fallback liefert in diesem Projekt ohnehin nichts, da
 * kein next-intl-eigenes Locale-Header-Schema verwendet wird, siehe
 * Abschnitt 1 des Plans) — der Code fällt dann exakt wie zuvor auf den
 * `x-locale`-Header zurück.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const overridden = await requestLocale;
  if (overridden && isSupportedLocale(overridden)) {
    return {
      locale: overridden,
      messages: (await import(`../../messages/${overridden}.json`)).default,
    };
  }

  const headerList = await headers();
  const requested = headerList.get("x-locale");
  const locale = requested && isSupportedLocale(requested) ? requested : DEFAULT_LOCALE;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
