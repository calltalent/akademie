"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  disableMembership,
  enableMembership,
  resendInviteLink,
  deleteMembership,
} from "@/lib/users/actions";

/**
 * Erweitert um "Link erneut senden" + "Löschen" (19.07.2026, Josips
 * Auftrag) — dieselben Server Actions wie in `teilnehmer-row-actions.tsx`
 * (Listenansicht), hier nur als einfache Text-Buttons statt Icons, passend
 * zum bisherigen schlichten Stil dieser Detailseiten-Karte.
 */
export function MembershipRowActions({
  userId,
  status,
  name,
  email,
}: {
  userId: string;
  status: string;
  name: string;
  email: string;
}) {
  const t = useTranslations("admin.teilnehmer");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const router = useRouter();

  function toggle() {
    setError(null);
    startTransition(async () => {
      const action = status === "active" ? disableMembership : enableMembership;
      await action(userId);
      router.refresh();
    });
  }

  function resend() {
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

  function remove() {
    if (!confirm(t("deleteConfirmDetail", { name, email }))) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await deleteMembership(userId);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.push("/admin/teilnehmer");
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={toggle}
          disabled={pending}
          className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
        >
          {status === "active" ? t("deactivateAction") : t("activateAction")}
        </button>
        <button
          onClick={resend}
          disabled={pending}
          className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
        >
          {t("resendTitle")}
        </button>
        <button
          onClick={remove}
          disabled={pending}
          className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
          style={{ borderColor: "#E9CFCF", color: "#B14A4A" }}
        >
          {t("deleteTitle")}
        </button>
      </div>
      {resent && (
        <p role="status" className="text-sm font-semibold" style={{ color: "#1F8A5B" }}>
          {t("linkSent")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm font-semibold" style={{ color: "#B14A4A" }}>
          {error}
        </p>
      )}
    </div>
  );
}
