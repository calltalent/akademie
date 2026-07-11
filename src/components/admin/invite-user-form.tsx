"use client";

import { useActionState } from "react";
import { inviteSingleUser } from "@/lib/users/actions";
import { initialCourseActionState } from "@/lib/courses/state";

export function InviteUserForm() {
  const [state, action, pending] = useActionState(
    inviteSingleUser,
    initialCourseActionState,
  );

  return (
    <form
      action={action}
      className="flex flex-col gap-3 rounded-md border p-4"
      style={{ borderRadius: "var(--radius)" }}
    >
      <h2 className="text-lg font-medium">Einzelne Person einladen</h2>
      <label className="flex flex-col gap-1 text-sm">
        E-Mail
        <input
          name="email"
          type="email"
          required
          className="rounded-md border px-3 py-2 text-base"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Name (optional)
        <input name="fullName" type="text" className="rounded-md border px-3 py-2 text-base" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Kurs-Slug für automatische Zuweisung (optional)
        <input name="courseSlug" type="text" className="rounded-md border px-3 py-2 text-base" />
      </label>
      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="text-sm text-green-700">
          Konto angelegt und als Mitglied aktiviert — Willkommensmail mit Login-Link wird verschickt.
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-md px-4 py-2 text-base text-white disabled:opacity-50"
        style={{ background: "var(--color-primary)" }}
      >
        Einladen
      </button>
    </form>
  );
}
