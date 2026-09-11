import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenant } from "@/lib/tenant/context";
import { isAffiliateEnabled } from "@/lib/tenant/types";
import { computeBaseCents, computeCommissionParts } from "@/lib/affiliate/compute";
import { AFFILIATE_PROGRAM_PUBLIC_COLUMNS } from "@/lib/affiliate/types";
import type { AffiliateProgramPublicRow } from "@/lib/affiliate/types";
import { issueContactFormToken } from "@/lib/contact/form-token";
import { publicEnv } from "@/lib/env";
import { BewerbungForm } from "./bewerbung-form";

/**
 * Affiliate-System, Block B7-B — die öffentliche Programmseite
 * (PLAN_Affiliate-System.md 8.3, 8.5, 11.10, 11.15).
 *
 * DIE SEITE IST ENTWEDER DA ODER SIE IST 404. Sichtbar ist sie nur, wenn der
 * Betreiber das Modul für diesen Mandanten freigeschaltet hat
 * (`settings.affiliate_enabled`, gesetzt ausschließlich im Betreiber-Portal,
 * Plan 3.0d/9.8), das Programm `status='active'` trägt und seine
 * `visibility` nicht `private` ist. Jeder andere Fall endet in `notFound()` —
 * NICHT in einer Seite „Partnerprogramm deaktiviert". Eine solche Seite wäre
 * ein Orakel darüber, welcher Mandant ein Partnerprogramm betreibt, und zwar
 * ein von außen abfragbares: wer die Domänenliste kennt, kennt danach die
 * Programme. `visibility='link'` bleibt erreichbar, wird aber über
 * `robots: noindex` aus dem Index gehalten (8.3).
 *
 * GELESEN WIRD MIT `createAdminClient()` UND AUSDRÜCKLICHER SPALTENLISTE
 * (Plan 3.2/11.10), nie über eine `anon`-Policy — `affiliate_programs` hat für
 * `anon` weder SELECT-Recht noch Policy, und das soll so bleiben: eine
 * RLS-Policy kann „genau diese Spalten, genau diese Zeile" nicht durchsetzen,
 * eine Serverfunktion mit Spaltenliste schon (Begründung ausführlich in
 * `src/lib/marketplace/catalog.ts`). Die Liste ist
 * `AFFILIATE_PROGRAM_PUBLIC_COLUMNS` aus types.ts; `select("*")` bräche hier
 * ohnehin mit 42501 ab.
 *
 * ABWEICHUNG MIT GRUND — `terms_text`: Plan 3.2 schließt die Spalte
 * ausdrücklich aus der öffentlichen DTO-Liste aus, diese Seite liest sie
 * trotzdem zusätzlich. Ohne sie stünde über der Zustimmungs-Checkbox „Ich habe
 * die Partnerbedingungen gelesen" ein Text, den niemand lesen kann — eine
 * Zustimmung ohne einsehbaren Gegenstand ist kein Nachweis nach Art. 7 Abs. 1
 * DSGVO, und Plan 8.3 verlangt für diese Seite ausdrücklich das „Regelwerk".
 * Die Spalte wird deshalb genau hier und nur hier gelesen, ausdrücklich
 * benannt, und sie geht NICHT in `AFFILIATE_PROGRAM_PUBLIC_COLUMNS` ein: jede
 * andere Stelle, die das DTO benutzt, bleibt unverändert ohne sie.
 *
 * DIE ATTRIBUTIONSREGELN STEHEN IM KLARTEXT AUF DIESER SEITE. Das ist keine
 * Ausschmückung: ein Streit zwischen Händler und Partner darüber, wem ein
 * Verkauf zuzurechnen ist, ist ohne veröffentlichte Regel unentscheidbar.
 * Jede Regel, die der Verarbeiter anwendet — Zuordnungsdauer, erster oder
 * letzter Klick, Überschreiben, dauerhafte Bindung, Selbstkauf, Abo-Raten,
 * Sperrfrist, Reserve, Storno — wird hier als Satz ausgeschrieben, in
 * derselben Reihenfolge, in der sie greift.
 *
 * DYNAMISCH, NICHT STATISCH: `getTenant()` liest `headers()`, und jeder Aufruf
 * muss ein frisches Formular-Token bekommen (Zeitfalle, 8.3). Ein zwischen-
 * gespeichertes Token wäre nach drei Stunden abgelaufen und das Formular für
 * alle unbenutzbar.
 *
 * BARRIEREFREIHEIT (8.5, CLAUDE.md §3.4): Sprungmarke zum Hauptinhalt, jede
 * Kennzahl als Satz statt als Grafik (es gibt auf dieser Seite bewusst kein
 * Diagramm), Fließtext 18 px bei Zeilenhöhe 1,6, Sekundärtext `#66679B`
 * (rund 5,3:1 auf Weiß) statt `#A9AAC4` (2,3:1, fällt durch AA), jede Regel
 * als `<dt>`/`<dd>`-Paar statt als Aufzählung ohne Bezug.
 */

