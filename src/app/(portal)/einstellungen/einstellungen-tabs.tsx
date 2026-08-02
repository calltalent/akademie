"use client";

import { useActionState, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  updateProfile,
  uploadAvatar,
  changeEmail,
  updateNotificationPref,
  revokeSession,
  type SettingsState,
} from "@/lib/account/actions";
import { DeletionRequestForm } from "@/app/profil/deletion-request-form";
import { PushToggle } from "@/components/pwa/push-toggle";
import { LocaleSwitcher } from "@/components/settings/locale-switcher";
import type { Locale } from "@/i18n/config";

/**
 * Client-Teil des Einstellungen-Bereichs (Referenz Einstellungen.dc.html):
 * drei Tabs (Allgemein / Benachrichtigungen / Geräte) mit Client-State-
 * Wechsel. Alle Schreibvorgänge laufen über die Server-Actions in
 * lib/account/actions.ts. Daten kommen als Props echt aus page.tsx.
 *
 * „Allgemein" bündelt zusätzlich die bereits bestehenden echten Konto-
 * funktionen aus /profil (Zertifikate, Datenexport, Konto löschen), damit
 * beim Umzug von /profil nichts verlorengeht.
 */
type Tab = "allgemein" | "benachrichtigungen" | "geraete";

export type SettingsProfile = {
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  city: string | null;
  job_position: string | null;
  about: string | null;
  avatar_url: string | null;
};
export type SessionInfo = { id: string; browser: string; lastActive: string; isCurrent: boolean };
export type CertificateInfo = {
  id: string;
  title: string;
  issuedAt: string;
  serial: string;
  downloadUrl: string | null;
};

/**
 * i18n Block C3: Struktur (Keys/Defaults) bleibt eine Modul-Konstante — nur
 * die Anzeigetexte (title/desc/label) kommen jetzt aus `t()`, deshalb ohne
 * sie hier, aufgelöst innerhalb von `BenachrichtigungenTab()` (Hooks lassen
 * sich nicht auf Modulebene aufrufen).
 */
type NotifRowLabelKey = "newLesson" | "liveQa" | "weeklyDigest" | "feedback" | "deadlineReminder" | "tips";

const NOTIF_GROUPS: {
  titleKey: "courses" | "submissions" | "other";
  rows: { key: string; labelKey: NotifRowLabelKey; default: boolean }[];
}[] = [
  {
    titleKey: "courses",
    rows: [
      { key: "neueLektion", labelKey: "newLesson", default: true },
      { key: "liveqa", labelKey: "liveQa", default: true },
      { key: "wochenmail", labelKey: "weeklyDigest", default: false },
    ],
  },
  {
    titleKey: "submissions",
    rows: [
      { key: "feedback", labelKey: "feedback", default: true },
      { key: "abgabeFrist", labelKey: "deadlineReminder", default: true },
    ],
  },
  {
    titleKey: "other",
    rows: [{ key: "tipps", labelKey: "tips", default: false }],
  },
];

const initialState: SettingsState = { error: null };

