# Masterprompt — Kurs-Editor (fehlendes Design)

Zum Einfügen in **claude.ai/design**, Projekt „Calltalent-Akademie Studenten-Portal"
(`e95f8a0e-e423-41a5-b840-48dd805070ec`).

**Warum:** Das Design-Projekt hat `AdminKurse.dc.html` (die Kurs*liste*), aber **keine Datei
für den Editor dahinter** (`/admin/kurse/[id]`). Der Editor ist deshalb der einzige Bereich
der Anwendung ohne Marken-Design — graue Standard-Kästen. Die neue Video-Aufnahme erbt
dieses Nichts.

---

## PROMPT (ab hier alles kopieren)

Du gestaltest den **Kurs-Editor** der Calltalent-Akademie — den einzigen Bereich, für den
es noch kein Design gibt. Erzeuge `.dc.html`-Dateien im exakten Stil der bereits
vorhandenen Dateien dieses Projekts (`AdminKurse.dc.html`, `Admin.dc.html`,
`KursUebersicht.dc.html`).

### Produkt

Mehrmandanten-Lernplattform (LMS) für Vertriebstrainings, deutsche UI. Ein Kurs-Autor legt
Kurse an, gliedert sie in Module und Lektionen und füllt Lektionen mit Inhalts-Blöcken.
Neu hinzugekommen: Video **direkt im Browser aufnehmen**, grob **schneiden**, und
**KI-Untertitel**. Genau dafür fehlt das Design.

### Design-System — verbindlich, nicht neu erfinden

```
Akzent/Primär   #5663AE      Navy/dunkel     #3E3F66
Ink/Text        #1A1A2E      Seiten-BG       #F4F5FA
Creme           #F7EED4      Weiß            #FFFFFF
Rahmen          #E7E8F2  #E0E2EF  #D8DAEA  #EEF0F7
Gedämpft        #66679B  #A9AAC4  #B9BBDA  #C9CBE6
Erfolg/Grün     #1F8A5B auf #E3F2EA        Fortschritt-Ring #8BE0B7
```

- **Schrift:** Montserrat (400/500/600/700/800), Basis 18px, `line-height:1.6`
- **Radien:** Chips/Buttons `10–11px`, Karten `14px`, große Flächen `16–18px`
- **Karten:** `background:#fff; border:1px solid #E7E8F2; border-radius:14px`
- **Primär-Button:** `background:#5663AE; color:#fff; font-weight:700; padding:12px 18px; border-radius:11px`
- **Sekundär-Button:** `background:#fff; color:#3E3F66; border:1px solid #E7E8F2; border-radius:10px`
- **Status-Chips:** Live `#1F8A5B` auf `#E3F2EA` · Entwurf `#1A1A2E` auf `#F7EED4` · Archiviert `#66679B` auf `#EEF0F7`
- **Platzhalter-Flächen** (Video/Thumbnails) als diagonale Streifen, nie als Fake-Foto:
  `background-color:#DFE2F4; background-image:repeating-linear-gradient(45deg,#DFE2F4 0 9px, rgba(255,255,255,.55) 9px 18px)`
- Icons: schlichte Stroke-SVGs (Lucide-Stil), `stroke-width` 2–2.4

### Datei-Konventionen — exakt einhalten

- `<x-dc>`-Wrapper, `<helmet>` mit Montserrat-Link und
  `<style>* { box-sizing: border-box; } body { margin: 0; } a { color:#5663AE; } a:hover { color:#3E3F66; }</style>`
- **Nur Inline-Styles**, keine CSS-Klassen
- Admin-Seiten binden die Sidebar so ein und haben einen **eigenen Inline-Header**
  (Admin-Seiten nutzen **kein** `TopBar`!):
  ```html
  <dc-import name="AdminSidebar" active="courses" hint-size="264px,100vh"></dc-import>
  ```
  Header-Muster: kleine Brotkrume (`13px`, `600`, `#A9AAC4`) über einer `26px`/`800`-H1.
- Listen über `<sc-for list="{{ rows }}" as="r" hint-placeholder-count="4">`
- Daten unten in `<script type="text/x-dc" data-dc-script data-props="{&quot;$preview&quot;:{&quot;width&quot;:1440,&quot;height&quot;:900}}">`
  als `class Component extends DCLogic { renderVals() { return { … }; } }`

