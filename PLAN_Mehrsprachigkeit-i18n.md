# Plan — Mehrsprachigkeit (i18n), Start mit Bosnisch

Erstellt: 01.08.2026, architect-Agent (Opus). Status: freigegeben, noch nicht gebaut.

Entscheidungen mit Josip (01.08.2026):
1. Übersetzung bs.json: KI-Entwurf zuerst, Josip prüft danach.
2. Sichtbarkeit von Sprachen: pro Mandant freischaltbar (nicht global).
3. Sprache von E-Mails/Zertifikaten: Mandanten-Standardsprache (nicht individuelle Nutzereinstellung).
4. Zertifikats-PDF-Schriftfehler (siehe Abschnitt 6) wird vorgezogen und als eigene Fehlerbehebung vor dem i18n-Vorhaben umgesetzt.

---

## 0. Ausgangsbefund

- `messages/de.json` (156 Zeilen) wird aktuell **nirgends gelesen** — `useTranslations` wird an keiner Stelle verwendet. Die gesamte Oberfläche (58 Seiten-, 87 Komponenten-Dateien) ist hartkodiertes Deutsch. Es steht keine Migration bestehender Übersetzungs-Aufrufe an, sondern die **Ersterfassung** aller UI-Texte.
- `src/i18n/request.ts` hat die Locale hart auf `"de"` kodiert.
- `next.config.ts` bindet next-intl bereits über `createNextIntlPlugin`.
- Kein `[locale]`-Segment im App Router. Route-Gruppen `(admin)`, `(auth)`, `(learn)`, `(portal)`.
- Middleware heißt `src/middleware.ts` (nicht `proxy.ts` — das wurde am 12.07. zurückgebaut, weil `@opennextjs/cloudflare` keine Node-Middleware unterstützt). Läuft auf Edge-Runtime.
- Mandantenfähigkeit über Subdomain (`{slug}.localhost:3000` in Dev), Auflösung in `src/lib/tenant/routing.ts`.
- `profiles.locale text not null default 'de'` existiert bereits seit `0001_init.sql`. `tenants.settings.default_locale` ist in `src/lib/tenant/types.ts` bereits typisiert. **Keine DB-Migration für dieses Vorhaben nötig.**
- `next-intl` ist in `package.json` als `"latest"` deklariert, tatsächlich installiert: `4.13.2`. Muss gepinnt werden (v5 hätte brechende API-Änderungen).
- Josip hat 90 % Sehbehinderung — Sprachumschalter muss tastaturbedienbar sein, natives `<select>`, kein Custom-Dropdown.

---

## 1. Architekturentscheidung: kein Pfadpräfix (`/bs/...`)

Locale wird über **Cookie + `profiles.locale`** aufgelöst, nicht über den URL-Pfad.

Begründung:
1. Ein Pfadpräfix würde `decideRouting()` in `src/lib/tenant/routing.ts` brechen (Portal-Rewrites auf `/portal${pathname}` — mit Präfix entstünde `/portal/de/mandanten`, eine nicht existierende Route). Diese Datei hat bereits zwei dokumentierte Produktionsbugs aus genau dieser Rewrite-Achse verursacht.
2. Hunderte Berührungspunkte (jeder `redirect()`, jeder `<Link href>`) müssten locale-fähig umgebaut werden.
3. SEO-Nutzen ist praktisch null — fast alles liegt hinter Auth.
4. Keine Kollision mit Mandanten-Subdomain, weil Host-Achse (Mandant) und Cookie-Achse (Sprache) sich nie kreuzen.

### Auflösungskette (Priorität absteigend)

| # | Quelle | Wo gelesen |
|---|---|---|
| 1 | Cookie `NEXT_LOCALE` (explizite Wahl) | `src/middleware.ts` |
| 2 | `tenants.settings.default_locale` | aus bereits dekodiertem `x-tenant-data`, kein Zusatz-Query |
| 3 | `Accept-Language`, nur wenn unterstützt | Request-Header |
| 4 | `"de"` | Konstante |

Jeder Kandidat muss zusätzlich gegen `enabled_locales` des Mandanten (siehe Abschnitt 3) bestehen — scheitert er, fällt er auf die nächste Stufe durch, nie direkt auf Fehler oder leere Seite.

`profiles.locale` ist der dauerhafte Speicher, das Cookie der Transport pro Anfrage. Synchronisiert beim Umschalten (Server Action schreibt beides) und nach Login in `src/app/auth/callback/`.

Middleware setzt `x-locale` als Request-Header (gleiches Muster wie `x-tenant-id`/`x-tenant-data`). `src/i18n/request.ts` liest ihn über `headers()`.

