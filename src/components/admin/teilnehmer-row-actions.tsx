"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail, Trash2 } from "lucide-react";
import { resendInviteLink, deleteMembership } from "@/lib/users/actions";

/**
 * Icon-Buttons je Teilnehmer-Zeile (19.07.2026, Josips Auftrag, im Anschluss
 * an den "otp_expired"-Fund): "Link erneut senden" (der ursprüngliche
 * Einladungslink ist nach dem ersten Klick verbraucht, siehe
 * `resendInviteLink()`) + "Löschen" (entfernt nur die Mitgliedschaft in
 * DIESEM Mandanten, siehe `deleteMembership()` — Verlauf/Einschreibungen
 * bleiben erhalten).
 *
 * Natives `confirm()` statt eines vollen `<dialog>` (wie beim Kurs-Löschen):
 * hier steht kein Content/keine Struktur auf dem Spiel, nur der Zugang
 * dieses einen Teilnehmers zu diesem Mandanten — dieselbe Abwägung wie beim
 * Modul-/Sektion-Löschen in `module-lesson-tree.tsx`.
 */
export function TeilnehmerRowActions({
  userId,
  name,
  email,
  courseCount,
}: {
  userId: string;
  name: string;
  email: string;
  courseCount: number;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const router = useRouter();

  function handleResend() {
    setError(null);
    setResent(false);
    startTransition(async () => {
      const result = await resendInviteLink(userId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setResent(true);
    });
  }

  function handleDelete() {
    const courseHint =
      courseCount > 0
        ? ` ${courseCount} Kurs-Einschreibung${courseCount === 1 ? "" : "en"} bleiben als Verlauf erhalten, der Zugang wird aber sofort entfernt.`
        : "";
    if (!confirm(`Teilnehmer „${name}" (${email}) wirklich löschen?${courseHint}`)) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteMembership(userId);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={handleResend}
          disabled={pending}
          aria-label={`Einladungslink erneut senden: ${name || email}`}
          title="Link erneut senden"
          className="inline-flex h-9 w-9 items-center justify-center rounded-[9px] border bg-white disabled:opacity-50"
          style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
        >
          <Mail size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={pending}
          aria-label={`Teilnehmer löschen: ${name || email}`}
          title="Löschen"
          className="inline-flex h-9 w-9 items-center justify-center rounded-[9px] border bg-white disabled:opacity-50"
          style={{ borderColor: "#E9CFCF", color: "#B14A4A" }}
        >
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </div>
      {resent && (
        <p role="status" className="text-xs font-semibold" style={{ color: "#1F8A5B" }}>
          Link verschickt.
        </p>
      )}
      {error && (
        <p role="alert" className="max-w-[180px] text-right text-xs font-semibold" style={{ color: "#B14A4A" }}>
          {error}
        </p>
      )}
    </div>
  );
}
