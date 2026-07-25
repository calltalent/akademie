"use client";

import { useActionState } from "react";
import { inviteSingleUser } from "@/lib/users/actions";
import { initialCourseActionState } from "@/lib/courses/state";

/**
 * Optik (25.07.2026, Josips Auftrag "Einladungsoption als integriertes
 * Design darstellen"): nutzte generisches Tailwind-Grau statt der
 * Design-Tokens der übrigen Karten. Reine Optik, keine Logikänderung.
 */
export function InviteUserForm() {
  const [state, action, pending] = useActionState(
    inviteSingleUser,
    initialCourseActionState,
  );

  return (
    <form action={action} className="flex flex-col gap-3 rounded-[14px] border bg-white px-6 py-5" style={{ borderColor: "#E7E8F2" }}>
      <div className="text-[17px] font-bold" style={{ color: "#1A1A2E" }}>
        Einzelne Person einladen
      </div>
      <label className="flex flex-col gap-1 text-sm font-semibold" style={{ color: "#3E3F66" }}>
        E-Mail
        <input
          name="email"
          type="email"
          required
          className="rounded-[10px] border px-3.5 py-2.5 text-base font-normal"
          style={{ borderColor: "#D8DAEA" }}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold" style={{ color: "#3E3F66" }}>
        Name (optional)
        <input
          name="fullName"
          type="text"
          className="rounded-[10px] border px-3.5 py-2.5 text-base font-normal"
          style={{ borderColor: "#D8DAEA" }}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold" style={{ color: "#3E3F66" }}>
        Kurs-Slug für automatische Zuweisung (optional)
        <input
          name="courseSlug"
          type="text"
          className="rounded-[10px] border px-3.5 py-2.5 text-base font-normal"
          style={{ borderColor: "#D8DAEA" }}
        />
      </label>
      {state.error && (
        <p role="alert" className="text-sm font-semibold" style={{ color: "#B14A4A" }}>
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="text-sm font-semibold" style={{ color: "#1F8A5B" }}>
          Konto angelegt und als Mitglied aktiviert — Willkommensmail mit Login-Link wird verschickt.
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-[10px] px-4 py-2.5 text-base font-semibold text-white disabled:opacity-50"
        style={{ background: "#5663AE" }}
      >
        {pending ? "Wird eingeladen …" : "Einladen"}
      </button>
    </form>
  );
}
