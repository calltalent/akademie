import { AlertTriangle } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { getTenant } from "@/lib/tenant/context";
import { createClient } from "@/lib/supabase/server";
import { courseGenOutputSchema } from "@/lib/generator/schema";
import { KiUploadForm } from "@/components/admin/ki-upload-form";
import { KiDraftRow, type KiDraftRowData } from "@/components/admin/ki-draft-row";

/**
 * Admin/KI-Generator (Design-Import 19.07.2026, AdminKiGenerator.dc.html
 * aus dem Design-Projekt „Calltalent-Akademie Studenten-Portal" — Josips
 * Auftrag: "Design UND Funktionen genau wie im Design abgebildet"). Ersetzt
 * die bisherige Ein-Job-Ansicht (Formular + Inline-Vorschau, verloren beim
 * Neuladen — Zustand lebte nur im Browser) durch eine ECHTE, dauerhafte
 * Liste aller Entwürfe dieses Mandanten (`ai_jobs`, kind='course_gen'),
 * jeweils mit Status-Symbol und einer je Status passenden Aktion — genau
 * wie im Export, aber mit echten Daten/Funktionen statt der
 * Demo-Platzhalter des Scripts:
 *
 * - "Zu prüfen" (fertig, noch nicht übernommen) → Bearbeiten-Symbol führt
 *   auf die neue Review-Seite `/admin/ki/[jobId]` (im Export ein simpler
 *   Link ohne echtes Ziel).
 * - "Übernommen" → Symbol führt auf den echten Kurs-Editor
 *   `/admin/kurse/[courseId]`. Dauerhaft erkennbar über
 *   `ai_jobs.output.appliedCourseId`, seit `applyDraftAsCourse()`
 *   (lib/generator/apply.ts) das nach erfolgreicher Übernahme selbst
 *   einträgt — vorher gab es dafür gar keine dauerhafte Markierung.
 * - "Fehlgeschlagen" → "Erneut versuchen" (`retryDraft()`,
 *   lib/generator/actions.ts) legt einen neuen Auftrag mit demselben
 *   bereits extrahierten PDF-Text an, kein erneutes Hochladen nötig — im
 *   Export nur ein `confirm()`-Platzhalter ohne echte Wirkung.
 * - "Entwurf löschen" (`deleteDraft()`) — im Export ebenfalls nur ein
 *   `confirm()`-Platzhalter.
 *
 * NEUE FUNKTION "Zielkurs" (Design-Import, Upload-Formular): der Export
 * zeigt eine Auswahl "Neuen Kurs erstellen" oder einen bestehenden Kurs —
 * bisher konnte der Generator AUSSCHLIESSLICH neue Kurse anlegen. Jetzt
 * kann ein Entwurf stattdessen an einen bestehenden Kurs angehängt werden
 * (neue Module ans Ende, siehe `applyDraftAsCourse()`).
 */
export default async function AdminKiPage() {
  const t = await getTranslations("admin.ki");
  const tShared = await getTranslations("learn.shared");
  const tenant = await getTenant();
  const enabled = tenant?.settings.course_generator_enabled === true;
  const supabase = await createClient();

  const { data: courses } = enabled
    ? await supabase
        .from("courses")
        .select("id, title")
        .eq("tenant_id", tenant!.id)
        .order("title", { ascending: true })
    : { data: [] as { id: string; title: string }[] };

  const { data: jobs } = enabled
    ? await supabase
        .from("ai_jobs")
        .select("id, status, input, output, error, created_at")
        .eq("tenant_id", tenant!.id)
        .eq("kind", "course_gen")
        .order("created_at", { ascending: false })
    : { data: [] as { id: string; status: string; input: unknown; output: unknown; error: string | null; created_at: string }[] };

  const drafts: KiDraftRowData[] = (jobs ?? []).map((j) => {
    const input = (j.input ?? {}) as { sourceFilename?: string; titleHint?: string };
    const parsedOutput = courseGenOutputSchema.safeParse(j.output ?? {});
    const output = parsedOutput.success ? parsedOutput.data : { step: 0 };

    const title = output.draft?.title || input.titleHint || input.sourceFilename || t("unnamedDraft");
    const source = input.sourceFilename ?? t("noSource");

    let meta: string;
    if (j.status === "error") {
      meta = t("processingAbortedMeta");
    } else if (j.status === "done" && output.draft) {
      const moduleCount = output.draft.modules.length;
      const lessonCount = output.draft.modules.reduce((sum, m) => sum + m.lessons.length, 0);
      meta = `${tShared("modulesCount", { count: moduleCount })} · ${tShared("lessonsCount", { count: lessonCount })}`;
    } else {
      meta = [t("queueStep0"), t("queueStep1"), t("queueStep2"), t("queueStep3")][output.step] ?? t("processingFallback");
    }

    const status: KiDraftRowData["status"] =
      j.status === "error" ? "failed" : j.status === "done" ? (output.appliedCourseId ? "applied" : "review") : "processing";

    return { id: j.id, title, source, meta, status, appliedCourseId: output.appliedCourseId ?? null };
  });

  return (
    <div className="flex max-w-[920px] flex-col gap-6">
      <header>
        <div className="text-[13px] font-semibold" style={{ color: "#A9AAC4" }}>
          {t("eyebrow")}
        </div>
        <h1 className="mt-0.5 text-[26px] font-extrabold" style={{ letterSpacing: "-0.01em" }}>
          {t("title")}
        </h1>
      </header>

      <p className="text-base" style={{ color: "#66679B" }}>
        {t("intro")}
      </p>

      {!enabled ? (
        <div className="flex items-start gap-[18px] rounded-[14px] border bg-white p-[32px_34px]" style={{ borderColor: "#E7E8F2" }}>
          <span
            className="flex h-11 w-11 flex-none items-center justify-center rounded-[11px]"
            style={{ background: "#FBF1DC" }}
            aria-hidden="true"
          >
            <AlertTriangle size={20} color="#B98A1E" strokeWidth={2.2} />
          </span>
          <div>
            <div className="mb-1 text-base font-bold">{t("disabledHeading")}</div>
            <div className="text-[15px]" style={{ color: "#66679B" }}>
              {t("disabledHint")}
            </div>
          </div>
        </div>
      ) : (
        <>
          <KiUploadForm courseOptions={courses ?? []} />

          <div className="overflow-hidden rounded-[14px] border bg-white" style={{ borderColor: "#E7E8F2" }}>
            <div className="p-[24px_28px_16px] text-[17px] font-bold">{t("draftsHeading")}</div>
            {drafts.length === 0 ? (
              <p className="px-[28px] pb-6 text-sm" style={{ color: "#A9AAC4" }}>
                {t("noDrafts")}
              </p>
            ) : (
              drafts.map((d) => <KiDraftRow key={d.id} draft={d} />)
            )}
          </div>
        </>
      )}
    </div>
  );
}
