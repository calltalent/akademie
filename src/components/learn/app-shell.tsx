import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { LearnMobileNav } from "@/components/layout/LearnMobileNav";
import { checkPlatformAccess } from "@/lib/platform/auth";
import { getTenant } from "@/lib/tenant/context";
import { createClient } from "@/lib/supabase/server";
import { HtmlBackgroundSync } from "@/components/shell/html-background-sync";

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
 * Link in der Sidebar, siehe components/layout/Sidebar.tsx) statt eines
 * ungenutzten Props.
 *
 * Migration (Folgeauftrag): Chrome auf die generischen Komponenten unter
 * components/layout/ umgestellt (Sidebar/TopBar, Prompt-1-Tokens + lucide-
 * Icons). Produktionssicher verdrahtet: echter Nutzer statt Demo-Default,
 * `notifications={[]}` (kein erfundener Zähler/Eintrag, DESIGN-MASTERPROMPT.md
 * §8.1), Staff-Admin-Link via `isStaff` erhalten, aktiver Menüpunkt aus der
 * Route abgeleitet. Die bisherigen learn/sidebar.tsx + learn/top-bar.tsx
 * wurden im Zuge dessen entfernt (nur diese Datei hatte sie importiert).
 *
 * `isPlatformAdmin` NEU (19.07.2026, Josips Auftrag: "Direktlink zum
 * Mandantenbereich unter dem Admin-Bereich-Link"): wird HIER, nicht von
 * jeder aufrufenden Seite, berechnet — AppShell wird von rund einem Dutzend
 * Lernbereich-Seiten eingebunden (Dashboard, Kurskatalog, Lesezeichen,
 * Kurs-/Lektionsansicht, Einstellungen); jede einzelne um eine zusätzliche
 * Prop-Übergabe zu erweitern hätte unnötig viele Dateien angefasst. Nutzt
 * `checkPlatformAccess()` (dieselbe Prüfung wie admin/layout.tsx für den
 * "Mandanten"-Punkt der Admin-Sidebar) — eine zusätzliche, aber billige
 * Abfrage pro Seitenaufruf, analog zur bereits bestehenden `isStaff`-Prüfung
 * auf Aufrufer-Seite. `.ok` ist bei jedem Fehler/fehlender Anmeldung `false`
 * (fail-closed), zeigt den Link also nie fälschlich an.
 */
export async function AppShell({
  children,
  isStaff,
  userName,
  userEmail,
  breadcrumb,
  title,
  hideTitle = false,
}: {
  children: ReactNode;
  isStaff: boolean;
  userName: string;
  userEmail?: string;
  /**
   * Kein Default-Parameterwert mehr (i18n Block C2, siehe PHASENSTATUS.md):
   * `t()`/`getTranslations()` lässt sich nicht in einem Parameter-Default
   * einsetzen (kein `await` in Default-Ausdrücken). Der Fallback auf
   * "Lernen · Meine Kurse" passiert jetzt im Funktionskörper.
   */
  breadcrumb?: string;
  title?: string;
  /**
   * Josips Auftrag (24.07.2026, Folgeauftrag): auf Kurs-/Lektions-/Modul-/
   * Sektionsseiten stand der große Titel bereits doppelt (einmal hier in
   * der TopBar, einmal prominent in der jeweiligen Hero-/Erfolgs-Karte
   * weiter unten) — blendet NUR den `h1`-Titel aus, die Brotkrume bleibt
   * immer sichtbar (ausdrücklicher Folgeauftrag), siehe TopBar.tsx.
   */
  hideTitle?: boolean;
}) {
  const t = await getTranslations("learn.shell");
  const tShared = await getTranslations("learn.shared");
  const effectiveBreadcrumb = breadcrumb ?? tShared("myCoursesBreadcrumb");
  const platformAccess = await checkPlatformAccess();

  // NEU (23.07.2026, Josips Auftrag: admin-verwaltbarer "LINKS"-Bereich in
  // der Sidebar) — gehört hierher aus demselben Grund wie `isPlatformAdmin`
  // oben: AppShell wird von rund einem Dutzend Lernbereich-Seiten
  // eingebunden, jede einzelne um eine zusätzliche Prop zu erweitern wäre
  // unnötig aufwendig. `getTenant()` ist bereits `cache()`-gewrappt (liest
  // nur den `x-tenant-data`-Header, keine eigene DB-Anfrage) — nur die
  // `sidebar_links`-Abfrage selbst ist neu, eine einzelne indexierte SELECT
  // pro Seitenaufruf.
  const tenant = await getTenant();
  let customLinks: { id: string; label: string; url: string }[] = [];
  if (tenant) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("sidebar_links")
      .select("id, label, url")
      .eq("tenant_id", tenant.id)
      .order("position", { ascending: true });
    customLinks = data ?? [];
  }

  const topBarUser = { name: userName, email: userEmail, role: t("role") };
  const tenantName = tenant?.name || "Calltalent";
  const logoUrl = tenant?.branding?.logo_url ?? null;

  return (
    <>
      <LearnMobileNav
        isStaff={isStaff}
        isPlatformAdmin={platformAccess.ok}
        customLinks={customLinks}
        user={topBarUser}
        notifications={[]}
        tenantName={tenantName}
        logoUrl={logoUrl}
      />
      <div className="flex min-h-screen bg-bg">
        <HtmlBackgroundSync color="#F4F5FA" />
        <Sidebar
          isStaff={isStaff}
          isPlatformAdmin={platformAccess.ok}
          customLinks={customLinks}
          tenantName={tenantName}
          logoUrl={logoUrl}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar
            breadcrumb={effectiveBreadcrumb}
            title={title ?? t("welcomeBack", { name: userName })}
            user={topBarUser}
            notifications={[]}
            hideTitle={hideTitle}
          />
          <main className="flex-1 px-4 pb-8 pt-3 lg:px-10 lg:pb-14 lg:pt-4">{children}</main>
        </div>
      </div>
    </>
  );
}
