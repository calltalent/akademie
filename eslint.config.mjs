import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Korrektur (Josips Lint-Lauf, 12.07.2026): ".open-next/**" fehlte hier
    // — dadurch hat ESLint kompiliertes/minifiziertes Cloudflare-Worker-
    // Build-Output als Quellcode gelesen und dort 12932 der insgesamt
    // 12988 gemeldeten Probleme erzeugt (99,6 % — reines Bundler-Rauschen,
    // keine echten Fehler). Ebenso die rohen Claude-Design-Export-Ordner
    // (Referenzmaterial, kein App-Code, siehe design-reference/-Konvention)
    // und einen doppelt liegenden Upload-Ordner im Projekt-Root.
    ".open-next/**",
    "design-reference/**",
    "Calltalent-Akademie Studenten-Portal/**",
  ]),
]);

export default eslintConfig;
