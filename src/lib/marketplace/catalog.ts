import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Öffentlicher Marketplace-Katalog (Marketplace M4, Plan
 * "ich-möchte-einen-eigenen-groovy-toast.md" Abschnitt 3) — Lesezugriff für
 * VÖLLIG anonyme, nicht authentifizierte Besucher auf mandantenübergreifende
 * Daten. Laut Auftragstext der sicherheitskritischste Block bisher in diesem
 * Projekt. Vorbild: `src/lib/stripe/storefront.ts::getPublicProduct()`
 * (gleiches Grundmuster: service_role + strikte Spaltenliste + sanitisiertes
 * DTO), hier aber mandantenübergreifend statt tenant-scoped.
 *
 * Regeln, die HIER und in jeder neuen Funktion dieser Datei absolut gelten:
 *
 * 1. Immer `createAdminClient()` (service_role). `marketplace_listings` hat
 *    laut `20260803100100_marketplace_listings.sql` BEWUSST KEINE
 *    anon/authenticated-Policy (nur `ml_staff_*`, nur für den eigenen
 *    Mandanten) — der öffentliche Katalog läuft ausschließlich über diese
 *    Datei. Nie eine neue anon/authenticated-Policy auf `marketplace_listings`
 *    anlegen, "um diese Datei zu vereinfachen" — das wäre exakt derselbe
 *    Fehler wie die beiden bereits behobenen Lecks in diesem Projekt:
 *      - `20260710233735_security_hardening_storage_listing_and_products.sql`
 *        (`products_public_select` gab über eine zu offene RLS-Policy zu
 *        viele Spalten/Zeilen frei — ersetzt durch `products_member_select`
 *        + eine server-seitige Storefront-Funktion, s. o.).
 *      - `20260711210852_security_fix_embeddings_publish_filter.sql`
 *        (`match_embeddings` prüfte den Veröffentlichungsstatus nicht
 *        vollständig — RLS/RPC allein reichte nicht, ein Anwendungsfilter
 *        war zusätzlich nötig).
 *    Beide Fälle: eine RLS-Policy für `anon`/`authenticated` kann "nur
 *    genehmigte, freigeschaltete Felder ausgewählter Spalten und Zeilen"
 *    strukturell nicht durchsetzen — das kann nur eine Server-Funktion mit
 *    expliziter Spaltenliste, wie hier.
 * 2. Pflichtfilter auf `marketplace_listings` IMMER:
 *    `status = 'approved' AND enabled = true`. Zusätzlich
 *    `tenants.status = 'active'` — ein suspendierter Mandant behält seine
 *    Listing-Zeilen in der DB, darf aber nicht öffentlich sichtbar bleiben.
 * 3. `tenant_id`, `product_id`, `stripe_*`, `review_note`, `reviewed_by`
 *    verlassen diese Datei NIE — auch nicht als Zwischenwert an eine andere
 *    Datei durchgereicht. `sellerName`/`sellerSlug` sind unbedenklich (stehen
 *    ohnehin öffentlich in der Adresszeile der Verkäufer-Domain, exakt wie
 *    `PublicTenant` in `tenant/types.ts` das für das normale Mandanten-
 *    Branding bereits vorlebt).
 * 4. Nie `select *` — jede Abfrage bekommt eine explizite Spaltenliste.
 *
 * Performance (Plan Abschnitt 9.4, ausdrücklicher Auftrag): das bestehende
 * `getPublicProductFeatures()` (stripe/storefront.ts) lädt pro Aufruf bis zu
 * drei sequenzielle Abfragen — für EINE einzelne Kaufseite unproblematisch,
 * für eine Katalogliste mit vielen Kacheln wäre dasselbe Muster N+1 (Plan
 * nennt das ausdrücklich als Negativ-Vorbild). `buildPublicListings()` unten
 * lädt Verkäufer/Kurse/Kategorien/Module/Lektionen für ALLE übergebenen
 * Listing-Zeilen in EINER Batch-Runde (je Tabelle genau eine
 * `.in(...)`-Abfrage), unabhängig von der Anzahl der Listings — sowohl
 * `listPublicListings()` (Katalog, viele Zeilen) als auch `getPublicListing()`
 * (Detailseite, eine Zeile) rufen dieselbe Funktion auf, letztere einfach mit
 * einem Array der Länge 1.
 */

export type PublicListing = {
  slug: string;
  headline: string;
  summary: string | null;
  coverUrl: string | null;
  priceCents: number;
  currency: string;
  isFree: boolean;
  categoryName: string | null;
  sellerName: string;
  sellerSlug: string;
  moduleCount: number;
  lessonCount: number;
  totalMinutes: number;
};

