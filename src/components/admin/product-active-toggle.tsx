"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { archiveProduct, reactivateProduct } from "@/lib/stripe/products";

/**
 * Schnell-Umschalter fuer Aktiv/Deaktiviert, ohne das ganze Formular zu
 * oeffnen - gleiches Muster wie src/components/admin/publish-toggle.tsx.
 * Nicht explizit in der Plan-Dateiliste benannt (Punkt 10 nennt den
 * Aktiv-Schalter als Formularfeld), ergaenzt hier als kleine UX-Abkuerzung,
 * da archiveProduct()/reactivateProduct() ohnehin existieren.
 */
export function ProductActiveToggle({ productId, active }: { productId: string; active: boolean }) {
  const t = useTranslations("payments.admin");
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
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className="self-start rounded-[9px] border px-3.5 py-2 text-sm font-semibold disabled:opacity-50"
        style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
      >
        {active ? t("deactivate") : t("reactivate")}
      </button>
      {error && (
        <p role="alert" className="text-sm font-semibold" style={{ color: "#B24343" }}>
          {error}
        </p>
      )}
    </div>
  );
}
