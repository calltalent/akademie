"use client";

import { useRef } from "react";
import { Plus } from "lucide-react";
import { InviteUserForm } from "@/components/admin/invite-user-form";
import { CsvImportForm } from "@/components/admin/csv-import-form";

/**
 * Design-Block 6 (13.07.2026, AdminTeilnehmer.dc.html): der Export zeigt
 * genau EINEN "Einladen"-Button ohne Zielseite. Real gibt es zwei
 * Einlade-Wege (Einzelperson, CSV-Bulk) — beide bleiben erhalten, gebündelt
 * in diesem Modal (Projektkonvention natives <dialog>, siehe
 * api-key-created-dialog.tsx) statt sie zu unterschlagen. Kein Auto-Close
 * nach Einzel-Einladung (anders als new-course-dialog.tsx), da Nutzer im
 * selben Zug ggf. noch den CSV-Import darunter nutzen wollen.
 */
export function InviteUserDialog() {
  const ref = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        className="inline-flex flex-none items-center gap-2 rounded-[11px] px-[18px] py-3 text-[15px] font-bold text-white"
        style={{ background: "#5663AE" }}
      >
        <Plus aria-hidden="true" size={16} />
        Einladen
      </button>
      <dialog
        ref={ref}
        aria-labelledby="invite-user-title"
        className="rounded-md border p-6 backdrop:bg-black/40"
        style={{ borderRadius: "var(--radius)", width: "min(520px, 90vw)" }}
      >
        <h2 id="invite-user-title" className="sr-only">
          Teilnehmer einladen
        </h2>
        <div className="flex flex-col gap-5">
          <InviteUserForm />
          <CsvImportForm />
        </div>
        <button
          type="button"
          onClick={() => ref.current?.close()}
          className="mt-4 text-sm underline"
        >
          Schließen
        </button>
      </dialog>
    </>
  );
}
