/**
 * Generische, barrierefreie Tabelle für die drei Reporting-Berichte
 * (Auftrag Block 6) — `<table>` mit `scope="col"` auf jeder Kopfzelle,
 * gleiches Muster wie src/components/admin/orders-table.tsx
 * (CLAUDE.md §3.4: Barrierefreiheit bei jeder Komponente).
 */
export function ReportTable({
  caption,
  headers,
  rows,
  emptyMessage = "Keine Daten vorhanden.",
}: {
  caption: string;
  headers: string[];
  rows: (string | number)[][];
  emptyMessage?: string;
}) {
  if (rows.length === 0) {
    return <p className="text-base text-gray-500">{emptyMessage}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b">
            {headers.map((h) => (
              <th key={h} scope="col" className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-3 py-2">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
