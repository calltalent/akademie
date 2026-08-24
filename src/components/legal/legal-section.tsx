/**
 * Abschnitt einer Rechtsseite — dieselbe Typografie wie die bestehenden
 * Marketplace-Rechtsseiten (`src/app/marketplace/impressum/page.tsx`), nur
 * einmal statt in jeder Seite wiederholt. Überschriften sind echte `<h2>`
 * (Screenreader-Gliederung, CLAUDE.md §3.4), die Optik macht `uppercase`,
 * nicht die Textauszeichnung.
 */
export function LegalSection({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6 first:mt-8">
      <h2 className="text-sm font-bold uppercase tracking-[0.03em] text-muted-400">{heading}</h2>
      <div className="mt-2 space-y-2 text-base leading-relaxed text-ink">{children}</div>
    </section>
  );
}

/** Seitentitel + optionale Stand-Zeile, gemeinsam für alle drei Rechtsseiten. */
export function LegalHeader({ title, updated }: { title: string; updated?: string }) {
  return (
    <>
      <h1 className="text-[28px] font-extrabold text-ink">{title}</h1>
      {updated && <p className="mt-2 text-sm text-muted-400">{updated}</p>}
    </>
  );
}
