import { z } from "zod";
import { DEFAULT_LOCALE, localeSchema, type Locale } from "@/i18n/config";

/**
 * i18n Block B5 (PLAN_Mehrsprachigkeit-i18n.md Abschnitt 4): zod-Validierung
 * der Mandanten-Sprachauswahl (Formularfelder aus tenant-settings-form.tsx),
 * getrennt von lib/tenant/actions.ts gehalten — eine mit "use server"
 * markierte Datei darf nur async Funktionen exportieren (Next.js-Vorgabe),
 * ein Schema-Export wäre dort ein Build-Fehler. Gleiches Trennungsmuster wie
 * lib/courses/schema.ts (Schema, ohne "use server") vs. die zugehörigen
 * Server Actions — und macht die Validierung hier ohne Supabase-/Next-
 * Headers-Mocking testbar (siehe locale-settings.test.ts).
 *
 * `.refine()` erzwingt Plan-Bedingung 1: die Standardsprache muss Teil der
 * freigeschalteten Menge sein — sonst widersprechen sich beide Felder.
 */
export const tenantLocalesSchema = z
  .object({
    defaultLocale: localeSchema,
    enabledLocales: z.array(localeSchema).min(1),
  })
  .refine((v) => v.enabledLocales.includes(v.defaultLocale), {
    message: "Die Standardsprache muss auch freigeschaltet sein.",
    path: ["defaultLocale"],
  });

export type TenantLocaleSettingsResult =
  | { ok: true; defaultLocale: Locale; enabledLocales: Locale[] }
  | { ok: false; error: string };

/**
 * Baut aus rohen Formulardaten (FormData.get()/getAll() liefern nur Strings/
 * Files, kein Locale-Typ) die geprüfte Sprachauswahl für `tenants.settings`.
 * "de" wird hier IMMER erzwungen (Plan Abschnitt 5, "de nie sperrbar") —
 * unabhängig davon, was das Formular tatsächlich schickt. Die Checkbox in
 * tenant-settings-form.tsx ist zusätzlich `disabled` (kann clientseitig gar
 * nicht abgewählt werden); dieser serverseitige Zwang deckt trotzdem den
 * Fall ab, dass eine Anfrage nicht über das reguläre Formular kam.
 */
export function parseTenantLocaleSettings(input: {
  defaultLocaleRaw: string;
  enabledLocalesRaw: string[];
}): TenantLocaleSettingsResult {
  const result = tenantLocalesSchema.safeParse({
    defaultLocale: input.defaultLocaleRaw,
    enabledLocales: [...new Set([DEFAULT_LOCALE, ...input.enabledLocalesRaw])],
  });
  if (!result.success) {
    // zods eingebaute Meldung für ein unbekanntes Enum-Kürzel ist Englisch
    // ("Invalid enum value…") — nur die eigene `.refine()`-Meldung (deutsch,
    // `code === "custom"`) direkt durchreichen, sonst deutschen Standardtext
    // verwenden (CLAUDE.md: deutsche UI-Texte).
    const customIssue = result.error.issues.find((issue) => issue.code === "custom");
    return { ok: false, error: customIssue?.message ?? "Unbekannte Sprache." };
  }
  return { ok: true, defaultLocale: result.data.defaultLocale, enabledLocales: result.data.enabledLocales };
}
