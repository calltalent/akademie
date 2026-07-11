import { checkAdminAccess } from "@/lib/auth/staff";
import { createClient } from "@/lib/supabase/server";
import { ApiKeysPanel } from "@/components/admin/api-keys-panel";
import { WebhooksPanel } from "@/components/admin/webhooks-panel";

/**
 * Phase 3, Block 7 — `/admin/einstellungen` (SPEC.md
 * Navigationskarte: "Domain, Sprachen, Tutor an/aus, Webhooks, API-Keys").
 * Diese Iteration deckt API-Keys + Webhooks ab; Domain/Sprachen/Tutor-
 * Umschalter sind nicht Teil von Block 7 (kein Bezug zu REST-API/
 * Webhooks) und bleiben ein späteres Thema.
 *
 * Eigenes Admin-Gate (`checkAdminAccess`, strenger als das layout-weite
 * Staff-Gate) — gleiches Muster wie `/admin/nutzer` (Block 6): RLS
 * `api_keys_admin_all`/`webhooks_admin_all` erlaubt nur owner/admin, ein
 * Trainer bekäme über das allgemeine Staff-Gate sonst eine irreführend
 * leere Seite statt einer klaren Meldung.
 */
export default async function AdminEinstellungenPage() {
  const access = await checkAdminAccess();

  if (!access.ok) {
    const text =
      access.reason === "not-admin"
        ? "Kein Zugriff — Einstellungen sind nur für Inhaber und Administratoren."
        : access.reason === "not-authenticated"
          ? "Bitte zuerst anmelden."
          : "Kein Mandant zu diesem Host gefunden.";
    return (
      <div className="mx-auto max-w-3xl">
        <p className="text-base">{text}</p>
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: apiKeys }, { data: webhooks }] = await Promise.all([
    supabase
      .from("api_keys")
      .select("id, name, last_used, active, created_at")
      .eq("tenant_id", access.tenant.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("webhooks")
      .select("id, url, events, active, created_at")
      .eq("tenant_id", access.tenant.id)
      .order("created_at", { ascending: false }),
  ]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Einstellungen</h1>
        <p className="text-base text-gray-500">
          API-Keys und Webhooks für externe Integrationen (z. B. Zapier, Make) dieses Mandanten.
        </p>
      </div>

      <ApiKeysPanel apiKeys={apiKeys ?? []} />
      <WebhooksPanel webhooks={(webhooks ?? []) as { id: string; url: string; events: string[]; active: boolean; created_at: string }[]} />
    </div>
  );
}
