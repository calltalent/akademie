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
    // NEU (Phase 5, Block 8, 12.07.2026): bei einer fehlgeschlagenen
    // Inhaber-Einladung NICHT sofort wegnavigieren — Josip soll den Hinweis
    // tatsächlich lesen können, bevor die Seite wechselt. Der Mandant ist in
    // beiden Fällen bereits angelegt (siehe actions.ts-Kommentar); ohne
    // Fehler bleibt der bisherige sofortige Redirect unverändert.
    if (state.success && state.id && !state.ownerInviteError) {
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

        <label className="flex flex-col gap-1 text-sm" htmlFor="ownerEmail">
          Inhaber-E-Mail (optional)
          <input
            id="ownerEmail"
            name="ownerEmail"
            type="email"
            autoComplete="off"
            aria-describedby="owner-hint"
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-base text-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
          />
          <span id="owner-hint" className="text-xs text-slate-500">
            Falls ausgefüllt: Konto wird als Inhaber (Owner) angelegt und bekommt sofort eine
            Einladungsmail mit Link zum Passwort-Setzen. Leer lassen, um den Mandanten ohne
            Inhaber anzulegen (Einladung kann später über den Mandanten selbst nachgeholt werden).
          </span>
        </label>

        {state.error && (
          <p role="alert" className="text-sm text-red-400">
            {state.error}
          </p>
        )}

        {state.success && state.ownerInviteError && (
          <div className="rounded-md border border-amber-700 bg-amber-950/40 p-3 text-sm text-amber-200">
            <p>
              Mandant wurde angelegt, die Inhaber-Einladung ist aber fehlgeschlagen:{" "}
              {state.ownerInviteError}
            </p>
            <a href={`/portal/mandanten/${state.id}`} className="mt-2 inline-block underline">
              Trotzdem zum Mandanten →
            </a>
          </div>
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
