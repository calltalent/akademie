"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronUp, Users as UsersIcon } from "lucide-react";
import {
  createCustomerAreaGroup,
  renameCustomerAreaGroup,
  deleteCustomerAreaGroup,
  setCustomerAreaGroupMembers,
} from "@/lib/customer-area/actions";
import type { CustomerAreaGroupRow, CustomerAreaTenantMember } from "@/lib/customer-area/schema";

/**
 * Gruppenverwaltung für "Meine Kunden Area" (Plan Abschnitt 3,
 * verwende-den-planungs-agenten-sequential-frost.md). Gleiches Grundmuster
 * wie `trainer-profile-panel.tsx`/`sidebar-links-panel.tsx` (Karte,
 * Anlegen-Formular oben, Liste darunter). Je Gruppe eine aufklappbare
 * Checkbox-Liste aktiver Mitglieder (kein Multi-Select-Combobox, WCAG 2.1
 * AA/CLAUDE.md §3.4) — Mitgliederauswahl speichert separat von
 * Name/Umbenennen, damit ein Speichern-Klick nicht versehentlich beide
 * Formulare zusammen absendet.
 */
export function CustomerAreaGroupsPanel({
  groups,
  tenantMembers,
}: {
  groups: CustomerAreaGroupRow[];
  tenantMembers: CustomerAreaTenantMember[];
}) {
  const t = useTranslations("admin.customerArea.groups");
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createCustomerAreaGroup(name);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setName("");
      router.refresh();
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteCustomerAreaGroup(id);
      router.refresh();
    });
  }

  return (
    <section className="rounded-[14px] border bg-white px-7 py-6" style={{ borderColor: "#E7E8F2" }}>
      <div className="mb-1.5 text-[17px] font-bold">{t("heading")}</div>
      <div className="mb-4 text-sm" style={{ color: "#66679B" }}>
        {t("description")}
      </div>

      <form onSubmit={handleCreate} className="mb-4 flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm font-semibold" style={{ color: "#3E3F66" }} htmlFor="customer-area-group-name">
          {t("nameLabel")}
          <input
            id="customer-area-group-name"
            type="text"
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("namePlaceholder")}
            className="rounded-[10px] border px-3.5 py-2.5 text-base font-normal"
            style={{ borderColor: "#D8DAEA" }}
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="self-start rounded-[10px] px-4 py-2.5 text-base font-semibold text-white disabled:opacity-50"
          style={{ background: "#5663AE" }}
        >
          {pending ? t("addingButton") : t("addButton")}
        </button>
      </form>
      {error && (
        <p role="alert" className="mb-3 text-sm font-semibold" style={{ color: "#B14A4A" }}>
          {error}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {groups.map((group) => (
          <CustomerAreaGroupRowItem key={group.id} group={group} tenantMembers={tenantMembers} onDelete={handleDelete} />
        ))}
        {groups.length === 0 && (
          <p className="text-sm" style={{ color: "#A9AAC4" }}>
            {t("empty")}
          </p>
        )}
      </ul>
    </section>
  );
}

