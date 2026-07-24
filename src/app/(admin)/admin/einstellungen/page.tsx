import Link from "next/link";
import { checkAdminAccess } from "@/lib/auth/staff";
import { checkPlatformAccess } from "@/lib/platform/auth";
import { createClient } from "@/lib/supabase/server";
import { ApiKeysPanel } from "@/components/admin/api-keys-panel";
import { WebhooksPanel } from "@/components/admin/webhooks-panel";
import { TenantSettingsForm } from "@/components/admin/tenant-settings-form";
import { SidebarLinksPanel } from "@/components/admin/sidebar-links-panel";
import { PromoCardsPanel } from "@/components/admin/promo-cards-panel";
import { TrainerProfilePanel } from "@/components/admin/trainer-profile-panel";
import type { PromoCardRow, TrainerRow } from "@/lib/settings/actions";

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
 */
export default async function AdminEinstellungenPage() {
  const access = await checkAdminAccess();

  if (!access.ok) {
    const text =
      access.reason === "not-admin"
        ? "Kein Zugriff — Einstellungen sind nur für Inhaber und Administratoren."
        : access.reason === "not-authenticated"
          ? "Bitte zuerst anmelden."
          : "Kein Mandant zu diesem Host gefunden.";
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
  const [{ data: apiKeys }, { data: webhooks }, { data: sidebarLinks }, { data: promoCardsRaw }, { data: trainersRaw }] =
    await Promise.all([
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
        .select("id, name, role, bio, image_url")
        .eq("tenant_id", tenant.id)
        .order("position", { ascending: true }),
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
  }));

  const branding = tenant.branding;

  return (
    <div className="flex flex-col gap-4">
      <header>
        <div className="text-[13px] font-semibold" style={{ color: "#A9AAC4" }}>
          Plattform · Einstellungen
        </div>
        <h1 className="mt-0.5 text-[26px] font-extrabold" style={{ letterSpacing: "-0.01em" }}>
          Einstellungen
        </h1>
      </header>

      <div className="flex max-w-[820px] flex-col gap-[22px]">
        <TenantSettingsForm
          name={tenant.name}
          supportEmail={tenant.settings.support_email ?? ""}
          selfSignupEnabled={tenant.settings.self_signup_enabled !== false}
          certificatesEnabled={tenant.settings.certificates_enabled !== false}
          maintenanceEnabled={tenant.settings.maintenance_enabled === true}
        />

        <div className="rounded-[14px] border bg-white px-7 py-6" style={{ borderColor: "#E7E8F2" }}>
          <div className="mb-1.5 text-[17px] font-bold">Marken-Standard</div>
          <div className="mb-4 text-sm" style={{ color: "#66679B" }}>
            Aktuelle Markenwerte dieses Mandanten.
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className="h-[34px] w-[34px] flex-none rounded-[9px]"
                style={{ background: branding.color_primary ?? "#5663AE" }}
              />
              <span className="text-sm" style={{ color: "#3E3F66" }}>
                {branding.color_primary ?? "#5663AE"}
              </span>
            </div>
            <div className="text-sm" style={{ color: "#3E3F66" }}>
              Radius {branding.radius ?? "14px"}
            </div>
            <div className="text-sm" style={{ color: "#3E3F66" }}>
              Schrift: {branding.font ?? "Montserrat"}
            </div>
            {isPlatformAdmin && (
              <Link href="/portal/mandanten" className="ml-auto text-sm font-semibold no-underline">
                Mandanten verwalten →
              </Link>
            )}
          </div>
        </div>

        <SidebarLinksPanel links={sidebarLinks ?? []} />
        <PromoCardsPanel cards={promoCards} />
        <TrainerProfilePanel trainers={trainers} />
      </div>

      <div className="mt-6 flex max-w-[820px] flex-col gap-8">
        <div>
          <h2 className="text-lg font-semibold">Integrationen</h2>
          <p className="text-sm text-gray-500">
            API-Keys und Webhooks für externe Integrationen (z. B. Zapier, Make) dieses Mandanten.
          </p>
        </div>
        <ApiKeysPanel apiKeys={apiKeys ?? []} />
        <WebhooksPanel
          webhooks={(webhooks ?? []) as { id: string; url: string; events: string[]; active: boolean; created_at: string }[]}
        />
      </div>
    </div>
  );
}
