import { getTranslations } from "next-intl/server";
import { checkAdminAccess } from "@/lib/auth/staff";
import { checkPlatformAccess } from "@/lib/platform/auth";
import { createClient } from "@/lib/supabase/server";
import { EinstellungenTabs } from "@/components/admin/einstellungen-tabs";
import type { PromoCardRow, TrainerRow } from "@/lib/settings/actions";
import { DEFAULT_LOCALE, isSupportedLocale, resolveEnabledLocales } from "@/i18n/config";
import { toCustomerAreaItemRow, type CustomerAreaGroupRow, type CustomerAreaItemRow, type CustomerAreaTenantMember } from "@/lib/customer-area/schema";

/**
 * Design-Block 6 (13.07.2026, Claude-Design-Export Teil 3,
 * AdminEinstellungen.dc.html). Der Export zeigt Akademie-Grunddaten,
 * Plattform-Optionen (3 Schalter) und Marken-Standard — GAR KEINE
 * API-Keys/Webhooks (das war bislang der komplette Seiteninhalt, Phase 3
 * Block 7). Beides bleibt erhalten: neue Karten oben (echte, gespeicherte
 * Werte, siehe tenant-settings-form.tsx + lib/tenant/actions.ts), API-Keys/
 * Webhooks als eigener Abschnitt darunter (reale, funktionierende
 * Integrationsverwaltung, im Export schlicht nicht vorgesehen — nicht
 * entfernt, nur nicht Teil dieses Exports).
 *
 * "Marken-Standard" zeigt echte `tenant.branding`-Werte (mit Systemstandard
 * als Fallback, siehe DEFAULT_BRANDING in lib/tenant/types.ts) statt der im
 * Export fest verdrahteten Demo-Werte — rein lesend, keine Eingabefelder
 * (Export zeigt dort auch keine). Der Export verlinkt zusätzlich auf
 * "Mandanten verwalten" (Betreiber-Portal) — bewusst weggelassen, weil das
 * nur für Calltalent-Plattform-Admins zugänglich ist, nicht für normale
 * Mandanten-Administratoren, die diese Seite genauso sehen.
 *
 * Horizontale Reiter (25.07.2026, Josips Auftrag, gleiches Prinzip wie beim
 * Kurs-Redesign): sieben Karten untereinander auf einer langen Seite wurden
 * zu drei thematischen Reitern (Allgemein/Inhalte/Integrationen) —
 * `EinstellungenTabs` (einstellungen-tabs.tsx). Diese Server Component lädt
 * unverändert alle Daten, das Rendering übernimmt komplett der neue
 * Client-Wrapper.
 */
