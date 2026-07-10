import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";

/**
 * Zweite Verteidigungslinie neben RLS (Sicherheitsregel-Geist §2.1):
 * RLS (`is_staff(tenant_id)`) verhindert das eigentliche Schreiben/Lesen
 * bereits hart in der DB. Diese Funktion liefert zusätzlich eine
 * benutzerfreundliche Fehlermeldung/Redirect-Grundlage in der UI-Schicht,
 * bevor überhaupt eine Anfrage an Supabase geht.
 */
export async function requireStaffTenant() {
  const tenant = await getTenant();
  if (!tenant) {
    throw new Error("Kein Mandant zu diesem Host gefunden.");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Nicht angemeldet.");
  }

  const { data: isStaff, error } = await supabase.rpc("is_staff", {
    t: tenant.id,
  });
  if (error || !isStaff) {
    throw new Error("Kein Zugriff — nur für Team-Mitglieder (Staff).");
  }

  return { tenant, user, supabase };
}
