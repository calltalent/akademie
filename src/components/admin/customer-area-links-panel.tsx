"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ChevronUp,
  ChevronDown,
  Link as LinkIcon,
  Folder,
  Video,
  MessageCircle,
  Users,
  Calendar,
  FileText,
  Globe,
  Mail,
  Phone,
  type LucideIcon,
} from "lucide-react";
import { createCustomerAreaItem, updateCustomerAreaItem, deleteCustomerAreaItem, moveCustomerAreaItem } from "@/lib/customer-area/actions";
import type { CustomerAreaItemInput, CustomerAreaItemRow } from "@/lib/customer-area/schema";
import type { CustomerAreaGroupRow, CustomerAreaTenantMember, CustomerAreaVisibility } from "@/lib/customer-area/schema";
import { CUSTOMER_AREA_ICONS, type CustomerAreaIcon } from "@/lib/customer-area/schema";
import { CustomerAreaVisibilityField } from "@/components/admin/customer-area-visibility-field";

type SubmitResult = { ok: boolean; error?: string };

/** Deckt sich 1:1 mit den Schlüsseln unter messages/de.json admin.customerArea.icons. */
type IconMessageKey = "link" | "folder" | "video" | "messageCircle" | "users" | "calendar" | "fileText" | "globe" | "mail" | "phone";

/** Icon-Schlüssel (kebab-case, DB-Wert) -> lucide-Komponente + i18n-Kamelkey. */
const ICON_MAP: Record<CustomerAreaIcon, { Icon: LucideIcon; messageKey: IconMessageKey }> = {
  link: { Icon: LinkIcon, messageKey: "link" },
  folder: { Icon: Folder, messageKey: "folder" },
  video: { Icon: Video, messageKey: "video" },
  "message-circle": { Icon: MessageCircle, messageKey: "messageCircle" },
  users: { Icon: Users, messageKey: "users" },
  calendar: { Icon: Calendar, messageKey: "calendar" },
  "file-text": { Icon: FileText, messageKey: "fileText" },
  globe: { Icon: Globe, messageKey: "globe" },
  mail: { Icon: Mail, messageKey: "mail" },
  phone: { Icon: Phone, messageKey: "phone" },
};

/**
 * Links-Panel für "Meine Kunden Area" (Plan Abschnitt 3,
 * verwende-den-planungs-agenten-sequential-frost.md) — Drive-Ordner,
 * WhatsApp-/Facebook-Gruppen etc. Gleiches Grundmuster wie
 * `sidebar-links-panel.tsx`/`promo-cards-panel.tsx` (Karte, Formular oben,
 * Liste mit Bearbeiten/Löschen/Auf-Ab darunter), zusätzlich Icon-Auswahl aus
 * der festen Whitelist (`CUSTOMER_AREA_ICONS`) und der gemeinsame
 * `CustomerAreaVisibilityField`-Baustein.
 */
export function CustomerAreaLinksPanel({
  items,
  groups,
  tenantMembers,
}: {
  items: CustomerAreaItemRow[];
  groups: CustomerAreaGroupRow[];
  tenantMembers: CustomerAreaTenantMember[];
}) {
  const t = useTranslations("admin.customerArea.links");
  const router = useRouter();

  async function handleCreate(input: CustomerAreaItemInput): Promise<SubmitResult> {
    const result = await createCustomerAreaItem(input);
    if (!result.ok) return { ok: false, error: result.error };
    router.refresh();
    return { ok: true };
  }

  function handleDelete(id: string) {
    deleteCustomerAreaItem(id).then(() => router.refresh());
  }

  return (
    <section className="rounded-[14px] border bg-white px-7 py-6" style={{ borderColor: "#E7E8F2" }}>
      <div className="mb-1.5 text-[17px] font-bold">{t("heading")}</div>
      <div className="mb-4 text-sm" style={{ color: "#66679B" }}>
        {t("description")}
      </div>

      <CustomerAreaLinkForm groups={groups} tenantMembers={tenantMembers} onSubmit={handleCreate} submitLabel={t("addButton")} />

      <ul className="mt-4 flex flex-col gap-2">
        {items.map((item, index) => (
          <CustomerAreaLinkRowItem
            key={item.id}
            item={item}
            groups={groups}
            tenantMembers={tenantMembers}
            onDelete={handleDelete}
            isFirst={index === 0}
            isLast={index === items.length - 1}
          />
        ))}
        {items.length === 0 && (
          <p className="text-sm" style={{ color: "#A9AAC4" }}>
            {t("empty")}
          </p>
        )}
      </ul>
    </section>
  );
}

