import { CourseImportForm } from "@/components/admin/course-import-form";

/**
 * Migrations-Importer (Phase 4, Block 4): mandanten-seitig im bestehenden
 * Admin-Bereich (NICHT im Betreiber-Portal — jeder Mandant importiert seine
 * eigenen Altdaten). Zugriffsschutz bereits über das layout-weite Staff-Gate
 * (src/app/(admin)/admin/layout.tsx, checkStaffAccess()) abgedeckt; die
 * Server Action prüft zusätzlich selbst über requireStaffTenant().
 */
export default function AdminImportPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <h1 className="text-2xl font-semibold">Altdaten importieren</h1>
      <CourseImportForm />
    </div>
  );
}
