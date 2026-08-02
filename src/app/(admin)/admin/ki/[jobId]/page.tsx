import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { getTenant } from "@/lib/tenant/context";
import { createClient } from "@/lib/supabase/server";
import { courseGenOutputSchema } from "@/lib/generator/schema";
import { KiReviewPanel } from "@/components/admin/ki-review-panel";

/**
 * Entwurf-Review-Seite (Design-Import AdminKiGenerator.dc.html, 19.07.2026)
 * — NEUE Route, ersetzt das bisherige Inline-Vorschau-Panel auf `/admin/ki`
 * selbst (das den Fortschritt nur für die laufende Browser-Sitzung zeigte,
 * siehe Kommentar in `page.tsx` der Listenseite). Eine eigene, aufrufbare
 * URL je Entwurf erlaubt es, später zu einem noch laufenden ODER bereits
 * fertigen Entwurf zurückzukehren, statt an einen einzigen Seitenzustand
 * gebunden zu sein.
 */
export default async function AdminKiJobPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const t = await getTranslations("admin.ki");
  const { jobId } = await params;
  const tenant = await getTenant();
  const supabase = await createClient();

  const { data: job } = await supabase
    .from("ai_jobs")
    .select("id, status, output, error")
    .eq("id", jobId)
    .eq("tenant_id", tenant!.id)
    .eq("kind", "course_gen")
    .maybeSingle();

  return (
    <div className="flex max-w-[920px] flex-col gap-6">
      <Link
        href="/admin/ki"
        className="inline-flex w-fit items-center gap-2 text-sm font-semibold no-underline"
        style={{ color: "#5663AE" }}
      >
        <ArrowLeft size={16} strokeWidth={2.2} aria-hidden="true" />
        {t("backToDraftsLink")}
      </Link>

      {!job ? (
        <p className="text-base" style={{ color: "#66679B" }}>
          {t("draftNotFound")}
        </p>
      ) : (
        <KiReviewPanel
          jobId={job.id}
          initialStatus={job.status as "queued" | "running" | "done" | "error"}
          initialOutput={courseGenOutputSchema.safeParse(job.output ?? {}).success ? job.output : { step: 0 }}
          initialError={job.error}
        />
      )}
    </div>
  );
}
