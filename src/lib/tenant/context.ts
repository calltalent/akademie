import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { resolveTenantById } from "@/lib/tenant/resolve";
import type { PublicTenant } from "@/lib/tenant/types";

function base64ToUtf8(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * Liest den von middleware.ts aufgelösten Mandanten für die aktuelle Anfrage.
 * `cache()` dedupliziert innerhalb einer Anfrage (Layout + Page rufen das
 * beide auf, es wird trotzdem nur einmal nachgeladen).
 *
 * Performance-Fix (19.07.2026, Josips Fund: Login/Seitenaufbau spürbar
 * langsam): las hier vorher NUR die ID aus dem Header und lud den Mandanten
 * per `resolveTenantById()` erneut aus der DB — bei praktisch jeder Seite
 * im Mandantenbereich ein zusätzlicher, komplett vermeidbarer Rundlauf, weil
 * middleware.ts denselben Mandanten Zeilen zuvor bereits vollständig
 * geladen hatte. `x-tenant-data` (Base64-JSON, siehe middleware.ts) enthält
 * jetzt das komplette Objekt — kein DB-Zugriff mehr im Normalfall.
 * Fällt auf den alten ID-Weg zurück, falls der Header aus irgendeinem
 * Grund fehlt oder sich nicht parsen lässt (defensiv, sollte über
 * middleware.ts nie eintreten).
 *
 * Gibt `null` zurück, wenn kein Mandant zum Host passt (x-tenant-missing).
 * Aufrufer entscheiden selbst, ob das ein 404 oder eine Plattform-Seite ist.
 */
export const getTenant = cache(async (): Promise<PublicTenant | null> => {
  const headerList = await headers();

  const tenantData = headerList.get("x-tenant-data");
  if (tenantData) {
    try {
      return JSON.parse(base64ToUtf8(tenantData)) as PublicTenant;
    } catch {
      // Fällt unten auf den ID-basierten Weg zurück.
    }
  }

  const tenantId = headerList.get("x-tenant-id");
  if (!tenantId) return null;

  return resolveTenantById(tenantId);
});
