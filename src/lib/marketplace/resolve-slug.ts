import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Findet einen GLOBAL eindeutigen `public_slug` für `marketplace_listings`
 * (`unique` in 20260803100100_marketplace_listings.sql, anders als
 * `courses.slug`, das nur `unique(tenant_id, slug)` ist). Bei Kollision wird
 * `-2`, `-3`, … angehängt (max. 20 Versuche — gleiches Muster wie
 * `resolveUniqueCourseSlug`, src/lib/courses/resolve-slug.ts).
 *
 * WICHTIG (Abweichung ggü. `resolveUniqueCourseSlug`): nutzt bewusst
 * `createAdminClient()` statt des übergebenen, RLS-gebundenen
 * Server-Clients. `ml_staff_select` erlaubt Lesen NUR für den eigenen
 * Mandanten (`is_staff(tenant_id)`) — eine Kollisionsprüfung mit dem
 * normalen Session-Client würde Listings anderer Mandanten schlicht nicht
 * sehen und könnte denselben Slug fälschlich für frei halten. Der
 * `unique`-Constraint in der DB fängt eine verbliebene Kollision zur Not
 * ohnehin ab (klare deutsche Fehlermeldung über `translateDbError`,
 * 23505 -> "Dieser Eintrag existiert bereits.") — dieser admin-gestützte
 * Check macht den Normalfall aber kollisionsfrei, statt sich darauf zu
 * verlassen. Rein lesender Zugriff (nur `id` einer einzigen Spalte, keine
 * sensiblen Felder), kein Sicherheitsrisiko trotz RLS-Umgehung.
 */
export async function resolveUniquePublicSlug(baseSlug: string): Promise<string> {
  const admin = createAdminClient();
  let slug = baseSlug;
  for (let attempt = 1; attempt <= 20; attempt++) {
    const { data: existing } = await admin
      .from("marketplace_listings")
      .select("id")
      .eq("public_slug", slug)
      .maybeSingle();
    if (!existing) break;
    slug = `${baseSlug}-${attempt + 1}`;
  }
  return slug;
}
