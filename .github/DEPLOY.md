# CI und Deploy einrichten

Zwei Workflows liegen in `.github/workflows/`. `ci.yml` prüft jeden Pull
Request, `deploy.yml` liefert `main` nach Cloudflare Workers aus. Bis die
folgenden vier Schritte erledigt sind, läuft `ci.yml` bereits, `deploy.yml`
bricht dagegen absichtlich mit einer Fehlermeldung ab.

Alle Einstellungen liegen unter `https://github.com/calltalent/akademie/settings`.

## 1. Secrets eintragen

Pfad: Settings, dann Secrets and variables, dann Actions, Reiter Secrets,
Knopf New repository secret.

| Name | Wert |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare-Dashboard, My Profile, API Tokens, Create Token, Vorlage „Edit Cloudflare Workers", Account `calltalent.ai` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | aus deiner lokalen `.env`, Zeile 3 |

Der Anon-Key ist kein Geheimnis (er landet im Browser-Bundle), steht hier
aber trotzdem unter Secrets, damit GitHub ihn in den Protokollen maskiert.

## 2. Variablen eintragen

Derselbe Bildschirm, Reiter Variables, Knopf New repository variable.

| Name | Wert |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://vklqksdiyiijzoirntyt.supabase.co` |
| `NEXT_PUBLIC_SITE_URL` | `https://academy.calltalent.ai` |
| `NEXT_PUBLIC_PORTAL_HOST` | `portal.calltalent.ai` |
| `NEXT_PUBLIC_MARKETPLACE_HOST` | `marketplace.calltalent.ai` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | aus deiner lokalen `.env` |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | aus deiner lokalen `.env` |

Vergleiche die Werte mit deiner `.env`, bevor du sie einträgst. Diese sechs
Werte werden beim Bauen fest ins Browser-Bundle geschrieben. Ein falscher
`NEXT_PUBLIC_PORTAL_HOST` macht das Betreiber-Portal in Produktion
unerreichbar, ohne dass irgendein Prüfschritt rot wird. Genau deshalb bricht
`deploy.yml` ab, solange die ersten fünf Einträge aus Abschnitt 1 und 2
fehlen.

Die letzten beiden dürfen leer bleiben. Ohne VAPID-Schlüssel gibt es keine
Push-Nachrichten, ohne Turnstile-Key greifen die fünf übrigen Schutzschichten
des Kontaktformulars weiter.

## 3. Umgebung `production` anlegen

Pfad: Settings, dann Environments, dann New environment, Name `production`.

Trage dich dort unter **Required reviewers** selbst ein. Danach wartet jeder
Deploy auf deinen Klick. Das ist die Freigabe, die CLAUDE.md §4.6 verlangt,
und sie kostet dich pro Deploy einen Knopfdruck statt eines Terminal-Laufs.

Willst du später vollautomatisch ausliefern, nimm den Reviewer wieder heraus.
Das ist eine bewusste Änderung an §4.6 und gehört in `PHASENSTATUS.md`.

## 4. Branch-Schutz auf `main`

Pfad: Settings, dann Rules, dann Rulesets, dann New branch ruleset.

1. Name `main-schutz`, Enforcement status auf Active.
2. Target branches: Add target, Include default branch.
3. Haken bei **Require a pull request before merging**, Required approvals 0.
4. Haken bei **Require status checks to pass**. Dort diese drei Prüfungen
   suchen und hinzufügen: `Typen, Lint, Tests, Build`, `OpenNext-Worker-Build`
   und `Bekannte Schwachstellen`.
5. Haken bei **Block force pushes**.

Die Prüfungen erscheinen in der Auswahlliste erst, nachdem `ci.yml` einmal
gelaufen ist. Lass also zuerst einen Pull Request laufen und setze den
Branch-Schutz danach.

Required approvals steht bewusst auf 0: du arbeitest allein, ein Zwang zur
Fremdprüfung würde dich aussperren. Der Schutz liegt in den grünen
Prüfungen und darin, dass niemand mehr versehentlich direkt auf `main`
schiebt.

## Was danach passiert

Bei jedem Pull Request laufen Typprüfung, ESLint, 771 Vitest-Tests, der
Next-Build und der OpenNext-Worker-Build. Der Worker-Build fängt die
Fehlerklasse, die am 14.07.2026 den Deploy zerlegt hat, nachdem lokal alles
lief.

Bei jedem Push auf `main` laufen dieselben Prüfungen noch einmal, danach
wartet der Deploy auf deine Freigabe und liefert aus. `npm run deploy` von
Hand brauchst du ab dann nicht mehr.

## Der Prüfschritt „Bekannte Schwachstellen"

`npm audit --omit=dev --audit-level=high` meldet seit dem 09.09.2026 null
Schwachstellen in den Produktionsabhängigkeiten. Der Schritt blockiert
deshalb, statt nur zu melden.

Geht er rot, lies zuerst `npm audit --omit=dev` und bestimme die Ursache.
Führe `npm audit fix --force` nicht blind aus: am 09.09. hätte es
`@opennextjs/cloudflare` von 1.20 auf 1.1.0 heruntergestuft, also eine
Hauptversion zurück.

Entwicklungsabhängigkeiten sind ausgenommen. Dort stehen heute fünf
Meldungen, alle über optionale Pakete, die gar nicht installiert werden:
`jsdom` deklariert `canvas` als optionalen Peer, und darüber hängen
`@mapbox/node-pre-gyp` und `tar`. Ein Sprung auf `jsdom@26` würde die Kette
auflösen, bringt aber npm 10.9.7 beim Auflösen zum Absturz
(`Cannot read properties of null (reading 'edgesOut')`). Das gehört
wiederholt, sobald npm den Fehler behoben hat.