---

## 2. Block A — Infrastruktur

| # | Datei | Aktion |
|---|---|---|
| A1 | `package.json` | `"next-intl": "latest"` → `"4.13.2"` pinnen |
| A2 | `src/i18n/config.ts` (neu) | `SUPPORTED_LOCALES`, `DEFAULT_LOCALE`, Typ `Locale`, `LOCALE_NAMES`, `isSupportedLocale()`, `resolveEnabledLocales(settings)` |
| A3 | `src/i18n/resolve.ts` (neu) | reine Funktion `resolveLocale({cookie, tenantDefault, acceptLanguage, enabledLocales})`, Durchfall-Logik |
| A4 | `src/i18n/resolve.test.ts` (neu) | Vitest: alle vier Stufen der Kette, gesperrte Cookie-Sprache fällt durch, leeres `enabled_locales` ergibt `de`, unbekanntes Kürzel wird ignoriert, `de` nie sperrbar |
| A5 | `src/i18n/request.ts` | Umbau: `x-locale` lesen, gegen `SUPPORTED_LOCALES`-Whitelist prüfen **vor** dynamischem Import (Path-Traversal-Schutz), Messages laden |
| A6 | `src/middleware.ts` | `x-locale` setzen, direkt nach `x-tenant-data`-Block |
| A7 | `messages/bs.json` (neu) | KI-Entwurf, `de.json` als Struktur-Vorlage, alle Keys, ICU-Platzhalter unverändert übernehmen. Notiz zu Fachbegriffen (Lektion, Modul, Abgabe, Versuch, Bestehensgrenze, Zertifikat) für Josips Durchsicht. Danach Vitest-Abgleich (A4-Erweiterung: Schlüsselmengen-Vergleich `de.json` vs. alle weiteren) + Josips inhaltliche Prüfung |
| A8 | `src/app/layout.tsx` | `<html lang={locale}>` statt `lang="de"`; `generateMetadata` über `getTranslations` |
| A9 | `src/global.d.ts` (neu) | `declare module "next-intl"` für Typsicherheit der Message-Keys |
| A10 | `src/lib/tenant/types.ts` | `enabled_locales?: Locale[]` im `settings`-Block ergänzen |

**Definition of Done:** Cookie `NEXT_LOCALE=bs` schaltet Texte um, `<html lang>` ändert sich mit, `npm run test` + `npm run lint` grün.

---

## 3. Mandanten-Freischaltung (`enabled_locales`)

Keine Migration nötig — `tenants.settings` ist `jsonb not null default '{}'`. Gleiches Muster wie `self_signup_enabled`, `certificates_enabled`, `maintenance_enabled`.

**Zwei getrennte Whitelist-Ebenen, dürfen nie verschmolzen werden:**

| Ebene | Quelle | Zweck |
|---|---|---|
| `SUPPORTED_LOCALES` | Code | Sicherheit — welche `messages/*.json` existieren, schützt dynamischen Import |
| `enabled_locales` | Daten (`tenants.settings`) | Produkt — was der Mandant anbietet, nie sicherheitsrelevant |

Effektive Menge: `dedupe([DEFAULT_LOCALE, ...enabled_locales]) ∩ SUPPORTED_LOCALES`. `de` ist immer implizit enthalten. Fehlendes Feld → `["de"]`, Bestandsmandanten unverändert.

**Fall „Nutzer hat bs gewählt, Mandant deaktiviert es später":**
1. `resolveLocale()` fällt auf die nächste Kettenstufe durch, kein Fehler.
2. `profiles.locale` bleibt unverändert auf `bs` — kein Aufräum-Job. Schaltet der Mandant später wieder frei, bekommt der Nutzer seine Sprache automatisch zurück.
3. Deshalb **kein `CHECK`-Constraint** auf `profiles.locale` — ein Constraint könnte den Mandantenkontext nicht kennen (ein Nutzer kann über `memberships` in mehreren Mandanten mit unterschiedlichen Freischaltungen stecken). Validierung gehört in `resolve.ts`.

---

## 4. Block B — Steuerung und Sichtbarkeit