export function EinstellungenTabs({
  profile,
  email,
  initials,
  notificationPrefs,
  sessions,
  certificates,
  pendingDeletionDate,
  vapidPublicKey,
  initialTab,
  enabledLocales,
  currentLocale,
}: {
  profile: SettingsProfile;
  email: string;
  initials: string;
  notificationPrefs: Record<string, boolean>;
  sessions: SessionInfo[];
  certificates: CertificateInfo[];
  pendingDeletionDate: string | null;
  vapidPublicKey: string | null;
  initialTab: Tab;
  /** i18n Block B3: effektive Locale-Menge + aktuelle Wahl, aus page.tsx (Server Component). */
  enabledLocales: Locale[];
  currentLocale: Locale;
}) {
  const t = useTranslations("portal.settings");
  const tNotif = useTranslations("learn.shell");
  const TAB_LABELS: Record<Tab, string> = {
    allgemein: t("tabs.allgemein"),
    benachrichtigungen: tNotif("notificationsLabel"),
    geraete: t("tabs.geraete"),
  };
  const [tab, setTab] = useState<Tab>(initialTab);

  return (
    <div className="max-w-[920px]">
      {/* Tabs */}
      <div className="mb-[30px] flex gap-1.5 border-b border-border-200">
        {(Object.keys(TAB_LABELS) as Tab[]).map((tabId) => {
          const active = tabId === tab;
          return (
            <button
              key={tabId}
              type="button"
              onClick={() => setTab(tabId)}
              aria-current={active ? "page" : undefined}
              className="-mb-px px-[18px] py-3 text-[15px]"
              style={{
                fontWeight: active ? 700 : 500,
                color: active ? "#5663AE" : "#66679B",
                borderBottom: active ? "2px solid #5663AE" : "2px solid transparent",
              }}
            >
              {TAB_LABELS[tabId]}
            </button>
          );
        })}
      </div>

      <div className="mb-[22px] text-[13px] font-semibold text-muted-400">
        {t("title")} &nbsp;›&nbsp; <span style={{ color: "#5663AE" }}>{TAB_LABELS[tab]}</span>
      </div>

      {tab === "allgemein" && (
        <AllgemeinTab
          profile={profile}
          email={email}
          initials={initials}
          certificates={certificates}
          pendingDeletionDate={pendingDeletionDate}
          enabledLocales={enabledLocales}
          currentLocale={currentLocale}
        />
      )}
      {tab === "benachrichtigungen" && (
        <BenachrichtigungenTab notificationPrefs={notificationPrefs} vapidPublicKey={vapidPublicKey} />
      )}
      {tab === "geraete" && <GeraeteTab sessions={sessions} />}
    </div>
  );
}

/* ---------------------------------------------------------------- Allgemein */

