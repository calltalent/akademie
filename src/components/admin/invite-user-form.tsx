"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { inviteSingleUser } from "@/lib/users/actions";
import { initialCourseActionState } from "@/lib/courses/state";

/**
 * Optik (25.07.2026, Josips Auftrag "Einladungsoption als integriertes
 * Design darstellen"): nutzte generisches Tailwind-Grau statt der
 * Design-Tokens der übrigen Karten. Reine Optik, keine Logikänderung.
 */
export function InviteUserForm() {
  const t = useTranslations("admin.invite");
  const [state, action, pending] = useActionState(
    inviteSingleUser,
    initialCourseActionState,
  );

  return (
    <form action={action} className="flex flex-col gap-3 rounded-[14px] border bg-white px-6 py-5" style={{ borderColor: "#E7E8F2" }}>
      <div className="text-[17px] font-bold" style={{ color: "#1A1A2E" }}>
        {t("singleHeading")}
      </div>
      <label className="flex flex-col gap-1 text-sm font-semibold" style={{ color: "#3E3F66" }}>
        {t("emailLabel")}
        <input
          name="email"
          type="email"
          required
          className="rounded-[10px] border px-3.5 py-2.5 text-base font-normal"
          style={{ borderColor: "#D8DAEA" }}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold" style={{ color: "#3E3F66" }}>
        {t("nameLabel")}
        <input
          name="fullName"
          type="text"
          className="rounded-[10px] border px-3.5 py-2.5 text-base font-normal"
          style={{ borderColor: "#D8DAEA" }}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold" style={{ color: "#3E3F66" }}>
        {t("courseSlugLabel")}
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
          {t("successMessage")}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-[10px] px-4 py-2.5 text-base font-semibold text-white disabled:opacity-50"
        style={{ background: "#5663AE" }}
      >
        {pending ? t("inviting") : t("submitButton")}
      </button>
    </form>
  );
}
