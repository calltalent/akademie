"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { Plus, X } from "lucide-react";
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
 *
 * Rechtes Panel statt zentriertem Dialog (25.07.2026, Josips Auftrag "als
 * integriertes Design rechts darstellen"): natives `<dialog>` zentrierte
 * sich vorher NICHT (Projekt-CSS setzt die UA-Zentrierung zurück) und landete
 * dadurch oben links als unstyled weißer Kasten mit generischem
 * Tailwind-Grau — wirkte wie ein Fremdkörper statt Teil der Oberfläche.
 * Bleibt technisch ein `<dialog>` (Fokusfalle/Escape/`::backdrop` bekommt man
 * dadurch geschenkt, gleiche Projektkonvention wie überall sonst), nur
 * fix rechts über die volle Höhe positioniert und mit denselben
 * Design-Tokens wie die übrigen Karten (Kurse/Einstellungen).
 */
export function InviteUserDialog() {
  const t = useTranslations("admin.invite");
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
        {t("openButton")}
      </button>
      <dialog
        ref={ref}
        aria-labelledby="invite-user-title"
        className="m-0 ml-auto h-dvh max-h-dvh w-full backdrop:bg-black/40"
        style={{ maxWidth: "min(440px, 100vw)" }}
      >
        <div className="flex h-full flex-col gap-5 overflow-y-auto bg-white px-7 py-6">
          <div className="flex items-center justify-between gap-4">
            <h2 id="invite-user-title" className="text-[19px] font-extrabold" style={{ color: "#1A1A2E" }}>
              {t("heading")}
            </h2>
            <button
              type="button"
              onClick={() => ref.current?.close()}
              aria-label={t("closeAria")}
              className="flex h-9 w-9 flex-none items-center justify-center rounded-[9px] border bg-white"
              style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>

          <InviteUserForm />
          <CsvImportForm />
        </div>
      </dialog>
    </>
  );
}
