"use client";

import { useState, useTransition } from "react";
import { approveListing, rejectListing, suspendListing } from "@/lib/platform/marketplace";
import type { MarketplaceModerationState } from "@/lib/platform/marketplace";

/**
 * Prüf-Formular (Marketplace M3, Plan Abschnitt 7). Gleiches
 * State-Management-Muster wie `admin/marketplace/listing-row.tsx`
 * (`useTransition` + `runAction`-Wrapper, kein `useActionState`, da diese
 * Server-Funktionen bewusst ohne `FormData`/`_prevState`-Signatur direkt
 * aufgerufen werden — Muster aus `submitListing`/`withdrawListing` dort).
 *
 * Nach einem erfolgreichen Aufruf zeigt der Server (`approveListing()` etc.)
 * über `revalidatePath()` automatisch den neuen Stand — Next.js aktualisiert
 * die aufrufende Route nach Abschluss einer Server-Function automatisch
 * (kein manuelles `router.refresh()` nötig, gleiches Verhalten wie bei
 * `ListingRow`).
 *
 * `status='submitted'`: Freigeben (ohne Zusatzfeld) ODER Ablehnen (Pflicht-
 * Begründung). `status='approved'`: nur noch Sperren (Pflicht-Begründung) —
 * eine Seite für beide Fälle, kein Duplikat (Auftrag).
 */
export function ReviewForm({
  listingId,
  status,
}: {
  listingId: string;
  status: "submitted" | "approved";
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState("");

  function runAction(action: () => Promise<MarketplaceModerationState>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) setError(result.error);
    });
  }

  if (status === "approved") {
    return (
      <div className="flex flex-col gap-3 rounded-[14px] border p-6" style={{ borderColor: "#1e293b", background: "#0f172a" }}>
        <h2 className="text-[17px] font-bold text-slate-50">Listing sperren</h2>
        <p className="text-sm" style={{ color: "#64748B" }}>
          Sperrt dieses bereits freigegebene Listing — es verschwindet sofort aus dem öffentlichen Marketplace, bis
          es erneut freigegeben wird.
        </p>
        <label htmlFor="suspend-note" className="text-sm font-semibold text-slate-200">
          Begründung (Pflicht)
        </label>
        <textarea
          id="suspend-note"
          value={reviewNote}
          onChange={(e) => setReviewNote(e.target.value)}
          rows={3}
          className="rounded-lg border bg-transparent p-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-300"
          style={{ borderColor: "#1e293b" }}
        />
        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => runAction(() => suspendListing(listingId, reviewNote))}
          className="w-fit rounded-[10px] px-[18px] py-2.5 text-sm font-bold text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
          style={{ background: "#B24343" }}
        >
          {pending ? "Sperrt …" : "Listing sperren"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 rounded-[14px] border p-6" style={{ borderColor: "#1e293b", background: "#0f172a" }}>
      <div>
        <h2 className="text-[17px] font-bold text-slate-50">Prüfung</h2>
        <p className="mt-1 text-sm" style={{ color: "#64748B" }}>
          Freigeben macht das Listing im öffentlichen Marketplace sichtbar. Ablehnen schickt es mit einer Begründung
          zurück an den Mandanten.
        </p>
      </div>

      <button
        type="button"
        disabled={pending}
        onClick={() => runAction(() => approveListing(listingId))}
        className="w-fit rounded-[10px] px-[18px] py-2.5 text-sm font-bold text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
        style={{ background: "#1F8A5B" }}
      >
        {pending ? "Gibt frei …" : "Freigeben"}
      </button>

      <div className="flex flex-col gap-2 border-t pt-5" style={{ borderColor: "#1e293b" }}>
        <label htmlFor="reject-note" className="text-sm font-semibold text-slate-200">
          Ablehnen — Begründung (Pflicht)
        </label>
        <textarea
          id="reject-note"
          value={reviewNote}
          onChange={(e) => setReviewNote(e.target.value)}
          rows={3}
          className="rounded-lg border bg-transparent p-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-300"
          style={{ borderColor: "#1e293b" }}
        />
        <button
          type="button"
          disabled={pending}
          onClick={() => runAction(() => rejectListing(listingId, reviewNote))}
          className="w-fit rounded-[10px] border px-[18px] py-2.5 text-sm font-bold disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
          style={{ borderColor: "#B24343", color: "#F87171" }}
        >
          {pending ? "Lehnt ab …" : "Ablehnen"}
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