/** Beispielrechnung: 100,00 € in der Währung des Programms (8.3). */
const EXAMPLE_GROSS_CENTS = 10_000;

/** Was diese Seite liest: die öffentliche Liste plus `terms_text` (siehe Kopf). */
const PROGRAM_COLUMNS = [...AFFILIATE_PROGRAM_PUBLIC_COLUMNS, "terms_text"].join(", ");

type PublicProgram = AffiliateProgramPublicRow & { terms_text: string };

/**
 * Einmal lesen, zweimal verwenden (`generateMetadata` und die Seite selbst).
 * Next.js dedupliziert den Aufruf innerhalb eines Requests nicht automatisch,
 * die zweite Abfrage ist aber ein Primärschlüsselzugriff auf eine Zeile — das
 * ist billiger als ein eigener Cache-Mechanismus, der die Sichtbarkeitsregel
 * verwässern könnte.
 *
 * Gibt `null` zurück, sobald die Seite nicht existieren darf. Der Aufrufer
 * macht daraus `notFound()`; ein Grund wird nirgends ausgegeben.
 */
async function loadPublicProgram(): Promise<{
  tenantName: string;
  program: PublicProgram;
} | null> {
  const tenant = await getTenant();
  if (tenant === null || !isAffiliateEnabled(tenant)) return null;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("affiliate_programs")
    .select(PROGRAM_COLUMNS)
    .eq("tenant_id", tenant.id)
    .maybeSingle();

  if (error) {
    // Nur der SQLSTATE, nie die PostgREST-Meldung (CLAUDE.md §2.11).
    console.error("Partnerprogramm-Seite: Programm nicht lesbar", { code: error.code });
    return null;
  }

  const program = (data ?? null) as PublicProgram | null;
  if (program === null) return null;
  if (program.visibility === "private" || program.status !== "active") return null;

  return { tenantName: tenant.name, program };
}

export async function generateMetadata(): Promise<Metadata> {
  const [loaded, t] = await Promise.all([loadPublicProgram(), getTranslations("affiliate.program")]);
  if (loaded === null) return {};

  return {
    title: `${t("title")} — ${loaded.tenantName}`,
    // `link` heißt „nur über den Direktlink erreichbar" (8.3) — erreichbar
    // bleibt die Seite, aber sie gehört dann in keinen Suchindex.
    robots: loaded.program.visibility === "public" ? undefined : { index: false, follow: false },
  };
}