### Datenmodell — daran halten, nichts dazuerfinden

- Hierarchie ist **Kurs → Modul → Lektion**. Es gibt **KEINE „Sektionen"** zwischen Modul
  und Lektion. Erfinde diese Ebene nicht.
- Block-Typen exakt diese neun: **Text, Bild, Video, Audio, Datei, Quiz, Abgabe,
  Hinweisbox, Einbettung**
- Ein Video-Block kennt genau **ein** Video. Es gibt keine Video-Titel, keine Poster,
  keine Kapitelbilder im Block.
- Lektions-Status: **Entwurf / Veröffentlicht**. Kurs-Status: **Entwurf / Live / Archiviert**.
- Kurs-Kategorien: **Vertrieb, Telefonie, Abschluss, Mindset**
- Es gibt **keine Coach-/Trainer-Stammdaten** — keine Coach-Karten, keine Autoren-Fotos.

### Barrierefreiheit — harte Produktanforderung, kein Extra

**Der Auftraggeber ist sehbehindert.** WCAG 2.1 AA ist Pflicht:

- Kontrast ≥ 4,5:1 für jeden Text. Gedämpftes Grau **nie** für wichtige Information.
- Jedes Bedienelement ist ein sichtbarer, beschrifteter Button oder ein Feld mit
  sichtbarem Label — **keine reinen Icon-Buttons ohne Text**, keine Platzhalter statt Labels.
- Zustand nie nur über Farbe: roter Punkt **immer** mit dem Wort „Aufnahme läuft".
- Sichtbare Fokus-Ringe mitdenken.
- **Der Schnitt-Editor darf KEIN Drag-Timeline sein.** Ziehbare Griffe sind mit Tastatur und
  Screenreader unbedienbar — für den Hauptnutzer also wertlos. Gestalte ihn als
  **Liste von Abschnitten mit Zeit-Eingabefeldern** (`mm:ss`) und echten Buttons. Eine
  Timeline-Leiste ist erlaubt, aber nur als **zusätzliche Anzeige**, nie als einzige Bedienung.

---

## Zu erzeugende Dateien

### 1. `AdminKursEditor.dc.html` — der Editor (Hauptdatei)

Kopfzeile: Brotkrume „Inhalte · Kurse", H1 = Kurstitel, rechts Status-Auswahl (Entwurf/Live/
Archiviert), Kategorie-Auswahl, Link „Zurück zur Kursliste".

Darunter **zwei Spalten** (links ca. 300px, rechts flexibel):

**Links — Modul-/Lektionsbaum:**
- Je Modul eine Karte: Modultitel, kleine Hoch/Runter/Löschen-Steuerung
- Darin die Lektionen als Zeilen mit Titel + Status-Chip (Entwurf/Veröffentlicht)
- Die **aktive Lektion deutlich hervorgehoben** (nicht nur farblich — z. B. linker
  Akzentbalken + kräftigere Schrift)
- Je Modul ein Feld „Neue Lektion …" mit `+`-Button; unten „Neues Modul …" mit `+`

**Rechts — Lektions-Editor:**
- Lektionstitel als großes Eingabefeld **mit sichtbarem Label „Lektionstitel"**, daneben
  ein dezenter Speicher-Status („Gespeichert")
- Darunter die Blöcke als Karten. Zeige beispielhaft: einen **Text**-Block und einen
  **Video**-Block. Jede Block-Karte hat oben rechts Hoch/Runter/Entfernen.
- **Block-Leiste** unten: die vier häufigsten zuerst — `+ Text` `+ Video` `+ Bild` `+ Quiz` —
  und die übrigen fünf hinter einem aufklappbaren „Weitere Blöcke" (Audio, Datei, Abgabe,
  Hinweisbox, Einbettung). Neun gleichwertige Buttons sind zu viel Suchaufwand.
- Fußzeile: „Veröffentlichen" / „Auf Entwurf setzen" und „Lektion löschen" (rechts, dezent rot)

Der **Video-Block im leeren Zustand** zeigt eine Umschaltung mit zwei gleichwertigen
Optionen: **„Video hochladen"** und **„Video aufnehmen"** (als Segment-Control, beide
sichtbar beschriftet), darunter die passende Fläche (Datei-Auswahl bzw. Start der Aufnahme).