const LISTING_COLUMNS =
  "id, tenant_id, course_id, public_slug, headline, summary, cover_url, price_cents, currency";

type ListingRow = {
  id: string;
  tenant_id: string;
  course_id: string;
  public_slug: string;
  headline: string | null;
  summary: string | null;
  cover_url: string | null;
  price_cents: number;
  currency: string;
};

/**
 * Reichert eine Menge bereits gefilterter (`status='approved' AND enabled`)
 * Listing-Zeilen zum öffentlichen `PublicListing`-DTO an. Interne, NICHT
 * exportierte Hilfsfunktion — `tenant_id`/`course_id` aus `ListingRow`
 * werden hier nur für Joins verwendet und fließen nie ins Rückgabeobjekt.
 */
async function buildPublicListings(rows: ListingRow[]): Promise<PublicListing[]> {
  if (rows.length === 0) return [];
  const admin = createAdminClient();

  const tenantIds = [...new Set(rows.map((r) => r.tenant_id))];
  const courseIds = [...new Set(rows.map((r) => r.course_id))];

  const [{ data: tenants }, { data: courses }] = await Promise.all([
    admin.from("tenants").select("id, slug, name, status").in("id", tenantIds),
    admin.from("courses").select("id, title, status, category_id").in("id", courseIds),
  ]);
  const tenantById = new Map((tenants ?? []).map((t) => [t.id as string, t]));
  const courseById = new Map((courses ?? []).map((c) => [c.id as string, c]));

  const categoryIds = [
    ...new Set(
      (courses ?? [])
        .map((c) => c.category_id as string | null)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const { data: categories } =
    categoryIds.length > 0
      ? await admin.from("course_categories").select("id, name").in("id", categoryIds)
      : { data: [] as { id: string; name: string }[] };
  const categoryNameById = new Map((categories ?? []).map((c) => [c.id as string, c.name as string]));

  const { data: modules } = await admin.from("modules").select("id, course_id").in("course_id", courseIds);
  const moduleRows = modules ?? [];
  const moduleIds = moduleRows.map((m) => m.id as string);

  const { data: lessons } =
    moduleIds.length > 0
      ? await admin
          .from("lessons")
          .select("module_id, video_duration_s")
          .in("module_id", moduleIds)
          .eq("status", "published")
      : { data: [] as { module_id: string; video_duration_s: number | null }[] };
  const lessonRows = lessons ?? [];

  const moduleIdsByCourse = new Map<string, string[]>();
  for (const m of moduleRows) {
    const courseId = m.course_id as string;
    const list = moduleIdsByCourse.get(courseId) ?? [];
    list.push(m.id as string);
    moduleIdsByCourse.set(courseId, list);
  }

  const result: PublicListing[] = [];
  for (const row of rows) {
    const tenant = tenantById.get(row.tenant_id);
    // Pflichtfilter tenants.status='active' (Plan Abschnitt 3) — hier statt
    // in der SQL-Abfrage geprüft: marketplace_listings trägt keinen direkten
    // Statuswert des Verkäufer-Mandanten, ein Embed-Muster ist in diesem
    // Projekt bewusst nicht etabliert (siehe getListingForReview()/
    // listPendingListings() in platform/marketplace.ts — separate Abfragen +
    // Map statt PostgREST-Embed, gleiches Muster hier fortgeführt).
    if (!tenant || tenant.status !== "active") continue;

    const course = courseById.get(row.course_id);
    // Sollte wegen `course_id references courses(id) on delete cascade` nie
    // eintreten (ein gelöschter Kurs löscht auch sein Listing) — defensiv
    // trotzdem übersprungen statt eines DTOs mit erfundenem Titel.
    if (!course || course.status !== "published") continue;

    const courseModuleIds = moduleIdsByCourse.get(row.course_id) ?? [];
    const courseLessons = lessonRows.filter((l) => courseModuleIds.includes(l.module_id as string));
    const totalSeconds = courseLessons.reduce(
      (sum, l) => sum + ((l.video_duration_s as number | null) ?? 0),
      0,
    );

    result.push({
      slug: row.public_slug,
      // headline ist im Formular optional (listing-form.tsx) — ohne
      // gesetzten Wert zeigt der Katalog den Kurstitel statt eines leeren
      // Felds.
      headline: row.headline?.trim() || (course.title as string),
      summary: row.summary,
      coverUrl: row.cover_url,
      priceCents: row.price_cents,
      currency: row.currency,
      isFree: row.price_cents === 0,
      categoryName: course.category_id ? (categoryNameById.get(course.category_id as string) ?? null) : null,
      sellerName: tenant.name as string,
      sellerSlug: tenant.slug as string,
      moduleCount: courseModuleIds.length,
      lessonCount: courseLessons.length,
      totalMinutes: Math.round(totalSeconds / 60),
    });
  }
  return result;
}

/**
 * Katalogansicht (Marketplace-Startseite). `filter.categoryName` ist bewusst
 * vorbereitet, aber von M4 selbst nicht verdrahtet — die Katalogseite filtert
 * client-seitig über die bereits geladene, kleine Ergebnismenge (gleiches
 * serverseitig-laden-clientseitig-filtern-Muster wie das bestehende
 * `kurskatalog-grid.tsx`), ein zusätzlicher Server-Roundtrip pro Filterklick
 * lohnt sich beim heutigen Marketplace-Umfang nicht. Bleibt hier als
 * Erweiterungspunkt für eine spätere echte Server-Suche stehen.
 */
export async function listPublicListings(filter?: { categoryName?: string }): Promise<PublicListing[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("marketplace_listings")
    .select(LISTING_COLUMNS)
    .eq("status", "approved")
    .eq("enabled", true)
    .order("created_at", { ascending: false });

  const listings = await buildPublicListings((data ?? []) as ListingRow[]);
  if (!filter?.categoryName) return listings;
  return listings.filter((l) => l.categoryName === filter.categoryName);
}

/** Detailseite — ein einzelnes Listing über den global eindeutigen `public_slug`. */
export async function getPublicListing(slug: string): Promise<PublicListing | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("marketplace_listings")
    .select(LISTING_COLUMNS)
    .eq("public_slug", slug)
    .eq("status", "approved")
    .eq("enabled", true)
    .maybeSingle();
  if (!data) return null;

  const listings = await buildPublicListings([data as ListingRow]);
  return listings[0] ?? null;
}

export type ListingSellerLink = {
  sellerSlug: string;
  sellerCustomDomain: string | null;
  courseSlug: string;
  courseTitle: string;
};

/**
 * NUR für die Dankeseite nach einem Erwerb (Marketplace M5,
 * `src/app/marketplace/kurs/[slug]/danke/page.tsx`) — bewusst eine EIGENE,
 * enger geschnittene Funktion statt `PublicListing` um `custom_domain`/
 * `courseSlug` zu erweitern: `PublicListing` wird auch vom öffentlichen,
 * unauthentifizierten Katalog (`listPublicListings`) genutzt, dessen
 * Spaltenallowlist bewusst minimal gehalten ist (Kopfkommentar dieser
 * Datei). `custom_domain` ist zwar unbedenklich (identische Sichtbarkeit wie
 * `sellerSlug` — beides steht ohnehin öffentlich in der Adresszeile der
 * Verkäufer-Domain, exakt wie `PublicTenant.custom_domain` in
 * `tenant/types.ts` das für das normale Branding bereits vorlebt), aber eine
 * eigene, schmale Funktion hält den Blast-Radius einer künftigen Änderung
 * an dieser Stelle auf genau die Dankeseite begrenzt, statt den bereits
 * geprüften `PublicListing`-Vertrag zu erweitern (Design-Entscheidung,
 * dokumentiert in PHASENSTATUS.md). Gleicher Pflichtfilter
 * (`status='approved' AND enabled`) wie überall in dieser Datei — die
 * Dankeseite existiert ohnehin nur nach erfolgreichem Erwerb eines
 * gültigen, freigegebenen Listings.
 */
export async function getListingSellerLink(slug: string): Promise<ListingSellerLink | null> {
  const admin = createAdminClient();
  const { data: listing } = await admin
    .from("marketplace_listings")
    .select("tenant_id, course_id")
    .eq("public_slug", slug)
    .eq("status", "approved")
    .eq("enabled", true)
    .maybeSingle();
  if (!listing) return null;

  const [{ data: tenant }, { data: course }] = await Promise.all([
    admin.from("tenants").select("slug, custom_domain, status").eq("id", listing.tenant_id).maybeSingle(),
    admin.from("courses").select("slug, title").eq("id", listing.course_id).maybeSingle(),
  ]);
  if (!tenant || tenant.status !== "active" || !course) return null;

  return {
    sellerSlug: tenant.slug as string,
    sellerCustomDomain: tenant.custom_domain as string | null,
    courseSlug: course.slug as string,
    courseTitle: course.title as string,
  };
}
