import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { searchLessons, type SearchResult } from "@/lib/ai/search";
import { RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";

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
  const t = await getTranslations("learn.search");
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
    } catch (e) {
      // Rate-Limit-Fehler (searchLessons() wirft mit RATE_LIMIT_MESSAGE als
      // .message, siehe src/lib/ai/search.ts) wird 1:1 durchgereicht, alle
      // anderen Fehler (z. B. fehlender VOYAGE_API_KEY) bleiben generisch.
      searchError =
        e instanceof Error && e.message === RATE_LIMIT_MESSAGE ? RATE_LIMIT_MESSAGE : t("genericError");
    }
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-12">
      <Link href="/" className="text-sm underline">
        {t("backToCourses")}
      </Link>
      <h1 className="text-2xl font-semibold" style={{ color: "var(--color-primary)" }}>
        {t("heading")}
      </h1>

      <form action="/suche" method="get" className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="q" className="sr-only">
          {t("searchLabel")}
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={query}
          placeholder={t("placeholder")}
          className="w-full rounded-md border px-3 py-2 text-base"
          style={{ borderRadius: "var(--radius)" }}
        />
        <button
          type="submit"
          className="px-4 py-2 text-base text-white"
          style={{ background: "var(--color-primary)", borderRadius: "var(--radius)" }}
        >
          {t("submitButton")}
        </button>
      </form>

      {searchError && (
        <p role="alert" className="text-base text-red-700">
          {searchError}
        </p>
      )}

      {!searchError && query.length > 0 && results.length === 0 && (
        <p className="text-base text-gray-500">{t("noResults", { query })}</p>
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
