import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";

/**
 * Block 2: zeigt Mandanten-Branding (Name, Akzentfarbe via CSS-Variable).
 * Ohne erkennbaren Mandanten (z. B. Root-Domain in Dev ohne Subdomain):
 * Hinweis statt Absturz — hilfreich beim lokalen Testen der Mandantentrennung.
 */
export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenant = await getTenant();

  if (!tenant) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-start justify-center gap-4 px-6">
        <h1 className="text-2xl font-semibold">Calltalent-Akademie — Dev-Root</h1>
        <p className="text-base">
          Kein Mandant zu diesem Host gefunden. Zum Testen eine Mandanten-Subdomain
          aufrufen, z. B.:
        </p>
        <ul className="list-inside list-disc text-base">
          <li>
            <code>http://demo-blau.localhost:3000</code>
          </li>
          <li>
            <code>http://demo-gruen.localhost:3000</code>
          </li>
        </ul>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-start justify-center gap-4 px-6">
      <h1
        className="text-2xl font-semibold"
        style={{ color: "var(--color-primary)" }}
      >
        {tenant.name}
      </h1>
      {user ? (
        <>
          <p className="text-base">Angemeldet als {user.email}</p>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="rounded-md border px-4 py-2 text-base"
              style={{ borderRadius: "var(--radius)" }}
            >
              Abmelden
            </button>
          </form>
        </>
      ) : (
        <a
          href="/login"
          className="px-4 py-2 text-base text-white"
          style={{ background: "var(--color-primary)", borderRadius: "var(--radius)" }}
        >
          Anmelden
        </a>
      )}
    </main>
  );
}