| # | Datei | Aktion |
|---|---|---|
| B1 | `src/lib/account/actions.ts` | `setLocale()`: zod-validiert, schreibt Cookie **und** `profiles.locale` |
| B2 | `src/components/settings/locale-switcher.tsx` (neu) | natives `<select>` mit `<label>`, zeigt nur effektive Menge des aktuellen Mandanten; bei genau einem Eintrag wird die Komponente gar nicht gerendert |
| B3 | `src/app/(portal)/einstellungen/einstellungen-tabs.tsx` | Switcher in Tab „Allgemein" einhängen |
| B4 | `src/app/auth/callback/route.ts` | nach Login `profiles.locale` → Cookie spiegeln |
| B5 | `src/app/(admin)/admin/einstellungen/page.tsx` | Mandanten-Standardsprache **und** Mehrfachauswahl `enabled_locales`. Bedingungen: Standardsprache muss Teil der freigeschalteten Menge sein; Schreibpfad server-seitig per zod gegen `SUPPORTED_LOCALES` validiert; Deutsch in der Oberfläche nicht abwählbar |

**Barrierefreiheit bei B2:** natives `<select>` (Tastatur/Screenreader ohne Eigenbau), Sprachnamen in der jeweiligen Sprache selbst („Deutsch", „Bosanski"), kein Flaggen-Icon als alleiniger Bedeutungsträger, Fokus nach Umschalten halten, Erfolg über `aria-live` melden.

**Pflicht danach:** security-reviewer-Lauf (CLAUDE.md §4.3).

---

## 5. Erweiterbarkeit — neue Sprache in zwei Schritten

1. `messages/<locale>.json` anlegen.
2. Kürzel in `SUPPORTED_LOCALES` und `LOCALE_NAMES` (`src/i18n/config.ts`) ergänzen.

Regeln, damit das hält:
- `src/i18n/config.ts` ist die **einzige** Locale-Liste. Kein Kürzel taucht sonst als Literal auf.
- Kein `CHECK`-Constraint auf `profiles.locale` (siehe Abschnitt 3).
- `de.json` als Referenz für Typsicherheit; fehlt ein Key in einer anderen Datei, fällt next-intl auf `de` zurück statt zu brechen; zusätzlich Vitest, der Schlüsselmengen vergleicht.

Randnotiz: `translate-captions.ts` erzeugt bereits englische Untertitel — Englisch ist faktisch schon zweite Inhaltssprache. `SUPPORTED_LOCALES` sollte `en` als dritten Eintrag mitdenken.

---

## 6. Block C — Textextraktion (inkrementell)

Kein Big Bang (widerspricht CLAUDE.md §4.2, kleine Commits). Reihenfolge nach Nutzerzahl/Erstkontakt:

| Stufe | Umfang | Diese Phase? |
|---|---|---|
| C1 | `src/app/(auth)/**` — Login, Registrieren, Passwort | ja |
| C2 | `src/app/(learn)/**` + `src/components/learn/**` | ja |
| C3 | `src/app/(portal)/**` + Shell/Navigation | ja |
| C4 | `src/app/(admin)/**` (~40 Dateien) | später |
| C5a | E-Mails (`src/lib/email/templates.ts`) | ja, sobald bs.json steht |
| C5b | Zertifikats-PDF-Schrift | **vorgezogen, siehe Abschnitt 7 — vor dem gesamten i18n-Vorhaben** |
| — | Kursinhalte (Titel, Lektionstexte) | nein — SPEC „Could" |

**Zahlen-/Datumsformate:** 14 Fundstellen mit hartkodiertem `"de-DE"` (u. a. `src/app/(admin)/admin/zahlungen/page.tsx:7`, `src/components/admin/orders-table.tsx:24`, `src/lib/certificates/pdf.ts:331`) wandern mit dem jeweiligen Block auf `useFormatter()`. Währung bleibt EUR.

**Leitplanke ab sofort:** neuer Code verwendet ausschließlich `t()`.

### C5a — E-Mails, konkretisiert

Locale-Quelle: **Mandanten-Standardsprache** (Josips Entscheidung), nicht `profiles.locale` des Empfängers. Der Mandant liegt an allen Aufrufstellen bereits im Scope, nichts muss durchgereicht werden:

| Aufrufstelle | Locale-Quelle im Scope |
|---|---|
| `src/lib/certificates/issue.ts:204` | `tenantSettings`, bereits Zeile 116 geladen |
| `src/lib/auth/actions.ts:169, 246, 319` | `tenant`-Objekt, siehe Zeile 170 |
| `src/app/api/stripe/webhook/route.ts:226` | `tenant`, Zeile 223 |
| `src/lib/contact/actions.ts:47` | **kein Mandant — bleibt bewusst Deutsch**, geht an Calltalent-Betrieb, nicht an Mandanten-Nutzer |

Jede der zehn Funktionen in `src/lib/email/templates.ts` erhält `locale: Locale` im Parameterobjekt, wird dadurch `async` (`getTranslations({locale, namespace: "email"})` aus `next-intl/server`, funktioniert v4 auch außerhalb eines Requests). Alle Aufrufstellen: `const html = welcomeInvite({...})` → `await`. `<html lang="de">` (Zeile 48) → `lang={locale}`.

