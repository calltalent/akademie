---
name: marketing-recht-dach
description: "Rechtlicher Rahmen für Marketing in Deutschland, Österreich und der Schweiz — verbindlich zu lesen, BEVOR eine Maßnahme aus den Marketing-Skills (cold-email, emails, sms, prospecting, analytics, attribution, ads, ab-testing, popups, churn-prevention, pricing, offers, competitors, influencer-marketing, referrals, signup, paywalls, lead-magnets, revops, site-architecture, image, video, ad-creative, marketing-loops) umgesetzt wird. Auch nutzen, wenn der Nutzer 'DSGVO', 'UWG', 'TDDDG', 'Abmahnung', 'Einwilligung', 'Double-Opt-In', 'Cookie-Banner', 'Impressum', 'Kündigungsbutton', 'Buttonlösung', 'Werbekennzeichnung', 'Preisangabenverordnung', 'darf ich das rechtlich', 'ist das erlaubt' oder 'BFSG' erwähnt, oder wenn eine Maßnahme auf deutsche, österreichische oder Schweizer Empfänger zielt. Die übrigen Marketing-Skills stammen aus den USA und beschreiben US-Recht (CAN-SPAM, TCPA, FTC); dieser Skill ergänzt und überschreibt sie für den DACH-Raum."
metadata:
  version: 1.0.0
  herkunft: lokal (Calltalent-Akademie), kein Upstream-Bestandteil von marketingskills
---

# Marketing-Recht DACH

Die 50 Skills unter `.claude/skills/` stammen aus
[coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills)
und sind auf den US-Markt geschrieben. Ihre Taktiken sind fachlich gut, ihr
Rechtsrahmen ist es für Deutschland nicht: CAN-SPAM erlaubt Kaltakquise per
E-Mail mit Opt-out, § 7 UWG verbietet sie ohne vorherige Einwilligung. Wer die
US-Anleitung wörtlich befolgt, produziert abmahnfähige Maßnahmen.

**Dieser Skill ersetzt die US-Rechtsaussagen der anderen Skills, nicht deren
Taktik.** Die US-Fassungen bleiben unverändert erhalten — sie gelten weiter für
US-Empfänger und als fachliche Grundlage.

> **Keine Rechtsberatung.** Das hier ist eine Arbeitsgrundlage, damit
> offensichtliche Fehler gar nicht erst entstehen. Paragrafenstände ändern
> sich; vor dem Live-Gang eines Funnels, eines Einwilligungstextes oder eines
> Vertragsflows gehört der konkrete Ablauf zu einem Fachanwalt für
> IT-/Wettbewerbsrecht. Bei mandantenfähigem Betrieb gilt das doppelt: Was
> Mandanten über die Plattform versenden, fällt auf den Betreiber zurück.

## Vor jeder Maßnahme: die vier Fragen

1. **Wer wird angesprochen?** Verbraucher oder Unternehmen? Viele Erleichterungen
   (mutmaßliche Einwilligung beim Telefonat, kein Widerrufsrecht, kein
   Kündigungsbutton) gelten nur im B2B — bei E-Mail-Werbung dagegen gibt es
   **keinen B2B-Rabatt**.
2. **Wo sitzt der Empfänger?** DACH → dieser Skill. USA → die Upstream-Skills
   sind zuständig. Gemischte Liste → strengsten Standard fahren und die
   Rechtsgrundlage je Kontakt dokumentieren.
3. **Werden personenbezogene Daten verarbeitet?** Dann braucht es eine
   Rechtsgrundlage nach Art. 6 DSGVO, Informationspflichten (Art. 13/14) und
   bei Auftragsverarbeitern einen AVV (Art. 28).
4. **Wird auf das Endgerät zugegriffen?** Jedes Cookie, `localStorage`, Pixel
   oder Fingerprint jenseits des technisch Erforderlichen braucht Einwilligung
   nach § 25 TDDDG — unabhängig davon, ob die Daten personenbezogen sind.

## Schnellurteile

