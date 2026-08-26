# Website- und Vertragspflichten

Betrifft `site-architecture`, `signup`, `paywalls`, `pricing`, `offers`,
`churn-prevention`, `cro`, `popups`.

## Pflichtseiten

`site-architecture/references/navigation-patterns.md` zeigt Footer mit
„Privacy · Terms · Contact". Für einen deutschen Auftritt fehlt darin das
Wichtigste.

| Seite | Grundlage | Anforderung |
|---|---|---|
| **Impressum** | § 5 DDG (seit 14.05.2024, ersetzt § 5 TMG) | Von jeder Seite **unmittelbar erreichbar**, klar als „Impressum" bezeichnet. Name, Anschrift (kein Postfach), E-Mail und ein zweiter schneller Kontaktweg, Register und Registernummer, USt-IdNr., Vertretungsberechtigte |
| **Verantwortlicher i. S. d. MStV** | § 18 Abs. 2 MStV | Zusätzlich bei journalistisch-redaktionellen Inhalten — der Blog fällt regelmäßig darunter |
| **Datenschutzerklärung** | Art. 13, 14 DSGVO | Eigene Seite, von jeder Seite erreichbar, vollständig zu allen eingesetzten Diensten |
| **Cookie-Einstellungen** | Art. 7 Abs. 3 DSGVO | Dauerhaft erreichbarer Widerrufsweg, so einfach wie die Erteilung |
| **AGB** | — | Keine allgemeine Pflicht, praktisch aber erforderlich |
| **Widerrufsbelehrung + Muster-Formular** | Art. 246a EGBGB | Pflicht bei Verbraucherverträgen im Fernabsatz |
| **Barrierefreiheitserklärung** | BFSG, seit 28.06.2025 | Bei B2C-Dienstleistungen im elektronischen Geschäftsverkehr |

Faustregel für Menüführung: Impressum und Datenschutzerklärung gehören in den
Footer **jeder** Seite, auch auf Landingpages, die aus Conversion-Gründen sonst
navigationsfrei gebaut werden. Eine Landingpage ohne Impressum ist der
klassische Abmahnfall.

## Buttonlösung — § 312j Abs. 3 BGB