Betreffzeilen nicht vergessen — stehen hartkodiert an Aufrufstellen (`issue.ts:212`, `webhook/route.ts:234`), wandern mit in `messages`.

---

## 7. Vorgezogene Fehlerbehebung: Zertifikats-PDF-Schrift (vor dem i18n-Vorhaben)

**Bestehender Fehler, nicht durch Bosnisch verursacht:** `src/lib/certificates/pdf.ts` bettet `StandardFonts.Helvetica` ein (Zeile 173/174) — kodiert nur WinAnsi/Windows-1252, enthält kein `č`, `ć`, `ž`, `š`, `đ`. `sanitizeForFont()` (Zeile 71) entfernt Diakritika lautlos. Schon heute wird z. B. „Josipović" auf einem Zertifikat zu „Josipovic". Ein Zertifikat mit falsch geschriebenem Namen ist als Nachweis unbrauchbar.

**Fix:** `@pdf-lib/fontkit` + Montserrat als Cloudflare-Workers-Static-Asset einbetten (Lizenz SIL OFL, unkritisch). Der Dateikopf (`pdf.ts` Zeilen 24–26) hatte das einmal als „unverhältnismäßig" verworfen — diese Abwägung galt für ein rein deutsches Produkt und trägt nicht mehr.

Eigener Arbeitsblock, eigenes Risiko (Worker-Bundle-Größe). Freigegeben von Josip (01.08.2026), wird **vor** Block A umgesetzt.

---

## 8. Risiken

**8.1 Sicherheit (kritisch):** Path Traversal in `request.ts` — Locale wird nach dem Umbau Nutzereingabe (Cookie/Header). Whitelist-Prüfung gegen `SUPPORTED_LOCALES` muss **vor** dem dynamischen Import stehen.

**8.2 Cookie-Domain:** kein `domain`-Attribut (sonst gilt Sprachwahl mandantenübergreifend). Host-only, `httpOnly: true`, `sameSite: "lax"`, `secure` in Produktion, `path: "/"`.

**8.3 RLS/Datenbank:** kein Risiko — keine neue Tabelle/Spalte, `profiles_own_update` deckt den einzigen Schreibvorgang. security-reviewer-Lauf nach Block B trotzdem Pflicht.

**8.4 Performance:**
- Kein Zusatz-Query (Mandanten-Standard kommt aus bereits dekodiertem `x-tenant-data`).
- `NextIntlClientProvider` reicht aktuell alle Messages an den Client — bei vollständiger Extraktion Bundle-Wachstum im Blick behalten (Namensräume einschränken oder Provider tiefer montieren), sonst Lighthouse-≥-90-Budget gefährdet.
- Sobald Edge-Caching für Lerninhalte kommt: `NEXT_LOCALE` muss Teil des Cache-Keys werden, sonst sieht Nutzer B die Sprache von Nutzer A.

**8.5 DSGVO:** Sprach-Cookie ist einwilligungsfrei nach § 25 Abs. 2 Nr. 2 TDDDG, **Bedingung:** nur bei expliziter Wahl gesetzt, `Accept-Language` nie als Anlass zum Cookie-Schreiben, nicht protokollieren. `profiles.locale` ist personenbezogen — prüfen, ob Datenexporte (`src/app/profil/export/`, `src/app/portal/mandanten/[id]/export/`) das Feld bereits ausgeben.

**8.6 SEO/Metadata:** kein `hreflang`, keine sprachspezifischen URLs — bewusster Verzicht. `<html lang>` (WCAG 3.1.1) ist trotzdem Pflicht.

**8.7 Kollision Mandant/Locale:** gering, getrennte Achsen, einziger Punkt ist Cookie-Domain (8.2).

---

## 9. Reihenfolge gesamt

```
Fehlerbehebung: Zertifikats-PDF-Unicode-Schrift (vorgezogen, unabhängig von i18n)
↓
A1 → A2 → A3 → A4 → A5 → A6 → A8 → A9 → A10   (Infrastruktur, testbar)
A7 (bs.json: KI-Entwurf → Vitest-Abgleich → Josips Durchsicht)
↓
B1 → B2 → B3 → B4 → B5
↓
security-reviewer (Pflicht)
↓
C1 → C2 → C3   (Extraktion, je eigener Commit)
C5a (E-Mails)
↓
später: C4 (Admin-Bereich), C5b entfällt (bereits vorgezogen)
↓
PHASENSTATUS.md nach jedem Block aktualisieren
```
