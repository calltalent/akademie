import { createClient } from "@/lib/supabase/server";

/**
 * Block 1: einfacher Platzhalter „Meine Kurse".
 * Mandanten-Branding (Block 2) und echte Kursliste (Block 3/5) folgen.
 */
export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-start justify-center gap-4 px-6">
      <h1 className="text-2xl font-semibold">Calltalent-Akademie</h1>
      {user ? (
        <>
          <p className="text-base">Angemeldet als {user.email}</p>
          <form action="/auth/signout" method="post">
            <button type="submit" className="rounded-md border px-4 py-2 text-base">
              Abmelden
            </button>
          </form>
        </>
      ) : (
        <a href="/login" className="rounded-md bg-black px-4 py-2 text-base text-white">
          Anmelden
        </a>
      )}
    </main>
  );
}