| Maßnahme aus den Skills | US-Fassung sagt | DACH |
|---|---|---|
| Cold E-Mail an B2B-Leads (`cold-email`, `prospecting`) | erlaubt mit Opt-out (CAN-SPAM) | **Unzulässig** ohne vorherige ausdrückliche Einwilligung, § 7 Abs. 2 UWG. Auch B2B. |
| Newsletter-Anmeldung (`emails`, `lead-magnets`, `popups`) | Single Opt-in genügt | **Double-Opt-In** mit protokolliertem Nachweis (Art. 7 Abs. 1 DSGVO) |
| Werbe-SMS (`sms`) | Express written consent, Quiet Hours, STOP | Einwilligung wie bei E-Mail; A2P-10DLC/Quiet-Hours-Regeln sind US-spezifisch und hier gegenstandslos |
| Kalt-Telefonat B2B (`prospecting`) | erlaubt | Nur bei **mutmaßlicher** Einwilligung (sachliches Interesse); B2C nur mit ausdrücklicher Einwilligung, Dokumentation § 7a UWG |
| Pixel/GA4/CAPI ab Seitenaufruf (`analytics`, `ads`, `attribution`) | Standard-Setup, Consent optional | **Erst nach Einwilligung** laden, § 25 TDDDG |
| First-Party-/Server-Side-Tracking (`attribution`) | consentfrei implementierbar | Serverseitig ≠ einwilligungsfrei; Endgeräte-Zugriff und Profilbildung bleiben zustimmungspflichtig |
| A/B-Test mit Client-Tool (`ab-testing`) | einfach einbauen | Setzt Cookies → Einwilligung, sofern nicht rein serverseitig und ohne Wiedererkennung |
| Cancel-Flow mit Hürden (`churn-prevention`) | FTC: so einfach wie Anmeldung | **§ 312k BGB**: Kündigungsbutton „Verträge hier kündigen", ständig verfügbar. Telefonpflicht zum Kündigen ist unzulässig (B2C) |
| CTA „Start Getting X" auf zahlungspflichtigem Button (`paywalls`, `signup`) | Conversion-optimiert | **§ 312j Abs. 3 BGB**: „zahlungspflichtig bestellen" oder eindeutig entsprechend (B2C) |
| Streichpreis / „war 199 €" (`pricing`, `offers`) | Anchoring | **§ 11 PAngV**: Bezug auf den niedrigsten Preis der letzten 30 Tage |
| Countdown / „nur noch 3 Plätze" (`offers`, `popups`) | „fake scarcity zerstört Vertrauen" | Zusätzlich **§ 5 UWG**: unwahre Verknappung ist irreführend und abmahnfähig |
| Vergleichsseite „X vs. Y" (`competitors`) | SEO-Standard | Zulässig unter **§ 6 UWG**: objektiv, nachprüfbar, keine Herabsetzung, keine Verwechslungsgefahr |
| Influencer-Post (`influencer-marketing`) | FTC: `#ad` | **§ 5a Abs. 4 UWG**: kommerzieller Zweck kenntlich, deutsch („Werbung"/„Anzeige"), am Anfang, nicht im Hashtag-Block |
| Bewertungen einsammeln (`customer-research`, `cro`) | Social Proof | **UWG-Anhang Nr. 23b/23c** + § 5b Abs. 3 UWG: keine gefälschten/gekauften Bewertungen, Echtheitsprüfung offenlegen |
| Automatisches Lead-Scoring mit Aussteuerung (`revops`) | Standard | **Art. 22 DSGVO** prüfen, wenn allein automatisiert über Angebot/Preis entschieden wird |
| KI-generiertes Bild/Video/Text (`image`, `video`, `ad-creative`) | keine Pflicht | **Art. 50 KI-VO** (seit 02.08.2026 anwendbar) + Projektregel CLAUDE.md 3.6 |

## Referenzen

| Datei | Inhalt |
|---|---|
| [einwilligung-e-mail-sms.md](references/einwilligung-e-mail-sms.md) | § 7 UWG, Double-Opt-In, Bestandskundenausnahme, Telefonakquise, Textbausteine |
| [tracking-und-consent.md](references/tracking-und-consent.md) | § 25 TDDDG, Consent Mode, Server-Side, Scraping und Art. 14, Drittlandtransfer |
| [website-pflichten.md](references/website-pflichten.md) | Impressum, Datenschutzerklärung, Buttonlösung, Kündigungsbutton, Widerruf, PAngV, BFSG |
| [werbeaussagen-uwg.md](references/werbeaussagen-uwg.md) | Irreführung, Verknappung, Bewertungen, Vergleich, Kennzeichnung, KI-Transparenz |
| [skill-audit.md](references/skill-audit.md) | Prüfergebnis je Upstream-Skill: konkrete Fundstelle, Konflikt, was stattdessen gilt |

## Österreich und Schweiz

- **Österreich:** E-Mail-/SMS-Werbung ist in **§ 174 TKG 2021** geregelt
  (vorherige Einwilligung, gleicher Grundgedanke wie § 7 UWG), unlautere
  Geschäftspraktiken im **UWG (AT)**, Impressum in **§ 5 ECG** und § 25
  MedienG. DSGVO gilt unverändert.
- **Schweiz:** Nicht DSGVO, sondern **revDSG**; Massenwerbung per E-Mail ist in
  **Art. 3 Abs. 1 lit. o UWG (CH)** geregelt — Opt-in plus Absenderangabe und
  Ablehnungsmöglichkeit. Die Schweiz ist Drittland: Übermittlungen dorthin sind
  über den Angemessenheitsbeschluss gedeckt, in die USA nicht automatisch.

Wenn die Zielgruppe nicht eindeutig einem Land zuzuordnen ist: strengsten
Standard fahren, das ist im Regelfall der deutsche.

## Related Skills

- Alle Marketing-Skills unter `.claude/skills/` — dieser Skill geht ihren
  Rechtsaussagen für DACH vor.
- `../../CLAUDE.md` Abschnitt 2 (Sicherheitsregeln) und 3.6 (KI-Transparenz)
  gehen wiederum diesem Skill vor.
