"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, ChevronDown, CircleUserRound } from "lucide-react";

export type NotificationItem = { text: string; time: string };
export type TopBarUser = { name: string; role?: string; email?: string };

/**
 * Benachrichtigungen-/Profil-Menü, ausgelagert aus TopBar.tsx (24.07.2026,
 * Josips Fund: auf dem Handy saßen Glocke + Profil-Chip mitten im
 * mehrzeilig umbrechenden Begrüßungstext der TopBar, statt oben in der
 * schmalen Kopfzeile). Jetzt von ZWEI Stellen genutzt: `TopBar.tsx`
 * (Desktop, ab `lg`, `compact=false` — Original-Chip mit Name/Rolle) und
 * `LearnMobileNav.tsx` (mobil, unter `lg`, `compact=true` — reines Icon,
 * kein Platz für den vollen Chip auf 375px).
 *
 * `compact`-Panel-Positionierung `fixed inset-x-4` + beim Öffnen aus der
 * Trigger-Button-Position berechnetes `top` (`getBoundingClientRect()
 * .bottom`) — funktioniert hier zuverlässig OHNE die frühere Header-Höhen-
 * Messung (siehe Git-Historie von TopBar.tsx für die ausführliche
 * Fehlersuche dazu), weil die mobile Kopfzeile jetzt eine einzelne schmale
 * Zeile ohne mehrzeiligen Text ist — der Button sitzt immer exakt an der
 * unteren Kante der Leiste, keine Diskrepanz zwischen Button- und
 * Leisten-Höhe mehr möglich.
 *
 * `useExclusiveMenu()`: nur EIN Menü gleichzeitig offen (Klick auf das
 * andere schließt das erste) — jede Kopfzeile (TopBar/LearnMobileNav) hält
 * ihre eigene Instanz, unabhängig voneinander (immer nur eine der beiden
 * Leisten gleichzeitig sichtbar).
 */
export function useExclusiveMenu() {
  const [openKey, setOpenKey] = useState<"notif" | "profile" | null>(null);
  return {
    notifOpen: openKey === "notif",
    profileOpen: openKey === "profile",
    toggleNotif: () => setOpenKey((k) => (k === "notif" ? null : "notif")),
    toggleProfile: () => setOpenKey((k) => (k === "profile" ? null : "profile")),
    close: () => setOpenKey(null),
  };
}

