# Einwilligung: E-Mail, SMS, Telefon

Der zentrale Unterschied zu den US-Skills. `cold-email`, `prospecting`, `sms`
und `emails` gehen von CAN-SPAM/TCPA aus — dort ist Werbung im Grundsatz
erlaubt und wird durch Opt-out begrenzt. In Deutschland ist es umgekehrt:
Werbung per elektronischer Post ist verboten, solange keine Einwilligung
vorliegt.

## § 7 UWG in einem Satz

E-Mail- und SMS-Werbung ohne **vorherige ausdrückliche Einwilligung** des
Adressaten ist eine unzumutbare Belästigung (§ 7 Abs. 2 UWG) — **auch im B2B**.
Es gibt keine Ausnahme für „geschäftliche Empfänger", „nur eine einzige Mail",
„relevantes Angebot" oder „berechtigtes Interesse".

**Warum DSGVO-Argumente hier nicht helfen:** `prospecting/references/compliance.md`
stützt Kaltakquise auf Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse). Das
ist für die *Datenverarbeitung* vertretbar, sagt aber nichts über die
*Zulässigkeit des Versands*. Beides muss erfüllt sein. Die DSGVO erlaubt dir,
die Adresse zu speichern; das UWG entscheidet, ob du sie anschreiben darfst.

**Folgen:** Abmahnung durch Mitbewerber oder Verbände (§ 8 UWG) mit
Unterlassungserklärung und Vertragsstrafe, Kostenerstattung, in Wiederholung
schnell vierstellig je Fall. Bei Telefonwerbung zusätzlich Bußgeld bis
300.000 € (§ 20 UWG).

## Die vier zulässigen Wege

### 1. Ausdrückliche Einwilligung (Regelfall)

Anforderungen (Art. 4 Nr. 11, Art. 7 DSGVO + § 7 UWG):

- **Aktive Handlung** — kein vorangekreuztes Kästchen, keine Einwilligung per AGB.
- **Getrennt** von anderen Erklärungen; ein eigenes Feld, nicht in den AGB versteckt.
- **Bestimmt** — Zweck, Absender und Art der Werbung benannt.
- **Freiwillig** — siehe Kopplungsverbot unten.
- **Nachweisbar** — Art. 7 Abs. 1 DSGVO. Der Nachweis muss den konkreten
  Vorgang belegen, nicht nur „Häkchen war gesetzt".
- **Jederzeit widerrufbar**, so einfach wie die Erteilung.

### 2. Double-Opt-In (der Nachweisweg)

Ohne Double-Opt-In lässt sich in einem Streit praktisch nicht belegen, dass der
Inhaber der Adresse selbst eingewilligt hat (BGH, Urt. v. 10.02.2011 –
I ZR 164/09). Ablauf:

1. Eintragung im Formular → **noch keine Werbung senden**.
2. Bestätigungsmail, die selbst **keine Werbung** enthalten darf — nur den
   Bestätigungslink und die Angabe, worum es geht.
3. Klick auf den Link → Einwilligung wirksam.
4. Protokollieren und aufbewahren: Zeitstempel Anmeldung, Zeitstempel
   Bestätigung, IP-Adresse, Formular-URL und der **exakt angezeigte
   Einwilligungstext in der damaligen Fassung**. Ein späterer Textstand ist
   als Nachweis wertlos.

Aufbewahrung: solange die Einwilligung genutzt wird, plus Verjährung.

### 3. Bestandskundenausnahme (§ 7 Abs. 3 UWG)

Der einzige Weg zu Werbe-E-Mail ohne Einwilligung. **Alle vier** Voraussetzungen
müssen zugleich vorliegen:

1. Die E-Mail-Adresse wurde **im Zusammenhang mit dem Verkauf** einer Ware oder
   Dienstleistung vom Kunden erhalten (nicht aus einem Download, nicht aus einem
   Webinar, nicht aus einer Visitenkarte).
2. Beworben werden **eigene, ähnliche** Waren oder Dienstleistungen — kein
   Fremdangebot, keine Themenwechsel.
3. Der Kunde hat **nicht widersprochen**.
4. Der Kunde wurde **bei Erhebung und bei jeder Verwendung** klar und deutlich
   darauf hingewiesen, dass er jederzeit widersprechen kann, ohne dass andere
   als Übermittlungskosten nach Basistarif entstehen.

Praktisch: Diese Ausnahme trägt Reaktivierungs- und Cross-Sell-Mails an eigene
Kunden. Sie trägt **keine** Kaltakquise und keinen allgemeinen Newsletter.

### 4. Telefon

- **B2C:** vorherige **ausdrückliche** Einwilligung. Einwilligungen sind zu
  dokumentieren und fünf Jahre aufzubewahren (§ 7a UWG).
