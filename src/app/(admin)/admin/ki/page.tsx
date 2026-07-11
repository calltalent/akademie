import { getTenant } from "@/lib/tenant/context";
import { KiGeneratorPanel } from "@/components/admin/ki-generator-panel";

/**
 * `/admin/ki` (SPEC §4.2) — Kurs-Generator: Dateien hochladen -> Kursentwurf
 * -> Review -> „Als Kurs übernehmen". Staff-Gate kommt aus
 * `admin/layout.tsx`. Feature-Flag strikt `=== true`, gleiches Muster wie
 * `tutor_enabled` (Block 4) und `payments_enabled` (Phase 2).
 */
export default async function AdminKiPage() {
  const tenant = await getTenant();
  const enabled = tenant?.settings.course_generator_enabled === true;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-2 text-2xl font-semibold">KI-Kursgenerator</h1>
      <p className="mb-6 text-base text-gray-600">
        Lade ein PDF-Dokument hoch — Claude erstellt daraus einen Kursentwurf (Module, Lektionen,
        Quiz-Fragen). Der Entwurf wird nie automatisch veröffentlicht; du prüfst und übernimmst ihn
        aktiv.
      </p>
      {!enabled ? (
        <p className="text-base">Der KI-Kursgenerator ist für diese Akademie nicht aktiviert.</p>
      ) : (
        <KiGeneratorPanel />
      )}
    </div>
  );
}
