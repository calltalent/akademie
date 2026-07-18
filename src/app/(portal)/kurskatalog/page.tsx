import { redirect } from "next/navigation";
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const tenant = await getTenant();
  if (!tenant) redirect("/");

  const { data: courses } = await supabase
    .from("courses")
    .select("id, title, slug, status, category, cover_url")
    .eq("tenant_id", tenant.id)
    .eq("status", "published")
    .order("position", { ascending: true });

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
    (emailLocalPart ? emailLocalPart[0].toUpperCase() + emailLocalPart.slice(1) : "zurück");

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
    const lessonLabel = `${lessonCount} ${lessonCount === 1 ? "Lektion" : "Lektionen"}`;
    const hours = durationSec / 3600;
    const meta =
      hours > 0 ? `${lessonLabel} · ${hours.toFixed(1).replace(".", ",")} Std` : lessonLabel;

    return {
      id: course.id,
      slug: course.slug as string,
      title: course.title as string,
      eyebrow: courseModules[0]?.title ? String(courseModules[0].title).toUpperCase() : null,
      meta,
      enrolled: enrolledIds.has(course.id),
      category: (course.category as string | null) ?? null,
      coverUrl: (course.cover_url as string | null) ?? null,
      tint: THUMB_TINTS[index % THUMB_TINTS.length],
    };
  });

  return (
    <AppShell
      isStaff={Boolean(isStaff)}
      userName={displayName}
      userEmail={user.email ?? undefined}
      breadcrumb="Lernen · Kurskatalog"
      title="Kurskatalog"
    >
      <KurskatalogGrid items={items} />
    </AppShell>
  );
}
