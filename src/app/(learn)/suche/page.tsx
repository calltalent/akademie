import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { searchLessons, type SearchResult } from "@/lib/ai/search";

/**
 * Phase 3, Block 3 — Semantische Suche über den kompletten sichtbaren
 * Kursinhalt des Mandanten. Klassisches GET-Suchformular (kein JavaScript
 * nötig), Ergebnisse laden serverseitig über den `q`-Query-Parameter —
 * gleiches Zugriffsmuster wie `kurs/[slug]/page.tsx` (Auth-Check + Redirect,
 * `getTenant()`, kein Staff-Check, das ist eine Lernenden-Seite).
 *
 * Fängt Fehler aus `searchLessons()` (z. B. fehlender `VOYAGE_API_KEY` in
 * einer anderen Umgebung) explizit über try/catch ab — eine Next.js
 * Error Boundary reicht bei Server Components mit synchronem Fehler in der
 * Render-Funktion nicht automatisch aus.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const tenant = await getTenant();
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const query = (q ?? "").trim();

  let results: SearchResult[] = [];
  let searchError: string | null = null;

  if (query.length > 0) {
    try {
      results = await searchLessons({ tenantId: tenant!.id, userId: user.id, query });
    } catch {
      searchError =
        "Die semantische Suche ist gerade nicht verfügbar. Bitte später erneut versuchen.";
    }
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-12">
      <a href="/" className="text-sm underline">
        ← Meine Kurse
      </a>
      <h1 className="text-2xl font-semibold" style={{ color: "var(--color-primary)" }}>
        Suche
      </h1>

      <form action="/suche" method="get" className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="q" className="sr-only">
          Suchbegriff
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={query}
          placeholder="Kursinhalte durchsuchen…"
          className="w-full rounded-md border px-3 py-2 text-base"
          style={{ borderRadius: "var(--radius)" }}
        />
        <button
          type="submit"
          className="px-4 py-2 text-base text-white"
          style={{ background: "var(--color-primary)", borderRadius: "var(--radius)" }}
        >
          Suchen
        </button>
      </form>

      {searchError && (
        <p role="alert" className="text-base text-red-700">
          {searchError}
        </p>
      )}

      {!searchError && query.length > 0 && results.length === 0 && (
        <p className="text-base text-gray-500">Keine Treffer für „{query}“.</p>
      )}

      {!searchError && results.length > 0 && (
        <ul className="flex flex-col gap-4">
          {results.map((result, index) => (
            <li
              key={`${result.lessonId}-${index}`}
              className="rounded-md border p-4"
              style={{ borderRadius: "var(--radius)" }}
            >
              <a
                href={`/kurs/${result.courseSlug}/l/${result.lessonId}`}
                className="text-base font-medium hover:underline"
              >
                {result.lessonTitle}
              </a>
              <p className="text-sm text-gray-500">{result.courseTitle}</p>
              <p className="mt-2 text-base text-gray-700">{result.snippet}</p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
