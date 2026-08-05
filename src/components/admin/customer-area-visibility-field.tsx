"use client";

import { useTranslations } from "next-intl";
import type { CustomerAreaGroupRow, CustomerAreaTenantMember, CustomerAreaVisibility } from "@/lib/customer-area/schema";

/**
 * Gemeinsamer Sichtbarkeits-Baustein für alle drei Kunden-Area-Item-Panels
 * (Links/Kontakte/Ankündigungen) — Plan Abschnitt 3
 * (verwende-den-planungs-agenten-sequential-frost.md). Radio-Gruppe "Alle
 * Mitglieder" (Standard) / "Nur ausgewählte Gruppen oder Personen", bei
 * zweiter Option zwei Checkbox-Listen (Gruppen, Personen). Native
 * Radios/Checkboxen statt Multi-Select-Combobox — vollständig
 * tastaturbedienbar, kein ARIA-Konstrukt nötig (WCAG 2.1 AA ist
 * Produktanforderung, CLAUDE.md §3.4, Auftraggeber sehbehindert). Jedes
 * `<input>` sitzt als Kind seines `<label>` — implizite Beschriftung, kein
 * `aria-label` nötig.
 *
 * `idPrefix` macht den Radio-`name` je Formularinstanz eindeutig (mehrere
 * Zeilen derselben Panel-Liste könnten sonst gleichzeitig im Bearbeiten-
 * Modus stehen und sich einen Radio-Gruppennamen teilen).
 */
export function CustomerAreaVisibilityField({
  idPrefix,
  groups,
  members,
  visibility,
  onVisibilityChange,
  groupIds,
  onGroupIdsChange,
  userIds,
  onUserIdsChange,
}: {
  idPrefix: string;
  groups: Pick<CustomerAreaGroupRow, "id" | "name">[];
  members: CustomerAreaTenantMember[];
  visibility: CustomerAreaVisibility;
  onVisibilityChange: (value: CustomerAreaVisibility) => void;
  groupIds: string[];
  onGroupIdsChange: (ids: string[]) => void;
  userIds: string[];
  onUserIdsChange: (ids: string[]) => void;
}) {
  const t = useTranslations("admin.customerArea.visibility");
  const radioName = `${idPrefix}-visibility`;

  function toggleGroup(id: string, checked: boolean) {
    onGroupIdsChange(checked ? [...groupIds, id] : groupIds.filter((g) => g !== id));
  }

  function toggleUser(id: string, checked: boolean) {
    onUserIdsChange(checked ? [...userIds, id] : userIds.filter((u) => u !== id));
  }

  const summary =
    visibility === "all"
      ? t("summaryAll")
      : groupIds.length === 0 && userIds.length === 0
        ? t("summaryNone")
        : `${t("summaryPrefix")}${[
            groupIds.length > 0 ? t("groupsCount", { count: groupIds.length }) : null,
            userIds.length > 0 ? t("peopleCount", { count: userIds.length }) : null,
          ]
            .filter(Boolean)
            .join(t("summaryJoin"))}${t("summarySuffix")}`;

  return (
    <fieldset className="flex flex-col gap-2 rounded-[10px] border px-3.5 py-3" style={{ borderColor: "#E7E8F2" }}>
      <legend className="px-1 text-sm font-semibold" style={{ color: "#3E3F66" }}>
        {t("legend")}
      </legend>

      <label className="flex items-center gap-2 text-sm" style={{ color: "#3E3F66" }}>
        <input
          type="radio"
          name={radioName}
          checked={visibility === "all"}
          onChange={() => onVisibilityChange("all")}
          className="h-4 w-4 flex-none accent-[#5663AE]"
        />
        {t("allOption")}
      </label>
      <label className="flex items-center gap-2 text-sm" style={{ color: "#3E3F66" }}>
        <input
          type="radio"
          name={radioName}
          checked={visibility === "restricted"}
          onChange={() => onVisibilityChange("restricted")}
          className="h-4 w-4 flex-none accent-[#5663AE]"
        />
        {t("restrictedOption")}
      </label>

      {visibility === "restricted" && (
        <div className="ml-6 mt-1 flex flex-col gap-3 rounded-[10px] border p-3" style={{ borderColor: "#E7E8F2", background: "#FAFAFD" }}>
          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: "#A9AAC4" }}>
              {t("groupsLegend")}
            </p>
            {groups.length === 0 ? (
              <p className="text-sm" style={{ color: "#A9AAC4" }}>
                {t("noGroups")}
              </p>
            ) : (
              <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                {groups.map((g) => (
                  <li key={g.id}>
                    <label className="flex items-center gap-2 text-sm" style={{ color: "#3E3F66" }}>
                      <input
                        type="checkbox"
                        checked={groupIds.includes(g.id)}
                        onChange={(e) => toggleGroup(g.id, e.target.checked)}
                        className="h-4 w-4 flex-none accent-[#5663AE]"
                      />
                      {g.name}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: "#A9AAC4" }}>
              {t("peopleLegend")}
            </p>
            {members.length === 0 ? (
              <p className="text-sm" style={{ color: "#A9AAC4" }}>
                {t("noMembers")}
              </p>
            ) : (
              <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                {members.map((m) => (
                  <li key={m.userId}>
                    <label className="flex items-center gap-2 text-sm" style={{ color: "#3E3F66" }}>
                      <input
                        type="checkbox"
                        checked={userIds.includes(m.userId)}
                        onChange={(e) => toggleUser(m.userId, e.target.checked)}
                        className="h-4 w-4 flex-none accent-[#5663AE]"
                      />
                      <span className="truncate">{m.fullName ? `${m.fullName} (${m.email})` : m.email}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <p className="mt-1 text-sm" style={{ color: "#66679B" }} aria-live="polite">
        {summary}
      </p>
    </fieldset>
  );
}
