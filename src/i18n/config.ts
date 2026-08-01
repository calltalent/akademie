import { z } from "zod";

/**
 * Einzige Locale-Liste des Projekts (PLAN_Mehrsprachigkeit-i18n.md Abschnitt 5:
 * "kein Kürzel taucht sonst als Literal auf"). Neue Sprache = neuer Eintrag
 * hier + messages/<locale>.json, sonst nichts (siehe dortige Randnotiz zu
 * translate-captions.ts: "en" ist als dritter Eintrag bereits absehbar,
 * sobald messages/en.json existiert — hier bewusst noch nicht ergänzt).
 */
export const SUPPORTED_LOCALES = ["de", "bs"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "de";

/** Sprachname jeweils IN der Sprache selbst — kein Übersetzungs-Umweg im Umschalter. */
export const LOCALE_NAMES: Record<Locale, string> = {
  de: "Deutsch",
  bs: "Bosanski",
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
