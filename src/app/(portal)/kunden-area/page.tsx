import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { getAuthUser } from "@/lib/auth/context";
import { AppShell } from "@/components/learn/app-shell";
import { CustomerAreaView, type CustomerAreaViewItem } from "@/components/learn/customer-area-view";

/**
 * Fallstrick bei der eingebetteten `trainers`-Relation (Plan Abschnitt 4,
 * verwende-den-planungs-agenten-sequential-frost.md): postgrest-js
 * typisiert n:1 als Array, liefert zur Laufzeit ein Objekt — übernommen aus
 * `src/app/lesezeichen/page.tsx` (dortiger Kopfkommentar erklärt den
 * ursprünglichen Bugfix).
 */
function embeddedOne<T>(value: T[] | T | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/**
 * "Meine Kunden Area" (Plan Abschnitt 4). URL `/kunden-area`, Route-Group
 * `(portal)` ohne Präfix — Geschwister von `dashboard`/`kurskatalog`, gleiches
 * Muster wie `(portal)/dashboard/page.tsx` (`getAuthUser()`+`getTenant()`,
 * Redirects, `AppShell`).
 *
 * Die Gruppenfilterung wird NICHT im Code programmiert — sie steckt
 * vollständig in der SELECT-Policy `customer_area_items_member_select`
 * (Migration 20260805090000_customer_area.sql). Diese Seite kennt weder
 * Gruppen noch Zuordnungen; es gibt keinen Codepfad, der die Filterung
 * vergessen kann. `member_role(tenant_id) is not null` liefert für
 * Marketplace-Gäste (Rolle 'guest') bewusst `false` — kein Sonderfall hier
 * nötig (Plan Abschnitt 0.4).
 */
export default async function KundenAreaPage() {
  const supabase = await createClient();
  const [user, tenant, t, tShared] = await Promise.all([
    getAuthUser(),
    getTenant(),
    getTranslations("learn.customerArea"),
    getTranslations("learn.shared"),
  ]);

  if (!tenant) redirect("/");
  if (!user) redirect("/login");

  const [{ data: itemsRaw }, { data: isStaff }, { data: profile }] = await Promise.all([
    supabase
      .from("customer_area_items")
      .select(
        "id, kind, title, description, url, image_url, icon, item_date, trainers(name, role, image_url, phone, email)",
      )
      .eq("tenant_id", tenant.id)
      .order("kind", { ascending: true })
      .order("position", { ascending: true }),
    supabase.rpc("is_staff", { t: tenant.id }),
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
  ]);

  const emailLocalPart = (user.email ?? "").split("@")[0] ?? "";
  const displayName =
    profile?.full_name?.trim() ||
    (emailLocalPart ? emailLocalPart[0].toUpperCase() + emailLocalPart.slice(1) : tShared("fallbackUserName"));

  const items: CustomerAreaViewItem[] = (itemsRaw ?? []).map((row) => {
    const trainer = embeddedOne(row.trainers);
    return {
      id: row.id,
      kind: row.kind as CustomerAreaViewItem["kind"],
      title: row.title,
      description: row.description,
      url: row.url,
      imageUrl: row.image_url,
      icon: row.icon,
      itemDate: row.item_date,
      trainer: trainer
        ? {
            name: trainer.name as string,
            role: (trainer.role as string | null) ?? null,
            imageUrl: (trainer.image_url as string | null) ?? null,
            phone: (trainer.phone as string | null) ?? null,
            email: (trainer.email as string | null) ?? null,
          }
        : null,
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
      <CustomerAreaView items={items} userName={displayName} />
    </AppShell>
  );
}
