"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { acquireFreeListing } from "@/lib/marketplace/acquire";
import { createMarketplaceCheckout } from "@/lib/marketplace/checkout";

/**
 * Marketplace-Kaufbutton (M5, Plan Abschnitt 9 "Kaufbutton auf der
 * Detailseite aktivieren") — eigene kleine Client-Komponente, weil die
 * Detailseite selbst eine Server Component ist (gleicher, technisch
 * erzwungener Grund wie `components/learn/buy-button.tsx`, dessen Muster
 * hier 1:1 übernommen ist: direkter async Server-Action-Aufruf über
 * `useTransition` statt `useActionState`, `redirect()` innerhalb der Action
 * wirft intern, der `if (result?.error)`-Zweig greift deshalb nur bei einem
 * tatsächlichen Fehler).
 */
export function MarketplaceBuyButton({ slug, isFree }: { slug: string; isFree: boolean }) {
  const t = useTranslations("marketplace.detail");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = isFree ? await acquireFreeListing(slug) : await createMarketplaceCheckout(slug);
      if (result?.error) {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="inline-flex items-center justify-center gap-2 rounded-[10px] bg-accent px-6 py-3 text-sm font-bold text-white disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
      >
        {pending ? t("buyPending") : isFree ? t("acquireButton") : t("buyButton")}
        {!pending && <Check size={16} strokeWidth={2.6} aria-hidden="true" />}
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
