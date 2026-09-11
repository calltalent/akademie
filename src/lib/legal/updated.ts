/**
 * Stand der Rechtstexte (Impressum/Datenschutz/AGB). Bewusst eine feste
 * Konstante statt `new Date()`: eine Rechtsseite, deren Stand-Datum sich
 * täglich selbst hochzählt, behauptet eine Prüfung, die nicht stattgefunden
 * hat. Beim nächsten inhaltlichen Eingriff in die Texte mit ändern.
 *
 * 24.08.2026: Erstfassung der Mandanten-Rechtstexte unter der Calltalent LLC
 * (Wyoming, USA) — vorher gab es auf Mandanten-Domains keine Rechtstexte.
 * 25.08.2026: Datenschutzerklärung um den Abschnitt "Spam- und Bot-Schutz"
 * erweitert (Folge des Spam-Vorfalls am Kontaktformular). Impressum und AGB
 * sind inhaltlich unverändert, teilen sich aber bewusst diese eine
 * Stand-Konstante.
 * 10.09.2026: Datenschutzerklärung um den Abschnitt "Partner-Empfehlungen"
 * erweitert und der Cookie-Absatz korrigiert (Affiliate-Modul Block B2,
 * PLAN_Affiliate-System.md Abschnitt 10/B2). Impressum und AGB bleiben
 * inhaltlich unverändert.
 *
 * NEBENWIRKUNG dieses Datums, bewusst in Kauf genommen: die
 * Tracking-Einwilligung speichert den hier stehenden Stand als
 * `policy_version` mit und gilt nur für genau diesen Stand
 * (`isConsentGranted()`, src/lib/consent/read.ts). Jedes Hochsetzen dieser
 * Konstante lässt also alle zuvor erteilten Einwilligungen verfallen und den
 * Einwilligungsdialog erneut erscheinen. Das ist die gewollte Richtung — eine
 * Einwilligung bezieht sich auf einen bestimmten Text, nicht auf einen
 * Dienst —, aber es ist der Grund, diese Konstante nur bei einem echten
 * inhaltlichen Eingriff anzufassen.
 */
export const LEGAL_LAST_UPDATED = "2026-09-10";
