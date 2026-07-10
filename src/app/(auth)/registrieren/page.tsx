"use client";

import { useActionState } from "react";
import { signUpWithPassword } from "@/lib/auth/actions";
import type { AuthActionState } from "@/lib/auth/actions";

const initialState: AuthActionState = { error: null };

export default function RegistrierenPage() {
  const [state, action, pending] = useActionState(signUpWithPassword, initialState);

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <h1 className="text-2xl font-semibold">Registrieren</h1>

      <form action={action} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Name
          <input
            name="fullName"
            type="text"
            required
            autoComplete="name"
            className="rounded-md border px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-offset-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          E-Mail
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="rounded-md border px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-offset-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Passwort
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
        {state.success && (
          <p role="status" className="text-sm text-green-700">
            Konto erstellt. Bitte E-Mail-Postfach zur Bestätigung prüfen.
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-black px-4 py-2 text-base text-white disabled:opacity-50"
        >
          Konto erstellen
        </button>
      </form>

      <a href="/login" className="text-center text-sm underline">
        Bereits ein Konto? Anmelden
      </a>
    </main>
  );
}
