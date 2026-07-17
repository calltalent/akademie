"use client";

/**
 * Kleiner, geteilter Baustein für die zwei Umschalter aus dem Aufnahme-Plan
 * (`calm-watching-dewdrop.md`, Schritt B): „Hochladen | Aufnehmen" in
 * `video-source-switch.tsx` und „Bildschirm | Webcam" in `video-recorder.tsx`.
 * Implementiert das WAI-ARIA-APG-„Radio Group"-Muster: echte `<button
 * role="radio">`-Elemente (kein `div onClick`, CLAUDE.md §3.4), roving
 * Tabindex (nur die aktive Option ist per Tab erreichbar) + Pfeiltasten.
 */
export function VideoRadioGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}) {
  function focusAndSelect(index: number, refs: (HTMLButtonElement | null)[]) {
    const target = options[index];
    if (!target) return;
    onChange(target.value);
    refs[index]?.focus();
  }

  const buttonRefs: (HTMLButtonElement | null)[] = [];

  function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      focusAndSelect((index + 1) % options.length, buttonRefs);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      focusAndSelect((index - 1 + options.length) % options.length, buttonRefs);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusAndSelect(0, buttonRefs);
    } else if (e.key === "End") {
      e.preventDefault();
      focusAndSelect(options.length - 1, buttonRefs);
    }
  }

  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((option, index) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            ref={(el) => {
              buttonRefs[index] = el;
            }}
            onClick={() => onChange(option.value)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            className={`rounded-md border px-3 py-2 text-sm ${
              checked ? "border-gray-900 font-medium" : "border-gray-300"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
