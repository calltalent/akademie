"use client";

import { useActionState } from "react";
import { requestDeletion } from "./actions";
import type { ProfilActionState } from "./actions";

const initialState: ProfilActionState = { error: null };

/**
 * Löschantrag-Formular (Art. 17 DSGVO), Phase 4 Block 3. Eigene
 * Client-Komponente, weil `src/app/profil/page.tsx` eine Server Component
 * ist und `useActionState` einen Client-Boundary braucht — gleiches Muster
 * wie `src/app/portal/mandanten/[id]/mandant-edit-form.tsx`. Helles
 * Mandanten-Farbschema (`var(--color-primary)`, normale Tailwind-Graustufen)
 * wie der Rest von `/profil` — NICHT das dunkle Portal-Schema.
 */
export function DeletionRequestForm() {
  const [state, formAction, pending] = useActionState(requestDeletion, initialState);

  if (state.success && !state.error) {
    return (
      <p role="status" aria-live="polite" className="text-sm text-gray-700">
        Löschantrag eingereicht — wird geprüft.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm" htmlFor="deletion-reason">
        Grund (optional)
        <textarea
          id="deletion-reason"
          name="reason"
          rows={3}
          maxLength={1000}
          className="rounded-md border border-gray-300 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-offset-2"
          style={{ borderRadius: "var(--radius)" }}
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
        className="w-fit rounded-md px-4 py-2 text-base font-medium text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-offset-2"
        style={{ background: "var(--color-primary)", borderRadius: "var(--radius)" }}
      >
        {pending ? "Wird gesendet …" : "Löschung beantragen"}
      </button>
    </form>
  );
}
