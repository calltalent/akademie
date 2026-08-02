import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { AppShell } from "@/components/learn/app-shell";
import { KurskatalogGrid, type CatalogItem } from "./kurskatalog-grid";

/**
 * Kurskatalog (Referenz: „Calltalent-Akademie Studenten-Portal/
 * Kurskatalog.dc.html"). Zog von /kurse hierher nach /kurskatalog um
 * (Folgeauftrag, analog zum Dashboard-Umzug); /kurse leitet jetzt hierher.
 *
 * Alle Daten echt aus Supabase (kein Mock-Array):
 * - Kurse (published, tenant-scoped) inkl. `category` (Migration
 *   20260715120000) für die Filter-Chips.
 * - Modul-Eyebrow = Titel des ersten Moduls.
 * - Meta „X Lektionen · Y Std": Lektionszahl + Σ `lessons.video_duration_s`.
 * - CTA „Weiterlernen" (eingeschrieben, echte `enrollments`-Zeile) bzw.
 *   „Zum Kurs" (nicht eingeschrieben).
 *
 * Chips + Klick-Filter laufen client-seitig (kurskatalog-grid.tsx), die
 * Datenabfrage bleibt server-seitig — daher die Aufteilung.
 */
export default async function KurskatalogPage() {
  const supabase = await createClient();
  const [{ data: { user } }, tenant, t, tShared, format] = await Promise.all([
    supabase.auth.getUser(),
    getTenant(),
    getTranslations("portal.kurskatalog"),
    getTranslations("learn.shared"),
    getFormatter(),
  ]);
  if (!user) redirect("/login");
  if (!tenant) redirect("/");

  // `course_categories(name)` (Migration 20260722180000_course_categories.sql)
  // — der Join liefert den aktuellen Kategorienamen live, ohne dass ein
  // Umbenennen im Admin-Bereich hier separat nachgezogen werden müsste.
  const { data: courses } = await supabase
    .from("courses")
    .select("id, title, slug, status, category_id, course_categories(name), cover_url")
    .eq("tenant_id", tenant.id)
    .eq("status", "published")
    .order("position", { ascending: true });

  // Für die Filter-Chips: die aktuelle, mandantenspezifische Kategorienliste
  // statt des früheren globalen `COURSE_CATEGORIES`-Consts.
  const { data: categoryRows } = await supabase
    .from("course_categories")
    .select("name")
    .eq("tenant_id", tenant.id)
    .order("position", { ascending: true });
  const categoryNames = (categoryRows ?? []).map((c) => c.name as string);

  const courseIds = (courses ?? []).map((c) => c.id);
  const noneId = "00000000-0000-0000-0000-000000000000";

  const { data: modules } = await supabase
    .from("modules")
    .select("id, course_id, title, position")
    .in("course_id", courseIds.length > 0 ? courseIds : [noneId])
    .order("position", { ascending: true });

  const { data: lessons } = await supabase
    .from("lessons")
    .select("id, module_id, status, video_duration_s")
    .in("module_id", (modules ?? []).map((m) => m.id).length > 0 ? (modules ?? []).map((m) => m.id) : [noneId])
    .eq("status", "published");

  // Eingeschrieben = echte enrollments-Zeile (Kauf/Import/API/manuell).
  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("course_id")
    .eq("user_id", user.id)
    .in("course_id", courseIds.length > 0 ? courseIds : [noneId]);
  const enrolledIds = new Set((enrollments ?? []).map((e) => e.course_id as string));

  const { data: isStaff } = await supabase.rpc("is_staff", { t: tenant.id });
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();
  const emailLocalPart = (user.email ?? "").split("@")[0] ?? "";
  const displayName =
    profile?.full_name?.trim() ||
    (emailLocalPart ? emailLocalPart[0].toUpperCase() + emailLocalPart.slice(1) : tShared("fallbackUserName"));

  // Helle Periwinkle-Tönungen mit Diagonalstreifen (wie Dashboard/Referenz).
  const THUMB_TINTS = ["#DFE2F4", "#E7E9F6", "#EDE7F5", "#E4E6F5", "#E9E6F3", "#DDE0F2"];

  const items: CatalogItem[] = (courses ?? []).map((course, index) => {
    const courseModules = (modules ?? [])
      .filter((m) => m.course_id === course.id)
      .sort((a, b) => a.position - b.position);
    const moduleIds = courseModules.map((m) => m.id);
    const courseLessons = (lessons ?? []).filter((l) => moduleIds.includes(l.module_id));
    const lessonCount = courseLessons.length;
    const durationSec = courseLessons.reduce(
      (sum, l) => sum + (typeof l.video_duration_s === "number" ? l.video_duration_s : 0),
      0,
    );

    // „X Lektionen · Y Std" — die Stundenangabe nur, wenn es echte
    // Video-Laufzeit gibt (kein erfundener Wert für reine Text-Lektionen).
    // i18n Block C3: ICU-Plural aus learn.shared (Block C2) statt eigenem
    // Text; Dezimalstunden über getFormatter() statt hartkodiertem
    // ".".replace(",") (Plan Abschnitt 6, hartkodierte "de-DE"-Fundstelle).
    const lessonLabel = tShared("lessonsCount", { count: lessonCount });
    const hours = durationSec / 3600;
    const meta =
      hours > 0
        ? t("durationMeta", { lessons: lessonLabel, hours: format.number(hours, { maximumFractionDigits: 1 }) })
        : lessonLabel;

    return {
      id: course.id,
      slug: course.slug as string,
      title: course.title as string,
      eyebrow: courseModules[0]?.title ? String(courseModules[0].title).toUpperCase() : null,
      meta,
      enrolled: enrolledIds.has(course.id),
      // Laufzeit-Form ist ein einzelnes Objekt (many-to-one via category_id,
      // PostgREST embedded ohne Array), der generische, ungetypte
      // Supabase-Client kennt die FK-Kardinalität aber nicht und nimmt ein
      // Array an — Cast über `unknown`, da die Typen sonst nicht überlappen.
      category: (course.course_categories as unknown as { name: string } | null)?.name ?? null,
      coverUrl: (course.cover_url as string | null) ?? null,
      tint: THUMB_TINTS[index % THUMB_TINTS.length],
    };
  });

  return (
    <AppShell
      isStaff={Boolean(isStaff)}
      userName={displayName}
      userEmail={user.email ?? undefined}
      breadcrumb={t("breadcrumb")}
      title={t("title")}
    >
      <KurskatalogGrid items={items} categories={categoryNames} />
    </AppShell>
  );
}
