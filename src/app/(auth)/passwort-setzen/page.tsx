import { createClient } from "@/lib/supabase/server";
import { NewPasswordForm } from "./new-password-form";

/**
 * NEU (Phase 5, Block 8, 12.07.2026) — Ziel-Seite nach einem Recovery-/
 * Invite-Link (siehe auth/callback/route.ts, `?next=/passwort-setzen`).
 * Server-Component-Vorprüfung (statt den Nutzer erst nach dem Absenden des
 * Formulars scheitern zu lassen): ohne aktive Session (Link abgelaufen,
 * bereits benutzt, oder Seite direkt ohne Link aufgerufen) zeigt die Seite
 * sofort einen klaren Hinweis statt eines Formulars, das ohnehin fehlschlagen
 * würde (setNewPassword() prüft serverseitig zusätzlich dieselbe Session -
 * Defense-in-Depth, kein alleiniger Verlass auf diese Vorprüfung).
 */
export default async function PasswortSetzenPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <h1 className="text-2xl font-semibold">Passwort setzen</h1>

      {user ? (
        <>
          <p className="text-sm text-gray-600">
            Lege ein Passwort für <strong>{user.email}</strong> fest.
          </p>
          <NewPasswordForm />
        </>
      ) : (
        <>
          <p className="text-sm text-gray-600">
            Dieser Link ist abgelaufen oder wurde bereits verwendet.
          </p>
          <a href="/passwort-vergessen" className="text-center text-sm underline">
            Neuen Link anfordern
          </a>
        </>
      )}
    </main>
  );
}
