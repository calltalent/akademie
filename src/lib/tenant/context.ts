import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { resolveTenantById } from "@/lib/tenant/resolve";
import type { PublicTenant } from "@/lib/tenant/types";

/**
 * Liest den von middleware.ts aufgelösten Mandanten für die aktuelle Anfrage.
 * `cache()` dedupliziert innerhalb einer Anfrage (Layout + Page rufen das
 * beide auf, es wird trotzdem nur einmal nachgeladen).
 *
 * Gibt `null` zurück, wenn kein Mandant zum Host passt (x-tenant-missing).
 * Aufrufer entscheiden selbst, ob das ein 404 oder eine Plattform-Seite ist.
 */
export const getTenant = cache(async (): Promise<PublicTenant | null> => {
  const headerList = await headers();
  const tenantId = headerList.get("x-tenant-id");
  if (!tenantId) return null;

  return resolveTenantById(tenantId);
});
