# Fehleranalyse — Calltalent-Akademie

**Datum:** 12.07.2026 · **Projekt:** SOFTWARE/calltalent-akademie · **Stack:** Next.js 16 / React 19, Supabase (EU-Frankfurt), OpenNext + Cloudflare Workers, Stripe, Bunny, Anthropic

---

## 0. Kernbefund zuerst (wichtig)

**Dein Code ist intakt. Die Cowork-/Sandbox-Umgebung liest die Dateien aber korrupt.**

Die automatische Analyse aus der Sandbox lief zunächst auf einer **beschädigten Datei-Sicht**: Der Linux-Mount, über den die Analyse-Werkzeuge (tsc, ESLint) lesen, liefert ca. **40 % der Quelldateien abgeschnitten oder mit Nullbyte-Müll aufgefüllt**. Die echten Dateien auf deiner Festplatte sind vollständig — bewiesen über das App-eigene Datei-Tool und die Git-Historie.

Belegkette (5 Stichproben, jeweils Mount-Sicht ≠ Realität):

1. `src/middleware.ts` — Mount: 98 Zeilen, mitten im Code abgebrochen. Real: 139 Zeilen, sauberes Ende.
2. `src/app/page.tsx` — Mount: 142 Zeilen abgeschnitten. Real: läuft korrekt bis Zeilenende weiter.
3. `src/components/learn/app-shell.tsx` — Mount: 52 Zeilen + 2.477 Nullbytes. Real: 52 Zeilen, vollständig.
4. `src/components/shell/nav-link.tsx` — Mount: bei `usePathname(` abgeschnitten. Real: 147 Zeilen komplett.
5. `src/lib/quiz/actions.ts` — Mount: bei Zeile 398 abgeschnitten. Real: 416 Zeilen komplett.

**Zwei Konsequenzen:**

