"use client";

import { useActionState, useEffect } from "react";
import { setNewPassword } from "@/lib/auth/actions";
import type { AuthActionState } from "@/lib/auth/actions";

const initialState: AuthActionState = { error: null };

export function NewPasswordForm() {
  const [state, action, pending] = useActionState(setNewPassword, initialState);

  // BUGFIX (22.07.2026): siehe lib/auth/actions.ts (signInWithPassword) —
  // redirect() aus der Server Action heraus war der langsame Pfad.
  useEffect(() => {
    if (state.redirectTo) window.location.href = state.redirectTo;
  }, [state.redirectTo]);

  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Neues Passwort
        <input
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="rounded-md border px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-offset-1"
        />
      </label>
      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-black px-4 py-2 text-base text-white disabled:opacity-50"
      >
        Passwort speichern
      </button>
    </form>
  );
}