export default async function PartnerprogrammPage() {
  const [loaded, formToken, t, tShell, format] = await Promise.all([
    loadPublicProgram(),
    issueContactFormToken(),
    getTranslations("affiliate.program"),
    getTranslations("affiliate.shell"),
    getFormatter(),
  ]);

  if (loaded === null) notFound();

  const { program, tenantName } = loaded;
  const currency = program.currency.toUpperCase();

  const money = (cents: number) =>
    format.number(cents / 100, { style: "currency", currency });
  const percent = (bp: number) =>
    format.number(bp / 10_000, { style: "percent", maximumFractionDigits: 2 });

  /**
   * Die Beispielrechnung läuft durch DIESELBEN reinen Funktionen wie der
   * Verarbeiter (`compute.ts`, Plan 5.1/5.3) — keine zweite Rechenlogik auf
   * einer Marketingseite. Sonst stünde hier irgendwann eine Zahl, die der
   * Partner nie ausgezahlt bekommt.
   */
  const base = computeBaseCents({
    gross_cents: EXAMPLE_GROSS_CENTS,
    tax_cents: 0,
    shipping_cents: 0,
    basis_kind: program.basis_kind,
    fee_deduction_bp: program.fee_deduction_bp,
  });
  const example = computeCommissionParts({
    base_cents: base.base_cents,
    rate_kind: program.rate_kind,
    rate_bp: program.rate_bp,
    fixed_cents: program.fixed_cents,
    min_commission_cents: program.min_commission_cents,
    max_commission_cents: program.max_commission_cents,
    reserve_bp: program.reserve_bp,
  });

  /**
   * `description_md` wird als REINER TEXT ausgegeben, Absatz je Leerzeile.
   * Bewusst kein `dangerouslySetInnerHTML` und kein Markdown-Renderer: der
   * Text stammt aus der Einstellungsseite des Mandanten, landet ungeprüft auf
   * einer öffentlichen Seite und wäre damit der kürzeste Weg zu gespeichertem
   * XSS über ein Admin-Konto.
   */
  const description = program.description_md
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block !== "");

  const rules: Array<{ term: string; text: string }> = [
    { term: t("attributionHeading"), text: t("attributionHint", { days: program.cookie_ttl_days }) },
    {
      term: t("attributionModelTerm"),
      text: program.attribution_model === "first" ? t("attributionModelFirst") : t("attributionModelLast"),
    },
    {
      term: t("attributionOverwriteTerm"),
      text: program.overwrite_policy === "deny" ? t("attributionOverwriteDeny") : t("attributionOverwriteAllow"),
    },
    {
      term: t("attributionLifetimeTerm"),
      text: program.lifetime_binding ? t("attributionLifetime") : t("attributionNoLifetime"),
    },
    { term: t("attributionSelfTerm"), text: t("attributionSelf") },
    { term: t("attributionConsentTerm"), text: t("attributionConsent") },
    {
      term: t("recurringHeading"),
      text:
        program.recurring_mode === "all"
          ? t("recurringAll")
          : program.recurring_mode === "n_periods"
            ? t("recurringNPeriods", { periods: program.recurring_max_periods })
            : t("recurringFirstOnly"),
    },
  ];

  const payoutRules: Array<{ term: string; text: string }> = [
    {
      term: t("payoutScheduleTerm"),
      text:
        program.payout_schedule === "weekly"
          ? t("payoutWeekly")
          : program.payout_schedule === "semi_monthly"
            ? t("payoutSemiMonthly")
            : t("payoutMonthly"),
    },
    { term: t("payoutHoldTerm"), text: t("payoutHold", { days: program.hold_days }) },
    { term: t("payoutMinimumTerm"), text: t("payoutMinimum", { amount: money(program.min_payout_cents) }) },
    { term: t("payoutReversalTerm"), text: t("payoutReversal") },
  ];

  if (program.reserve_bp > 0) {
    payoutRules.splice(2, 0, {
      term: t("payoutReserveTerm"),
      text: t("payoutReserve", {
        rate: percent(program.reserve_bp),
        days: program.reserve_days,
      }),
    });
  }

  return (
    <div style={{ background: "#F4F5FA" }} className="min-h-screen">
      {/* Sprungmarke (8.5): erstes fokussierbares Element, sichtbar nur im Fokus. */}
      <a
        href="#hauptinhalt"
        className="sr-only rounded-xl px-4 py-3 text-base font-semibold focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-white focus:text-ink focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2"
      >
        {tShell("skipLink")}
      </a>

      <main
        id="hauptinhalt"
        tabIndex={-1}
        className="mx-auto flex max-w-3xl flex-col gap-10 px-6 py-12 text-ink"
        style={{ fontSize: 18, lineHeight: 1.6 }}
      >
        <header className="flex flex-col gap-3">
          <p className="text-sm font-semibold uppercase tracking-[0.08em]" style={{ color: "#66679B" }}>
            {tenantName}
          </p>
          <h1 className="text-[34px] font-extrabold leading-tight">{t("title")}</h1>
          <p style={{ color: "#66679B" }}>{t("subtitle", { tenant: tenantName })}</p>
          {description.map((block, index) => (
            <p key={index}>{block}</p>
          ))}
        </header>

        {/* --- Provision ------------------------------------------------- */}
        <section aria-labelledby="provision" className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 id="provision" className="mb-3 text-[24px] font-extrabold">
            {t("commissionHeading")}
          </h2>
          <p className="text-[22px] font-extrabold">
            {program.rate_kind === "fixed"
              ? t("commissionFixed", { amount: money(program.fixed_cents) })
              : t("commissionPercent", { rate: percent(program.rate_bp) })}
          </p>

          <dl className="mt-4 flex flex-col gap-3">
            <div>
              <dt className="text-sm font-bold uppercase tracking-[0.04em]" style={{ color: "#66679B" }}>
                {t("basisHeading")}
              </dt>
              <dd>
                {program.basis_kind === "gross" ? t("basisGross") : t("basisNet")}
                {program.fee_deduction_bp > 0
                  ? ` ${t("basisFee", { rate: percent(program.fee_deduction_bp) })}`
                  : ""}
              </dd>
            </div>

            {program.min_commission_cents !== null && (
              <div>
                <dt className="text-sm font-bold uppercase tracking-[0.04em]" style={{ color: "#66679B" }}>
                  {t("commissionMinTerm")}
                </dt>
                <dd>{t("commissionMin", { amount: money(program.min_commission_cents) })}</dd>
              </div>
            )}

            {program.max_commission_cents !== null && (
              <div>
                <dt className="text-sm font-bold uppercase tracking-[0.04em]" style={{ color: "#66679B" }}>
                  {t("commissionMaxTerm")}
                </dt>
                <dd>{t("commissionMax", { amount: money(program.max_commission_cents) })}</dd>
              </div>
            )}

            {program.tier2_enabled && (
              <div>
                <dt className="text-sm font-bold uppercase tracking-[0.04em]" style={{ color: "#66679B" }}>
                  {t("tier2Heading")}
                </dt>
                <dd>
                  {program.tier2_basis === "revenue"
                    ? t("tier2Revenue", { rate: percent(program.tier2_rate_bp) })
                    : t("tier2Commission", { rate: percent(program.tier2_rate_bp) })}
                </dd>
              </div>
            )}
          </dl>

          {/* Die Zahl steht als Satz, nicht als Grafik (8.5). */}
          <p className="mt-5 rounded-xl px-4 py-3" style={{ background: "#F4F5FA" }}>
            <strong className="block text-sm font-bold uppercase tracking-[0.04em]" style={{ color: "#66679B" }}>
              {t("exampleHeading")}
            </strong>
            {program.basis_kind === "gross"
              ? t("exampleText", {
                  gross: money(EXAMPLE_GROSS_CENTS),
                  amount: money(example.amount_cents),
                })
              : t("exampleTextNet", {
                  net: money(base.base_cents),
                  amount: money(example.amount_cents),
                })}
          </p>
        </section>

        {/* --- Regeln der Zuordnung -------------------------------------- */}
        <section aria-labelledby="regeln" className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 id="regeln" className="mb-3 text-[24px] font-extrabold">
            {t("rulesHeading")}
          </h2>
          <dl className="flex flex-col gap-3">
            {rules.map((rule) => (
              <div key={rule.term}>
                <dt className="text-sm font-bold uppercase tracking-[0.04em]" style={{ color: "#66679B" }}>
                  {rule.term}
                </dt>
                <dd>{rule.text}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* --- Geld und Fristen ------------------------------------------ */}
        <section aria-labelledby="auszahlung" className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 id="auszahlung" className="mb-3 text-[24px] font-extrabold">
            {t("payoutHeading")}
          </h2>
          <dl className="flex flex-col gap-3">
            {payoutRules.map((rule) => (
              <div key={rule.term}>
                <dt className="text-sm font-bold uppercase tracking-[0.04em]" style={{ color: "#66679B" }}>
                  {rule.term}
                </dt>
                <dd>{rule.text}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* --- Partnerbedingungen ---------------------------------------- */}
        <section aria-labelledby="bedingungen" className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 id="bedingungen" className="mb-1 text-[24px] font-extrabold">
            {t("termsHeading")}
          </h2>
          <p className="mb-3 text-base" style={{ color: "#66679B" }}>
            {t("termsVersion", { version: program.terms_version })}
          </p>
          {program.terms_text.trim() === "" ? (
            <p>{t("termsEmpty")}</p>
          ) : (
            // `<details>` ist nativ tastaturbedienbar und wird von jedem
            // Screenreader als auf-/zuklappbar angesagt — kein eigenes
            // Aufklapp-Widget (8.5, Begründung wie bei den nativen <select>).
            <details className="rounded-xl border" style={{ borderColor: "#D8DAEA" }}>
              <summary className="cursor-pointer px-4 py-3 font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2">
                {t("termsShow")}
              </summary>
              <div className="whitespace-pre-wrap px-4 pb-4 pt-1">{program.terms_text}</div>
            </details>
          )}
        </section>

        {/* --- Bewerbung -------------------------------------------------- */}
        <BewerbungForm
          formToken={formToken}
          turnstileSiteKey={publicEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? null}
          termsVersion={program.terms_version}
          applicationNote={program.application_note}
          fields={program.application_fields ?? []}
        />
      </main>
    </div>
  );
}