1. Eine belastbare tsc-/ESLint-/Build-Analyse ist **aus Cowork heraus derzeit nicht möglich** — jedes Werkzeug bekommt Müll geliefert (die zuerst gemeldeten 944.788 „Fehler" waren reine Artefakte).
2. **Gefahr:** Bearbeitet eine KI in dieser Sitzung eine Projektdatei und speichert sie, kann die abgeschnittene Sicht über die echte Datei geschrieben werden → **echter Code-Verlust**. Das deckt sich mit deiner Notiz „Edit-Tool schneidet Dateienden ab". Bis der Sync geklärt ist: **keine Datei-Edits an diesem Projekt über Cowork.**

---

## 1. Was zuverlässig geprüft werden konnte (mount-unabhängig)

Alles Folgende stammt aus Quellen, die den defekten Datei-Mount **nicht** benutzen (Supabase-API, Git-Objektspeicher, App-Datei-Tool).

### 1.1 Git-Zustand — sauber
- Branch `main`, HEAD `eee4957` (12.07. 04:02), Objektspeicher lesbar, kein Stash.
- HEAD enthält 192 Dateien unter `src/`; im Arbeitsverzeichnis 212 → es gibt **nicht committete Arbeit** (Design-Umbau vom 12.07.).
- Die im Mount gemeldete Git-Index-Meldung `unknown index entry format` ist ebenfalls ein Mount-Artefakt (Refs/Objekte lesen einwandfrei).
- **Empfehlung:** nicht committete Design-Arbeit lokal zeitnah committen, damit sie einen Wiederherstellungspunkt hat.

### 1.2 Secrets / `.env` — im Kern korrekt
- `.gitignore` schließt `.env` und `.env.*` aus (Ausnahme `.env.example`). Verifiziert: **`.env` wurde nie committet**, nur `.env.example` ist getrackt. Live-Schlüssel sind also **nicht** im Repository.
- In `.env` liegen produktive Live-Schlüssel (u. a. Stripe `sk_live_…`, Supabase Service-Role, Anthropic, Resend, VAPID). Lokal per CLAUDE.md-Ausnahme bewusst gespeichert → akzeptiert; Restrisiko nur bei physischem/Backup-Zugriff auf den Rechner.
- **Offener Punkt (Doku):** Kommentar nennt „Testmodus", der Live-`sk_live_…`-Schlüssel steht aber daneben. Vor Go-Live sicherstellen, dass `npm run dev` nie den Live-Schlüssel zieht (getrennte Variablennamen sind vorhanden — gut).

### 1.3 Supabase — Security-Advisors (7 Hinweise)

| Stufe | Regel | Objekt |
|------|-------|--------|
| WARN | SECURITY-DEFINER-Funktion öffentlich aufrufbar (`anon`+`authenticated`) | `check_rate_limit()` |
| WARN | SECURITY-DEFINER-Funktion für Angemeldete aufrufbar | `is_staff()` |
| WARN | SECURITY-DEFINER-Funktion für Angemeldete aufrufbar | `member_role()` |
| WARN | Leaked-Password-Schutz deaktiviert (HaveIBeenPwned) | Auth |
| INFO | RLS aktiv, aber keine Policy (= Vollsperre) | `platform_admins` |
| INFO | RLS aktiv, aber keine Policy (= Vollsperre) | `rate_limits` |

- Die drei SECURITY-DEFINER-Funktionen sind vermutlich als RLS-Hilfsfunktionen gedacht, aber zusätzlich per REST-RPC direkt aufrufbar. `is_staff`/`member_role` geben nur Boolean/Rolle je Tenant-UUID zurück (geringes Risiko); `check_rate_limit` ließe sich missbrauchen, um Rate-Limit-Budget zu verbrauchen. → `EXECUTE` für `anon`/`authenticated` entziehen oder auf `SECURITY INVOKER` umstellen.
- `platform_admins`/`rate_limits` ohne Policy = niemand außer `service_role` kommt dran. Wahrscheinlich beabsichtigt; nur bestätigen.
- Leaked-Password-Schutz im Supabase-Dashboard aktivieren (1 Klick).
- Referenz: https://supabase.com/docs/guides/database/database-linter

### 1.4 Supabase — Performance-Advisors (121 Hinweise, 102 WARN / 19 INFO)

1. **85× multiple_permissive_policies** — mehrere permissive RLS-Policies pro Tabelle/Rolle/Aktion; jede Abfrage wertet alle aus. Zusammenfassen reduziert DB-Last spürbar.
2. **18× unindexed_foreign_keys** — Fremdschlüssel ohne Index (u. a. `ai_jobs`, `attempts`, `audit_log`, `bunny_videos`, `certificates`, `courses`). Bremst Joins und Löschungen. Index je FK nachziehen.
3. **17× auth_rls_initplan** — RLS-Policies rufen `auth.uid()`/`current_setting()` pro Zeile statt einmalig. Fix: Aufruf in `(select auth.uid())` kapseln → große Wirkung bei wenig Aufwand.
4. **1× unused_index** — `embeddings`: ungenutzter Index, kann entfallen.

> Keine dieser Punkte ist ein Blocker; es sind Skalierungs-Optimierungen vor stärkerer Last.

---

## 2. Was NICHT verlässlich lief (und warum)

| Prüfung | Status aus Cowork | Grund |
|--------|--------|-------|
| tsc (Typen) | ungültig | Mount liefert korrupte Dateien |
| ESLint | ungültig | dito |
| `next build` | nicht lauffähig | native Binaries sind Windows-only (SWC) |
| Vitest (Unit) | nicht lauffähig | native esbuild-Binary ist Windows-only |
| Playwright (E2E) | nicht lauffähig | Browser/Runner nicht im Sandbox |

Fazit: Die vollständige technische Prüfung gehört **auf deinen Rechner** — dort werden die echten Dateien gelesen und die passenden Windows-Binaries sind installiert.

---

## 3. Konkrete nächste Schritte

**A — Vollständige Fehleranalyse lokal ausführen** (im Projektordner, PowerShell):

```
npx tsc -p tsconfig.json --noEmit      # echte Typfehler
npm run lint                            # ESLint
npm test                               # Vitest (Unit-Tests)
npm run build                          # Produktions-Build
npm run e2e                            # Playwright E2E (optional)
```

Schick mir die Ausgaben (auch als Text-Datei) — dann werte ich die **echten** Fehler hier aus, ohne den defekten Mount.

**B — Sync-Problem der Sandbox klären:** Cowork/Session neu verbinden oder Rechner-seitig prüfen, warum der Mount abgeschnittene Dateien zeigt. Bis dahin an diesem Projekt **keine** Datei-Edits über Cowork.

**C — Supabase-Quick-Wins** (ich kann die Migrationen vorbereiten):
1. `auth_rls_initplan` fixen (17 Policies auf `(select auth.uid())`).
2. 18 fehlende FK-Indizes anlegen.
3. Leaked-Password-Schutz aktivieren; SECURITY-DEFINER-`EXECUTE`-Rechte prüfen.

**D — Absicherung:** nicht committete Design-Arbeit lokal committen (Wiederherstellungspunkt).

---
*Erstellt 12.07.2026. Reine Analyse — keine Datei im Projekt wurde verändert.*
