import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // "server-only" ist in diesem Projekt keine eigene npm-Abhängigkeit
      // (nur intern in node_modules/next/dist/compiled/server-only gebündelt
      // und von Next.js' eigenem Bundler aufgelöst) — Vitest/Vite braucht
      // einen eigenen Alias auf ein leeres Stub-Modul, siehe
      // src/test/stubs/server-only.ts.
      "server-only": path.resolve(__dirname, "./src/test/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // env.ts validiert process.env sofort beim Import (zod) — Vitest lädt
    // .env sonst NICHT automatisch in process.env (anders als Next.js selbst).
    // loadEnv("", cwd, "") liest .env unabhängig vom Präfix, damit
    // env.test.ts (und jeder andere Test, der env.ts importiert) dieselben
    // Werte wie `npm run dev` sieht.
    env: loadEnv("", process.cwd(), ""),
  },
});
