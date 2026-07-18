"use client";

import { useState } from "react";
import { COURSE_CATEGORIES } from "@/lib/courses/categories";

/**
 * Client-Teil des Kurskatalogs (Referenz: Kurskatalog.dc.html): Filter-Chips
 * + Kurskarten-Grid. Nur die Interaktion (aktiver Chip, Klick filtert) ist
 * client-seitig; die Daten kommen als `items` echt aus page.tsx.
 *
 * Farben/Radien/Abstände aus dem Referenz-HTML: Chip 9/16px, radius 10px;
 * Karte radius 14px; Thumb 132px mit Diagonalstreifen; CTA radius 10px
 * (Weiterlernen = accent, Zum Kurs = cream). Tokens: accent, navy, ink,
 * cream, border-100, muted-400/500.
 */
export type CatalogItem = {
  id: string;
  slug: string;
  title: string;
  eyebrow: string | null;
  meta: string;
  enrolled: boolean;
  category: string | null;
  coverUrl: string | null;
  tint: string;
};

const ALL = "Alle Kurse";

export function KurskatalogGrid({ items }: { items: CatalogItem[] }) {
  const [active, setActive] = useState<string>(ALL);

  const filters = [ALL, ...COURSE_CATEGORIES];
  const filtered = active === ALL ? items : items.filter((i) => i.category === active);

  return (
    <div>
      {/* Filter-Chips */}
      <div className="mb-7 flex flex-wrap gap-2.5">
        {filters.map((f) => {
          const isActive = active === f;
          return (
            <button
              key={f}
              type="button"
              onClick={() => setActive(f)}
              aria-pressed={isActive}
              className={`inline-flex items-center rounded-[10px] border px-4 py-[9px] text-sm font-semibold transition-colors ${
                isActive
                  ? "border-accent bg-accent text-white"
                  : "border-border-100 bg-white text-navy hover:bg-bg"
              }`}
            >
              {f}
            </button>
          );
        })}
      </div>

      {/* Kurskarten-Grid */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-border-100 bg-white px-6 py-10 text-center text-sm text-muted-400">
          {items.length === 0
            ? "Noch keine veröffentlichten Kurse."
            : "Keine Kurse in dieser Kategorie."}
        </div>
      ) : (
        <div className="grid gap-6" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 320px))" }}>
          {filtered.map((c) => (
            <a
              key={c.id}
              href={`/kurs/${c.slug}`}
              className="flex flex-col overflow-hidden rounded-[14px] border bg-white text-inherit no-underline"
              style={{
                borderColor: "#D8DAEA",
                boxShadow: "0 1px 2px rgba(26,26,46,.05), 0 4px 10px rgba(26,26,46,.06)",
              }}
            >
              {c.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- Storage-URL, kein next/image-Loader konfiguriert
                <img src={c.coverUrl} alt="" className="aspect-video w-full object-cover object-center" />
              ) : (
                <div
                  className="aspect-video w-full"
                  style={{
                    backgroundColor: c.tint,
                    backgroundImage:
                      "repeating-linear-gradient(45deg, " +
                      c.tint +
                      " 0 10px, rgba(255,255,255,.55) 10px 20px)",
                  }}
                  aria-hidden="true"
                />
              )}
              <div className="flex flex-1 flex-col p-5">
                {c.eyebrow && (
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.03em] text-muted-400">
                    {c.eyebrow}
                  </div>
                )}
                <div className="mb-2.5 text-[17px] font-bold leading-snug text-ink">{c.title}</div>
                <div className="mb-[18px] text-sm text-muted-500">{c.meta}</div>
                <span
                  className={`mt-auto inline-flex items-center justify-center rounded-[10px] px-4 py-[11px] text-sm font-bold ${
                    c.enrolled ? "bg-accent text-white" : "bg-cream text-ink"
                  }`}
                >
                  {c.enrolled ? "Weiterlernen" : "Zum Kurs"}
                </span>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
