"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronUp, ChevronDown, Megaphone } from "lucide-react";
import { createCustomerAreaItem, updateCustomerAreaItem, deleteCustomerAreaItem, moveCustomerAreaItem } from "@/lib/customer-area/actions";
import type { CustomerAreaItemInput, CustomerAreaItemRow } from "@/lib/customer-area/schema";
import type { CustomerAreaGroupRow, CustomerAreaTenantMember, CustomerAreaVisibility } from "@/lib/customer-area/schema";
import { CustomerAreaVisibilityField } from "@/components/admin/customer-area-visibility-field";
import { ThumbnailUpload } from "@/components/admin/thumbnail-upload";

type SubmitResult = { ok: boolean; error?: string };

/**
 * Ankündigungen-Panel für "Meine Kunden Area" (Plan Abschnitt 3,
 * verwende-den-planungs-agenten-sequential-frost.md) — Titel, Beschreibung,
 * optionales Bild (`ThumbnailUpload`, gleiches Muster wie
 * `trainer-profile-panel.tsx`), optionaler CTA-Link, optionales
 * Anzeigedatum, Sichtbarkeit.
 */
export function CustomerAreaAnnouncementsPanel({
  items,
  groups,
  tenantMembers,
}: {
  items: CustomerAreaItemRow[];
  groups: CustomerAreaGroupRow[];
  tenantMembers: CustomerAreaTenantMember[];
}) {
  const t = useTranslations("admin.customerArea.announcements");
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

      <CustomerAreaAnnouncementForm groups={groups} tenantMembers={tenantMembers} onSubmit={handleCreate} submitLabel={t("addButton")} />

      <ul className="mt-4 flex flex-col gap-2">
        {items.map((item, index) => (
          <CustomerAreaAnnouncementRowItem
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

function CustomerAreaAnnouncementRowItem({
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
  const t = useTranslations("admin.customerArea.announcements");
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
        <CustomerAreaAnnouncementForm
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

  return (
    <li
      className="flex flex-wrap items-center justify-between gap-4 rounded-[10px] border px-4 py-3 text-base"
      style={{ borderColor: "#E7E8F2" }}
    >
      <div className="flex min-w-0 items-center gap-3">
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- Storage-URL, kein next/image-Loader konfiguriert
          <img src={item.imageUrl} alt="" className="h-10 w-16 flex-none rounded-[8px] object-cover" />
        ) : (
          <span
            className="flex h-10 w-16 flex-none items-center justify-center rounded-[8px]"
            style={{ background: "#EEF0F7", color: "#A9AAC4" }}
          >
            <Megaphone size={18} aria-hidden="true" />
          </span>
        )}
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-semibold">{item.title}</span>
          {item.description && (
            <span className="truncate text-sm" style={{ color: "#66679B" }}>
              {item.description}
            </span>
          )}
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

function CustomerAreaAnnouncementForm({
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
  const t = useTranslations("admin.customerArea.announcements");
  const tAdminCommon = useTranslations("admin.common");
  const tCommon = useTranslations("common");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [imageUrl, setImageUrl] = useState<string | null>(initial?.imageUrl ?? null);
  const [linkUrl, setLinkUrl] = useState(initial?.url ?? "");
  const [itemDate, setItemDate] = useState(initial?.itemDate ?? "");
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
        kind: "announcement",
        title,
        description: description.trim() || undefined,
        imageUrl: imageUrl ?? undefined,
        url: linkUrl.trim() || undefined,
        itemDate: itemDate || undefined,
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
        setDescription("");
        setImageUrl(null);
        setLinkUrl("");
        setItemDate("");
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
      <div className="flex items-start gap-3">
        <ThumbnailUpload
          initialUrl={imageUrl}
          entityLabel={t("imageEntityLabel")}
          entityTitle={title || t("imageEntityFallbackTitle")}
          onUpload={async (url) => {
            setImageUrl(url);
            return { error: null };
          }}
        />
        <div className="flex flex-1 flex-col gap-3">
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
            {t("dateLabel")}
            <input
              type="date"
              value={itemDate}
              onChange={(e) => setItemDate(e.target.value)}
              className="rounded-[10px] border px-3.5 py-2.5 text-base font-normal"
              style={{ borderColor: "#D8DAEA" }}
            />
          </label>
        </div>
      </div>

      <label className="flex flex-col gap-1 text-sm font-semibold" style={{ color: "#3E3F66" }}>
        {t("descriptionLabel")}
        <textarea
          maxLength={1000}
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="rounded-[10px] border px-3.5 py-2.5 text-base font-normal"
          style={{ borderColor: "#D8DAEA" }}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm font-semibold" style={{ color: "#3E3F66" }}>
        {t("linkLabel")}
        <input
          type="text"
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          placeholder={t("linkPlaceholder")}
          className="rounded-[10px] border px-3.5 py-2.5 text-base font-normal"
          style={{ borderColor: "#D8DAEA" }}
        />
      </label>

      <CustomerAreaVisibilityField
        idPrefix={`customer-area-announcement-${initial?.id ?? "new"}`}
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