export function NotificationsMenu({
  notifications,
  compact = false,
  open,
  onToggle,
  onClose,
}: {
  notifications: NotificationItem[];
  compact?: boolean;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [panelTop, setPanelTop] = useState<number>();

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [onClose]);

  const unread = notifications.length;

  return (
    <div className="relative flex-shrink-0" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => {
          if (compact && !open) setPanelTop((btnRef.current?.getBoundingClientRect().bottom ?? 0) + 8);
          onToggle();
        }}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="Benachrichtigungen"
        className="relative flex h-[46px] w-[46px] items-center justify-center rounded-md border border-border-100 bg-white"
      >
        <Bell size={21} aria-hidden="true" className="text-navy" />
        {unread > 0 && (
          <span className="absolute right-2 top-2 flex h-[17px] min-w-[17px] items-center justify-center rounded-[9px] border-2 border-white bg-accent px-1 text-[10px] font-bold text-white">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div
          className={
            compact
              ? "fixed inset-x-4 z-30 overflow-hidden rounded-xl border border-border-100 bg-white shadow-[0_18px_44px_rgba(26,26,46,0.16)]"
              : "absolute right-0 top-14 z-30 w-[360px] overflow-hidden rounded-xl border border-border-100 bg-white shadow-[0_18px_44px_rgba(26,26,46,0.16)]"
          }
          style={compact ? { top: panelTop } : undefined}
          role="menu"
        >
          <div className="flex items-center justify-between px-[18px] pb-3 pt-4">
            <span className="text-[16px] font-bold text-ink">Benachrichtigungen</span>
            {unread > 0 && (
              <button type="button" className="text-[13px] font-semibold text-accent">
                Alle gelesen
              </button>
            )}
          </div>
          {unread === 0 ? (
            <div className="border-t border-[#EEF0F7] px-[18px] py-10 text-center text-sm text-muted-400">
              Noch keine Benachrichtigungen.
            </div>
          ) : (
            <>
              <div className="flex gap-1.5 border-b border-[#EEF0F7] px-[18px] pb-3">
                <span className="border-b-2 border-accent pb-2 text-sm font-bold text-accent">Ungelesen</span>
                <span className="px-2 pb-2 text-sm font-medium text-muted-400">Gelesen</span>
              </div>
              <div className="max-h-[320px] overflow-auto">
                {notifications.map((n, i) => (
                  <div key={i} className="flex gap-[13px] border-b border-[#F2F3F9] px-[18px] py-[14px]">
                    <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] bg-[#EEF0FA]">
                      <span className="h-[15px] w-[15px] rounded-[4px] bg-accent" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-medium leading-[1.45] text-ink">{n.text}</p>
                      <p className="mt-[3px] text-[12px] text-muted-400">{n.time}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function ProfileMenu({
  user,
  compact = false,
  open,
  onToggle,
  onClose,
}: {
  user: TopBarUser;
  compact?: boolean;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [panelTop, setPanelTop] = useState<number>();

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [onClose]);

  return (
    <div className="relative flex-shrink-0" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => {
          if (compact && !open) setPanelTop((btnRef.current?.getBoundingClientRect().bottom ?? 0) + 8);
          onToggle();
        }}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={compact ? `Profilmenü: ${user.name}` : undefined}
        className={
          compact
            ? "flex h-[46px] w-[46px] items-center justify-center rounded-md border border-border-100 bg-white"
            : "flex items-center gap-[11px] rounded-md border border-border-100 bg-white py-[5px] pl-[5px] pr-3"
        }
      >
        {compact ? (
          <CircleUserRound size={23} aria-hidden="true" className="text-navy" />
        ) : (
          <>
            <span
              className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-navy text-[15px] font-bold text-cream"
              aria-hidden="true"
            >
              {initialsFrom(user.name)}
            </span>
            <span className="text-left leading-tight">
              <span className="block text-[14px] font-semibold text-ink">{user.name}</span>
              {user.role && <span className="block text-[12px] text-muted-400">{user.role}</span>}
            </span>
            <ChevronDown size={16} aria-hidden="true" className="text-muted-500" />
          </>
        )}
      </button>
      {open && (
        <div
          className={
            compact
              ? "fixed inset-x-4 z-30 overflow-hidden rounded-xl border border-border-100 bg-white p-2 shadow-[0_18px_44px_rgba(26,26,46,0.16)]"
              : "absolute right-0 top-14 z-30 w-[250px] overflow-hidden rounded-xl border border-border-100 bg-white p-2 shadow-[0_18px_44px_rgba(26,26,46,0.16)]"
          }
          style={compact ? { top: panelTop } : undefined}
          role="menu"
        >
          <div className="px-3 pb-[14px] pt-3">
            <p className="text-[15px] font-bold text-ink">{user.name}</p>
            {user.email && <p className="text-[13px] text-muted-400">{user.email}</p>}
          </div>
          <Link
            href="/einstellungen"
            prefetch={false}
            className="flex items-center gap-[11px] rounded-[10px] px-3 py-[10px] text-[14px] font-medium text-navy no-underline"
          >
            <span className="h-2 w-2 rounded-[2px] bg-accent" />
            Profil ansehen
          </Link>
          <Link
            href="/einstellungen"
            prefetch={false}
            className="flex items-center gap-[11px] rounded-[10px] px-3 py-[10px] text-[14px] font-medium text-navy no-underline"
          >
            <span className="h-2 w-2 rounded-[2px] bg-accent" />
            Einstellungen
          </Link>
          <Link
            href="/einstellungen?tab=benachrichtigungen"
            prefetch={false}
            className="flex items-center gap-[11px] rounded-[10px] px-3 py-[10px] text-[14px] font-medium text-navy no-underline"
          >
            <span className="h-2 w-2 rounded-[2px] bg-accent" />
            Benachrichtigungen
          </Link>
          <div className="mx-1 my-1.5 h-px bg-[#EEF0F7]" />
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="flex w-full items-center gap-[11px] rounded-[10px] px-3 py-[10px] text-[14px] font-semibold text-[#B24343]"
            >
              <span className="h-2 w-2 rounded-[2px] bg-[#B24343]" />
              Abmelden
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
