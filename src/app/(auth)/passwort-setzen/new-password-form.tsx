"use client";

import { useActionState, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Eye, EyeOff } from "lucide-react";
import { setNewPassword } from "@/lib/auth/actions";
import type { AuthActionState } from "@/lib/auth/actions";

const initialState: AuthActionState = { error: null };

/**
 * Design-Update (26.07.2026, Josips Auftrag): Design-Tokens statt
 * generischem Tailwind-Grau, gleiches Muster wie login/login-form.tsx.
 * Zusätzlich ein Auge-Symbol rechts im Eingabefeld zum Ein-/Ausblenden des
 * eingegebenen Passworts (Josips Auftrag) — reiner Anzeige-Toggle
 * (`type="text"`/`"password"`), keine Logikänderung an setNewPassword().
 */
export function NewPasswordForm() {
  const t = useTranslations("auth.passwordSet");
  const [state, action, pending] = useActionState(setNewPassword, initialState);
  const [visible, setVisible] = useState(false);

  // BUGFIX (22.07.2026): siehe lib/auth/actions.ts (signInWithPassword) —
  // redirect() aus der Server Action heraus war der langsame Pfad.
  useEffect(() => {
    if (state.redirectTo) window.location.href = state.redirectTo;
  }, [state.redirectTo]);

  return (
    <form action={action} className="flex flex-col gap-6">
      <label className="flex flex-col gap-[7px] text-sm font-semibold" style={{ color: "#3E3F66" }}>
        {t("newPasswordLabel")}
        <div className="relative">
          <input
            name="password"
            type={visible ? "text" : "password"}
            required
            minLength={8}
            autoComplete="new-password"
            className="w-full rounded-xl border px-4 py-3.5 pr-12 text-base font-normal focus:outline-none focus:ring-2 focus:ring-offset-1"
            style={{ borderColor: "#D8DAEA", color: "#1A1A2E" }}
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? t("hidePassword") : t("showPassword")}
            aria-pressed={visible}
            className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg"
            style={{ color: "#66679B" }}
          >
            {visible ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}
          </button>
        </div>
      </label>
      {state.error && (
        <p role="alert" className="text-sm" style={{ color: "#B24343" }}>
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-xl py-3.5 text-base font-bold text-white disabled:opacity-50"
        style={{ background: "var(--color-primary)" }}
      >
        {pending ? t("submitting") : t("submitButton")}
      </button>
    </form>
  );
}
