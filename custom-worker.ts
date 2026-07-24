// Custom-Worker-Entrypoint (Phase 5, Block 1). Der von @opennextjs/cloudflare
// generierte Worker (.open-next/worker.js) exportiert AUSSCHLIESSLICH einen
// fetch-Handler. Dieser Custom-Worker (offizielles OpenNext-Muster, siehe
// https://opennext.js.org/cloudflare/howtos/custom-worker) reicht diesen
// fetch-Handler unverändert durch und ergänzt zusätzlich einen
// scheduled-Handler für den Cloudflare Cron Trigger (wrangler.jsonc,
// "triggers.crons") — ersetzt Josips bisheriges manuelles Wiederholt-
// Aufrufen von /api/admin/ki/process aus der lokalen Entwicklung (Phase 3,
// Block 5/6: KI-Job-Pipeline für Kursgenerierung/Transkripte, verarbeitet
// pro Aufruf genau einen Pipeline-Schritt).
//
// Korrektur (Josips Build-Lauf, 12.07.2026): TypeScript erkennt JEDE
// "//"-Kommentarzeile, die (nach dem Trimmen) mit dem Directive-Schlüssel-
// wort beginnt, als eigenständiges Compiler-Directive — das galt beim
// ersten Korrekturversuch sogar für die Erklärung selbst, die deshalb hier
// bewusst ohne "@"-Symbol vor den Schlüsselwörtern auskommt. Kurzfassung:
// das strengere Directive (verlangt einen tatsächlichen Typfehler in der
// Folgezeile) passt hier nicht, weil der Fehlerstatus dieses Imports
// instabil ist — er hängt davon ab, ob `.open-next/worker.js` von einem
// vorherigen Build noch auf der Platte liegt, nicht vom Quellcode. Deshalb
// unten das nachsichtigere Directive (ignoriert unabhängig vom Fehler-
// status), mit gezieltem eslint-disable statt die ESLint-Regel zu erfüllen.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore `.open-next/worker.js` wird erst beim Build (`npm run deploy`/
// `npm run preview`) generiert, existiert im Repo nicht als Quelldatei.
import { default as handler } from "./.open-next/worker.js";

// Minimaler Fetcher-Typ für das Service Binding (gleiche Begründung wie bei
// ScheduledEvent unten: kein @cloudflare/workers-types verfügbar).
interface Fetcher {
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
}

interface Env {
  CRON_PROCESS_SECRET: string;
  NEXT_PUBLIC_SITE_URL: string;
  // Service Binding auf denselben Worker (wrangler.jsonc "services") — ersetzt
  // den bisherigen echten Netzwerk-`fetch()` unten (24.07.2026, Fund: wieder-
  // holte 522-Fehler bei diesem Self-Call).
  SELF: Fetcher;
}

// Minimale, selbst definierte Typen statt Abhaengigkeit von
// @cloudflare/workers-types (12.07.2026, `npm run build`-Fund: das Paket ist
// nur eine OPTIONALE Peer-Dependency von wrangler und wurde bei `npm install`
// nicht mitinstalliert — daher kein globaler `ExportedHandler`/`Env`-Typ
// verfuegbar, ohne ihn erst separat nachzuinstallieren). Dieses Interface
// bildet nur das ab, was der Handler tatsaechlich braucht.
interface ScheduledEvent {
  readonly cron: string;
  readonly scheduledTime: number;
}

// Korrektur (Josips Lint-Lauf, 12.07.2026): Objekt vor dem Export benannt
// (import/no-anonymous-default-export) und den ungenutzten dritten
// `ctx`-Parameter (ExecutionContext) entfernt, statt ihn nur mit "_" zu
// prefixen — dieses Projekt erkennt die Unterstrich-Konvention für
// ungenutzte Funktionsparameter nicht (kein argsIgnorePattern in
// eslint.config.mjs), siehe auch app-shell.tsx/sidebar.tsx-Fund vorhin.
const worker = {
  fetch: handler.fetch,

  async scheduled(_event: ScheduledEvent, env: Env) {
    // Security-Review-Fund (Phase 5, Block 7, 12.07.2026, MITTEL): try/catch
    // ergänzt — ohne diesen fängt ein fehlendes/ungültiges
    // NEXT_PUBLIC_SITE_URL (fetch() wirft dann statt eines HTTP-Fehlers)
    // eine ungefangene Exception im scheduled-Handler, statt sie wie den
    // regulären Fehlerfall unten im Cloudflare-Cron-Log zu protokollieren.
    try {
      const response = await env.SELF.fetch(`${env.NEXT_PUBLIC_SITE_URL}/api/admin/ki/process`, {
        method: "POST",
        headers: { "x-cron-secret": env.CRON_PROCESS_SECRET },
      });
      if (!response.ok) {
        // Kein Retry/Alarm hier — der nächste Cron-Lauf (alle 2 Minuten,
        // siehe wrangler.jsonc) greift denselben bzw. den nächsten
        // wartenden Job erneut auf. Fehler landen im Cloudflare-Cron-
        // Event-Log (Dashboard "Triggers" > "Cron Events").
        console.error(`[custom-worker] /api/admin/ki/process antwortete mit Status ${response.status}.`);
      }
    } catch (err) {
      console.error(
        `[custom-worker] Aufruf von /api/admin/ki/process fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
};

export default worker;
