import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Basis-Security-Headers (Security-Fix 08.08.2026, Sicherheitsaudit-Punkt 13
// "Basic security headers is on") — bewusst nur die unstrittigen,
// nicht-brechenden Header. KEINE Content-Security-Policy hier: das Projekt
// bindet Stripe.js (Checkout), Bunny (Video-Player/HLS) und Supabase
// (WebSocket-Realtime) ein — eine CSP ohne sorgfältiges Austesten gegen
// eine echte Deployment-Umgebung riskiert, Zahlungen oder Video-Wiedergabe
// stillschweigend zu brechen. Als eigene Folgeaufgabe vorgesehen (siehe
// PHASENSTATUS.md), nicht Teil dieses Fixes.
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  // SAMEORIGIN statt DENY: die App bettet sich selbst nirgends per iframe
  // ein, aber SAMEORIGIN ist die verbreitete, unschädliche Wahl, falls
  // künftig ein eigener Embed-Anwendungsfall entsteht.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Gilt nur über HTTPS (Cloudflare Workers liefert ohnehin nur HTTPS aus),
  // erzwingt aber auch bei künftigen Subdomains/Custom-Domains kein
  // Downgrade auf HTTP.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
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
