"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronUp, ChevronDown, User as UserIcon } from "lucide-react";
import { createCustomerAreaItem, updateCustomerAreaItem, deleteCustomerAreaItem, moveCustomerAreaItem } from "@/lib/customer-area/actions";
import type { CustomerAreaItemInput, CustomerAreaItemRow } from "@/lib/customer-area/schema";
import type { CustomerAreaGroupRow, CustomerAreaTenantMember, CustomerAreaVisibility } from "@/lib/customer-area/schema";
import type { TrainerRow } from "@/lib/settings/actions";
import { CustomerAreaVisibilityField } from "@/components/admin/customer-area-visibility-field";

type SubmitResult = { ok: boolean; error?: string };

/**
 * Ansprechpartner-Panel für "Meine Kunden Area" (Plan Abschnitt 3,
 * verwende-den-planungs-agenten-sequential-frost.md) — verweist auf
 * vorhandene Trainer-/Ansprechperson-Profile (Reiter "Inhalte",
 * `trainer-profile-panel.tsx`) statt eigene Profile anzulegen (Plan
 * Abschnitt 0.2: `trainers` bleibt der Datenpool). Eine Zeile hier bindet
 * ein Trainerprofil per `trainer_id` an die Kunden-Area und legt zusätzlich
 * die Sichtbarkeit fest — Name/Bild/Rolle/Telefon/E-Mail kommen unverändert
 * aus `trainers`.
 */
export function CustomerAreaContactsPanel({
  items,
  trainers,
  groups,
  tenantMembers,
}: {
  items: CustomerAreaItemRow[];
  trainers: TrainerRow[];
  groups: CustomerAreaGroupRow[];
  tenantMembers: CustomerAreaTenantMember[];
}) {
  const t = useTranslations("admin.customerArea.contacts");
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

  const availableTrainerIds = new Set(items.map((i) => i.trainerId).filter(Boolean));
  const selectableTrainers = trainers.filter((tr) => !availableTrainerIds.has(tr.id));

  return (
    <section className="rounded-[14px] border bg-white px-7 py-6" style={{ borderColor: "#E7E8F2" }}>
      <div className="mb-1.5 text-[17px] font-bold">{t("heading")}</div>
      <div className="mb-4 text-sm" style={{ color: "#66679B" }}>
        {t("description")}
      </div>

      {trainers.length === 0 ? (
        <p className="text-sm" style={{ color: "#A9AAC4" }}>
          {t("noTrainers")}
        </p>
      ) : (
        <CustomerAreaContactForm
          trainers={selectableTrainers}
          groups={groups}
          tenantMembers={tenantMembers}
          onSubmit={handleCreate}
          submitLabel={t("addButton")}
        />
      )}

      <ul className="mt-4 flex flex-col gap-2">
        {items.map((item, index) => (
          <CustomerAreaContactRowItem
            key={item.id}
            item={item}
            trainer={trainers.find((tr) => tr.id === item.trainerId) ?? null}
            selectableTrainers={selectableTrainers}
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

function CustomerAreaContactRowItem({
  item,
  trainer,
  selectableTrainers,
  groups,
  tenantMembers,
  onDelete,
  isFirst,
  isLast,
}: {
  item: CustomerAreaItemRow;
  trainer: TrainerRow | null;
  selectableTrainers: TrainerRow[];
  groups: CustomerAreaGroupRow[];
  tenantMembers: CustomerAreaTenantMember[];
  onDelete: (id: string) => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const t = useTranslations("admin.customerArea.contacts");
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

  // Beim Bearbeiten darf das aktuell zugeordnete Trainerprofil weiterhin
  // ausgewählt sein, auch wenn es sonst schon "vergeben" ist (nur EIN
  // Kunden-Area-Kontakt je Trainer, siehe `availableTrainerIds` oben).
  const editableTrainers = trainer ? [trainer, ...selectableTrainers] : selectableTrainers;

  if (editing) {
    return (
      <li className="rounded-[10px] border px-4 py-3" style={{ borderColor: "#E7E8F2" }}>
        <CustomerAreaContactForm
          trainers={editableTrainers}
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
        {trainer?.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- Storage-URL, kein next/image-Loader konfiguriert
          <img src={trainer.imageUrl} alt="" className="h-10 w-10 flex-none rounded-full object-cover" />
        ) : (
          <span
            className="flex h-10 w-10 flex-none items-center justify-center rounded-full"
            style={{ background: "#EEF0F7", color: "#A9AAC4" }}
          >
            <UserIcon size={18} aria-hidden="true" />
          </span>
        )}
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-semibold">{trainer?.name ?? t("unknownTrainer")}</span>
          {trainer?.role && (
            <span className="truncate text-sm" style={{ color: "#66679B" }}>
              {trainer.role}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-none gap-2">
        <button
          type="button"
          aria-label={t("moveUpAria", { name: trainer?.name ?? "" })}
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
          aria-label={t("moveDownAria", { name: trainer?.name ?? "" })}
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

function CustomerAreaContactForm({
  initial,
  trainers,
  groups,
  tenantMembers,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: CustomerAreaItemRow;
  trainers: TrainerRow[];
  groups: CustomerAreaGroupRow[];
  tenantMembers: CustomerAreaTenantMember[];
  submitLabel: string;
  onSubmit: (input: CustomerAreaItemInput) => Promise<SubmitResult>;
  onCancel?: () => void;
}) {
  const t = useTranslations("admin.customerArea.contacts");
  const tAdminCommon = useTranslations("admin.common");
  const tCommon = useTranslations("common");
  const [trainerId, setTrainerId] = useState(initial?.trainerId ?? "");
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
        kind: "contact",
        trainerId: trainerId || undefined,
        visibility,
        groupIds,
        userIds,
      });
      if (!result.ok) {
        setError(result.error ?? t("genericError"));
        return;
      }
      if (!initial) {
        setTrainerId("");
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
      <label className="flex flex-col gap-1 text-sm font-semibold" style={{ color: "#3E3F66" }} htmlFor={`customer-area-contact-trainer-${initial?.id ?? "new"}`}>
        {t("trainerLabel")}
        <select
          id={`customer-area-contact-trainer-${initial?.id ?? "new"}`}
          required
          value={trainerId}
          onChange={(e) => setTrainerId(e.target.value)}
          className="rounded-[10px] border px-3.5 py-2.5 text-base font-normal"
          style={{ borderColor: "#D8DAEA" }}
        >
          <option value="">{t("trainerPlaceholder")}</option>
          {trainers.map((tr) => (
            <option key={tr.id} value={tr.id}>
              {tr.role ? `${tr.name} — ${tr.role}` : tr.name}
            </option>
          ))}
        </select>
      </label>

      <CustomerAreaVisibilityField
        idPrefix={`customer-area-contact-${initial?.id ?? "new"}`}
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
