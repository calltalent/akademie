import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { publicEnv } from "@/lib/env";
import { readTrackingConsent } from "@/lib/consent/read";
import { LEGAL_LAST_UPDATED } from "@/lib/legal/updated";
import { AppShell } from "@/components/learn/app-shell";
import { DEFAULT_LOCALE, isSupportedLocale, resolveEnabledLocales, type Locale } from "@/i18n/config";
import {
  EinstellungenTabs,
  type SessionInfo,
  type CertificateInfo,
  type ConsentInfo,
} from "./einstellungen-tabs";

type Tab = "allgemein" | "benachrichtigungen" | "geraete";

type CertificateRow = {
  id: string;
  serial: string;
  issued_at: string;
  pdf_path: string | null;
  courses: { title: string } | { title: string }[] | null;
};

function courseTitle(courses: CertificateRow["courses"], fallback: string): string {
  if (!courses) return fallback;
  if (Array.isArray(courses)) return courses[0]?.title ?? fallback;
  return courses.title ?? fallback;
}

type Formatter = Awaited<ReturnType<typeof getFormatter>>;
type DevicesTranslator = Awaited<ReturnType<typeof getTranslations<"portal.settings.devices">>>;

/** i18n Block C3: hartkodiertes "de-DE" (Plan Abschnitt 6) durch getFormatter() ersetzt. */
function formatDate(format: Formatter, iso: string): string {
  return format.dateTime(new Date(iso), { day: "2-digit", month: "2-digit", year: "numeric" });
}

function browserFromUA(ua: string | null, t: DevicesTranslator): string {
  if (!ua) return t("unknownDevice");
  if (ua.includes("Edg")) return "Edge";
  if (ua.includes("OPR") || ua.includes("Opera")) return "Opera";
  if (ua.includes("Firefox")) return "Firefox";
  if (ua.includes("Chrome")) return "Chrome";
  if (ua.includes("Safari")) return "Safari";
  return t("browserFallback");
}

function relativeActive(iso: string | null, t: DevicesTranslator): string {
  if (!iso) return t("lastActiveUnknown");
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 2) return t("activeNow");
  if (diffMin < 60) return t("activeMinutesAgo", { minutes: diffMin });
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return t("activeHoursAgo", { hours: diffH });
  const diffD = Math.round(diffH / 24);
  return t("activeDaysAgo", { days: diffD });
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
  const [
    {
      data: { user },
    },
    tenant,
    t,
    tShared,
    tDevices,
    format,
  ] = await Promise.all([
    supabase.auth.getUser(),
    getTenant(),
    getTranslations("portal.settings"),
    getTranslations("learn.shared"),
    getTranslations("portal.settings.devices"),
    getFormatter(),
  ]);
  if (!user) redirect("/login");
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
    (emailLocalPart ? emailLocalPart[0].toUpperCase() + emailLocalPart.slice(1) : tShared("fallbackUserName"));
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
    browser: browserFromUA(s.user_agent as string | null, tDevices),
    lastActive: relativeActive(s.updated_at as string | null, tDevices),
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
        title: courseTitle(cert.courses, t("certificateFallbackTitle")),
        issuedAt: formatDate(format, cert.issued_at),
        serial: cert.serial,
        downloadUrl,
      };
    }),
  );

  /**
   * Affiliate-Modul, Block B2 (PLAN_Affiliate-System.md Abschnitt 10/B2,
   * 10.09.2026): Widerruf der Tracking-Einwilligung. Art. 7 Abs. 3 DSGVO
   * verlangt, dass der Widerruf so einfach ist wie die Erteilung — der
   * Einwilligungsdialog liegt über jeder öffentlichen Seite, die
   * Gegenrichtung braucht deshalb eine feste, auffindbare Stelle.
   *
   * Das Cookie ist `httpOnly` (CLAUDE.md §2.13), der Zustand muss also hier
   * auf dem Server gelesen und als Prop weitergereicht werden; der Browser
   * kann ihn nicht selbst sehen.
   *
   * `null` bedeutet: Karte gar nicht anzeigen. Sie erscheint genau dann, wenn
   * es eine Entscheidung gibt, die man ändern könnte. Wer nie gefragt wurde
   * (Mandant ohne Partnerprogramm), bekommt auch keinen Abschnitt über ein
   * Cookie, das es dort nicht gibt.
   */
  const consentState = await readTrackingConsent();
  const consentDecision = consentState.decisions.affiliate ?? null;
  const consent: ConsentInfo | null =
    consentDecision === null
      ? null
      : {
          decision: consentDecision,
          decidedAt: consentState.decidedAt ? formatDate(format, consentState.decidedAt) : null,
          // Bezieht sich die Entscheidung noch auf den aktuellen Stand der
          // Rechtstexte? Wenn nicht, fragt der Dialog ohnehin erneut; die
          // Karte sagt es zusätzlich, damit der Hinweis auch findet, wer
          // gerade von einer Rechtsseite kommt (dort erscheint der Dialog
          // bewusst nicht).
          outdated: consentState.policyVersion !== LEGAL_LAST_UPDATED,
        };

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
      breadcrumb={t("breadcrumb")}
      title={t("title")}
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
        pendingDeletionDate={pendingDeletion ? formatDate(format, pendingDeletion.requested_at) : null}
        consent={consent}
        vapidPublicKey={publicEnv.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null}
        initialTab={initialTab}
        enabledLocales={enabledLocales}
        currentLocale={currentLocale}
      />
    </AppShell>
  );
}