Bei Verbraucherverträgen im elektronischen Geschäftsverkehr über eine
entgeltliche Leistung muss die Schaltfläche, die die Bestellung auslöst,
**ausschließlich** mit „zahlungspflichtig bestellen" oder einer entsprechend
eindeutigen Formulierung beschriftet sein („Kostenpflichtig bestellen",
„Zahlungspflichtigen Vertrag schließen").

`paywalls/SKILL.md:91` empfiehlt „Start Getting [Benefit]", `signup/SKILL.md:301`
stellt „Get Started" zur Wahl. Auf einem zahlungsauslösenden Button ist das in
Deutschland unzulässig — und die Rechtsfolge ist scharf: Der Vertrag kommt
**nicht zustande** (§ 312j Abs. 4 BGB).

Unmittelbar vor dem Button sind zudem klar und hervorgehoben anzugeben:
wesentliche Merkmale, Gesamtpreis, Laufzeit und Mindestlaufzeit.

Nicht betroffen: Buttons ohne Zahlungsauslösung — „Kostenlos testen" bei einem
Trial ohne Zahlungspflicht, „Konto erstellen", „Demo buchen". Dort bleibt die
Conversion-Optimierung der Skills uneingeschränkt anwendbar. Achtung beim Trial,
der automatisch in ein kostenpflichtiges Abo übergeht: Dann liegt eine
entgeltliche Bestellung vor.

## Kündigungsbutton — § 312k BGB

Bei Verbraucherverträgen über ein Dauerschuldverhältnis, die über eine Website
geschlossen werden können, muss dort auch gekündigt werden können:

- Schaltfläche „**Verträge hier kündigen**", ständig verfügbar, unmittelbar und
  leicht zugänglich — nicht erst nach Login.
- Danach eine Bestätigungsseite mit den Angaben zur Kündigung und eine
  Schaltfläche „**Jetzt kündigen**".
- Sofortige Bestätigung des Zugangs in Textform, mit Zeitpunkt.
- Rechtsfolge bei Verstoß: Der Verbraucher kann **jederzeit und fristlos**
  kündigen (§ 312k Abs. 6 BGB).

Das kollidiert direkt mit `churn-prevention/references/cancel-flow-patterns.md`:

- Zeile 60 — „Block self-serve cancel, require CS call" ab 2.000 $/Monat:
  im B2C unzulässig.
- Zeile 49 — Kündigung nur durch Admin/Owner: im B2C als Zugangshürde
  problematisch.
- Der Abschnitt „Compliance Notes" nennt die FTC-Regel, nicht § 312k BGB.

Weiter zulässig bleiben: Exit-Survey und Save-Offer **auf dem Weg**, solange
der Weg zur Kündigung durchgehend klar, gleichrangig sichtbar und ohne
zusätzliche Hürde bleibt. Im **B2B** greift § 312k nicht — dort sind die
Muster des Skills anwendbar, sollten aber vertraglich sauber abgebildet sein.

## Preisangaben — PAngV

- **§ 3 PAngV:** Gegenüber Verbrauchern ist der **Gesamtpreis inklusive
  Umsatzsteuer** und aller Preisbestandteile anzugeben. Eine reine
  Netto-Preistabelle ist nur zulässig, wenn sich das Angebot ausschließlich an
  Unternehmer richtet — und das muss unmissverständlich erkennbar sein.
- **§ 11 PAngV:** Bei Werbung mit einer Preisermäßigung ist der **niedrigste
  Gesamtpreis der letzten 30 Tage** anzugeben und als Bezugspunkt zu verwenden.
  Damit sind Dauerstreichpreise und ein frei erfundener „Normalpreis"
  ausgeschlossen — relevant für `pricing` und `offers`.
- Bei Abonnements: Preis pro Abrechnungszeitraum, Laufzeit, Verlängerung und
  Kündigungsfrist klar erkennbar. Die im `pricing`-Skill übliche Darstellung
  „19 €/Monat" bei jährlicher Vorauszahlung braucht den unmittelbaren Zusatz zur
  tatsächlichen Zahlungsweise und Summe.

## Widerrufsrecht bei digitalen Produkten

Für Kurse und digitale Inhalte an Verbraucher:

- 14 Tage Widerrufsfrist, Belehrung vor Vertragsschluss.
- Das Widerrufsrecht bei digitalen Inhalten erlischt vorzeitig nur, wenn der
  Verbraucher **ausdrücklich zustimmt**, dass mit der Ausführung vor Ablauf der
  Frist begonnen wird, **und** bestätigt, dass er damit sein Widerrufsrecht
  verliert — beides ist zu dokumentieren (§ 356 Abs. 5 BGB).
- „Sofort-Zugang" ohne diese Doppelbestätigung bedeutet: 14 Tage volles
  Widerrufsrecht trotz vollständiger Nutzung.

## Barrierefreiheit — BFSG

Seit 28.06.2025 gilt das Barrierefreiheitsstärkungsgesetz für
Dienstleistungen im elektronischen Geschäftsverkehr gegenüber Verbrauchern.
Maßstab ist EN 301 549, praktisch WCAG 2.1 AA. Ausnahme für Kleinstunternehmen
(< 10 Beschäftigte **und** ≤ 2 Mio. € Jahresumsatz) — bei Dienstleistungen.

Für dieses Projekt ohnehin verbindlich: CLAUDE.md 3.4 schreibt WCAG 2.1 AA fest.
Marketing-Artefakte sind mitgemeint — Landingpages, Popups, PDFs aus
`lead-magnets`, Videos aus `video` (Untertitel), Bilder aus `image`
(Alternativtexte), Farbkontraste aus `ad-creative`. Ein Popup ohne
Tastaturbedienung und Fokusfalle ist zugleich ein CRO- und ein
Barrierefreiheitsproblem.
