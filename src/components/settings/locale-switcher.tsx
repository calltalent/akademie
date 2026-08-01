"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setLocale } from "@/lib/account/actions";
import { LOCALE_NAMES, type Locale } from "@/i18n/config";

/**
 * Sprachumschalter (PLAN_Mehrsprachigkeit-i18n.md Abschnitt 4, Block B2).
 *
 * Natives `<select>` statt Custom-Dropdown: Josip hat 90 % Sehbehinderung
 * (CLAUDE.md §3.4/§3.7) — ein Eigenbau-Dropdown bräuchte selbst gebaute
 * Tastatur-/Screenreader-Logik (Pfeiltasten, ARIA-Rollen, Fokus-Falle), ein
 * natives Element bekommt das kostenlos vom Browser. Sprachnamen stehen
 * jeweils IN der Sprache selbst (LOCALE_NAMES), kein Flaggen-Icon als
 * alleiniger Bedeutungsträger.
 *
 * Zeigt ausschließlich die effektive Locale-Menge des aktuellen Mandanten
 * (von außen übergeben, siehe einstellungen-tabs.tsx) — nie SUPPORTED_LOCALES
 * direkt, sonst könnte ein Nutzer eine vom Mandanten gesperrte Sprache
 * anzeigen/wählen. Rendert `null` bei genau einem Eintrag: ein Auswahlfeld
 * mit einer einzigen, immer gleichen Option wäre ein toter Bedienpunkt und
 * ein sinnloser Tabstopp.
 */
export function LocaleSwitcher({
  enabledLocales,
  currentLocale,
}: {
  enabledLocales: Locale[];
  currentLocale: Locale;
}) {
  const router = useRouter();
  const selectRef = useRef<HTMLSelectElement>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; kind: "success" | "error" } | null>(null);

  // Muss NACH den Hooks stehen (Regeln der Hooks) — kein bedingtes Early-Return davor.
  if (enabledLocales.length <= 1) return null;

  function handleChange(value: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await setLocale(value);
      // Fokus bewusst in BEIDEN Fällen auf dem Auswahlfeld halten (Plan
      // Abschnitt 4: "hält den Fokus danach") — weder Erfolg noch Fehler
      // dürfen den Tastaturfokus verlieren lassen.
      selectRef.current?.focus();
      if (result.error) {
        setMessage({ text: result.error, kind: "error" });
        return;
      }
      setMessage({ text: "Sprache geändert.", kind: "success" });
      // Serverkomponenten (u. a. das <html lang>-Attribut in layout.tsx) lesen
      // die Locale aus dem x-locale-Header von middleware.ts — der wertet das
      // soeben gesetzte NEXT_LOCALE-Cookie erst beim NÄCHSTEN Request aus.
      // router.refresh() löst genau diesen Request aus, ohne die Seite zu
      // verlassen (kein window.location-Wechsel nötig).
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-[7px]">
      <label htmlFor="locale-switcher" className="text-sm font-semibold text-navy">
        Sprache
      </label>
      <select
        id="locale-switcher"
        ref={selectRef}
        value={currentLocale}
        disabled={pending}
        onChange={(e) => handleChange(e.target.value)}
        className="w-full max-w-[260px] rounded-sm border border-border-300 bg-white px-[15px] py-[13px] text-base text-ink disabled:opacity-50"
      >
        {enabledLocales.map((locale) => (
          <option key={locale} value={locale}>
            {LOCALE_NAMES[locale]}
          </option>
        ))}
      </select>
      <p
        role="status"
        aria-live="polite"
        className="min-h-[1.25em] text-sm"
        style={{ color: message?.kind === "error" ? "#B24343" : "#1F8A5B" }}
      >
        {message?.text}
      </p>
    </div>
  );
}
