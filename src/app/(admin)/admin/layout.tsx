import { checkStaffAccess } from "@/lib/auth/staff";

const REASON_TEXT: Record<string, string> = {
  "no-tenant": "Kein Mandant zu diesem Host gefunden.",
  "not-authenticated": "Bitte zuerst anmelden.",
  "not-staff": "Kein Zugriff — dieser Bereich ist nur für Team-Mitglieder (owner/admin/trainer).",
};

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const access = await checkStaffAccess();

  if (!access.ok) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-start justify-center gap-4 px-6">
        <h1 className="text-2xl font-semibold">Kein Zugriff</h1>
        <p className="text-base">{REASON_TEXT[access.reason]}</p>
        {access.reason === "not-authenticated" && (
          <a href="/login" className="rounded-md bg-black px-4 py-2 text-base text-white">
            Zur Anmeldung
          </a>
        )}
      </main>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <a href="/admin/kurse" className="text-lg font-semibold" style={{ color: "var(--color-primary)" }}>
          {access.tenant.name} — Admin
        </a>
        <nav className="flex gap-4 text-base">
          <a href="/admin/kurse" className="hover:underline">
            Kurse
          </a>
          <a href="/admin/abgaben" className="hover:underline">
            Abgaben
          </a>
          <a href="/admin/nutzer" className="hover:underline">
            Nutzer
          </a>
        </nav>
      </header>
      <div className="px-6 py-6">{children}</div>
    </div>
  );
}
