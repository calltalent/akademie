import { getTranslations } from "next-intl/server";
import { checkAffiliateManagerAccess } from "@/lib/affiliate/access";
import { getAffiliateProgram } from "@/lib/affiliate/queries";
import { AffiliateAccessNotice, AffiliateShell } from "../affiliate-shell";
import { CARD_BORDER, CARD_CLASS, MUTED } from "../affiliate-format";
import {
  AffiliateSettingsForm,
  type AffiliateSettingsValues,
} from "./settings-form";

/**
 * Affiliate-System, Block B6-B — `/admin/affiliate/einstellungen`
 * (PLAN_Affiliate-System.md 8.1 Zeile 7, 3.2).
 *
 * Diese Seite ist die EINZIGE, die ohne Programmzeile arbeitet: sie legt sie
 * an. Alle anderen Seiten verweisen hierher, solange es keine gibt — ohne
 * Satz, Währung und Frist wäre jede Zahl dort erfunden.
 *
 * Die Vorbelegung eines noch nicht angelegten Programms steht unten als
 * `DEFAULTS` und ist bewusst zurückhaltend: Entwurf, privat, Freigabe von
 * Hand. Ein Programm, das beim ersten Speichern sofort öffentlich und aktiv
 * wäre, hätte der Händler nicht entschieden, sondern die Vorbelegung.
 */

/**
 * Werte eines noch nicht angelegten Programms. Jeder einzelne ist entweder
 * der Standardwert der Spalte aus 3.2 oder die vorsichtigere Variante davon.
 * `reserveDays` darf nicht unter `holdDays` liegen (CHECK in 3.2 und
 * `superRefine` im Schema) — deshalb stehen beide auf 30.
 */
const DEFAULTS: AffiliateSettingsValues = {
  status: "draft",
  visibility: "private",
  approvalMode: "manual",
  rateKind: "percent",
  rateBp: 2000,
  fixedCents: 0,
  minCommissionCents: null,
  maxCommissionCents: null,
  basisKind: "net",
  feeDeductionBp: 0,
  currency: "eur",
  attributionModel: "last",
  cookieTtlDays: 30,
  overwritePolicy: "allow",
  lifetimeBinding: false,
  selfReferral: "block",
  referrerBlocklist: [],
  recurringMode: "first_only",
  recurringMaxPeriods: 12,
  tier2Enabled: false,
  tier2Basis: "commission",
  tier2RateBp: 0,
  holdDays: 30,
  reserveBp: 0,
  reserveDays: 30,
  minPayoutCents: 5000,
  payoutSchedule: "monthly",
  descriptionMd: "",
  termsText: "",
  termsVersion: 1,
  applicationNote: "",
  applicationFields: [],
  testMode: false,
};

export default async function AdminAffiliateSettingsPage() {
  const access = await checkAffiliateManagerAccess();
  if (!access.ok) return <AffiliateAccessNotice reason={access.reason} />;

  const t = await getTranslations("admin.affiliate");
  const program = await getAffiliateProgram(access.tenant.id);

  const values: AffiliateSettingsValues =
    program === null
      ? DEFAULTS
      : {
          status: program.status,
          visibility: program.visibility,
          approvalMode: program.approval_mode,
          rateKind: program.rate_kind,
          rateBp: program.rate_bp,
          fixedCents: program.fixed_cents,
          minCommissionCents: program.min_commission_cents,
          maxCommissionCents: program.max_commission_cents,
          basisKind: program.basis_kind,
          feeDeductionBp: program.fee_deduction_bp,
          currency: program.currency,
          attributionModel: program.attribution_model,
          cookieTtlDays: program.cookie_ttl_days,
          overwritePolicy: program.overwrite_policy,
          lifetimeBinding: program.lifetime_binding,
          selfReferral: program.self_referral,
          referrerBlocklist: program.referrer_blocklist,
          recurringMode: program.recurring_mode,
          recurringMaxPeriods: program.recurring_max_periods,
          tier2Enabled: program.tier2_enabled,
          tier2Basis: program.tier2_basis,
          tier2RateBp: program.tier2_rate_bp,
          holdDays: program.hold_days,
          reserveBp: program.reserve_bp,
          reserveDays: program.reserve_days,
          minPayoutCents: program.min_payout_cents,
          payoutSchedule: program.payout_schedule,
          descriptionMd: program.description_md,
          termsText: program.terms_text,
          termsVersion: program.terms_version,
          applicationNote: program.application_note,
          applicationFields: program.application_fields,
          testMode: program.test_mode,
        };

  return (
    <AffiliateShell active="settings" title={t("settings.title")}>
      {program === null && (
        <p
          className={`${CARD_CLASS} p-[16px_20px] text-[15px]`}
          style={{ borderColor: CARD_BORDER, color: MUTED }}
        >
          {t("settings.firstSaveHint")}
        </p>
      )}
      <AffiliateSettingsForm values={values} />
    </AffiliateShell>
  );
}
