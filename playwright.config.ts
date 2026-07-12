import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { loadEnvConfig } from "@next/env";

// Phase 4, Block 6: Playwright läuft außerhalb von Next.js' eigenem
// Bootstrapping — ohne diesen Aufruf sieht process.env im Testprozess/in
// den Workern NICHT die Werte aus .env (ANTHROPIC_API_KEY, VOYAGE_API_KEY,
// STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, CRON_PROCESS_SECRET,
// SUPABASE_SERVICE_ROLE_KEY, ...), die global-setup.ts und mehrere
// e2e/*.spec.ts-Dateien zur Laufzeit brauchen bzw. per `test.skip()`
// prüfen. `loadEnvConfig()` ist dieselbe Funktion, die Next.js selbst
// intern für `npm run dev`/`next build` nutzt (offizielles Next.js-
// Playwright-Integrationsmuster) — hier auf Modulebene aufgerufen, damit
// die Werte VOR globalSetup und vor dem Spawnen der Worker-Prozesse in
// process.env stehen (Worker erben process.env vom Hauptprozess beim
// Start).
loadEnvConfig(path.resolve(__dirname));

export default defineConfig({
  testDir: "./e2e",
  // Phase 4, Block 6: mehrere Specs teilen sich denselben Mandanten
  // (demo-blau) und dessen Rate-Limits/Zustand (z. B. CSV-Import
  // 5/300s/Mandant, Kurs-Generator 5/3600s/Mandant) — serielle Ausführung
  // ist bei 8 Specs schnell genug und robuster als parallele Kollisionen zu
  // debuggen. `fullyParallel: false` allein serialisiert nur Tests
  // INNERHALB derselben Datei; ohne zusätzliches `workers: 1` würden
  // verschiedene Spec-Dateien weiterhin in parallelen Workern laufen und
  // sich denselben Mandanten-Zustand teilen — `workers: 1` ist deshalb eine
  // technisch notwendige Ergänzung zum architect-Plan-Wortlaut (dokumentiert
  // in PHASENSTATUS.md Block 6), um das eigentliche Planziel ("serielle
  // Ausführung über alle 8 Specs hinweg") tatsächlich zu erreichen.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  // Einzelne Specs rufen echte Claude-/Voyage-/Stripe-APIs auf (Tutor-Chat,
  // Kurs-Generator mit mehreren Pipeline-Schritten, Stripe-Checkout) —
  // deutlich über dem 30s-Playwright-Standard.
  timeout: 180_000,
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    // Design-Block, Nachbesserung 2 (12.07.2026): "localhost" statt einer
    // festen IP kann unter Windows abwechselnd auf IPv6 (::1) oder IPv4
    // (127.0.0.1) aufgelöst werden. Next.js bindet an beide, Playwrights
    // Bereitschafts-Polling (config.webServer) fragt aber nur EINE davon ab
    // — bekommt keine Antwort und wartet die volle Zeit, obwohl der Server
    // (manuell mit `npm run dev` getestet: "Ready in 463ms") tatsächlich
    // längst läuft. Feste IPv4-Adresse macht die Prüfung eindeutig.
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: true,
    // Design-Block (12.07.2026): Playwrights Standard-Wartezeit fürs
    // Hochfahren ist 60s — bei einem kalten `next dev`-Start (erster
    // Kompilierlauf nach Codeänderungen, v. a. unter Windows) reicht das
    // oft nicht (Josips Testlauf: "Timed out waiting 60000ms"). Gleiche
    // Begründung wie beim 180s-Test-Timeout oben — echte Wartezeit statt
    // Playwright-Standard.
    timeout: 180_000,
    // Design-Block, Nachbesserung 3 (12.07.2026): 127.0.0.1 statt localhost
    // hat den Timeout NICHT behoben (Josips zweiter Testlauf: erneut volle
    // 180000ms, obwohl `npm run dev` manuell parallel "Ready in 417ms" zeigt
    // und Port 3000 laut `netstat` frei war). Playwright unterdrückt die
    // Ausgabe des von ihm selbst gestarteten Servers standardmäßig komplett
    // — wir sehen also gar nicht, ob der von Playwright gestartete Prozess
    // überhaupt bis "Ready" kommt oder vorher abbricht (z. B. andere
    // Umgebungsvariablen als im manuellen Terminal). `stdout`/`stderr:
    // "pipe"` schaltet diese Ausgabe für den NÄCHSTEN Testlauf sichtbar —
    // reines Diagnose-Mittel, ändert nichts am Serververhalten selbst.
    stdout: "pipe",
    stderr: "pipe",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
