import Link from "next/link";

/**
 * Minimale Portal-Startseite (Phase 4, Block 1). Mandantenverwaltung
 * (/portal/mandanten) folgt in Block 2 — Link hier bereits als
 * Platzhalter angelegt, Zielseite muss in diesem Block noch nicht existieren.
 */
export default function PortalHomePage() {
  return (
    <main className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Willkommen im Betreiber-Portal</h1>
      <p className="max-w-xl text-base text-slate-300">
        Von hier aus verwaltet das Calltalent-Team alle Akademie-Mandanten:
        anlegen, Status/Kontingente, Domain-Verknüpfung, Nutzungsübersicht.
      </p>
      <Link
        href="/portal/mandanten"
        className="w-fit rounded-md bg-slate-50 px-4 py-2 text-base font-medium text-slate-950 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
      >
        Mandanten verwalten
      </Link>
    </main>
  );
}
