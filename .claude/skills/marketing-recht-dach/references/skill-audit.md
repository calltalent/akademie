# Prüfergebnis: 50 Upstream-Skills im DACH-Kontext

Stand der Prüfung: 26.08.2026, Upstream-Version 2.11.0, Commit `becd60e`.
Geprüft wurde, wo die Skills Rechtsaussagen treffen oder Taktiken empfehlen,
die in Deutschland anders zu bewerten sind. **Die Upstream-Dateien wurden nicht
verändert** — die US-Fassungen bleiben vollständig erhalten. Ergänzt wurde je
Skill ein markierter Hinweisblock (`DACH-HINWEIS`) unterhalb des Frontmatters.

## A — Direkter Rechtskonflikt

Die US-Anleitung führt bei wörtlicher Befolgung in DACH zu einer
rechtswidrigen Maßnahme.

| Skill | Fundstelle | US-Aussage | DACH |
|---|---|---|---|
| `cold-email` | gesamter Skill; einziger Rechtsbezug: `references/benchmarks.md:71` „GDPR affects European tone" | Kaltakquise per E-Mail als Standardkanal, ohne Einwilligungsfrage | § 7 Abs. 2 UWG: ohne vorherige ausdrückliche Einwilligung unzulässig, auch B2B. Der Skill hat **keinerlei** Einwilligungslogik — größte Lücke im Set |
| `prospecting` | `references/compliance.md`, Abschnitt „EU / UK — GDPR" | Berechtigtes Interesse als „lawful basis for cold B2B outreach" | Trägt die Datenverarbeitung, **nicht** den Versand. UWG entscheidet über den Versand. Art. 14 DSGVO (Quelle nennen, Frist ein Monat) fehlt |
| `paywalls` | `SKILL.md:91` | CTA „Start Getting [Benefit]" | § 312j Abs. 3 BGB: „zahlungspflichtig bestellen". Verstoß = Vertrag kommt nicht zustande |
| `signup` | `SKILL.md:301` | „Get Started" / „Start Free Trial" als CTA-Varianten | Zulässig, solange kein Zahlungsvorgang ausgelöst wird; bei Trial mit automatischem Übergang in ein Abo greift die Buttonlösung |
| `churn-prevention` | `references/cancel-flow-patterns.md:60`, `:49`, Abschnitt „Compliance Notes" | „Block self-serve cancel, require CS call"; Kündigung nur durch Owner; Compliance-Abschnitt nennt nur die FTC-Regel | § 312k BGB: Kündigungsbutton „Verträge hier kündigen", ohne Login erreichbar. Verstoß = fristlose Kündigung jederzeit möglich. Gilt B2C; im B2B anwendbar |
| `analytics`, `ads`, `attribution` | `analytics/SKILL.md:234–243`; `ads/references/conversion-tracking.md:340`; `attribution/references/first-party-tracking.md` (durchgehend) | Consent als regionale Zusatzanforderung; First-Party-Tracking-Aufbau ohne jede Consent-Erwähnung | § 25 TDDDG: Einwilligung **vor** jedem nicht erforderlichen Endgerätezugriff. Serverseitig und First-Party sind keine Ausnahmen |
| `referrals` | Programmaufbau „refer a friend" | Einladungsmails über die Plattform | Vom Unternehmen veranlasste Empfehlungs-E-Mail an Dritte = eigene Werbung, ohne Einwilligung unzulässig (BGH I ZR 208/12). Nur Link-Sharing durch den Nutzer selbst |

## B — Falscher Rechtsrahmen, Taktik tragfähig

Die Maßnahme ist zulässig, die genannte Rechtsgrundlage ist die falsche.

| Skill | US-Rahmen | DACH-Rahmen |
|---|---|---|
| `sms` | TCPA, A2P 10DLC, Quiet Hours je Bundesstaat, STOP/HELP-Keywords (`references/compliance.md`, `references/platforms.md`) | § 7 Abs. 2 UWG. Der EU-Abschnitt des Skills (Zeile 125 ff.) ist im Kern zutreffend; die US-Mechanik ist hier gegenstandslos |
| `influencer-marketing` | FTC-Disclosure, `#ad`/`#sponsored` (`SKILL.md:96–107`) | § 5a Abs. 4 UWG, deutsche Begriffe „Werbung"/„Anzeige", am Beitragsanfang. Die Aussage „You're responsible for your creators" stimmt auch hier |
| `competitors` | Vergleichsseiten als reines SEO-Thema | § 6 UWG mit Zulässigkeitsvoraussetzungen; MarkenG bei Logo- und Keyword-Nutzung |
| `emails` | Sequenzaufbau ohne Einwilligungsstufe | Einstieg über Double-Opt-In oder § 7 Abs. 3 UWG; Abmeldelink in jeder Mail |
| `offers` | „fake scarcity" nur als Vertrauensproblem (`SKILL.md:122`, `:125`) | Zusätzlich § 5 UWG; unwahre Verknappung ist abmahnfähig |
| `pricing` | Anchoring, Jahresrabatt (`SKILL.md:142`, `:229`) | PAngV: Gesamtpreis inkl. USt. gegenüber Verbrauchern, § 11 zum Streichpreis, Klarheit zur tatsächlichen Zahlungsweise |
| `marketing-loops` | „CAN-SPAM/GDPR/FTC/ToS" in den Guardrails (`references/loop-guardrails.md:36`, `:70`) | Guardrail-Systematik ist gut und bleibt; für DACH ist UWG zu ergänzen. Der Grundsatz „im Zweifel nicht handeln, sondern einem Menschen vorlegen" trägt |

