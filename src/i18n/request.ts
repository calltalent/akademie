import { getRequestConfig } from "next-intl/server";

/**
 * Block 1: einzige Locale „de" (UI-Standardsprache laut CLAUDE.md §3.5).
 * i18n-Struktur steht von Anfang an, echtes Locale-Routing folgt bei Bedarf
 * (mehrsprachige Kursinhalte sind laut SPEC.md nur „Could", nicht Phase 1).
 */
export default getRequestConfig(async () => {
  const locale = "de";
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