- **B2B:** **mutmaßliche** Einwilligung genügt (§ 7 Abs. 2 Nr. 1 UWG). Die
  Messlatte ist ein aus Sicht des Angerufenen sachliches Interesse am konkreten
  Angebot, erkennbar aus seinem Geschäftsgegenstand — nicht die bloße Tatsache,
  dass er Unternehmer ist. „Wir haben ein passendes Produkt" reicht nicht.

Damit ist das Telefonat der einzige Kaltkanal, der im B2B tragfähig sein kann —
und der richtige Einstieg, wo `cold-email` in DACH nicht funktioniert.

## Kopplungsverbot

Art. 7 Abs. 4 DSGVO: Eine Einwilligung ist nicht freiwillig, wenn die Erfüllung
eines Vertrags von ihr abhängt, obwohl sie dafür nicht erforderlich ist.

Für `lead-magnets` und `free-tools` heißt das: Der Download darf gegen die
E-Mail-Adresse **zur Auslieferung** herausgegeben werden (Art. 6 Abs. 1 lit. b —
das ist keine Einwilligung, sondern Vertragserfüllung). Die
**Newsletter-Einwilligung muss ein separates, optionales Kästchen** sein. „Lade
das PDF herunter und erhalte damit unseren Newsletter" koppelt beides und macht
die Einwilligung angreifbar.

## Pflichtangaben in jeder Werbemail

- Absenderidentität nicht verschleiert, Betreffzeile nicht irreführend
  (§ 6 Abs. 2 TDDDG / § 7 Abs. 2 Nr. 3 UWG).
- Impressumsangaben oder ein klar erkennbarer Link darauf.
- **Abmeldelink in jeder Mail** — ein Klick, ohne Login, ohne Begründung.
  Wirksam umgesetzt, nicht nur angezeigt.
- Hinweis auf das Widerspruchsrecht gegen Direktwerbung (Art. 21 Abs. 2 DSGVO);
  dieses Recht ist absolut und braucht keine Abwägung.

## Textbausteine

**Einwilligung Newsletter (separates Kästchen, nicht vorausgewählt):**

```
[ ] Ich möchte den Newsletter von [Firma] mit Neuigkeiten zu [Themen] per
    E-Mail erhalten. Die Einwilligung kann ich jederzeit über den Abmeldelink
    in jeder E-Mail oder per Nachricht an [E-Mail] widerrufen.
    Hinweise zur Verarbeitung: [Link Datenschutzerklärung].
```

**Bestätigungsmail (Double-Opt-In, werbefrei):**

```
Betreff: Bitte bestätigen Sie Ihre Anmeldung

Sie haben sich am [Datum, Uhrzeit] auf [URL] für den Newsletter von [Firma]
angemeldet. Bitte bestätigen Sie die Anmeldung mit einem Klick:

[Anmeldung bestätigen]

Wenn Sie sich nicht angemeldet haben, ignorieren Sie diese E-Mail — ohne
Bestätigung senden wir Ihnen nichts.

[Impressum]
```

**Hinweis nach § 7 Abs. 3 Nr. 4 UWG (bei Erhebung und in jeder Mail):**

```
Sie erhalten diese E-Mail, weil Sie [Produkt] bei uns bezogen haben. Sie können
der Verwendung Ihrer Adresse für Werbung jederzeit widersprechen, ohne dass
andere als die Übermittlungskosten nach den Basistarifen entstehen:
[Widerspruchslink].
```

## Was das für die Upstream-Skills bedeutet

- `cold-email`: Die Textbausteine bleiben brauchbar — für **US-Empfänger**, für
  **Telefon-/LinkedIn-Erstkontakt** im B2B und für Mails an Empfänger, die
  bereits eingewilligt haben. Als E-Mail-Kaltakquise nach DACH nicht einsetzen.
- `prospecting`: Listenaufbau bleibt zulässig (Art. 6 Abs. 1 lit. f), aber
  Art. 14 DSGVO verlangt Information der Betroffenen spätestens bei der ersten
  Kontaktaufnahme, längstens nach einem Monat. Quelle, Datum und Rechtsgrundlage
  je Kontakt dokumentieren — das empfiehlt der Skill ohnehin.
- `sms`: EU-Abschnitt des Skills ist im Kern richtig. A2P-10DLC, Quiet Hours
  nach Bundesstaat und STOP/HELP-Keywords sind US-Themen; in DACH zählt die
  Einwilligung plus jederzeitiger, einfacher Abmeldeweg.
- `emails`: Sequenzlogik unverändert nutzbar. Einstieg immer über Double-Opt-In
  oder § 7 Abs. 3 UWG absichern.
