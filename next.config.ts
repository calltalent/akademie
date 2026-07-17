import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  /* config options here */
};

export default withNextIntl(nextConfig);

// Kurs-Editor, Stufe 2 "Schnitt" (Plan calm-watching-dewdrop.md): ohne diesen
// Aufruf existiert die R2-Bindung FFMPEG_BUCKET (wrangler.jsonc) unter
// `npm run dev` nicht - getCloudflareContext() (siehe
// src/app/api/ffmpeg/[file]/route.ts) würde dort werfen, statt die
// ffmpeg.wasm-Dateien auszuliefern. Offizielles OpenNext-Cloudflare-Muster
// (dynamischer statt top-level Import, damit `npm run build` ohne
// Cloudflare-Dev-Kontext nicht daran hängt): läuft NUR unter `next dev`, hat
// auf `npm run build`/`npm run deploy`/`npm run preview` keine Wirkung.
import("@opennextjs/cloudflare").then((m) => m.initOpenNextCloudflareForDev());