function AllgemeinTab({
  profile,
  email,
  initials,
  certificates,
  pendingDeletionDate,
  enabledLocales,
  currentLocale,
}: {
  profile: SettingsProfile;
  email: string;
  initials: string;
  certificates: CertificateInfo[];
  pendingDeletionDate: string | null;
  enabledLocales: Locale[];
  currentLocale: Locale;
}) {
  const t = useTranslations("portal.settings");
  const tCert = useTranslations("certificates");
  const [avatarState, avatarAction, avatarPending] = useActionState(uploadAvatar, initialState);
  const [profileState, profileAction, profilePending] = useActionState(updateProfile, initialState);
  const [emailState, emailAction, emailPending] = useActionState(changeEmail, initialState);
  const [showEmail, setShowEmail] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-[14px] border border-border-100 bg-white p-[30px]">
        {/* Profilbild */}
        <div className="mb-[30px] flex items-center gap-5 border-b border-[#EEF0F7] pb-[26px]">
          {profile.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.avatar_url}
              alt={t("avatar.alt")}
              className="h-[76px] w-[76px] flex-shrink-0 rounded-[16px] object-cover"
            />
          ) : (
            <span
              className="flex h-[76px] w-[76px] flex-shrink-0 items-center justify-center rounded-[16px] text-[26px] font-bold text-cream"
              style={{ background: "#3E3F66" }}
              aria-hidden="true"
            >
              {initials}
            </span>
          )}
          <div>
            <div className="text-lg font-bold text-ink">{t("avatar.heading")}</div>
            <div className="mb-2.5 text-sm text-muted-500">{t("avatar.hint")}</div>
            <form action={avatarAction} className="flex flex-wrap items-center gap-2">
              <input
                type="file"
                name="avatar"
                accept="image/jpeg,image/png"
                required
                className="text-sm text-muted-500 file:mr-2 file:rounded-sm file:border file:border-border-300 file:bg-white file:px-3 file:py-2 file:text-sm file:font-semibold file:text-navy"
              />
              <button
                type="submit"
                disabled={avatarPending}
                className="rounded-sm border border-border-300 bg-white px-4 py-2 text-sm font-semibold text-navy disabled:opacity-50"
              >
                {avatarPending ? t("avatar.uploadPending") : t("avatar.uploadButton")}
              </button>
            </form>
            {avatarState.error && <p className="mt-1 text-sm text-[#B24343]">{avatarState.error}</p>}
            {avatarState.success && <p className="mt-1 text-sm text-[#1F8A5B]">{t("avatar.updated")}</p>}
          </div>
        </div>

        {/* Profilfelder */}
        <form action={profileAction}>
          <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
            <Field name="first_name" label={t("fields.firstName")} defaultValue={profile.first_name} />
            <Field name="last_name" label={t("fields.lastName")} defaultValue={profile.last_name} />
            <Field name="phone" label={t("fields.phone")} defaultValue={profile.phone} type="tel" />
            <Field name="city" label={t("fields.city")} defaultValue={profile.city} />
            <div>
              <label className="mb-[7px] block text-sm font-semibold text-navy">{t("fields.email")}</label>
              <input
                value={email}
                readOnly
                aria-label={t("fields.emailAriaLabel")}
                className="w-full rounded-sm border border-border-300 bg-bg px-[15px] py-[13px] text-base text-muted-500"
              />
            </div>
            <Field name="job_position" label={t("fields.position")} defaultValue={profile.job_position} />
            <div className="sm:col-span-2">
              <label className="mb-[7px] block text-sm font-semibold text-navy">{t("fields.about")}</label>
              <textarea
                name="about"
                defaultValue={profile.about ?? ""}
                className="min-h-[96px] w-full resize-y rounded-sm border border-border-300 bg-white px-[15px] py-[13px] text-base text-ink"
              />
            </div>
          </div>

          {profileState.error && <p className="mt-4 text-sm text-[#B24343]">{profileState.error}</p>}
          {profileState.success && <p className="mt-4 text-sm text-[#1F8A5B]">{t("profileSaved")}</p>}

          <div className="mt-7 flex flex-wrap items-center gap-3 border-t border-[#EEF0F7] pt-6">
            <button
              type="button"
              onClick={() => setShowEmail((v) => !v)}
              className="rounded-sm border border-border-300 bg-white px-[18px] py-3 text-[15px] font-semibold text-navy"
            >
              {t("changeEmailButton")}
            </button>
            <a
              href="/passwort-vergessen"
              className="rounded-sm border border-border-300 bg-white px-[18px] py-3 text-[15px] font-semibold text-navy no-underline"
            >
              {t("changePasswordLink")}
            </a>
            <button
              type="submit"
              disabled={profilePending}
              className="ml-auto rounded-sm bg-primary px-[22px] py-3 text-[15px] font-bold text-white disabled:opacity-50"
            >
              {profilePending ? t("savePending") : t("saveButton")}
            </button>
          </div>
        </form>

        {/* E-Mail ändern (Bestätigungslink) */}
        {showEmail && (
          <form action={emailAction} className="mt-5 border-t border-[#EEF0F7] pt-5">
            <label className="mb-[7px] block text-sm font-semibold text-navy">{t("newEmailLabel")}</label>
            <div className="flex flex-wrap gap-2">
              <input
                name="email"
                type="email"
                required
                defaultValue={email}
                className="min-w-[240px] flex-1 rounded-sm border border-border-300 bg-white px-[15px] py-[13px] text-base text-ink"
              />
              <button
                type="submit"
                disabled={emailPending}
                className="rounded-sm bg-primary px-[18px] py-3 text-[15px] font-bold text-white disabled:opacity-50"
              >
                {t("sendConfirmationButton")}
              </button>
            </div>
            {emailState.error && <p className="mt-2 text-sm text-[#B24343]">{emailState.error}</p>}
            {emailState.success && (
              <p className="mt-2 text-sm text-[#1F8A5B]">
                {t("emailChangeSuccess")}
              </p>
            )}
          </form>
        )}
      </div>

      {/* i18n Block B3 (PLAN_Mehrsprachigkeit-i18n.md Abschnitt 4): eigene
          Karte statt Feld im Profilformular oben — die Sprachwahl greift
          sofort beim Umschalten (eigene Server Action, kein Teil von
          updateProfile()/profileAction), eine gemeinsame Karte mit Speichern-
          Button hätte das verschleiert. LocaleSwitcher rendert selbst `null`
          bei nur einer freigeschalteten Sprache, die Karte deshalb ebenfalls
          gated, damit kein leerer Kartenrahmen übrigbleibt. */}
      {enabledLocales.length > 1 && (
        <div className="rounded-[14px] border border-border-100 bg-white p-[30px]">
          <h2 className="text-lg font-bold text-ink">{t("language")}</h2>
          <p className="mt-2 mb-4 text-sm text-muted-500">
            {t("languageDescription")}
          </p>
          <LocaleSwitcher enabledLocales={enabledLocales} currentLocale={currentLocale} />
        </div>
      )}

      {/* Bestehende echte Konto-Funktionen (aus /profil übernommen) */}
      <div className="rounded-[14px] border border-border-100 bg-white p-[30px]">
        <h2 className="text-lg font-bold text-ink">{tCert("profileCertificatesTitle")}</h2>
        {certificates.length === 0 ? (
          <p className="mt-2 text-sm text-muted-500">{tCert("empty")}</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {certificates.map((cert) => (
              <li key={cert.id} className="rounded-xl border border-border-100 p-3">
                <p className="text-base font-medium text-ink">{cert.title}</p>
                <p className="text-xs text-muted-500">
                  {tCert("issuedOn", { date: cert.issuedAt })} — {tCert("serialLabel")} {cert.serial}
                </p>
                {cert.downloadUrl ? (
                  <a href={cert.downloadUrl} className="mt-2 inline-block text-sm font-semibold no-underline">
                    {tCert("download")}
                  </a>
                ) : (
                  <p className="mt-2 text-xs text-muted-500">{tCert("downloadUnavailable")}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-[14px] border border-border-100 bg-white p-[30px]">
        <h2 className="text-lg font-bold text-ink">{t("dataHeading")}</h2>
        <p className="mt-2 text-sm text-muted-500">
          {t("dataDescription")}
        </p>
        <a
          href="/profil/export"
          className="mt-2 inline-block text-sm font-semibold no-underline"
          style={{ color: "var(--color-primary)" }}
        >
          {t("dataExportLink")}
        </a>
      </div>

      <div className="rounded-[14px] border border-border-100 bg-white p-[30px]">
        <h2 className="text-lg font-bold text-ink">{t("deleteAccount.heading")}</h2>
        {pendingDeletionDate ? (
          <p className="mt-2 text-sm text-muted-500">
            {t("deleteAccount.pendingNotice", { date: pendingDeletionDate })}
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm text-muted-500">
              {t("deleteAccount.description")}
            </p>
            <div className="mt-3">
              <DeletionRequestForm />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({
  name,
  label,
  defaultValue,
  type = "text",
}: {
  name: string;
  label: string;
  defaultValue: string | null;
  type?: string;
}) {
  return (
    <div>
      <label className="mb-[7px] block text-sm font-semibold text-navy">{label}</label>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue ?? ""}
        className="w-full rounded-sm border border-border-300 bg-white px-[15px] py-[13px] text-base text-ink"
      />
    </div>
  );
}

/* ------------------------------------------------------- Benachrichtigungen */

function BenachrichtigungenTab({
  notificationPrefs,
  vapidPublicKey,
}: {
  notificationPrefs: Record<string, boolean>;
  vapidPublicKey: string | null;
}) {
  const t = useTranslations("portal.settings.notifications");
  const [prefs, setPrefs] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const g of NOTIF_GROUPS) for (const r of g.rows) init[r.key] = notificationPrefs[r.key] ?? r.default;
    return init;
  });
  const [, startTransition] = useTransition();

  function toggle(key: string) {
    const next = !prefs[key];
    setPrefs((p) => ({ ...p, [key]: next }));
    startTransition(() => {
      void updateNotificationPref(key, next);
    });
  }

  return (
    <div className="flex flex-col gap-[22px]">
      {NOTIF_GROUPS.map((group) => (
        <div key={group.titleKey} className="rounded-[14px] border border-border-100 bg-white px-7 py-6">
          <div className="text-base font-bold text-ink">{t(`groups.${group.titleKey}.title`)}</div>
          <div className="mb-[18px] text-sm text-muted-400">{t(`groups.${group.titleKey}.description`)}</div>
          {group.rows.map((row) => {
            const label = t(`rows.${row.labelKey}`);
            return (
              <div
                key={row.key}
                className="flex items-center justify-between border-t border-[#F2F3F9] py-[13px]"
              >
                <span className="text-[15px] font-medium text-ink">{label}</span>
                <Toggle on={prefs[row.key]} onToggle={() => toggle(row.key)} label={label} />
              </div>
            );
          })}
        </div>
      ))}

      {/* Bestehender echter Browser-Push (nicht verlieren). */}
      <div className="rounded-[14px] border border-border-100 bg-white px-7 py-6">
        <div className="text-base font-bold text-ink">{t("pushHeading")}</div>
        <div className="mb-[18px] text-sm text-muted-400">
          {t("pushDescription")}
        </div>
        <PushToggle vapidPublicKey={vapidPublicKey} />
      </div>
    </div>
  );
}

function Toggle({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      className="relative h-[26px] w-11 flex-shrink-0 rounded-[13px] transition-colors"
      style={{ background: on ? "var(--color-primary)" : "#D8DAEA" }}
    >
      <span
        className="absolute top-[3px] h-5 w-5 rounded-full bg-white transition-all"
        style={{ left: on ? 21 : 3, boxShadow: "0 1px 3px rgba(0,0,0,.2)" }}
      />
    </button>
  );
}

/* ----------------------------------------------------------------- Geräte */

function GeraeteTab({ sessions }: { sessions: SessionInfo[] }) {
  const t = useTranslations("portal.settings.devices");
  return (
    <div className="rounded-[14px] border border-border-100 bg-white px-7 py-1">
      {sessions.length === 0 ? (
        <p className="py-6 text-sm text-muted-500">{t("empty")}</p>
      ) : (
        sessions.map((s, i) => (
          <div
            key={s.id}
            className="flex items-center gap-[18px] py-5"
            style={{ borderTop: i === 0 ? "none" : "1px solid #F2F3F9" }}
          >
            <span
              className="flex h-[46px] w-[46px] flex-shrink-0 items-center justify-center rounded-[12px]"
              style={{ background: "#EEF0FA" }}
              aria-hidden="true"
            >
              <span className="h-[18px] w-[18px] rounded-[5px] border-2 border-primary" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-bold text-ink">
                {s.browser}
                {s.isCurrent && (
                  <span
                    className="ml-1.5 rounded-lg px-2 py-0.5 text-xs font-bold text-ink"
                    style={{ background: "#F7EED4" }}
                  >
                    {t("currentBadge")}
                  </span>
                )}
              </div>
              <div className="text-sm text-muted-500">{s.lastActive}</div>
            </div>
            {!s.isCurrent && <RevokeButton sessionId={s.id} />}
          </div>
        ))
      )}
    </div>
  );
}

function RevokeButton({ sessionId }: { sessionId: string }) {
  const t = useTranslations("portal.settings.devices");
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => void revokeSession(sessionId))}
      className="flex-shrink-0 rounded-[10px] border bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
      style={{ borderColor: "#E3C0C0", color: "#B24343" }}
    >
      {pending ? t("revokePending") : t("revoke")}
    </button>
  );
}
