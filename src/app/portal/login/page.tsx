"use client";

import { useActionState } from "react";
import { signInWithPassword, signInWithMagicLink } from "@/lib/auth/actions";
import type { AuthActionState } from "@/lib/auth/actions";

const initialState: AuthActionState = { error: null };

/**
 * Vereinfachte Portal-Variante von src/app/(auth)/login/page.tsx — nutzt
 * dieselben Server Actions (kein neues Auth-System, keine neuen Actions).
 * signInWithPassword redirect("/") funktioniert hier korrekt: der Browser
 * bleibt auf dem Portal-Host, src/middleware.ts schreibt "/" dort intern auf
 * /portal um (siehe checkPlatformAccess()-Gate in portal/layout.tsx).
 */
export default function PortalLoginPage() {
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
      <div>
        <p className="text-sm uppercase tracking-wide text-slate-400">
          Calltalent
        </p>
        <h1 className="text-2xl font-semibold">Betreiber-Portal — Anmelden</h1>
      </div>

      <form
        action={pwAction}
        className="flex flex-col gap-3"
        aria-label="Mit Passwort anmelden"
      >
        <label className="flex flex-col gap-1 text-sm">
          E-Mail
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-base text-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
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
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-base text-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
          />
        </label>
        {pwState.error && (
          <p role="alert" className="text-sm text-red-400">
            {pwState.error}
          </p>
        )}
        <button
          type="submit"
          disabled={pwPending}
          className="rounded-md bg-slate-50 px-4 py-2 text-base font-medium text-slate-950 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
        >
          Anmelden
        </button>
      </form>

      <div
        className="flex items-center gap-3 text-sm text-slate-500"
        aria-hidden="true"
      >
        <span className="h-px flex-1 bg-slate-800" />
        oder
        <span className="h-px flex-1 bg-slate-800" />
      </div>

      <form
        action={magicAction}
        className="flex flex-col gap-3"
        aria-label="Mit Magic Link anmelden"
      >
        <label className="flex flex-col gap-1 text-sm">
          E-Mail für Magic Link
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-base text-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
          />
        </label>
        {magicState.error && (
          <p role="alert" className="text-sm text-red-400">
            {magicState.error}
          </p>
        )}
        {magicState.success && (
          <p role="status" className="text-sm text-green-400">
            Link gesendet. Bitte E-Mail-Postfach prüfen.
          </p>
        )}
        <button
          type="submit"
          disabled={magicPending}
          className="rounded-md border border-slate-600 px-4 py-2 text-base disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
        >
          Magic Link senden
        </button>
      </form>

      <p className="text-center text-sm text-slate-500">
        Nur für Calltalent-Team-Mitglieder mit Plattform-Zugriff.
      </p>
    </main>
  );
}
