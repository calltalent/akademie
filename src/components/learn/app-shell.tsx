import type { ReactNode } from "react";
import { Sidebar } from "@/components/learn/sidebar";
import { TopBar } from "@/components/learn/top-bar";

/**
 * Design-Block (12.07.2026, Claude-Design-Export
 * `claude.ai/design/p/890b98ed-af1b-4360-8b96-b9076f8986cd`, von Josip als
 * verbindlich bestätigt — siehe PHASENSTATUS.md "Design-Update"). Löst die
 * vorherige, hier inline gebaute dunkle Indigo-Sidebar + einfache Kopfzeile
 * ab. Chrome jetzt in zwei eigenen Client-Komponenten (Sidebar/TopBar),
 * app-shell.tsx bleibt Server Component und reicht `children` unverändert
 * durch — keine Änderung an den Datenabfragen der Seiten, die AppShell
 * verwenden.
 *
 * Korrektur (Josips Lint-Lauf, 12.07.2026): `tenantName` war Pflicht-Prop,
 * wurde aber von zwei Seiten (lesezeichen/page.tsx, kurs/[slug]/l/
 * [lessonId]/page.tsx) nie übergeben — echter TypeScript-Fehler, nicht nur
 * ein Lint-Hinweis. Der Mandanten-Name hat im neuen Design ohnehin keine
 * Anzeigefläche mehr, deshalb Prop ganz entfernt statt nur optional
 * gemacht (kein totes Feld). `isStaff` bekommt echte Verwendung (Admin-
 * Link in der Sidebar, siehe sidebar.tsx) statt eines ungenutzten Props.
 */
export function AppShell({
  children,
  isStaff,
  userName,
  userEmail,
  breadcrumb = "Lernen · Meine Kurse",
  title,
}: {
  children: ReactNode;
  isStaff: boolean;
  userName: string;
  userEmail?: string;
  breadcrumb?: string;
  title?: string;
}) {
  return (
    <div className="flex min-h-screen" style={{ background: "#F4F5FA" }}>
      <Sidebar isStaff={isStaff} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          breadcrumb={breadcrumb}
          title={title ?? `Willkommen zurück, ${userName}`}
          userName={userName}
          userEmail={userEmail}
        />
        <main className="flex-1 px-10 pb-14 pt-4">{children}</main>
      </div>
    </div>
  );
}
