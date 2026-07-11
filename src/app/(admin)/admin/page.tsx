import { getTenant } from "@/lib/tenant/context";
import { AiQuotaCard } from "@/components/admin/ai-quota-card";

/**
 * Admin-Hauptseite `/admin` (SPEC 4.2). Existierte vor Phase 3 Block 1 noch
 * nicht (per Glob geprüft) — hier neu angelegt. Staff-Gate kommt bereits
 * aus `admin/layout.tsx` (`checkStaffAccess()`), kein zweiter Zugriffscheck
 * nötig — gleiches Muster wie `admin/reporting/page.tsx`.
 *
 * BEWUSSTE ABGRENZUNG (Auftrag Phase 3 Block 1, Punkt 8): diese Seite
 * enthält hier NUR die neue KI-Kontingent-Kachel. Die übrigen
 * SPEC-4.2-Kacheln (aktive Lernende, Abschlussquote, offene Abgaben) sind
 * bewusst NICHT Teil dieses Auftrags und folgen bei Bedarf in einem
 * eigenen Block/Auftrag — bestehende Seiten (Kurse/Nutzer/Abgaben/
 * Reporting/Zahlungen) sind davon unberührt.
 */
export default async function AdminOverviewPage() {
  const tenant = await getTenant();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Übersicht</h1>
        <p className="text-sm text-gray-500">{tenant?.name ?? "Calltalent-Akademie"}</p>
      </div>
      <AiQuotaCard />
    </div>
  );
}
