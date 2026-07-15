"use client";

import { useActionState, useState, useTransition } from "react";
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
const TAB_LABELS: Record<Tab, string> = {
  allgemein: "Allgemein",
  benachrichtigungen: "Benachrichtigungen",
  geraete: "Geräte",
};

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

const NOTIF_GROUPS: {
  title: string;
  desc: string;
  rows: { key: string; label: string; default: boolean }[];
}[] = [
  {
    title: "Kurse",
    desc: "Neue Inhalte und Lernerinnerungen.",
    rows: [
      { key: "neueLektion", label: "Neue Lektion verfügbar", default: true },
      { key: "liveqa", label: "Live-Q&A-Erinnerung", default: true },
      { key: "wochenmail", label: "Wöchentliche Lern-Zusammenfassung", default: false },
    ],
  },
  {
    title: "Abgaben",
    desc: "Feedback und Fristen zu deinen Einsendungen.",
    rows: [
      { key: "feedback", label: "Feedback zu Abgaben", default: true },
      { key: "abgabeFrist", label: "Erinnerung an offene Fristen", default: true },
    ],
  },
  {
    title: "Sonstiges",
    desc: "Produktneuigkeiten und Tipps.",
    rows: [{ key: "tipps", label: "Tipps & Angebote", default: false }],
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
}) {
  const [tab, setTab] = useState<Tab>(initialTab);

  return (
    <div className="max-w-[920px]">
      {/* Tabs */}
      <div className="mb-[30px] flex gap-1.5 border-b border-border-200">
        {(Object.keys(TAB_LABELS) as Tab[]).map((t) => {
          const active = t === tab;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              aria-current={active ? "page" : undefined}
              className="-mb-px px-[18px] py-3 text-[15px]"
              style={{
                fontWeight: active ? 700 : 500,
                color: active ? "#5663AE" : "#66679B",
                borderBottom: active ? "2px solid #5663AE" : "2px solid transparent",
              }}
            >
              {TAB_LABELS[t]}
            </button>
          );
        })}
      </div>

      <div className="mb-[22px] text-[13px] font-semibold text-muted-400">
        Einstellungen &nbsp;›&nbsp; <span style={{ color: "#5663AE" }}>{TAB_LABELS[tab]}</span>
      </div>

      {tab === "allgemein" && (
        <AllgemeinTab
          profile={profile}
          email={email}
          initials={initials}
          certificates={certificates}
          pendingDeletionDate={pendingDeletionDate}
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
}: {
  profile: SettingsProfile;
  email: string;
  initials: string;
  certificates: CertificateInfo[];
  pendingDeletionDate: string | null;
}) {
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
              alt="Profilbild"
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
            <div className="text-lg font-bold text-ink">Profilbild</div>
            <div className="mb-2.5 text-sm text-muted-500">JPG oder PNG, max. 2 MB.</div>
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
                {avatarPending ? "Lädt …" : "Bild hochladen"}
              </button>
            </form>
            {avatarState.error && <p className="mt-1 text-sm text-[#B24343]">{avatarState.error}</p>}
            {avatarState.success && <p className="mt-1 text-sm text-[#1F8A5B]">Profilbild aktualisiert.</p>}
          </div>
        </div>

        {/* Profilfelder */}
        <form action={profileAction}>
          <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
            <Field name="first_name" label="Vorname" defaultValue={profile.first_name} />
            <Field name="last_name" label="Nachname" defaultValue={profile.last_name} />
            <Field name="phone" label="Telefon" defaultValue={profile.phone} type="tel" />
            <Field name="city" label="Stadt" defaultValue={profile.city} />
            <div>
              <label className="mb-[7px] block text-sm font-semibold text-navy">E-Mail</label>
              <input
                value={email}
                readOnly
                aria-label="E-Mail (über „E-Mail ändern“ änderbar)"
                className="w-full rounded-sm border border-border-300 bg-bg px-[15px] py-[13px] text-base text-muted-500"
              />
            </div>
            <Field name="job_position" label="Position" defaultValue={profile.job_position} />
            <div className="sm:col-span-2">
              <label className="mb-[7px] block text-sm font-semibold text-navy">Über mich</label>
              <textarea
                name="about"
                defaultValue={profile.about ?? ""}
                className="min-h-[96px] w-full resize-y rounded-sm border border-border-300 bg-white px-[15px] py-[13px] text-base text-ink"
              />
            </div>
          </div>

          {profileState.error && <p className="mt-4 text-sm text-[#B24343]">{profileState.error}</p>}
          {profileState.success && <p className="mt-4 text-sm text-[#1F8A5B]">Änderungen gespeichert.</p>}

          <div className="mt-7 flex flex-wrap items-center gap-3 border-t border-[#EEF0F7] pt-6">
            <button
              type="button"
              onClick={() => setShowEmail((v) => !v)}
              className="rounded-sm border border-border-300 bg-white px-[18px] py-3 text-[15px] font-semibold text-navy"
            >
              E-Mail ändern
            </button>
            <a
              href="/passwort-vergessen"
              className="rounded-sm border border-border-300 bg-white px-[18px] py-3 text-[15px] font-semibold text-navy no-underline"
            >
              Passwort ändern
            </a>
            <button
              type="submit"
              disabled={profilePending}
              className="ml-auto rounded-sm bg-accent px-[22px] py-3 text-[15px] font-bold text-white disabled:opacity-50"
            >
              {profilePending ? "Speichert …" : "Änderungen speichern"}
            </button>
          </div>
        </form>

        {/* E-Mail ändern (Bestätigungslink) */}
        {showEmail && (
          <form action={emailAction} className="mt-5 border-t border-[#EEF0F7] pt-5">
            <label className="mb-[7px] block text-sm font-semibold text-navy">Neue E-Mail-Adresse</label>
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
                className="rounded-sm bg-accent px-[18px] py-3 text-[15px] font-bold text-white disabled:opacity-50"
              >
                Bestätigungslink senden
              </button>
            </div>
            {emailState.error && <p className="mt-2 text-sm text-[#B24343]">{emailState.error}</p>}
            {emailState.success && (
              <p className="mt-2 text-sm text-[#1F8A5B]">
                Bestätigungslink an die neue Adresse gesendet. Die Änderung greift nach Bestätigung.
              </p>
            )}
          </form>
        )}
      </div>

      {/* Bestehende echte Konto-Funktionen (aus /profil übernommen) */}
      <div className="rounded-[14px] border border-border-100 bg-white p-[30px]">
        <h2 className="text-lg font-bold text-ink">Meine Zertifikate</h2>
        {certificates.length === 0 ? (
          <p className="mt-2 text-sm text-muted-500">Noch keine Zertifikate ausgestellt.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {certificates.map((cert) => (
              <li key={cert.id} className="rounded-xl border border-border-100 p-3">
                <p className="text-base font-medium text-ink">{cert.title}</p>
                <p className="text-xs text-muted-500">
                  Ausgestellt am {cert.issuedAt} — Seriennummer {cert.serial}
                </p>
                {cert.downloadUrl ? (
                  <a href={cert.downloadUrl} className="mt-2 inline-block text-sm font-semibold no-underline">
                    Zertifikat herunterladen (PDF)
                  </a>
                ) : (
                  <p className="mt-2 text-xs text-muted-500">Download aktuell nicht verfügbar.</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-[14px] border border-border-100 bg-white p-[30px]">
        <h2 className="text-lg font-bold text-ink">Meine Daten</h2>
        <p className="mt-2 text-sm text-muted-500">
          Lade eine strukturierte JSON-Datei mit allen zu dir gespeicherten Daten herunter (Art. 15/20 DSGVO).
        </p>
        <a
          href="/profil/export"
          className="mt-2 inline-block text-sm font-semibold no-underline"
          style={{ color: "var(--color-primary)" }}
        >
          Meine Daten exportieren
        </a>
      </div>

      <div className="rounded-[14px] border border-border-100 bg-white p-[30px]">
        <h2 className="text-lg font-bold text-ink">Konto löschen</h2>
        {pendingDeletionDate ? (
          <p className="mt-2 text-sm text-muted-500">
            Löschantrag vom {pendingDeletionDate} eingegangen, wird geprüft.
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm text-muted-500">
              Beantrage die Löschung deines Kontos. Die Löschung erfolgt nach manueller Prüfung und ist
              nicht sofort.
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
        <div key={group.title} className="rounded-[14px] border border-border-100 bg-white px-7 py-6">
          <div className="text-base font-bold text-ink">{group.title}</div>
          <div className="mb-[18px] text-sm text-muted-400">{group.desc}</div>
          {group.rows.map((row) => (
            <div
              key={row.key}
              className="flex items-center justify-between border-t border-[#F2F3F9] py-[13px]"
            >
              <span className="text-[15px] font-medium text-ink">{row.label}</span>
              <Toggle on={prefs[row.key]} onToggle={() => toggle(row.key)} label={row.label} />
            </div>
          ))}
        </div>
      ))}

      {/* Bestehender echter Browser-Push (nicht verlieren). */}
      <div className="rounded-[14px] border border-border-100 bg-white px-7 py-6">
        <div className="text-base font-bold text-ink">Browser-Benachrichtigung</div>
        <div className="mb-[18px] text-sm text-muted-400">
          Erhalte eine Benachrichtigung, sobald du einen Kurs vollständig abgeschlossen hast.
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
  return (
    <div className="rounded-[14px] border border-border-100 bg-white px-7 py-1">
      {sessions.length === 0 ? (
        <p className="py-6 text-sm text-muted-500">Keine aktiven Sitzungen gefunden.</p>
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
              <span className="h-[18px] w-[18px] rounded-[5px] border-2 border-accent" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-bold text-ink">
                {s.browser}
                {s.isCurrent && (
                  <span
                    className="ml-1.5 rounded-lg px-2 py-0.5 text-xs font-bold text-ink"
                    style={{ background: "#F7EED4" }}
                  >
                    Dieses Gerät
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
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => void revokeSession(sessionId))}
      className="flex-shrink-0 rounded-[10px] border bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
      style={{ borderColor: "#E3C0C0", color: "#B24343" }}
    >
      {pending ? "…" : "Abmelden"}
    </button>
  );
}
