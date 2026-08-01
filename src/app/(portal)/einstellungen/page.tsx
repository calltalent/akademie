import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { publicEnv } from "@/lib/env";
import { AppShell } from "@/components/learn/app-shell";
import { DEFAULT_LOCALE, isSupportedLocale, resolveEnabledLocales, type Locale } from "@/i18n/config";
import {
  EinstellungenTabs,
  type SessionInfo,
  type CertificateInfo,
} from "./einstellungen-tabs";

type Tab = "allgemein" | "benachrichtigungen" | "geraete";

type CertificateRow = {
  id: string;
  serial: string;
  issued_at: string;
  pdf_path: string | null;
  courses: { title: string } | { title: string }[] | null;
};

function courseTitle(courses: CertificateRow["courses"]): string {
  if (!courses) return "Kurs";
  if (Array.isArray(courses)) return courses[0]?.title ?? "Kurs";
  return courses.title ?? "Kurs";
}

function formatDateDe(iso: string): string {
  return new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function browserFromUA(ua: string | null): string {
  if (!ua) return "Unbekanntes Gerät";
  if (ua.includes("Edg")) return "Edge";
  if (ua.includes("OPR") || ua.includes("Opera")) return "Opera";
  if (ua.includes("Firefox")) return "Firefox";
  if (ua.includes("Chrome")) return "Chrome";
  if (ua.includes("Safari")) return "Safari";
  return "Browser";
}

function relativeActive(iso: string | null): string {
  if (!iso) return "zuletzt aktiv unbekannt";
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 2) return "aktiv jetzt";
  if (diffMin < 60) return `aktiv vor ${diffMin} Min.`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `aktiv vor ${diffH} Std.`;
  const diffD = Math.round(diffH / 24);
  return `aktiv vor ${diffD} ${diffD === 1 ? "Tag" : "Tagen"}`;
}

/**
 * Einstellungen (Referenz Einstellungen.dc.html, „Voller Ausbau"). Zog von
 * /profil hierher um (/profil leitet weiter). Drei Tabs mit echten Daten:
 * - Allgemein: Profilfelder (Migration 20260715130000) + Avatar-Upload +
 *   E-Mail/Passwort ändern + die aus /profil übernommenen Konto-Funktionen
 *   (Zertifikate, Datenexport, Konto löschen).
 * - Benachrichtigungen: persistente Präferenz-Toggles (profiles.notification_prefs)
 *   + der bestehende echte Browser-Push.
 * - Geräte: eigene Auth-Sessions über public.my_sessions() (SECURITY DEFINER),
 *   Abmelden je Gerät über public.revoke_my_session().
 *
 * Tab-Wechsel per Client-State; `?tab=` setzt nur den Start-Tab (damit die
 * Sidebar direkt auf „Benachrichtigungen" verlinken kann).
 */
export default async function EinstellungenPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: rawTab } = await searchParams;
  const initialTab: Tab =
    rawTab === "benachrichtigungen" ? "benachrichtigungen" : rawTab === "geraete" ? "geraete" : "allgemein";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const tenant = await getTenant();
  if (!tenant) redirect("/");

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "full_name, first_name, last_name, phone, city, job_position, about, avatar_url, notification_prefs, locale",
    )
    .eq("id", user.id)
    .maybeSingle();

  // i18n Block B3 (PLAN_Mehrsprachigkeit-i18n.md Abschnitt 4): effektive
  // Locale-Menge DIESES Mandanten (nie SUPPORTED_LOCALES direkt an die UI
  // reichen) + aktuelle Wahl des Nutzers. Fällt auf DEFAULT_LOCALE zurück,
  // falls `profiles.locale` fehlt/unbekannt ist oder der Mandant die zuletzt
  // gewählte Sprache inzwischen wieder gesperrt hat (Plan Abschnitt 3, "Fall
  // Nutzer hat bs gewählt, Mandant deaktiviert es später" — kein Fehler,
  // reiner Anzeige-Fallback, `profiles.locale` bleibt in der DB unverändert).
  const enabledLocales = resolveEnabledLocales(tenant.settings);
  const storedLocale = profile?.locale as string | null | undefined;
  const currentLocale: Locale =
    storedLocale && isSupportedLocale(storedLocale) && enabledLocales.includes(storedLocale)
      ? storedLocale
      : DEFAULT_LOCALE;

  const { data: isStaff } = await supabase.rpc("is_staff", { t: tenant.id });

  const emailLocalPart = (user.email ?? "").split("@")[0] ?? "";
  const displayName =
    profile?.full_name?.trim() ||
    (emailLocalPart ? emailLocalPart[0].toUpperCase() + emailLocalPart.slice(1) : "zurück");
  const initials =
    [profile?.first_name, profile?.last_name]
      .filter(Boolean)
      .map((n) => String(n)[0])
      .join("")
      .toUpperCase() ||
    displayName.slice(0, 2).toUpperCase();

  // Sessions (Geräte-Tab)
  const { data: sessionRows } = await supabase.rpc("my_sessions");
  const sessions: SessionInfo[] = ((sessionRows ?? []) as Array<Record<string, unknown>>).map((s) => ({
    id: String(s.id),
    browser: browserFromUA(s.user_agent as string | null),
    lastActive: relativeActive(s.updated_at as string | null),
    isCurrent: Boolean(s.is_current),
  }));

  // Zertifikate (aus /profil übernommen)
  const { data: certificateRows } = await supabase
    .from("certificates")
    .select("id, serial, issued_at, pdf_path, courses(title)")
    .eq("tenant_id", tenant.id)
    .eq("user_id", user.id)
    .order("issued_at", { ascending: false });

  const certificates: CertificateInfo[] = await Promise.all(
    ((certificateRows ?? []) as CertificateRow[]).map(async (cert) => {
      let downloadUrl: string | null = null;
      if (cert.pdf_path) {
        const { data } = await supabase.storage.from("certificates").createSignedUrl(cert.pdf_path, 60 * 10);
        downloadUrl = data?.signedUrl ?? null;
      }
      return {
        id: cert.id,
        title: courseTitle(cert.courses),
        issuedAt: formatDateDe(cert.issued_at),
        serial: cert.serial,
        downloadUrl,
      };
    }),
  );

  const { data: pendingDeletion } = await supabase
    .from("deletion_requests")
    .select("requested_at")
    .eq("tenant_id", tenant.id)
    .eq("user_id", user.id)
    .eq("status", "pending")
    .maybeSingle();

  return (
    <AppShell
      isStaff={Boolean(isStaff)}
      userName={displayName}
      userEmail={user.email ?? undefined}
      breadcrumb="Konto · Einstellungen"
      title="Einstellungen"
    >
      <EinstellungenTabs
        profile={{
          first_name: (profile?.first_name as string | null) ?? null,
          last_name: (profile?.last_name as string | null) ?? null,
          phone: (profile?.phone as string | null) ?? null,
          city: (profile?.city as string | null) ?? null,
          job_position: (profile?.job_position as string | null) ?? null,
          about: (profile?.about as string | null) ?? null,
          avatar_url: (profile?.avatar_url as string | null) ?? null,
        }}
        email={user.email ?? ""}
        initials={initials}
        notificationPrefs={(profile?.notification_prefs as Record<string, boolean> | null) ?? {}}
        sessions={sessions}
        certificates={certificates}
        pendingDeletionDate={pendingDeletion ? formatDateDe(pendingDeletion.requested_at) : null}
        vapidPublicKey={publicEnv.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null}
        initialTab={initialTab}
        enabledLocales={enabledLocales}
        currentLocale={currentLocale}
      />
    </AppShell>
  );
}
