// Vitest-Stub für das echte npm-Paket "server-only" (Marker-Paket von React/
// Next.js, siehe node_modules/next/dist/compiled/server-only/index.js: die
// echte Implementierung wirft beim Import IMMER einen Error, wenn sie nicht
// über Next.js' eigenen Webpack/Turbopack-Build aufgelöst wird).
//
// "server-only" ist in diesem Projekt KEINE eigene npm-Abhängigkeit (siehe
// package.json/package-lock.json — kein Eintrag, kein node_modules/server-only
// auf oberster Ebene). Next.js bündelt seine eigene Kopie intern
// (node_modules/next/dist/compiled/server-only) und löst den nackten
// Bezeichner `"server-only"` über eine eigene Bundler-Sonderbehandlung auf,
// NICHT über normale Node-Modulauflösung. Vite/Vitest kennt diesen Next.js-
// internen Sonderfall nicht und würde ansonsten mit "Failed to resolve
// import "server-only""" abbrechen (Standardproblem bei Next.js+Vitest,
// siehe vitest.config.ts `resolve.alias`).
//
// `import "server-only"` ist in den betroffenen Dateien (z. B.
// src/lib/marketplace/catalog.ts) ein reiner Seiteneffekt-Import ohne
// Bindung — ein leeres, gültiges ESM-Modul reicht als Ersatz für Tests
// vollständig aus.
export {};
