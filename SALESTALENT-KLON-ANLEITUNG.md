# SalesTalent.app — Anleitung: Internationale Marke auf neuer Domain

Stand: 30.07.2026. Grundlage: Gespräch mit Josip, drei Entscheidungen bereits getroffen (siehe Abschnitt 1).

## 1. Entscheidungslage (bereits getroffen)

1. **Architektur:** Kein Code-Fork. `salestalent.app` wird ein **neuer Mandant** auf derselben Plattform (gleiches Supabase-Projekt, gleicher Cloudflare Worker `calltalent-akademie`). Ein Codebase, ein Deploy, Sicherheitsfixes gelten sofort für beide Marken.
2. **Inhalte:** Mandant startet **leer**. Kurse/Nutzer werden später separat für den internationalen Markt aufgebaut.
3. **Rechtsträger:** **Noch offen.** Technischer Aufbau läuft schon jetzt, Impressum/AGB/Datenschutz für salestalent.app müssen aber vor dem ersten echten (nicht-internen) Zugriff geklärt sein — siehe Schritt 6.

## 2. Was "Klonen" hier NICHT bedeutet

Kein zweites Git-Repo, keine zweite Datenbank, kein zweiter Worker. Die Plattform ist von Anfang an mandantenfähig gebaut (`supabase/migrations/0001_init.sql`, RLS auf allen Tabellen) — genau dafür ist ein neuer Mandant der eingebaute, richtige Mechanismus, nicht ein Sonderweg.

## 3. Wichtiger ehrlicher Hinweis: zwei getrennte Aufgaben, sehr unterschiedliche Größe

**Aufgabe A — Domain + Mandant technisch einrichten:** Ein paar Stunden Arbeit, unten Schritt für Schritt beschrieben.

**Aufgabe B — Die Plattform-Oberfläche wirklich auf Englisch:** Ein eigenes, größeres Projekt. Grund: `src/i18n/request.ts` hat aktuell **fest** `const locale = "de"` codiert, nur `messages/de.json` existiert (156 Zeilen — nur Quiz/Zertifikate/Zahlungen/Reporting-Texte). Der **überwiegende Teil der Admin- und Lernoberfläche** (z. B. Portal-Formulare wie `mandant-edit-form.tsx`, `tenant-domains-section.tsx`) enthält deutsche Texte **direkt hartcodiert im JSX** ("Mandant anlegen", "Änderungen speichern" usw.), nicht über next-intl-Übersetzungsschlüssel.

Das heißt konkret: Nach Aufgabe A ist salestalent.app technisch erreichbar, aber Admin-Bereich und große Teile der Lernansicht zeigen weiterhin deutsche Beschriftungen — bis Aufgabe B gemacht ist. Das ist kein Bug, sondern der ehrliche IST-Zustand. Ich empfehle, Aufgabe A jetzt zu machen und Aufgabe B als eigene Phase mit dem `architect`-Agenten zu planen (siehe Abschnitt 5), statt beides zu vermischen.

## 4. Voraussetzung: Cloudflare-Konto prüfen (vor Schritt 1 selbst nachsehen)

Der Worker läuft im Cloudflare-Account `calltalent.ai` (Account-ID `1721e487e86d9139ee900f52e2882622`, in `wrangler.jsonc` fest hinterlegt). Bitte im Cloudflare-Dashboard prüfen:

- Liegt die neu gekaufte Zone `salestalent.app` in **demselben** Account? → Schritt 1 unten ist der einfache Weg.
- Liegt sie in einem **anderen** Cloudflare-Account (z. B. weil beim Kauf ein anderes Login aktiv war)? → Entweder Zone in den Account `calltalent.ai` übertragen (Cloudflare-Dashboard → Domain → "Transfer domain to another account"), oder als Alternative "Cloudflare for SaaS" / Custom Hostname verwenden. Letzteres ist für **fremde** Kunden-Domains gedacht (SPEC.md-Stack-Punkt 7) und normalerweise mit monatlichen Zusatzkosten verbunden — bei einer **eigenen** Domain ist der einfache Weg (gleicher Account, normale Zone) günstiger und einfacher.

## 5. Schritt-für-Schritt: Domain + Mandant technisch einrichten