## C — Lücke, kein Widerspruch

Rechtlich Erforderliches kommt schlicht nicht vor.

| Skill | Was fehlt |
|---|---|
| `site-architecture` | Impressum (§ 5 DDG) in keinem der Footer-Muster (`references/navigation-patterns.md:75–116`); ebenso fehlen Cookie-Einstellungen, Widerrufsbelehrung, Barrierefreiheitserklärung |
| `lead-magnets` | Kopplung von Download und Newsletter-Einwilligung — Art. 7 Abs. 4 DSGVO verlangt zwei getrennte Vorgänge |
| `popups` | Verhältnis zum Consent-Banner: kein Werbe-Layer vor der Consent-Entscheidung; Tastaturbedienbarkeit und Fokusführung (WCAG/BFSG) |
| `ab-testing` | Client-Side-Testtools setzen einwilligungspflichtige Cookies; serverseitiges Bucketing als saubere Alternative fehlt |
| `revops` | Art. 22 DSGVO bei automatisierter Aussteuerung; Löschfristen im Lead-Lebenszyklus |
| `customer-research` | Bewertungen (UWG-Anhang Nr. 23b/23c, § 5b Abs. 3); Einwilligung und Aufbewahrung bei Interview-Aufzeichnungen |
| `image`, `video`, `ad-creative` | Art. 50 KI-VO (seit 02.08.2026), Persönlichkeitsrecht an KI-Personen, Rechte am Ausgangsmaterial |
| `copywriting` | Beweislast für Werbeaussagen, Erfolgsversprechen, Spitzenstellungsbehauptungen |
| `marketing-psychology` | Grenze zwischen zulässiger Persuasion und Dark Pattern (§ 5, § 4a UWG; bei Plattformen Art. 25 DSA) |
| `events` | Teilnehmerlisten, Badge-Scans und Sponsoren-Weitergabe brauchen Einwilligung, keine „implied consent by attendance" |
| `community-marketing`, `social` | Schleichwerbung durch Mitarbeitende und Markenbotschafter (§ 5a Abs. 4 UWG) |

## D — Unkritisch

Ohne DACH-spezifischen Zusatzbedarf nutzbar: `ab-testing` (Methodik),
`aso`, `ai-seo`, `co-marketing`, `competitor-profiling`, `content-strategy`,
`copy-editing`, `cro` (soweit Gestaltung), `directory-submissions`,
`free-tools`, `launch`, `marketing-council`, `marketing-ideas`,
`marketing-plan`, `onboarding`, `product-marketing`, `programmatic-seo`,
`public-relations`, `sales-enablement`, `schema`, `seo-audit`,
`site-architecture` (soweit Struktur).

Wo diese Skills in eine Maßnahme aus A/B/C münden, gilt der jeweilige Eintrag
dort.

## Besonderheit Mandantenfähigkeit

Die Akademie ist eine White-Label-Plattform. Wenn Mandanten über sie E-Mails
versenden, Tracking einbinden oder Landingpages veröffentlichen, entstehen zwei
Ebenen:

- **Betreiberebene:** technische Voraussetzungen bereitstellen, die einen
  rechtmäßigen Betrieb überhaupt zulassen — Double-Opt-In-Fähigkeit,
  Abmeldelink erzwungen, Consent-Gate vor Drittanbieter-Skripten,
  Impressumsfeld je Mandant als Pflichtfeld, Kündigungsbutton bei entgeltlichen
  Endkundenverträgen, Einwilligungsnachweise exportierbar.
- **Mandantenebene:** Der Mandant ist für seine Inhalte verantwortlich; das
  gehört in den Vertrag und in die AVV-Rollenverteilung (Art. 26 vs. Art. 28
  DSGVO — je Verarbeitung getrennt zu bewerten).

Ein Mandant, der die Plattform für Kaltakquise missbraucht, gefährdet die
Zustellbarkeit und die Reputation aller Mandanten. Absicherung gehört in AGB,
technische Grenzen und Monitoring — nicht nur in eine Klausel.

## Wiederholung der Prüfung

Nach jedem Upstream-Update (siehe `../../README.md`):

```bash
.claude/skills/scripts/dach-hinweise-anwenden.sh   # Hinweisblöcke erneut einfügen
```

Danach die Tabellen oben gegen die neuen Fundstellen prüfen — Zeilennummern
verschieben sich, Aussagen können sich ändern.
