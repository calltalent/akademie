"use client";

import { useState, useTransition } from "react";
import { createCheckoutSession } from "@/lib/stripe/checkout";

/**
 * Kaufen-Button (Phase 2, Block 5). Eigene kleine Client-Komponente, weil
 * die Kaufseite selbst eine Server Component ist (Next.js erlaubt Hooks nur
 * in Client-Komponenten) - nicht explizit im architect-Plan-Dateiliste
 * benannt, aber technisch notwendig (kein eigenstaendiger Plan-Abweichungs-
 * grund, reine Next.js-Architekturkonsequenz).
 *
 * Gleiches Muster wie src/components/admin/publish-toggle.tsx /
 * membership-row-actions.tsx: direkter async Server-Action-Aufruf über
 * useTransition statt useActionState, da kein FormData-Formular noetig ist.
 * `createCheckoutSession()` loest bei Erfolg serverseitig `redirect()` aus
 * (wirft intern) - der `if (result?.error)`-Zweig wird deshalb nur bei
 * einem tatsaechlichen Fehler erreicht.
 */
export function BuyButton({ productSlug }: { productSlug: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await createCheckoutSession(productSlug);
      if (result?.error) {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="self-start rounded-md px-5 py-2.5 text-base text-white disabled:opacity-50"
        style={{ background: "var(--color-primary)", borderRadius: "var(--radius)" }}
      >
        {pending ? "Wird vorbereitet …" : "Kaufen"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