### Schritt 1 — Cloudflare-Zone aktivieren
1. `salestalent.app` im Cloudflare-Dashboard als Zone bestätigen (bei Kauf über Cloudflare Registrar meist automatisch aktiv).
2. Kein DNS-A/CNAME-Eintrag zeigt hier auf einen Server — der Cloudflare Worker übernimmt die Auslieferung direkt über die `routes` in `wrangler.jsonc` (siehe Schritt 4). Ein Proxy-DNS-Eintrag (grauwolke → orange Wolke, "Proxied") auf `@` und `www` reicht, damit die Route greift.

### Schritt 2 — Neuen Mandanten im Betreiber-Portal anlegen
1. Auf `portal.calltalent.ai` einloggen (Josips Betreiber-Zugang).
2. "Mandanten" → "Neuer Mandant" (`src/app/portal/mandanten/neu/page.tsx`).
3. Name: z. B. `SalesTalent`. Slug: z. B. `salestalent` (ergibt automatisch `salestalent.calltalent.ai` als Fallback-Adresse — praktisch für Tests, bevor die eigene Domain steht).
4. Paket wählen, Inhaber-E-Mail **leer lassen**, solange noch kein echter Kunde angelegt wird (reiner interner Aufbau-Mandant).
5. Absenden → Weiterleitung zur Mandanten-Detailseite.

### Schritt 3 — Custom Domain im Mandanten eintragen
1. Auf der Detailseite des neuen Mandanten: Feld "Custom Domain" → `salestalent.app` eintragen, speichern (`mandant-edit-form.tsx`, Feld `customDomain`).
2. Hinweistext dort ist wörtlich zu nehmen: *"Nur Eintrag des Feldes — DNS/SSL-Einrichtung erfolgt separat außerhalb der App."* Das eigentliche Routing kommt aus `wrangler.jsonc`, nicht aus diesem Formularfeld allein — beide Schritte sind nötig.
3. Falls später zusätzlich `www.salestalent.app` erreichbar sein soll: über den Abschnitt "Zusätzliche Domains" (`tenant-domains-section.tsx`) ergänzen.

### Schritt 4 — Route im Deployment ergänzen
In `wrangler.jsonc`, Abschnitt `routes`, einen Eintrag ergänzen:

```jsonc
"routes": [
  { "pattern": "*.calltalent.ai/*", "zone_name": "calltalent.ai" },
  { "pattern": "academy.calltalent.ai/*", "zone_name": "calltalent.ai" },
  { "pattern": "salestalent.app/*", "zone_name": "salestalent.app" },
  { "pattern": "www.salestalent.app/*", "zone_name": "salestalent.app" }
]
```

**Wichtig (steht auch als Kommentar in der Datei):** `wrangler deploy` überschreibt bei jedem Lauf die komplette Remote-Routen-Konfiguration mit dem Inhalt dieser Datei. Der Eintrag muss **hier** stehen, nicht nur im Dashboard — sonst nimmt der nächste Deploy ihn wieder weg.

Danach: `npm run deploy` (führt `opennextjs-cloudflare build && opennextjs-cloudflare deploy` aus).

### Schritt 5 — Branding auf Englisch setzen (funktioniert schon heute, ohne Code-Änderung)
Diese Felder sind bereits pro Mandant frei konfigurierbar und unabhängig vom i18n-Problem aus Abschnitt 3:

- `branding.login_heading`, `branding.login_subheading`, `branding.login_copyright` (Login-Seite, Mandanten-Einstellungen)
- `branding.logo_url`, `branding.color_primary` usw. (Marken-Look)
- `settings.support_email`

Alles davon kann sofort auf Englisch gesetzt werden, ohne auf Aufgabe B (Abschnitt 3) zu warten.

### Schritt 6 — Rechtstexte (blockiert echten Live-Betrieb, nicht den technischen Test)
`tenant.legal.impressum_url` und `tenant.legal.datenschutz_url` sind bereits als Felder vorgesehen, aber für salestalent.app inhaltlich noch nicht geklärt (siehe Entscheidungslage Punkt 3). Solange kein echter externer Nutzer auf salestalent.app zugreift, ist das kein Blocker für den technischen Testlauf — **wohl aber**, bevor irgendein realer Kunde eingeladen wird. CLAUDE.md-Pflichten, die hier greifen sobald die Rechtsfrage geklärt ist: DSGVO Art. 3/27/28, Impressumspflicht § 5 DDG/ECG, § 5 UWG bei Erfahrungsaussagen.