### 2. `AdminVideoAufnahme.dc.html` — die Aufnahme, drei Zustände untereinander

Rahmen wie oben (AdminSidebar + Header „Inhalte · Kurse · Aufnahme").

**a) Bereit:** Auswahl **„Bildschirm"** oder **„Webcam"** (Segment-Control), großer Button
„Aufnahme starten", darunter ein Hinweis, dass Mikrofon-Zugriff nötig ist.

**b) Läuft:**
- Feste 16:9-Fläche. **Wichtig:** Bei **Webcam** zeigt sie das Kamerabild. Bei
  **Bildschirm** zeigt sie **bewusst KEIN Vorschaubild**, sondern eine ruhige Fläche mit dem
  Text „Dein Bildschirm wird aufgezeichnet" — eine Vorschau würde sich selbst abfilmen und
  flimmern. Gestalte diese Fläche so, dass sie nicht wie ein Fehler wirkt.
- Zeile darunter: roter Punkt **+ Text „Aufnahme läuft"**, Timer (`mm:ss`), Dateigröße,
  Button „Aufnahme beenden".
- **Mikrofon-Pegelanzeige** — eine schmale Balkenreihe, die zeigt, dass Ton wirklich ankommt.
  Das ist die einzige Rückmeldung gegen eine stumme Aufnahme. Zeige auch den Warnzustand
  „Kein Ton erkannt".
- Hinweis-Zustand ab 15 Minuten: „Noch 5 Minuten bis zum Limit (20 Minuten)".

**c) Fertig:** Wiedergabe der Aufnahme in derselben 16:9-Fläche, Dauer, und vier klar
beschriftete Aktionen: **Verwenden · Zuschneiden · Neu aufnehmen · Verwerfen**.
Zusätzlich ein Upload-Fortschritt (Balken + Prozent) als eigener Zustand.

### 3. `AdminVideoSchnitt.dc.html` — der Schnitt

**Kein Drag-Timeline** (siehe Barrierefreiheit).

- Oben die Videovorschau (16:9) mit Wiedergabe-Steuerung und aktueller Position.
- Darunter eine **Liste der zu behaltenden Abschnitte**. Je Zeile:
  Abschnittsnummer, zwei Zeitfelder **„Start"** und **„Ende"** (`mm:ss`, mit sichtbaren
  Labels), je ein Button „Position übernehmen", sowie „Abschnitt teilen" und „Abschnitt
  entfernen".
- Darunter eine rein **anzeigende** Timeline-Leiste, die behaltene und entfernte Bereiche
  farblich zeigt (ergänzend, nicht bedienbar).
- Hinweistext: „Schnitte erfolgen am nächsten Keyframe (bis ~2 Sekunden Abweichung) — dafür
  ohne Qualitätsverlust." Und nach dem Schnitt eine Rückmeldung der **tatsächlichen**
  Schnittzeit.
- Fußzeile: Gesamtlänge nach Schnitt, „Zuschnitt übernehmen", „Abbrechen".

### 4. `AdminVideoUntertitel.dc.html` — Untertitel-Status (klein)

Als Karte innerhalb des Video-Blocks gedacht:
- Zeile „Deutsch" mit Status-Chip: **Wird erstellt … / Fertig / Fehlgeschlagen**
- Zeile „Englisch" mit denselben Zuständen
- Sekundär-Button „Untertitel & Transkript aktualisieren"
- Dezenter Hinweis, dass Untertitel automatisch nach dem Upload erzeugt werden

---

## Harte Regeln

1. **Erfinde keine Funktion**, die oben nicht steht — keine Kommentare, keine Emojis, keine
   Sterne-Bewertungen, keine Coach-Karten, keine Sektionen.
2. **Keine erfundenen Zahlen** an Stellen, die echte Daten zeigen. Beispieldaten in
   `renderVals()` sind erwünscht, aber realistisch und deutsch.
3. **Keine toten Links.** Wenn etwas kein Ziel hat, gestalte es nicht als Link.
4. Deutsche UI-Texte durchgehend, „du"-Ansprache wie im übrigen Projekt.
5. Vorschaubreite 1440px.
6. Nutze durchgehend das Design-System oben — keine neuen Farben, keine neuen Radien.

Erzeuge die vier Dateien.

## PROMPT ENDE
