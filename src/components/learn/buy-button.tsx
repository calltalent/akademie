"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";
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
 *
 * Design-Block (18.07.2026, Claude-Design-Import KursKauf.dc.html): Stil und
 * Text jetzt wie der "Zahlungspflichtig bestellen"-Button der Kosten-
 * Zusammenfassung im Export (voller Breite, gruener CTA, Haekchen-Icon) -
 * bewusste Wortwahl fuer die deutsche Button-Loesung (§312j BGB). Verhalten
 * unveraendert: loest weiterhin nur createCheckoutSession() aus und leitet
 * zu Stripe Checkout weiter, kein eigenes Bestell-/Zahlungsformular.
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
        className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-[15px] text-base font-extrabold text-white disabled:opacity-50"
        style={{ background: "#1F8A5B" }}
      >
        {pending ? "Wird vorbereitet …" : "Zahlungspflichtig bestellen"}
        {!pending && <Check size={18} strokeWidth={2.6} aria-hidden="true" />}
      </button>
      {error && (
        <p role="alert" className="text-sm" style={{ color: "#B24343" }}>
          {error}
        </p>
      )}
    </div>
  );
}