### Schritt 7 — Testen
1. Lokal: `npm run dev`, Zugriff über `salestalent.localhost:3000` (Dev-Schema, siehe `extractTenantSlugFromHost`).
2. Nach Deploy: `https://salestalent.app` live aufrufen, SSL-Zertifikat prüfen (Cloudflare Universal SSL sollte automatisch für die neue Zone greifen), Login-Seite mit englischem Branding prüfen.
3. `npm run lint`, `npx tsc --noEmit` vor dem Deploy laufen lassen (Projekt-Standard).
4. Playwright-Suite (`npm run e2e`) ist laut PHASENSTATUS.md aktuell wegen fehlendem `demo-blau`-Tenant in der Test-Umgebung nicht lauffähig — für den neuen Mandanten gilt das gleiche Problem, kein neuer Blocker.

## 6. Aufgabe B als eigene Phase planen (nicht Teil dieses Schritts)

Wenn die Oberfläche wirklich vollständig Englisch werden soll, ist das laut Arbeitsweise in `CLAUDE.md` (§4.1) ein Fall für den `architect`-Agenten im Plan Mode, bevor Code geschrieben wird — es betrifft sehr viele Dateien:

1. Bestandsaufnahme: wie viele Komponenten enthalten hartcodierte deutsche Strings (grobe Schätzung nötig, vermutlich mehrere Dutzend Dateien über Admin/Portal/Lernansicht).
2. Migrationsstrategie: entweder schrittweiser Umbau auf next-intl-Keys mit `messages/en.json`, oder — schneller, aber unsauberer — ein zweiter Satz Komponenten nur für englischsprachige Mandanten (nicht empfohlen, doppelte Wartung).
3. Locale-Auflösung pro Mandant: `tenants.settings.default_locale` existiert bereits als Feld im Typ (`src/lib/tenant/types.ts`), wird aber **nirgends** gelesen — `src/i18n/request.ts` müsste umgebaut werden, um den aufgelösten Mandanten zu kennen und `default_locale` statt der fest codierten `"de"` zu verwenden.
4. Automatische Übersetzung von Kursinhalten (Videos/Untertitel) existiert laut PHASENSTATUS.md als "R15-Gate"-Funktion bereits im Code, ist aber **noch nie getestet worden** ("EN-Übersetzung ist noch nie gelaufen"). Vor Nutzung für echte SalesTalent-Kurse: einmal gezielt mit einem echten deutschen Video durchtesten.

Empfehlung: Schritt 1–7 aus Abschnitt 5 jetzt umsetzen (Domain lebt, Mandant ist da), Aufgabe B danach als eigenen Arbeitsblock mit architect-Plan angehen.

## 7. Pflichtschritte nach Umsetzung (laut CLAUDE.md)

1. `PHASENSTATUS.md` um einen neuen Abschnitt "salestalent.app — Mandant angelegt" ergänzen (Erledigt/Offen/Risiken).
2. Eintrag in `Entscheidungs-Log.md` (Calltalent-Ltd-Ebene): Datum, Entscheidung "Neuer Mandant statt Fork für internationale Marke", Rechtsträger-Frage als offen vermerkt.
3. Neuen Mandanten/Link in `00 - Übersicht (MOC).md` verlinken, sonst faktisch nicht auffindbar.
4. `security-reviewer`-Agent nach Abschluss laufen lassen (RLS betrifft neue Mandanten automatisch, aber Custom-Domain-Routing ist neu genug für eine kurze Prüfung).

## 8. Offene Punkte / Risiken — Zusammenfassung

| Punkt | Status |
|---|---|
| Cloudflare-Account-Zugehörigkeit von salestalent.app | Noch zu prüfen (Abschnitt 4) |
| Rechtsträger/Impressum/AGB für salestalent.app | Offen (Josip später klären) |
| Vollständige englische UI (nicht nur Branding) | Eigenes Folgeprojekt, noch nicht begonnen |
| EN-Video-Übersetzung (R15-Gate) | Im Code vorhanden, ungetestet |
| Playwright E2E für neuen Mandanten | Blockiert durch bestehendes Test-Env-Problem (unabhängig von salestalent.app) |
