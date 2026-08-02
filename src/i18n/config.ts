import { z } from "zod";

/**
 * Einzige Locale-Liste des Projekts (PLAN_Mehrsprachigkeit-i18n.md Abschnitt 5:
 * "kein Kürzel taucht sonst als Literal auf"). Neue Sprache = neuer Eintrag
 * hier + messages/<locale>.json, sonst nichts.
 *
 * "en" ergänzt (02.08.2026, Josips Auftrag) — der dritte, bereits in der
 * vorherigen Randnotiz hier angekündigte Eintrag (siehe translate-captions.ts,
 * das unabhängig davon schon länger englische Video-Untertitel erzeugt).
 * Englisch nutzt wie Deutsch nur die ICU-Pluralkategorien "one"/"other"
 * (Bosnisch zusätzlich "few") — messages/en.json spiegelt deshalb strukturell
 * de.json, nicht bs.json.
 */
export const SUPPORTED_LOCALES = ["de", "bs", "en"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "de";

/** Sprachname jeweils IN der Sprache selbst — kein Übersetzungs-Umweg im Umschalter. */
export const LOCALE_NAMES: Record<Locale, string> = {
  de: "Deutsch",
  bs: "Bosanski",
  en: "English",
};

export function isSupportedLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * zod-Gegenstück zu `isSupportedLocale()` für Eingabegrenzen, die eine
 * `safeParse()`-Fehlerform brauchen (Server Actions, Plan Block B — CLAUDE.md
 * §2.3: zod an jeder Eingabegrenze). Leitet sich aus SUPPORTED_LOCALES ab,
 * führt also kein zweites Kürzel-Literal ein.
 */
export const localeSchema = z.enum(SUPPORTED_LOCALES);

/**
 * Effektive Freischaltung eines Mandanten (Plan Abschnitt 3.3):
 * dedupe([DEFAULT_LOCALE, ...enabled_locales]) ∩ SUPPORTED_LOCALES.
 *
 * "de" ist nie sperrbar (immer implizit vorne dabei). `settings` kommt roh
 * aus `tenants.settings` (jsonb) — zur Laufzeit nicht durch TypeScript
 * abgesichert, deshalb hier defensiv geprüft statt vorausgesetzt: ein
 * unbekanntes oder falsch typisiertes Kürzel wird stillschweigend verworfen,
 * nie ein Fehler (Freischaltung ist reine Produktdaten, keine
 * Sicherheitsgrenze — die liegt allein in SUPPORTED_LOCALES, siehe resolve.ts).
 */
export function resolveEnabledLocales(settings: { enabled_locales?: unknown }): Locale[] {
  const raw = Array.isArray(settings.enabled_locales) ? settings.enabled_locales : [];
  const candidates: unknown[] = [DEFAULT_LOCALE, ...raw];
  const deduped = [...new Set(candidates)];
  return deduped.filter(
    (value): value is Locale => typeof value === "string" && isSupportedLocale(value),
  );
}

/**
 * Locale für serverseitig OHNE Request-Kontext erzeugte Inhalte — bislang nur
 * E-Mails (PLAN_Mehrsprachigkeit-i18n.md Abschnitt 6, "C5a"). Josips
 * Entscheidung: Mandanten-Standardsprache (`tenant.settings.default_locale`),
 * nicht die individuelle `profiles.locale` des Empfängers. `default_locale`
 * kommt roh aus `tenants.settings` (jsonb, in `PublicTenant["settings"]`
 * bislang als `string` typisiert) — zur Laufzeit nicht durch TypeScript
 * abgesichert, deshalb hier defensiv geprüft statt vorausgesetzt: ein
 * fehlendes/unbekanntes Kürzel fällt still auf DEFAULT_LOCALE zurück statt
 * zu werfen (gleiche Linie wie `resolveEnabledLocales()` oben).
 */
export function resolveTenantEmailLocale(defaultLocale?: string | null): Locale {
  return defaultLocale && isSupportedLocale(defaultLocale) ? defaultLocale : DEFAULT_LOCALE;
}
