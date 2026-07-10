"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { disableMembership, enableMembership } from "@/lib/users/actions";

export function MembershipRowActions({
  userId,
  status,
}: {
  userId: string;
  status: string;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function toggle() {
    startTransition(async () => {
      const action = status === "active" ? disableMembership : enableMembership;
      await action(userId);
      router.refresh();
    });
  }

  return (
    <button
      onClick={toggle}
      disabled={pending}
      className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
    >
      {status === "active" ? "Deaktivieren" : "Aktivieren"}
    </button>
  );
}
