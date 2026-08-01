/**
 * Bewusst KEIN `Buffer.from(base64, "base64")`: `pdf-lib`s Typ-Validierung
 * (`assertIs`, siehe `node_modules/pdf-lib/src/utils/validators.ts`) prüft
 * `value instanceof Uint8Array` — das schlägt für ein `Buffer`-Objekt fehl,
 * sobald `Buffer` (Node-Buffer oder ein Workers-`nodejs_compat`-Polyfill)
 * aus einem anderen Realm/Global-Kontext stammt als der `Uint8Array`, gegen
 * den `pdf-lib` prüft — beobachtet unter Vitest/jsdom beim Schreiben des
 * Tests in `../pdf.test.ts` (`embedFont()` wirft dort mit einem
 * `Buffer.from(...)`-Argument, mit einem `new Uint8Array(...)`-Argument
 * nicht). Ob genau dieses Cross-Realm-Verhalten auch im deployten
 * Cloudflare-Worker auftritt, ist nicht abschließend geprüft — `atob()` ist
 * aber ein Standard-Web-API-Global (Node ≥ 16, Browser, Cloudflare
 * Workers nativ, ganz ohne den `nodejs_compat`-Polyfill), erzeugt hier ein
 * echtes `Uint8Array` im aktuellen Realm und ist damit unabhängig vom
 * `nodejs_compat`-Flag robust — genau ein Grund weniger, an den `Buffer`
 * denken zu müssen. Für Font-Dateien in der Größenordnung von ~330 KB ist
 * die O(n)-Zeichen-für-Zeichen-Schleife unproblematisch.
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