export default async function AdminEinstellungenPage() {
  const t = await getTranslations("admin.settings");
  const tTeilnehmer = await getTranslations("admin.teilnehmer");
  const access = await checkAdminAccess();

  if (!access.ok) {
    const text =
      access.reason === "not-admin"
        ? t("accessDeniedNotAdmin")
        : access.reason === "not-authenticated"
          ? tTeilnehmer("accessDeniedNotAuthenticated")
          : tTeilnehmer("accessDeniedNoTenant");
    return (
      <div className="mx-auto max-w-3xl">
        <p className="text-base">{text}</p>
      </div>
    );
  }

  const { tenant } = access;
  // Der „Mandanten verwalten"-Link führt ins Betreiber-Portal (/portal/
  // mandanten) und ist nur für Plattform-Admins erreichbar — daher nur für
  // sie einblenden (Josips Freigabe: keine toten/gesperrten Links für normale
  // Mandanten-Admins, die diese Seite genauso sehen).
  const isPlatformAdmin = (await checkPlatformAccess()).ok;
  const supabase = await createClient();
  const [
    { data: apiKeys },
    { data: webhooks },
    { data: sidebarLinks },
    { data: promoCardsRaw },
    { data: trainersRaw },
    { data: customerAreaGroupsRaw },
    { data: customerAreaGroupMembersRaw },
    { data: customerAreaItemsRaw },
    { data: customerAreaAudienceRaw },
    { data: membershipsRaw },
  ] = await Promise.all([
    supabase
      .from("api_keys")
      .select("id, name, last_used, active, created_at")
      .eq("tenant_id", tenant.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("webhooks")
      .select("id, url, events, active, created_at")
      .eq("tenant_id", tenant.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("sidebar_links")
      .select("id, label, url")
      .eq("tenant_id", tenant.id)
      .order("position", { ascending: true }),
    supabase
      .from("promo_cards")
      .select("id, title, description, media_kind, image_url, bunny_video_id, link_url")
      .eq("tenant_id", tenant.id)
      .order("position", { ascending: true }),
    supabase
      .from("trainers")
      .select("id, name, role, bio, image_url, phone, email")
      .eq("tenant_id", tenant.id)
      .order("position", { ascending: true }),
    // "Meine Kunden Area" (05.08.2026, Plan
    // verwende-den-planungs-agenten-sequential-frost.md, Abschnitt 3) — vier
    // neue Abfragen + memberships(profiles) für die Personenauswahl im
    // Sichtbarkeits-Baustein (gleiches Muster wie admin/teilnehmer/page.tsx:
    // `profiles(email, full_name)` embedded, gefiltert auf `status='active'`).
    supabase
      .from("customer_area_groups")
      .select("id, name")
      .eq("tenant_id", tenant.id)
      .order("position", { ascending: true }),
    supabase.from("customer_area_group_members").select("group_id, user_id").eq("tenant_id", tenant.id),
    supabase
      .from("customer_area_items")
      .select("id, kind, title, description, url, image_url, icon, item_date, trainer_id, visibility, position")
      .eq("tenant_id", tenant.id)
      .order("kind", { ascending: true })
      .order("position", { ascending: true }),
    supabase.from("customer_area_item_audience").select("item_id, group_id, user_id").eq("tenant_id", tenant.id),
    supabase
      .from("memberships")
      .select("user_id, status, profiles(email, full_name)")
      .eq("tenant_id", tenant.id)
      .eq("status", "active"),
  ]);

  const promoCards: PromoCardRow[] = (promoCardsRaw ?? []).map((c) => ({
    id: c.id,
    title: c.title,
    description: c.description,
    mediaKind: c.media_kind as "image" | "video",
    imageUrl: c.image_url,
    bunnyVideoId: c.bunny_video_id,
    linkUrl: c.link_url,
  }));

  const trainers: TrainerRow[] = (trainersRaw ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    role: t.role,
    bio: t.bio,
    imageUrl: t.image_url,
    phone: t.phone,
    email: t.email,
  }));

  // "Meine Kunden Area" — Gruppen tragen ihre Mitglieder eingebettet
  // (`memberUserIds`), Items ihre Sichtbarkeits-Zuordnung (`groupIds`/
  // `userIds`) — kein separates Prop für die Rohzeilen, siehe Plan
  // Abschnitt 3 ("vier neue Props").
  const customerAreaGroups: CustomerAreaGroupRow[] = (customerAreaGroupsRaw ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    memberUserIds: (customerAreaGroupMembersRaw ?? []).filter((m) => m.group_id === g.id).map((m) => m.user_id),
  }));

  const customerAreaItems: CustomerAreaItemRow[] = (customerAreaItemsRaw ?? []).map((row) =>
    toCustomerAreaItemRow(
      row,
      (customerAreaAudienceRaw ?? []).filter((a) => a.item_id === row.id),
    ),
  );

  // `profiles` kommt als eingebettete n:1-Relation zurück — postgrest-js
  // typisiert das generisch als Array, liefert zur Laufzeit aber ein
  // Objekt (gleicher Fallstrick wie in admin/teilnehmer/page.tsx).
  const tenantMembers: CustomerAreaTenantMember[] = (membershipsRaw ?? [])
    .map((m) => {
      const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
      if (!profile?.email) return null;
      return { userId: m.user_id, email: profile.email, fullName: profile.full_name ?? null };
    })
    .filter((m): m is CustomerAreaTenantMember => m !== null);

  const branding = tenant.branding;

  // i18n Block B5 (PLAN_Mehrsprachigkeit-i18n.md Abschnitt 4): "de" ist
  // immer Teil der effektiven Menge (resolveEnabledLocales()) — der
  // Standardwert fällt nur dann auf DEFAULT_LOCALE zurück, wenn
  // `default_locale` fehlt oder (z. B. durch ein direktes DB-Update) auf ein
  // inzwischen gesperrtes Kürzel zeigt.
  const enabledLocales = resolveEnabledLocales(tenant.settings);
  const storedDefaultLocale = tenant.settings.default_locale;
  const defaultLocale =
    storedDefaultLocale && isSupportedLocale(storedDefaultLocale) && enabledLocales.includes(storedDefaultLocale)
      ? storedDefaultLocale
      : DEFAULT_LOCALE;

  return (
    <div className="flex flex-col gap-4">
      <header>
        <div className="text-[13px] font-semibold" style={{ color: "#A9AAC4" }}>
          {t("eyebrow")}
        </div>
        <h1 className="mt-0.5 text-[26px] font-extrabold" style={{ letterSpacing: "-0.01em" }}>
          {t("title")}
        </h1>
      </header>

      <EinstellungenTabs
        tenantName={tenant.name}
        supportEmail={tenant.settings.support_email ?? ""}
        selfSignupEnabled={tenant.settings.self_signup_enabled !== false}
        certificatesEnabled={tenant.settings.certificates_enabled !== false}
        maintenanceEnabled={tenant.settings.maintenance_enabled === true}
        brandingColor={branding.color_primary ?? "#5663AE"}
        brandingRadius={branding.radius ?? "14px"}
        brandingFont={branding.font ?? "Montserrat"}
        isPlatformAdmin={isPlatformAdmin}
        sidebarLinks={sidebarLinks ?? []}
        promoCards={promoCards}
        trainers={trainers}
        customerAreaGroups={customerAreaGroups}
        customerAreaItems={customerAreaItems}
        tenantMembers={tenantMembers}
        apiKeys={apiKeys ?? []}
        webhooks={(webhooks ?? []) as { id: string; url: string; events: string[]; active: boolean; created_at: string }[]}
        enabledLocales={enabledLocales}
        defaultLocale={defaultLocale}
      />
    </div>
  );
}
