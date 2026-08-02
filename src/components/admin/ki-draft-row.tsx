"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FileText, Clock, Check, X, Eye, ExternalLink, RotateCcw, Trash2 } from "lucide-react";
import { retryDraft, deleteDraft } from "@/lib/generator/actions";

export type KiDraftRowData = {
  id: string;
  title: string;
  source: string;
  meta: string;
  status: "processing" | "review" | "applied" | "failed";
  appliedCourseId: string | null;
};

const STATUS_COLORS: Record<KiDraftRowData["status"], { color: string; bg: string; Icon: typeof Clock }> = {
  processing: { color: "#5663AE", bg: "#EAEBF7", Icon: Clock },
  review: { color: "#B98A1E", bg: "#FBF1DC", Icon: Clock },
  applied: { color: "#1F8A5B", bg: "#E3F2EA", Icon: Check },
  failed: { color: "#B24343", bg: "#FBE7E7", Icon: X },
};

/**
 * Eine Zeile in der "Entwürfe"-Liste (Design-Import AdminKiGenerator.dc.html,
 * 19.07.2026). Client-Komponente wegen der zwei echten Aktionen
 * (Löschen/Erneut versuchen), die eine Bestätigung + einen Server-Action-
 * Aufruf brauchen — gleiches Muster wie `product-row.tsx`/
 * `teilnehmer-row-actions.tsx` in diesem Bereich.
 */
export function KiDraftRow({ draft }: { draft: KiDraftRowData }) {
  const t = useTranslations("admin.ki");
  const colors = STATUS_COLORS[draft.status];
  const statusLabel = {
    processing: t("statusProcessing"),
    review: t("statusReview"),
    applied: t("statusApplied"),
    failed: t("statusFailed"),
  }[draft.status];
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleRetry() {
    startTransition(async () => {
      const result = await retryDraft(draft.id);
      if (result.error) {
        alert(result.error);
        return;
      }
      router.refresh();
    });
  }

  function handleDelete() {
    if (!confirm(t("deleteDraftConfirm", { title: draft.title }))) return;
    startTransition(async () => {
      const result = await deleteDraft(draft.id);
      if (result.error) alert(result.error);
    });
  }

  return (
    <div className="flex items-center gap-[18px] px-[28px] py-[18px]" style={{ borderTop: "1px solid #F4F5FA" }}>
      <span
        className="flex h-10 w-10 flex-none items-center justify-center rounded-[10px]"
        style={{ background: "#EAEBF7" }}
        aria-hidden="true"
      >
        <FileText size={18} color="#5663AE" strokeWidth={2.2} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-bold">{draft.title}</div>
        <div className="mt-0.5 truncate text-[13px]" style={{ color: "#A9AAC4" }}>
          {draft.source} · {draft.meta}
        </div>
      </div>
      <span
        className="flex h-8 w-8 flex-none items-center justify-center rounded-[8px]"
        style={{ background: colors.bg }}
        title={statusLabel}
        aria-label={t("statusAria", { label: statusLabel })}
      >
        <colors.Icon size={15} color={colors.color} strokeWidth={2.3} aria-hidden="true" />
      </span>

      {draft.status === "review" && (
        <a
          href={`/admin/ki/${draft.id}`}
          title={t("reviewDraftTitle")}
          aria-label={t("reviewDraftAria", { title: draft.title })}
          className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-[8px]"
          style={{ background: "#F4F5FA" }}
        >
          <Eye size={15} color="#5663AE" strokeWidth={2.2} aria-hidden="true" />
        </a>
      )}
      {draft.status === "applied" && draft.appliedCourseId && (
        <a
          href={`/admin/kurse/${draft.appliedCourseId}`}
          title={t("viewAppliedTitle")}
          aria-label={t("viewAppliedAria", { title: draft.title })}
          className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-[8px]"
          style={{ background: "#F4F5FA" }}
        >
          <ExternalLink size={15} color="#5663AE" strokeWidth={2.2} aria-hidden="true" />
        </a>
      )}
      {draft.status === "failed" && (
        <button
          type="button"
          onClick={handleRetry}
          disabled={pending}
          title={t("retryTitle")}
          aria-label={t("retryAria", { title: draft.title })}
          className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-[8px] disabled:opacity-50"
          style={{ background: "#F4F5FA" }}
        >
          <RotateCcw size={15} color="#5663AE" strokeWidth={2.2} aria-hidden="true" />
        </button>
      )}
      {draft.status === "processing" && <span className="w-8 flex-none" aria-hidden="true" />}

      <button
        type="button"
        onClick={handleDelete}
        disabled={pending}
        title={t("deleteDraftTitle")}
        aria-label={t("deleteDraftAria", { title: draft.title })}
        className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-[8px] disabled:opacity-50"
        style={{ background: "#F4F5FA" }}
      >
        <Trash2 size={15} color="#B24343" strokeWidth={2.2} aria-hidden="true" />
      </button>
    </div>
  );
}
