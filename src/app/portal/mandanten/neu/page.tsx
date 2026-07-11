"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createTenant } from "@/lib/platform/actions";
import type { PlatformActionState } from "@/lib/platform/actions";
import { TENANT_PLANS, TENANT_PLAN_LABELS } from "@/lib/platform/schema";

const initialState: PlatformActionState = { error: null };

/**
 * Anlage-Formular fuer neue Mandanten (Betreiber-Portal, Phase 4 Block 2).
 * DoD-Messung (SPEC.md §4.3): Formular ausfuellen → Absenden → Mandant
 * sofort erreichbar unter `{slug}.localhost:3000` — der "< 5 Minuten"-Test.
 *
 * `redirect()` passiert bewusst NICHT in der Server Action (siehe
 * src/lib/platform/actions.ts-Kommentar) — bei Erfolg liefert `createTenant`
 * `{success:true,id,slug}`, der Redirect zur Detailseite laeuft hier
 * client-seitig per `useRouter()` in einem `useEffect`.
 */
export default function NeuerMandantPage() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(createTenant, initialState);
  const [slug, setSlug] = useState("");

  useEffect(() => {
    if (state.success && state.id) {
      router.push(`/portal/mandanten/${state.id}`);
    }
  }, [state, router]);

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Neuer Mandant</h1>
        <p className="text-base text-slate-300">
          Name, Subdomain und Paket festlegen — der Mandant ist danach sofort erreichbar.
        </p>
      </div>

      <form action={formAction} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm" htmlFor="name">
          Name
          <input
            id="name"
            name="name"
            type="text"
            required
            maxLength={200}
            autoComplete="off"
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-base text-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm" htmlFor="slug">
          Subdomain
          <input
            id="slug"
            name="slug"
            type="text"
            required
            pattern="[a-z0-9][a-z0-9-]{1,40}"
            placeholder="mein-mandant"
            autoComplete="off"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            aria-describedby="slug-hint"
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-base text-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
          />
          <span id="slug-hint" className="text-xs text-slate-500">
            Nur Kleinbuchstaben, Ziffern, Bindestriche. Erreichbar unter:{" "}
            {slug ? `${slug}.localhost:3000` : "…"}
          </span>
        </label>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Paket</legend>
          {TENANT_PLANS.map((plan) => (
            <label
              key={plan}
              className="flex items-center gap-2 text-base"
              htmlFor={`plan-${plan}`}
            >
              <input
                id={`plan-${plan}`}
                type="radio"
                name="plan"
                value={plan}
                defaultChecked={plan === "komplett"}
              />
              {TENANT_PLAN_LABELS[plan]}
            </label>
          ))}
        </fieldset>

        {state.error && (
          <p role="alert" className="text-sm text-red-400">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-fit rounded-md bg-slate-50 px-4 py-2 text-base font-medium text-slate-950 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
        >
          {pending ? "Wird angelegt …" : "Mandant anlegen"}
        </button>
      </form>
    </main>
  );
}
