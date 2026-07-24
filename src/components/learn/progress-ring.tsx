/**
 * Reiner SVG-Fortschrittsring (Server-Component). Umfang = 2πr, der sichtbare
 * Bogen wird über stroke-dashoffset gesteuert; um 90° gedreht, damit er oben
 * beginnt — 1:1 wie im Design-Export.
 *
 * Hierher verschoben (24.07.2026, Informations-Tab für Kurse nach
 * Baulig-Vorbild) aus `kurs/[slug]/page.tsx` — wird jetzt sowohl dort als
 * auch von `course-hero-header.tsx` (gemeinsamer Hero-Block für Übersicht
 * UND Information-Tab) gebraucht. Funktion unverändert übernommen.
 */
export function ProgressRing({
  size,
  radius,
  stroke,
  track,
  color,
  pct,
  label,
  labelColor,
  labelSize,
}: {
  size: number;
  radius: number;
  stroke: number;
  track: string;
  color: string;
  pct: number;
  label: string;
  labelColor: string;
  labelSize: number;
}) {
  const circumference = 2 * Math.PI * radius;
  const offset = Math.max(0, Math.round(circumference - (circumference * pct) / 100));
  const c = size / 2;
  return (
    <div className="relative" style={{ width: size, height: size }} role="img" aria-label={`${pct}% abgeschlossen`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={c} cy={c} r={radius} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={c}
          cy={c}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${c} ${c})`}
        />
      </svg>
      <div
        className="absolute inset-0 flex items-center justify-center font-extrabold"
        style={{ color: labelColor, fontSize: labelSize }}
      >
        {label}
      </div>
    </div>
  );
}
