---
typ: claude-design-prompt
projekt: calltalent-akademie
name: Masterprompt — Betreiber-Portal Mandanten-Verwaltung
version: 1.0
erstellt: 2026-07-19
einsatz: claude.ai/design (Projekt "Calltalent-Akademie Studenten-Portal", e95f8a0e-e423-41a5-b840-48dd805070ec)
sprache: Deutsch
bezug: src/components/portal/portal-shell.tsx, src/app/portal/mandanten/*, src/lib/platform/schema.ts, src/lib/platform/actions.ts
---

# Masterprompt — Betreiber-Portal: Mandanten-Verwaltung

## 0. Hinweis zur Benutzung

Diesen gesamten Prompt (ab Abschnitt 1) direkt als Chat-Nachricht in **Claude Design** (claude.ai/design) einfügen, im bestehenden Projekt **„Calltalent-Akademie Studenten-Portal"** (`e95f8a0e-e423-41a5-b840-48dd805070ec`) — dort liegen bereits die verwandten Admin-Mockups (`AdminZahlungen.dc.html`, `AdminReporting.dc.html`, `AdminKiGenerator.dc.html`, `AdminImport.dc.html`, `Mandanten.dc.html`, `Sidebar.dc.html` u. a.), damit dieselbe `dc-import`-Wiederverwendung funktioniert. Nach Fertigstellung: die drei erzeugten `.dc.html`-Dateien in Claude Code über den DesignSync-MCP-Import umsetzen lassen (gleicher Ablauf wie bei den Admin-Seiten).

---

## 1. Produkt & Kontext

Calltalent-Akademie ist ein Multi-Tenant-LMS (Kursplattform). Jeder Kunde ("Mandant") bekommt eine eigene Subdomain (`{slug}.calltalent.ai`) mit eigenem Branding. Das **Betreiber-Portal** ist der interne Bereich, mit dem **ausschließlich das Calltalent-Team** (nicht die Kunden!) alle Mandanten verwaltet — Mandanten anlegen, Pakete/Status pflegen, Nutzung und KI-Kosten einsehen, Mandanten löschen.

Gestalte den kompletten Mandanten-Verwaltungsbereich des Betreiber-Portals: drei zusammenhängende Screens (Liste, Anlegen, Detail/Bearbeiten), die zusammen einen in sich geschlossenen Workflow bilden.

## 2. Nicht verhandelbare Marken-/Theming-Regel — WICHTIGSTER PUNKT

Das Betreiber-Portal **darf niemals wie eine Mandanten-Oberfläche aussehen** — bewusster Verwechslungsschutz, weil hier teamweit über ALLE Kunden gleichzeitig verwaltet wird (hohe Fehlerreichweite bei einer Verwechslung). Das ist eine bestehende, bereits umgesetzte Design-Entscheidung, kein neuer Vorschlag.

Deshalb **kein** helles Calltalent-Kundenschema (`#F4F5FA`-Hintergrund, weiße Karten, `#1A1A2E`-Text) verwenden — das ist die Optik der Mandanten- und Admin-Bereiche. Stattdessen:

- **Dunkles Slate-Schema**: Seitenhintergrund `slate-950`, Karten/Panels `slate-900` mit `slate-800`-Rahmen, Fließtext `slate-50`/`slate-300`, sekundärer Text `slate-500`.
- **Einzige Akzentfarbe: Periwinkle `#5663AE`** — für aktiven Sidebar-Eintrag, primäre Buttons, Fokus-Ringe. Keine zweite Akzentfarbe.
- Status-Badges als einzige Ausnahme mit eigener Farbe (siehe 4.1), sonst keine bunten Flächen.
- Schrift: Montserrat (wie im gesamten Projekt), Grundschriftgröße ≥ 16px.
- Radius: gleicher Token wie im Rest des Projekts (`14px` für Karten, kleinere Radien für Buttons/Inputs).
- Icons linienbasiert, einfarbig (lucide-Stil), keine 3D-/bunten Icons.

Falls ein `PortalSidebar.dc.html`-Referenzbaustein im Projekt noch nicht existiert: bitte als eigene Datei mit anlegen (analog `AdminSidebar.dc.html`) — dunkle Sidebar mit Wortmarke „CALLTALENT · PORTAL", Gruppe „Verwaltung" mit den Einträgen **Übersicht** und **Mandanten**, unten ein „Abmelden"-Button. Alle drei Screens binden diesen Baustein per `dc-import` ein (`active="mandanten"`), genau wie die Admin-Screens `AdminSidebar` einbinden.

## 3. Zielgruppe & Aufgabe

Nutzer: Calltalent-Mitarbeiter (Vertrieb/Support/Gründer), nicht die Kunden selbst. Aufgabe: neue Kunden in Minuten anlegen, den Überblick über alle laufenden Mandanten behalten (Paket, Status, Größe), einen einzelnen Mandanten im Detail pflegen (Paket/Status/Domain/Branding), Nutzung und KI-Kosten der letzten Monate nachvollziehen, im Ausnahmefall einen Mandanten vollständig löschen.

## 4. Zu erstellende Screens (3 Dateien + ggf. Sidebar-Baustein)

Alle Zahlen/Werte in den Mockups als `{{ platzhalter }}`-Bindings anlegen (kein `DCLogic`-Demo-Datensatz mit erfundenen Werten wie "1.284 Teilnehmer") — die App füllt diese aus echten Datenbankwerten, ein unrealistischer Demo-Wert würde bei der Umsetzung nur wieder verworfen.

### 4.1 `Mandanten.dc.html` — Mandantenliste

Bereits vorhanden, bitte im obigen dunklen Schema verfeinern/bestätigen (eine frühere Version dieser Datei nutzte fälschlich das helle Schema — das war ein Fehler, hier korrigieren).

Inhalt pro Zeile/Karte: Avatar-Kachel mit Initiale, Name, Subdomain (`{slug}.calltalent.ai`), Paket-Badge (Trial / Komplett / Enterprise), Status-Badge mit eigener Farbe je Status:
- Aktiv → Grün
- Trial → Amber/Gelb
- Gesperrt → Rot

Zusätzlich: Anzahl aktiver Teilnehmer je Mandant, Erstellungsdatum. Kopfzeile mit Button „+ Neuer Mandant" (führt zu 4.2). Leerer Zustand („Noch keine Mandanten") vorsehen. Sortierung neueste zuerst.

### 4.2 `MandantenNeu.dc.html` — Mandant anlegen

Formular, Ziel: „Formular ausfüllen → Absenden → Mandant sofort erreichbar" (unter 5 Minuten).

Felder (real, keine weiteren erfinden):
- **Name** (Textfeld, z. B. „Muster GmbH")
- **Subdomain/Slug** (Textfeld, Kleinbuchstaben/Ziffern/Bindestriche) — live darunter anzeigen: „Erreichbar unter **{slug}.calltalent.ai**" (aktualisiert sich beim Tippen)
- **Paket**: Radio-Auswahl Trial / Komplett / Enterprise
- **Inhaber-E-Mail (optional)** — Hinweistext: „Leer lassen = Mandant ohne Inhaber anlegen (z. B. interner Test-Mandant). Ausfüllen = Owner-Konto wird direkt mit angelegt, Einladungsmail wird verschickt."

Primärer Button „Mandant anlegen". Bei Erfolg: Weiterleitung zu 4.3 (Detailseite des neuen Mandanten) — im Mockup als Hinweis „→ nach Erfolg: Weiterleitung zur Detailseite" kommentieren, kein eigener Erfolgs-Screen nötig.

### 4.3 `MandantenDetail.dc.html` — Mandant im Detail

Umfangreichste Seite, in klar getrennte Abschnitte gegliedert:

**Kopfbereich:** Name, Subdomain, Status-Badge, Paket-Badge, „Angelegt am {{ datum }}".

**Bearbeiten (Formular):** Name, Paket (Radio Trial/Komplett/Enterprise), Status (Radio Aktiv/Trial/Gesperrt), Custom Domain (optionales Textfeld, Hinweis „Nur Eintrag des Feldes — DNS/SSL-Einrichtung erfolgt separat"). Button „Änderungen speichern".

**Zusätzliche Domains:** Liste bereits hinterlegter Zusatz-Domains (Domain-Text + Löschen-Symbol je Zeile) plus ein Feld zum Hinzufügen einer weiteren Domain.

**Branding & Theming:** 4 Farb-Swatches zur Auswahl (Periwinkle `#5663AE`, Blau `#2A6FDB`, Grün `#1F8A5B`, Terrakotta `#B4682A`) — das ist die Akzentfarbe, die DER MANDANT (nicht das Portal) in seiner eigenen, hellen Oberfläche sieht, hier im dunklen Portal nur als kleine Vorschau-Kachel je Swatze zeigen. Dazu ein Radius-Schieberegler 4–24px mit Live-Vorschau (ein kleines Rechteck, das den gewählten Radius zeigt).

**Nutzungsübersicht (nur lesend):**
- Aktive Teilnehmer (Zahl)
- Kurse gesamt (Zahl)
- Diesen Monat: Tutor-Antworten, Kurs-Generierungen (aus `usage_counters`)
- KI-Kosten letzte 90 Tage, aufgeschlüsselt nach Art — Tabelle mit Spalten „Art" (Kurs-Generierung / Quiz-Generierung / Transkript / Zusammenfassung / Embeddings / Untertitel-Übersetzung) und „Kosten (USD, 4 Nachkommastellen)"

**Gefahrenzone:** eigener, visuell abgesetzter Abschnitt (z. B. roter Rahmen statt Slate) mit „Mandant endgültig löschen" — Bestätigungs-Interaktion vorsehen (z. B. Tippen des Mandantennamens zur Bestätigung), da unumkehrbar.

## 5. Navigation — Rückweg zur Übersicht (wichtiger Teil dieses Auftrags)

Jede der drei Seiten muss einen eindeutigen, direkt sichtbaren Weg zurück bieten — nicht nur über die Sidebar:

- **`MandantenNeu.dc.html`** und **`MandantenDetail.dc.html`**: oben, direkt über der Überschrift, einen Breadcrumb **„Mandanten"** (verlinkt zurück zu 4.1) gefolgt vom aktuellen Kontext — bei der Detailseite zusätzlich `/ {{ mandantName }}`.
- Zusätzlich in der `PortalSidebar` (siehe Abschnitt 2) den Menüpunkt **„Übersicht"** klar sichtbar über „Mandanten" platzieren, damit von jeder Unterseite aus ein Klick zurück zur Portal-Startseite führt.

## 6. Abgrenzung — nicht tun

1. Kein helles Schema, keine zweite Akzentfarbe außerhalb Periwinkle.
2. Keine erfundenen Kennzahlen/Demo-Werte — alle Zahlen als Bindings.
3. Keine neuen Funktionen erfinden, die hier nicht beschrieben sind (kein Abo-Verwaltung, keine Rechnungsstellung o. Ä. — das existiert an dieser Stelle nicht).
4. Den bestehenden `AdminSidebar`/hellen Mandanten-/Admin-Bereich nicht verändern — reine Ergänzung um die Portal-Mandanten-Screens.

## 7. Ablage

Alle Dateien im Projekt „Calltalent-Akademie Studenten-Portal" ablegen:
`Mandanten.dc.html`, `MandantenNeu.dc.html`, `MandantenDetail.dc.html` (+ `PortalSidebar.dc.html`, falls neu). Gleiches `dc-import`/`sc-for`/`sc-if`-Templating-Muster wie in den bestehenden Admin-Mockups verwenden.
