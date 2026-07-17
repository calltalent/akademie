// Handgeschriebene, bewusst MINIMALE Typdeklaration für die R2-Bindung
// FFMPEG_BUCKET (siehe wrangler.jsonc) — Kurs-Editor, Stufe 2 „Schnitt"
// (Plan `calm-watching-dewdrop.md`). Diese Datei existierte vorher nicht;
// `getCloudflareContext` (`@opennextjs/cloudflare`) wird im ganzen Repo
// bisher nirgends benutzt.
//
// WARUM NICHT `npm run cf-typegen` (= `wrangler types ...`) einfach laufen
// lassen: der Standardgenerator bündelt zusätzlich die vollständigen
// workerd-Laufzeittypen (~550 KB) — und die deklarieren u. a. ein EIGENES
// globales `Response`/`Body` (`Body.json(): Promise<unknown>`). Das
// überlagert/verdrängt TypeScripts DOM-lib-`Response.json(): Promise<any>`
// PROJEKTWEIT, nicht nur im Worker-Kontext. Verifiziert: nach testweisem
// Einspielen der vollen generierten Datei meldete `npx tsc --noEmit` drei
// NEUE Fehler in völlig unbeteiligten Dateien
// (`src/components/admin/ki-generator-panel.tsx`,
// `src/components/learn/submission-form.tsx`,
// `src/lib/bunny/use-bunny-upload.ts` — alle nutzen `await res.json()` in
// normalem Browser-`fetch()`, nicht im Worker-Kontext). Ohne die Datei bzw.
// mit dieser schlanken Version verschwinden die drei Fehler wieder.
//
// Deshalb hier — wie in `custom-worker.ts` für `ScheduledEvent` bereits
// vorgemacht ("Minimale, selbst definierte Typen statt Abhängigkeit von
// @cloudflare/workers-types", das Paket ist nicht installiert) — nur die
// Handvoll Bezeichner, die `@opennextjs/cloudflare`s eigene
// `cloudflare-context.d.ts` (und die davon importierten
// Durable-Object-/Incremental-Cache-Dateien) referenzieren, jeweils so
// schlank wie möglich gehalten. Echte Feld-für-Feld-Korrektheit ist hier
// NICHT das Ziel — keiner dieser Stubs wird über die eine tatsächlich
// genutzte `R2Bucket.get()`-Form hinaus irgendwo strukturell geprüft; sie
// müssen nur als Bezeichner auflösbar sein, damit `CloudflareEnv` (siehe
// `cloudflare-context.d.ts`) type-checkt.
/* eslint-disable @typescript-eslint/no-empty-object-type */

interface Fetcher {}
interface ImagesBinding {}
interface Service {}
interface KVNamespace {}
interface D1Database {}
interface DurableObjectNamespace<T = unknown> {
  /** Nie gelesen — hält den Typparameter nur strukturell am Leben (sonst ESLint-Warnung „T unused"). */
  readonly _phantom?: T;
}
interface Queue {}
interface DurableObjectState {}
interface SqlStorage {}
interface IncomingRequestCfProperties extends Record<string, unknown> {}
interface ExecutionContext {}

declare module "cloudflare:workers" {
  export abstract class DurableObject<Env = unknown> {
    constructor(ctx: DurableObjectState, env: Env);
  }
}

interface R2ObjectBody {
  readonly body: ReadableStream;
  readonly size: number;
}

/** Nur die eine Methode, die `src/app/api/ffmpeg/[file]/route.ts` tatsächlich aufruft. */
interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
}

interface CloudflareEnv {
  /** R2-Bucket "calltalent-akademie-ffmpeg" (siehe wrangler.jsonc) — liefert die drei ffmpeg.wasm-Dateien für den Video-Schnitt aus. */
  FFMPEG_BUCKET: R2Bucket;
}
