import "server-only";
import type { PublicTenant } from "@/lib/tenant/types";

/**
 * Zentrale Stelle für "unter welcher Domain ist DIESER Mandant gerade
 * erreichbar" (Phase 5, Block 8, 12.07.2026 — Bugfix).
 *
 * VORHER: `checkout.ts`, `portal.ts` und `import.ts` hatten je eine eigene,
 * fast identische private `buildTenantUrl()`/`buildLoginUrl()`, die
 * IMMER `https://${slug}.akademie.calltalent.ai` annahm — das alte,
 * zweite-Ebene-Subdomain-Schema, das heute wegen Cloudflares Universal-SSL-
 * Grenze (siehe tenant/resolve.ts) auf `{slug}.calltalent.ai` umgestellt
 * wurde. Alle drei Stellen wurden dabei übersehen (drei Kopien derselben
 * Logik, nur eine gefixt) — UND keine der drei kannte `custom_domain`
 * überhaupt, obwohl genau das der Fall des ersten echten Mandanten ist
 * (`learning.calltalent.ai`, nicht `calltalent.calltalent.ai`).
 *
 * Diese Funktion ist bewusst NICHT von `headers()`/der eingehenden Anfrage
 * abhängig (obwohl das an den aktuellen drei Aufrufstellen auch ginge,
 * da alle in echten Request-Kontexten laufen) — sie leitet die Domain
 * stattdessen deterministisch aus den Mandanten-Stammdaten ab. Das bleibt
 * auch dann korrekt, wenn eine URL für einen Mandanten AUSSERHALB seines
 * eigenen Hosts gebaut wird (z. B. ein zukünftiger Cron-/Batch-Kontext ohne
 * eingehende Anfrage).
 */
export function tenantOrigin(
  tenant: Pick<PublicTenant, "slug" | "custom_domain">,
): string {
  if (process.env.NODE_ENV !== "production") {
    return `http://${tenant.slug}.localhost:3000`;
  }
  const host = tenant.custom_domain || `${tenant.slug}.calltalent.ai`;
  return `https://${host}`;
}

export function buildTenantUrl(
  tenant: Pick<PublicTenant, "slug" | "custom_domain">,
  path: string,
): string {
  return `${tenantOrigin(tenant)}${path}`;
}