function CustomerAreaGroupRowItem({
  group,
  tenantMembers,
  onDelete,
}: {
  group: CustomerAreaGroupRow;
  tenantMembers: CustomerAreaTenantMember[];
  onDelete: (id: string) => void;
}) {
  const t = useTranslations("admin.customerArea.groups");
  const tSettings = useTranslations("admin.settings");
  const tCommon = useTranslations("common");
  const tAdminCommon = useTranslations("admin.common");
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(group.name);
  const [expanded, setExpanded] = useState(false);
  const [memberIds, setMemberIds] = useState<string[]>(group.memberUserIds);
  const [error, setError] = useState<string | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [savingMembers, startSavingMembers] = useTransition();

  function handleRename(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await renameCustomerAreaGroup(group.id, name);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  function toggleMember(userId: string, checked: boolean) {
    setMemberIds((prev) => (checked ? [...prev, userId] : prev.filter((id) => id !== userId)));
  }

  function handleSaveMembers() {
    setMembersError(null);
    startSavingMembers(async () => {
      const result = await setCustomerAreaGroupMembers(group.id, memberIds);
      if (!result.ok) {
        setMembersError(result.error);
        return;
      }
      router.refresh();
    });
  }

  if (editing) {
    return (
      <li className="rounded-[10px] border px-4 py-3" style={{ borderColor: "#E7E8F2" }}>
        <form onSubmit={handleRename} className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-sm font-semibold" style={{ color: "#3E3F66" }} htmlFor={`customer-area-group-name-${group.id}`}>
            {t("nameLabel")}
            <input
              id={`customer-area-group-name-${group.id}`}
              type="text"
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-[10px] border px-3.5 py-2.5 text-base"
              style={{ borderColor: "#D8DAEA" }}
            />
          </label>
          {error && (
            <p role="alert" className="text-sm font-semibold" style={{ color: "#B14A4A" }}>
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-[10px] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: "#5663AE" }}
            >
              {pending ? tAdminCommon("saving") : tCommon("save")}
            </button>
            <button
              type="button"
              onClick={() => {
                setName(group.name);
                setError(null);
                setEditing(false);
              }}
              className="rounded-[10px] border bg-white px-3 py-1.5 text-sm font-semibold"
              style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
            >
              {tCommon("cancel")}
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="rounded-[10px] border" style={{ borderColor: "#E7E8F2" }}>
      <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3 text-base">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="flex h-9 w-9 flex-none items-center justify-center rounded-full"
            style={{ background: "#EEF0F7", color: "#5663AE" }}
          >
            <UsersIcon size={16} aria-hidden="true" />
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-semibold">{group.name}</span>
            <span className="text-sm" style={{ color: "#66679B" }}>
              {t("memberCount", { count: group.memberUserIds.length })}
            </span>
          </div>
        </div>
        <div className="flex flex-none gap-2">
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={`customer-area-group-members-${group.id}`}
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1.5 rounded-[9px] border bg-white px-3 py-1 text-sm font-semibold"
            style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
          >
            {expanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
            {t("membersToggle")}
          </button>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-[9px] border bg-white px-3 py-1 text-sm font-semibold"
            style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
          >
            {tSettings("editButton")}
          </button>
          <button
            type="button"
            onClick={() => onDelete(group.id)}
            className="rounded-[9px] border bg-white px-3 py-1 text-sm font-semibold"
            style={{ borderColor: "#E9CFCF", color: "#B14A4A" }}
          >
            {tSettings("deleteButton")}
          </button>
        </div>
      </div>

      {expanded && (
        <div id={`customer-area-group-members-${group.id}`} className="border-t px-4 py-3" style={{ borderColor: "#E7E8F2" }}>
          {tenantMembers.length === 0 ? (
            <p className="text-sm" style={{ color: "#A9AAC4" }}>
              {t("noMembers")}
            </p>
          ) : (
            <ul className="mb-3 flex max-h-56 flex-col gap-1 overflow-y-auto">
              {tenantMembers.map((m) => (
                <li key={m.userId}>
                  <label className="flex items-center gap-2 text-sm" style={{ color: "#3E3F66" }}>
                    <input
                      type="checkbox"
                      checked={memberIds.includes(m.userId)}
                      onChange={(e) => toggleMember(m.userId, e.target.checked)}
                      className="h-4 w-4 flex-none accent-[#5663AE]"
                    />
                    <span className="truncate">{m.fullName ? `${m.fullName} (${m.email})` : m.email}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {membersError && (
            <p role="alert" className="mb-2 text-sm font-semibold" style={{ color: "#B14A4A" }}>
              {membersError}
            </p>
          )}
          <button
            type="button"
            onClick={handleSaveMembers}
            disabled={savingMembers}
            className="rounded-[10px] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: "#5663AE" }}
          >
            {savingMembers ? tAdminCommon("saving") : t("saveMembersButton")}
          </button>
        </div>
      )}
    </li>
  );
}
