# Tracking, Consent und Datenquellen

Betrifft `analytics`, `attribution`, `ads`, `ab-testing`, `popups`, `cro`,
`revops`, `prospecting`.

## § 25 TDDDG — die Regel vor der DSGVO

Das TDDDG (seit 14.05.2024 der neue Name des TTDSG) regelt den **Zugriff auf das
Endgerät**. § 25 Abs. 1: Speichern von Informationen auf dem Endgerät oder
Zugriff auf dort gespeicherte Informationen ist nur mit **Einwilligung** zulässig.

Zwei Punkte, die in den US-Skills fehlen:

1. Es kommt **nicht darauf an, ob die Daten personenbezogen sind**. Auch ein
   rein statistisches Cookie fällt darunter.
2. Es gibt **kein berechtigtes Interesse** als Alternative. Entweder
   Einwilligung — oder die Ausnahme „unbedingt erforderlich, um einen vom Nutzer
   ausdrücklich gewünschten Dienst zur Verfügung zu stellen" (§ 25 Abs. 2 Nr. 2).

Unbedingt erforderlich sind z. B. Session-Cookie, Warenkorb, Spracheinstellung,
Load-Balancing, CSRF-Token. **Nicht** erforderlich: GA4, Meta-Pixel,
LinkedIn-Insight, Hotjar, A/B-Test-Tools, Attributions-Cookies, Session
Recording.

Zusätzlich braucht die anschließende *Verarbeitung* der Daten eine
DSGVO-Rechtsgrundlage — bei Marketing-Tracking in aller Regel dieselbe
Einwilligung (Art. 6 Abs. 1 lit. a).

## Was das konkret bedeutet

- Tracking-Skripte **erst nach** aktiver Einwilligung laden, nicht vorab mit
  „deaktiviertem" Zustand.
- Der Banner braucht eine **gleichwertige Ablehnen-Schaltfläche auf der ersten
  Ebene** — gleiche Gestaltung, gleiche Klickzahl. Ein farbiger „Alle
  akzeptieren"-Button neben einem grauen Textlink ist eine unwirksame
  Einwilligung.
- **Widerruf so einfach wie Erteilung** (Art. 7 Abs. 3 DSGVO): dauerhaft
  erreichbarer Link „Cookie-Einstellungen" im Footer.
- Einwilligung **je Zweck**, nicht pauschal; Consent-Zustand protokollieren.
- Kein „Weitersurfen gilt als Zustimmung", kein Nudging durch Verstecken der
  Ablehnung.

## Server-Side-Tracking ist keine Umgehung

`attribution/references/first-party-tracking.md` beschreibt einen vollständigen
Identity-Stitching-Aufbau (First-Party-Endpunkt, Cross-Subdomain-Merge, CRM-Last-Mile)
**ohne jede Erwähnung von Consent**. Fachlich stark, rechtlich unvollständig:

- Wird zur Wiedererkennung eine ID im Browser abgelegt oder ausgelesen — auch
  first-party, auch per `localStorage`, auch serverseitig gesetzt — greift
  § 25 TDDDG.
- Fingerprinting ohne Speicherzugriff umgeht das Gesetz nicht: Es ist Zugriff
  auf Informationen im Endgerät und zudem als Profilbildung
  DSGVO-rechtfertigungsbedürftig.
- Das Zusammenführen von anonymem Verlauf mit einer identifizierten Person
  (`identify()`-Merge) ist eine eigene Verarbeitung mit eigener Rechtsgrundlage
  und Informationspflicht.

Umsetzbar bleibt der Aufbau — aber gesteuert vom Consent-Signal: ohne
Einwilligung kein Merge, kein Journey-Speicher, allenfalls aggregierte,
nicht rückführbare Messung.

## Werbeplattformen

- **Meta CAPI / Google Enhanced Conversions / Customer Match:** gehashte
  E-Mail-Adressen sind personenbezogene Daten. Hashing ist eine
  Sicherheitsmaßnahme, keine Anonymisierung. Es braucht Einwilligung, und die
  Plattformen verlangen das über ihre eigenen EU-Nutzereinwilligungsrichtlinien
  ohnehin — Verstoß bedeutet Kontosperre zusätzlich zum Rechtsrisiko.