function CustomerAreaLinkRowItem({
  item,
  groups,
  tenantMembers,
  onDelete,
  isFirst,
  isLast,
}: {
  item: CustomerAreaItemRow;
  groups: CustomerAreaGroupRow[];
  tenantMembers: CustomerAreaTenantMember[];
  onDelete: (id: string) => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const t = useTranslations("admin.customerArea.links");
  const tSettings = useTranslations("admin.settings");
  const tCommon = useTranslations("common");
  const tPosition = useTranslations("admin.courseEditor.position");
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [moving, startMoving] = useTransition();

  function handleMove(direction: "up" | "down") {
    startMoving(async () => {
      await moveCustomerAreaItem(item.id, direction);
      router.refresh();
    });
  }

  async function handleUpdate(input: CustomerAreaItemInput): Promise<SubmitResult> {
    const result = await updateCustomerAreaItem(item.id, input);
    if (!result.ok) return { ok: false, error: result.error };
    router.refresh();
    return { ok: true };
  }

  if (editing) {
    return (
      <li className="rounded-[10px] border px-4 py-3" style={{ borderColor: "#E7E8F2" }}>
        <CustomerAreaLinkForm
          groups={groups}
          tenantMembers={tenantMembers}
          initial={item}
          onSubmit={handleUpdate}
          submitLabel={tCommon("save")}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  const IconEntry = item.icon && item.icon in ICON_MAP ? ICON_MAP[item.icon as CustomerAreaIcon] : null;

  return (
    <li
      className="flex flex-wrap items-center justify-between gap-4 rounded-[10px] border px-4 py-3 text-base"
      style={{ borderColor: "#E7E8F2" }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="flex h-10 w-10 flex-none items-center justify-center rounded-[8px]"
          style={{ background: "#EEF0F7", color: "#5663AE" }}
        >
          {IconEntry ? <IconEntry.Icon size={18} aria-hidden="true" /> : <LinkIcon size={18} aria-hidden="true" />}
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-semibold">{item.title}</span>
          <span className="truncate text-sm" style={{ color: "#66679B" }}>
            {item.url}
          </span>
        </div>
      </div>
      <div className="flex flex-none gap-2">
        <button
          type="button"
          aria-label={t("moveUpAria", { title: item.title ?? "" })}
          title={tPosition("moveUpTitle")}
          onClick={() => handleMove("up")}
          disabled={moving || isFirst}
          className="rounded-[9px] border bg-white px-2 py-1 text-sm disabled:opacity-30"
          style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
        >
          <ChevronUp size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={t("moveDownAria", { title: item.title ?? "" })}
          title={tPosition("moveDownTitle")}
          onClick={() => handleMove("down")}
          disabled={moving || isLast}
          className="rounded-[9px] border bg-white px-2 py-1 text-sm disabled:opacity-30"
          style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
        >
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => setEditing(true)}
          disabled={moving}
          className="rounded-[9px] border bg-white px-3 py-1 text-sm font-semibold disabled:opacity-50"
          style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
        >
          {tSettings("editButton")}
        </button>
        <button
          type="button"
          onClick={() => onDelete(item.id)}
          disabled={moving}
          className="rounded-[9px] border bg-white px-3 py-1 text-sm font-semibold disabled:opacity-50"
          style={{ borderColor: "#E9CFCF", color: "#B14A4A" }}
        >
          {tSettings("deleteButton")}
        </button>
      </div>
    </li>
  );
}

function CustomerAreaLinkForm({
  initial,
  groups,
  tenantMembers,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: CustomerAreaItemRow;
  groups: CustomerAreaGroupRow[];
  tenantMembers: CustomerAreaTenantMember[];
  submitLabel: string;
  onSubmit: (input: CustomerAreaItemInput) => Promise<SubmitResult>;
  onCancel?: () => void;
}) {
  const t = useTranslations("admin.customerArea.links");
  const tIcons = useTranslations("admin.customerArea.icons");
  const tAdminCommon = useTranslations("admin.common");
  const tCommon = useTranslations("common");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [icon, setIcon] = useState<CustomerAreaIcon | "">((initial?.icon as CustomerAreaIcon) ?? "");
  const [visibility, setVisibility] = useState<CustomerAreaVisibility>(initial?.visibility ?? "all");
  const [groupIds, setGroupIds] = useState<string[]>(initial?.groupIds ?? []);
  const [userIds, setUserIds] = useState<string[]>(initial?.userIds ?? []);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await onSubmit({
        kind: "link",
        title,
        url,
        description: description.trim() || undefined,
        icon: icon || undefined,
        visibility,
        groupIds,
        userIds,
      });
      if (!result.ok) {
        setError(result.error ?? t("genericError"));
        return;
      }
      if (!initial) {
        setTitle("");
        setUrl("");
        setDescription("");
        setIcon("");
        setVisibility("all");
        setGroupIds([]);
        setUserIds([]);
      } else {
        onCancel?.();
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm font-semibold" style={{ color: "#3E3F66" }}>
        {t("titleLabel")}
        <input
          type="text"
          required
          maxLength={150}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("titlePlaceholder")}
          className="rounded-[10px] border px-3.5 py-2.5 text-base font-normal"
          style={{ borderColor: "#D8DAEA" }}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold" style={{ color: "#3E3F66" }}>
        {t("urlLabel")}
        <input
          type="text"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t("urlPlaceholder")}
          className="rounded-[10px] border px-3.5 py-2.5 text-base font-normal"
          style={{ borderColor: "#D8DAEA" }}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold" style={{ color: "#3E3F66" }}>
        {t("descriptionLabel")}
        <textarea
          maxLength={1000}
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="rounded-[10px] border px-3.5 py-2.5 text-base font-normal"
          style={{ borderColor: "#D8DAEA" }}
        />
      </label>

      <div className="flex flex-col gap-1.5 text-sm font-semibold" style={{ color: "#3E3F66" }}>
        {t("iconLabel")}
        <div className="flex flex-wrap gap-2">
          {CUSTOMER_AREA_ICONS.map((key) => {
            const { Icon, messageKey } = ICON_MAP[key];
            const selected = icon === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setIcon(selected ? "" : key)}
                aria-pressed={selected}
                title={tIcons(messageKey)}
                className="flex h-9 w-9 items-center justify-center rounded-[9px] border"
                style={
                  selected
                    ? { background: "#5663AE", color: "#fff", borderColor: "#5663AE" }
                    : { background: "#fff", color: "#3E3F66", borderColor: "#E7E8F2" }
                }
              >
                <Icon size={16} aria-hidden="true" />
                <span className="sr-only">{tIcons(messageKey)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <CustomerAreaVisibilityField
        idPrefix={`customer-area-link-${initial?.id ?? "new"}`}
        groups={groups}
        members={tenantMembers}
        visibility={visibility}
        onVisibilityChange={setVisibility}
        groupIds={groupIds}
        onGroupIdsChange={setGroupIds}
        userIds={userIds}
        onUserIdsChange={setUserIds}
      />

      {error && (
        <p role="alert" className="text-sm font-semibold" style={{ color: "#B14A4A" }}>
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="self-start rounded-[10px] px-4 py-2.5 text-base font-semibold text-white disabled:opacity-50"
          style={{ background: "#5663AE" }}
        >
          {pending ? tAdminCommon("saving") : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-[10px] border bg-white px-4 py-2.5 text-base font-semibold disabled:opacity-50"
            style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
          >
            {tCommon("cancel")}
          </button>
        )}
      </div>
    </form>
  );
}
