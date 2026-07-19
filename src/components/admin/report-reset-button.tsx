"use client";

import { useTransition } from "react";
import { RotateCcw } from "lucide-react";

/**
 * "Bericht zurücksetzen" (Design-Import AdminReporting.dc.html, 19.07.2026)
 * — ein Symbol-Button, wiederverwendet für alle drei Berichtsarten
 * (Kurs/Nutzer/Quiz), nur `action`/`confirmMessage`/`label` unterscheiden
 * sich je Aufrufer. `confirm()` + native `alert()` bei Fehlern statt eines
 * eigenen Dialogs — gleiches Muster wie der Export selbst (dessen Skript
 * ebenfalls nur `window.confirm()` nutzt), passend zur geringen Häufigkeit
 * dieser Aktion.
 */
export function ReportResetButton({
  label,
  confirmMessage,
  action,
}: {
  /** aria-label/title, z. B. "Kursbericht zurücksetzen: Onboarding-Training". */
  label: string;
  confirmMessage: string;
  action: () => Promise<{ error: string | null; success?: boolean }>;
}) {
  const [pending, startTransition] = useTransition();

  function handleClick() {
    if (!confirm(confirmMessage)) return;
    startTransition(async () => {
      const result = await action();
      if (result.error) alert(result.error);
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      aria-label={label}
      title="Bericht zurücksetzen"
      className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] disabled:opacity-50"
      style={{ background: "#F4F5FA", color: "#B24343" }}
    >
      <RotateCcw size={14} aria-hidden="true" />
    </button>
  );
}
