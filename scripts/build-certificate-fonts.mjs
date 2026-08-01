// Erzeugt `src/lib/certificates/fonts/montserrat-data.ts` aus den beiden
// eingecheckten TrueType-Dateien (SIL Open Font License, siehe
// `src/lib/certificates/fonts/OFL.txt`). Einmalig laufen lassen, wenn die
// Font-Dateien aktualisiert werden — Aufruf: `node scripts/build-certificate-fonts.mjs`.
//
// `.mjs` statt `.js`, damit ESM-`import` statt `require()` möglich ist —
// dieses Repo hat kein `"type": "module"` in package.json (Next.js selbst
// braucht CommonJS-Interop), ESLint verbietet `require()` aber projektweit
// (`@typescript-eslint/no-require-imports`); ein einmalig von Hand
// laufendes Build-Skript rechtfertigt keine Ausnahme in der ESLint-Config.
//
// Warum ein generiertes TS-Modul statt `fs.readFileSync()` zur Laufzeit:
// siehe Kommentar am Kopf der generierten Datei / in
// `src/lib/certificates/pdf.ts` (Cloudflare-Workers-Deploy via OpenNext hat
// zur Laufzeit kein echtes Dateisystem).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(__dirname, "..", "src", "lib", "certificates", "fonts");
const regular = fs.readFileSync(path.join(dir, "Montserrat-Regular.ttf"));
const bold = fs.readFileSync(path.join(dir, "Montserrat-Bold.ttf"));

const header = `/**
 * Generiert aus \`Montserrat-Regular.ttf\` / \`Montserrat-Bold.ttf\` (dieser
 * Ordner, SIL Open Font License, siehe \`OFL.txt\`) via
 * \`node scripts/build-certificate-fonts.mjs\` (siehe dort). NICHT von Hand
 * bearbeiten — bei einem Font-Update das Skript erneut laufen lassen.
 *
 * Warum base64 im TS-Modul statt \`fs.readFileSync()\` zur Laufzeit: Diese
 * Codebasis deployt via OpenNext auf Cloudflare Workers (siehe
 * wrangler.jsonc) — dort existiert zur Laufzeit kein echtes Dateisystem,
 * \`fs.readFileSync()\` funktioniert nicht zuverlässig. Als Bundle-Konstante
 * eingebettet läuft das Laden zur Bundle-Zeit und verhält sich in
 * \`next dev\`, \`vitest\`, \`next build\` und im deployten Worker identisch,
 * ganz ohne Netzwerk-Roundtrip oder Storage-Binding.
 */

`;

const body =
  header +
  `export const MONTSERRAT_REGULAR_BASE64 = "${regular.toString("base64")}";\n\n` +
  `export const MONTSERRAT_BOLD_BASE64 = "${bold.toString("base64")}";\n`;

fs.writeFileSync(path.join(dir, "montserrat-data.ts"), body, "utf8");

console.log(`Regular: ${regular.length} Bytes -> ${path.join(dir, "montserrat-data.ts")}`);
console.log(`Bold:    ${bold.length} Bytes`);
