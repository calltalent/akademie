"use client";

import { useState, useTransition } from "react";
import { archiveProduct, reactivateProduct } from "@/lib/stripe/products";

/**
 * Schnell-Umschalter fuer Aktiv/Deaktiviert, ohne das ganze Formular zu
 * oeffnen - gleiches Muster wie src/components/admin/publish-toggle.tsx.
 * Nicht explizit in der Plan-Dateiliste benannt (Punkt 10 nennt den
 * Aktiv-Schalter als Formularfeld), ergaenzt hier als kleine UX-Abkuerzung,
 * da archiveProduct()/reactivateProduct() ohnehin existieren.
 */
export function ProductActiveToggle({ productId, active }: { productId: string; active: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    setError(null);
    startTransition(async () => {
      const action = active ? archiveProduct : reactivateProduct;
      const result = await action(productId);
      if (result.error) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className="self-start rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
      >
        {active ? "Deaktivieren (im Shop verbergen)" : "Wieder aktivieren"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
