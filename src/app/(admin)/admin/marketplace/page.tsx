import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { ListingForm } from "./listing-form";
import { ListingRow, LISTING_LIST_COLS } from "./listing-row";

/**
 * Marketplace-Verwaltung des Mandanten (M2, Plan Abschnitt 6). Gleiches
 * Layout wie /admin/produkte (page.tsx dort): Listing-Liste links, "Neues
 * Listing" rechts sticky. RLS (`ml_staff_select`) filtert `marketplace_listings`
 * automatisch auf den eigenen Mandanten — die `.eq("tenant_id", …)` hier ist
 * zusätzliche Defense-in-Depth, gleiches Muster wie überall im Admin-Bereich.
 *
 * Kurs-Dropdown für die Neuanlage zeigt nur veröffentlichte Kurse OHNE
 * bestehendes Listing (Plan Abschnitt 6: "veröffentlichte Kurse des
 * Mandanten, die noch KEIN Listing haben") — eine einzige `courses`-Abfrage
 * liefert sowohl die Titel-Zuordnung für JEDE Listing-Zeile (unabhängig vom
 * aktuellen Kursstatus, ein Listing kann auch zu einem inzwischen
 * unveröffentlichten Kurs gehören) als auch die Optionsliste.
 */
export default async function AdminMarketplacePage() {
  const t = await getTranslations("admin.marketplace");
  const tenant = await getTenant();
  const supabase = await createClient();

  const [{ data: listings }, { data: courses }] = await Promise.all([
    supabase
      .from("marketplace_listings")
      .select(
        "id, course_id, public_slug, headline, summary, cover_url, price_cents, currency, status, enabled, review_note",
      )
      .eq("tenant_id", tenant!.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("courses")
      .select("id, title, status")
      .eq("tenant_id", tenant!.id)
      .order("title", { ascending: true }),
  ]);

  const allListings = listings ?? [];
  const allCourses = courses ?? [];
  const courseTitleById = new Map(allCourses.map((c) => [c.id, c.title]));
  const listedCourseIds = new Set(allListings.map((l) => l.course_id));
  const courseOptions = allCourses
    .filter((c) => c.status === "published" && !listedCourseIds.has(c.id))
    .map((c) => ({ id: c.id, title: c.title }));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center gap-[18px]">
        <div className="flex-1">
          <div className="text-[13px] font-semibold" style={{ color: "#A9AAC4" }}>
            {t("eyebrow")}
          </div>
          <h1 className="mt-0.5 text-[26px] font-extrabold" style={{ letterSpacing: "-0.01em" }}>
            {t("title")}
          </h1>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1.7fr_1fr]">
        {/* Linke Spalte: Listing-Liste */}
        <div className="overflow-hidden rounded-[14px] border bg-white" style={{ borderColor: "#E7E8F2" }}>
          <div className="p-[24px_28px_16px]">
            <div className="text-[17px] font-bold">{t("listingsHeading")}</div>
          </div>
          <div
            className="rgrid-header px-[28px] pb-2.5 text-[13px] font-bold"
            style={
              {
                "--rgrid-cols": LISTING_LIST_COLS,
                color: "#A9AAC4",
                borderBottom: "1px solid #EEF0F7",
              } as React.CSSProperties
            }
          >
            <div>{t("courseColumn")}</div>
            <div>{t("priceColumn")}</div>
            <div>{t("statusColumn")}</div>
            <div>{t("visibleColumn")}</div>
            <div className="text-right">{t("totalCountSuffix", { count: allListings.length })}</div>
          </div>
          {allListings.length === 0 ? (
            <p className="px-[28px] py-6 text-sm" style={{ color: "#A9AAC4" }}>
              {t("empty")}
            </p>
          ) : (
            allListings.map((l) => (
              <ListingRow
                key={l.id}
                listing={l}
                courseTitle={courseTitleById.get(l.course_id) ?? t("courseNotFound")}
              />
            ))
          )}
        </div>

        {/* Rechte Spalte: Neues Listing */}
        <div className="sticky top-4 self-start rounded-[14px] border bg-white p-[26px_28px]" style={{ borderColor: "#E7E8F2" }}>
          <div className="mb-5 text-[17px] font-bold">{t("newListing")}</div>
          <ListingForm courses={courseOptions} />
        </div>
      </div>
    </div>
  );
}
