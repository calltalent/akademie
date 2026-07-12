# Calltalent-Akademie

KI-native White-Label-Lernplattform (LMS) von Calltalent Ltd. Multi-Tenant: eine Codebasis, viele Kunden-Akademien mit eigenem Branding und eigener Domain.

**Status:** Phase 0 abgeschlossen (Fundament). Code-Aufbau beginnt mit Phase 1.

## Herkunft

Klon-Projekt auf Basis der Analyse von learningsuite.io (Premium-LMS, ca. 500 €/Monat). Vollständige Analyse: `VORBEREITUNG/Analyse_LearningSuite_Klon-Strategie_2026-07-10.md`. Agent: `AGENTEN/03-PRODUKT-ENTWICKLUNG/SAAS-KLON-AGENT/MASTERPROMPT.md`.

Kernversprechen gegenüber dem Original: schneller (< 1 s), KI-Kursgenerator + KI-Tutor, echtes Reporting, integrierte (abschaltbare) Zahlungen, transparente Preise, Self-Service.

## Preismodell (Verkauf)

| Paket | Einrichtung | Monatlich |
|---|---|---|
| Akademie Komplett | 2.990 € | 149 € |
| Akademie Enterprise | 4.990 € | 249 € |
| KI-Zusatzkontingent | — | 29 € je 1.000 Tutor-Antworten |

## Dateien in diesem Ordner

| Datei | Zweck |
|---|---|
| `CLAUDE.md` | Bau-Verfassung: Stack, Regeln, Definition of Done (von Claude Code automatisch gelesen) |
| `SPEC.md` | Produktspezifikation: MoSCoW, Screens, Datenmodell, KI-Kosten, API |
| `supabase/migrations/0001_init.sql` | Komplettes Datenbankschema mit Row Level Security |
| `.claude/agents/` | Subagenten: architect, builder, security-reviewer, tester |
| `PHASENSTATUS.md` | Fortschritt und offene Punkte je Phase |

## Phase 1 starten (neue Sitzung, Modell: Sonnet)

Claude Code im Ordner `SOFTWARE/calltalent-akademie/` öffnen und eingeben:

„Lies CLAUDE.md und SPEC.md. Führe Phase 1 laut CLAUDE.md aus (App-Gerüst, Auth, Mandanten, Kurs-Editor, Lernansicht). Beginne im Plan Mode mit dem architect-Agenten."

Alternativ in Cowork: gleicher Satz, mit Pfad `SOFTWARE/calltalent-akademie/`.

## Voraussetzungen vor Phase 1 (einmalig)

1. Supabase-Projekt „calltalent-akademie" (Region EU-Frankfurt) — kann ich per Supabase-MCP anlegen (Free Tier, 0 €; Freigabe genügt).
2. Bunny.net-Konto mit Stream-Library (EU) — manuelle Registrierung, API-Key in `.env` eintragen.
3. Stripe: vorhandenes Konto, Produkte werden in Phase 2 angelegt.
4. Anthropic-API-Key für Produkt-KI (Tutor/Generator) — getrennt vom Entwicklungs-Abo.