- **Google Consent Mode v2** ist Pflicht für EWR-Traffic, ersetzt aber die
  Einwilligung nicht. Modellierte Conversions sind eine Schätzung ohne
  Einwilligung, kein Ersatz für sie.
- **Drittlandtransfer:** US-Anbieter sind über den EU-US Data Privacy Framework
  nur gedeckt, wenn der konkrete Anbieter zertifiziert ist. Prüfen und
  dokumentieren; sonst Standardvertragsklauseln plus Transfer Impact Assessment.
- **AVV nach Art. 28 DSGVO** für jedes Tool, das in unserem Auftrag
  personenbezogene Daten verarbeitet — Analytics, ESP, CRM, Chat, Session
  Recording. Ohne AVV ist schon die Nutzung rechtswidrig.

## A/B-Tests

`ab-testing` empfiehlt Client-Side-Tools. Diese setzen Cookies zur
Varianten-Zuordnung → einwilligungspflichtig, mit der unangenehmen Folge, dass
nur ein Teil des Traffics in den Test läuft und die Stichprobe verzerrt.

Sauberer Weg: **serverseitiges Bucketing ohne persistente Wiedererkennung** oder
Zuordnung über eine ohnehin bestehende Session-/Nutzer-ID im eingeloggten
Bereich (dort Art. 6 Abs. 1 lit. f für Produktverbesserung, mit
Widerspruchsmöglichkeit und Dokumentation im Verzeichnis der
Verarbeitungstätigkeiten).

## Datenquellen und Anreicherung

Für `prospecting`, `competitor-profiling`, `customer-research`:

- **Öffentlich zugänglich ≠ frei verwendbar.** Auch öffentliche Berufsdaten sind
  personenbezogene Daten. Rechtsgrundlage in der Regel Art. 6 Abs. 1 lit. f mit
  dokumentierter Abwägung.
- **Art. 14 DSGVO** — bei Daten, die nicht bei der betroffenen Person erhoben
  wurden, besteht Informationspflicht: spätestens bei der ersten Kommunikation,
  längstens einen Monat nach Erhebung. Inklusive Angabe der **Datenquelle**.
  Diese Pflicht ist der häufigste blinde Fleck beim Listenaufbau.
- **Scraping und AGB:** LinkedIn, Xing und die meisten Portale untersagen
  automatisiertes Auslesen. Der Skill nennt das für LinkedIn korrekt als
  Ausschlusskriterium — es gilt breiter.
- **Anreicherungsdienste (Waterfall-Enrichment):** Der Anbieter muss seinerseits
  eine Rechtsgrundlage und die Art.-14-Information sicherstellen können. Wer das
  nicht schriftlich zusagt, ist als Quelle unbrauchbar.
- **Löschkonzept:** Aufbewahrung nur solange erforderlich; Widerspruch nach
  Art. 21 DSGVO führt bei Direktwerbung ohne Abwägung zur Beendigung der
  Verarbeitung, inklusive Sperrliste, damit der Kontakt nicht beim nächsten
  Listenimport wieder auftaucht.

## Automatisierte Entscheidungen

`revops` beschreibt Lead-Scoring mit Schwellenwerten und automatischer
Aussteuerung. Art. 22 DSGVO wird relevant, sobald **allein automatisiert**
entschieden wird und das für die Person rechtliche Wirkung oder eine
vergleichbar erhebliche Beeinträchtigung hat — etwa automatische Ablehnung,
individuelle Preisgestaltung oder Ausschluss von einem Angebot.

Reine Priorisierung einer Vertriebswarteschlange mit menschlicher
Kontaktaufnahme fällt regelmäßig nicht darunter. Der praktische Riegel: eine
echte menschliche Prüfmöglichkeit an der Stelle vorsehen, an der die Entscheidung
für den Betroffenen spürbar wird.
