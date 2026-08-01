import { DEFAULT_LOCALE, isSupportedLocale, type Locale } from "@/i18n/config";

/**
 * Reine Funktion, kein next/headers-Zugriff — dadurch ohne Mocking testbar
 * (gleiche Linie wie lib/tenant/routing.ts, siehe dortiger Kopfkommentar zu
 * genau diesem Muster).
 *
 * Kette (PLAN_Mehrsprachigkeit-i18n.md Abschnitt 1, absteigende Priorität):
 * Cookie -> Mandanten-Standard -> Accept-Language -> "de". Jeder Kandidat
 * muss zusätzlich in `enabledLocales` stehen — scheitert er, fällt er auf die
 * nächste Stufe durch, nie auf Fehler oder leere Seite (Plan Abschnitt 3.4).
 * "de" ist nie sperrbar, weil `resolveEnabledLocales()` es immer enthält.
 */
export function resolveLocale(params: {
  cookie?: string | null;
  tenantDefault?: string | null;
  acceptLanguage?: string | null;
  enabledLocales: Locale[];
}): Locale {
  const { cookie, tenantDefault, acceptLanguage, enabledLocales } = params;

  const isAllowed = (candidate: string | null | undefined): candidate is Locale =>
    !!candidate && isSupportedLocale(candidate) && enabledLocales.includes(candidate);

  if (isAllowed(cookie)) return cookie;
  if (isAllowed(tenantDefault)) return tenantDefault;

  const fromHeader = parseAcceptLanguageCandidates(acceptLanguage).find(isAllowed);
  if (fromHeader) return fromHeader;

  return DEFAULT_LOCALE;
}

/**
 * Zerlegt z. B. "de-DE,de;q=0.9,bs;q=0.8" in ["de", "de", "bs"] (Reihenfolge
 * = Priorität des Browsers). Kein Gewichtungs-Feintuning nötig — resolveLocale()
 * nimmt ohnehin den ersten Treffer, der zusätzlich in enabledLocales steht.
 */
function parseAcceptLanguageCandidates(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part) => part.trim().split(";")[0]?.split("-")[0]?.toLowerCase())
    .filter((tag): tag is string => !!tag);
}
