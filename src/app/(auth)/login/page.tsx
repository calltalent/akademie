"use client";

import { useActionState } from "react";
import { signInWithPassword, signInWithMagicLink } from "@/lib/auth/actions";
import type { AuthActionState } from "@/lib/auth/actions";

const initialState: AuthActionState = { error: null };

export default function LoginPage() {
  const [pwState, pwAction, pwPending] = useActionState(
    signInWithPassword,
    initialState,
  );
  const [magicState, magicAction, magicPending] = useActionState(
    signInWithMagicLink,
    initialState,
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-8 px-6">
      <h1 className="text-2xl font-semibold">Anmelden</h1>

      <form action={pwAction} className="flex flex-col gap-3" aria-label="Mit Passwort anmelden">
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
            autoComplete="current-password"
            className="rounded-md border px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-offset-1"
          />
        </label>
        {pwState.error && (
          <p role="alert" className="text-sm text-red-600">
            {pwState.error}
          </p>
        )}
        <button
          type="submit"
          disabled={pwPending}
          className="rounded-md bg-black px-4 py-2 text-base text-white disabled:opacity-50"
        >
          Anmelden
        </button>
      </form>

      <div className="flex items-center gap-3 text-sm text-gray-500" aria-hidden="true">
        <span className="h-px flex-1 bg-gray-200" />
        oder
        <span className="h-px flex-1 bg-gray-200" />
      </div>

      <form action={magicAction} className="flex flex-col gap-3" aria-label="Mit Magic Link anmelden">
        <label className="flex flex-col gap-1 text-sm">
          E-Mail für Magic Link
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="rounded-md border px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-offset-1"
          />
        </label>
        {magicState.error && (
          <p role="alert" className="text-sm text-red-600">
            {magicState.error}
          </p>
        )}
        {magicState.success && (
          <p role="status" className="text-sm text-green-700">
            Link gesendet. Bitte E-Mail-Postfach prüfen.
          </p>
        )}
        <button
          type="submit"
          disabled={magicPending}
          className="rounded-md border px-4 py-2 text-base disabled:opacity-50"
        >
          Magic Link senden
        </button>
      </form>

      <a href="/registrieren" className="text-center text-sm underline">
        Noch kein Konto? Registrieren
      </a>
    </main>
  );
}
