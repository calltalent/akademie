"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, ChevronDown, LogOut, Settings } from "lucide-react";

/**
 * Design-Block (12.07.2026, Claude-Design-Export
 * `claude.ai/design/p/890b98ed-af1b-4360-8b96-b9076f8986cd`, von Josip als
 * verbindlich bestätigt — siehe PHASENSTATUS.md "Design-Update"). Neue
 * Komponente, ersetzt die bisherige einfache Kopfzeile aus app-shell.tsx
 * (nur Überschrift + Suchsymbol + Avatar-Link).
 *
 * Benachrichtigungs-Glocke bewusst OHNE Badge-Zähler und OHNE Einträge
 * (leerer Zustand) — es gibt noch keine `notifications`-Tabelle
 * (DESIGN-MASTERPROMPT.md §8.1: kein Feature ohne echtes Datenmodell,
 * keine erfundenen Zahlen). Dropdown-Mechanik (öffnen/schließen, Klick
 * außerhalb schließt) ist fertig verdrahtet, damit ein künftiges
 * Datenmodell nur noch die Liste befüllen muss.
 *
 * "App installieren" aus dem Export bewusst weggelassen (kein
 * `beforeinstallprompt`-Fänger im Repo vorhanden, siehe
 * DESIGN-MASTERPROMPT.md §6.5: ausblenden statt totes UI-Element).
 * "Sprache: Deutsch" als reiner Info-Text, nicht als Link — UI ist aktuell
 * ausschließlich Deutsch (HOME.md §8), ein Sprachumschalter ohne Wirkung
 * wäre irreführend.
 */
export function TopBar({
  breadcrumb,
  title,
  userName,
  userEmail,
}: {
  breadcrumb: string;
  title: string;
  userName: string;
  userEmail?: string;
}) {
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <header
      className="sticky top-0 z-20 flex items-center gap-5 px-10 py-5"
      style={{ background: "#F4F5FA" }}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold" style={{ color: "#A9AAC4" }}>
          {breadcrumb}
        </div>
        <h1 className="mt-0.5 text-2xl font-extrabold tracking-tight" style={{ color: "#1A1A2E" }}>
          {title}
        </h1>
      </div>

      <div className="relative flex-shrink-0" ref={notifRef}>
        <button
          type="button"
          onClick={() => {
            setNotifOpen((v) => !v);
            setProfileOpen(false);
          }}
          aria-expanded={notifOpen}
          aria-haspopup="true"
          aria-label="Benachrichtigungen"
          className="flex h-[46px] w-[46px] items-center justify-center rounded-xl border"
          style={{ borderColor: "#E7E8F2", background: "#fff" }}
        >
          <Bell aria-hidden="true" size={21} style={{ color: "#3E3F66" }} />
        </button>
        {notifOpen && (
          <div
            className="absolute right-0 top-14 z-30 w-[340px] overflow-hidden rounded-2xl border shadow-xl"
            style={{ borderColor: "#E7E8F2", background: "#fff" }}
            role="menu"
          >
            <div className="px-5 pb-3 pt-4 text-[16px] font-bold" style={{ color: "#1A1A2E" }}>
              Benachrichtigungen
            </div>
            <div
              className="px-5 py-10 text-center text-sm"
              style={{ color: "#A9AAC4", borderTop: "1px solid #EEF0F7" }}
            >
              Noch keine Benachrichtigungen.
            </div>
          </div>
        )}
      </div>

      <div className="relative flex-shrink-0" ref={profileRef}>
        <button
          type="button"
          onClick={() => {
            setProfileOpen((v) => !v);
            setNotifOpen(false);
          }}
          aria-expanded={profileOpen}
          aria-haspopup="true"
          className="flex items-center gap-[11px] rounded-xl border py-[5px] pl-[5px] pr-3"
          style={{ borderColor: "#E7E8F2", background: "#fff" }}
        >
          <span
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[15px] font-bold text-white"
            style={{ background: "#3E3F66" }}
            aria-hidden="true"
          >
            {initialsFrom(userName)}
          </span>
          <span className="text-left leading-tight">
            <span className="block text-sm font-semibold" style={{ color: "#1A1A2E" }}>
              {userName}
            </span>
            <span className="block text-xs" style={{ color: "#A9AAC4" }}>
              Kursteilnehmer
            </span>
          </span>
          <ChevronDown aria-hidden="true" size={16} style={{ color: "#66679B" }} />
        </button>
        {profileOpen && (
          <div
            className="absolute right-0 top-14 z-30 w-[250px] overflow-hidden rounded-2xl border p-2 shadow-xl"
            style={{ borderColor: "#E7E8F2", background: "#fff" }}
            role="menu"
          >
            <div className="px-3 pb-3 pt-2">
              <div className="text-[15px] font-bold" style={{ color: "#1A1A2E" }}>
                {userName}
              </div>
              {userEmail && (
                <div className="text-[13px]" style={{ color: "#A9AAC4" }}>
                  {userEmail}
                </div>
              )}
            </div>
            <Link
              href="/profil"
              className="flex items-center gap-[11px] rounded-[10px] px-3 py-[10px] text-sm font-medium"
              style={{ color: "#3E3F66" }}
            >
              <Settings aria-hidden="true" size={16} />
              Profil und Einstellungen
            </Link>
            <div className="px-3 py-1 text-[13px]" style={{ color: "#A9AAC4" }}>
              Sprache: Deutsch
            </div>
            <div className="my-1 mx-1 h-px" style={{ background: "#EEF0F7" }} />
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="flex w-full items-center gap-[11px] rounded-[10px] px-3 py-[10px] text-sm font-semibold"
                style={{ color: "#B24343" }}
              >
                <LogOut aria-hidden="true" size={16} />
                Abmelden
              </button>
            </form>
          </div>
        )}
      </div>
    </header>
  );
}

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
