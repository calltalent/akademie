"use client";

import { useActionState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { submitAffiliateApplication } from "@/lib/affiliate/apply";
import { initialAffiliateApplicationActionState } from "@/lib/affiliate/state";
import type { AffiliateApplicationField } from "@/lib/affiliate/types";
import { CONTACT_HONEYPOT_FIELD, CONTACT_TOKEN_FIELD } from "@/lib/contact/patterns";
import { TurnstileWidget } from "@/components/security/turnstile-widget";

/**
 * Affiliate-System, Block B7-B — das öffentliche Bewerbungsformular
 * (PLAN_Affiliate-System.md 8.3, 8.5; CLAUDE.md §2.7, §3.4).
 *
 * Zwei versteckte Felder tragen den Bot-Schutz, den `lib/affiliate/apply.ts`
 * serverseitig auswertet: der Honeypot und das von der Server Component
 * ausgegebene, signierte Zeitstempel-Token (Zeitfalle).
 *
 * DER HONEYPOT LIEGT AUSSERHALB DES SICHTFELDS (`left:-9999px`), NICHT AUF
 * `display:none`. Das hat zwei Gründe, und der zweite ist der wichtigere:
 * viele Bots überspringen `display:none`-Felder, und — entscheidend — die
 * Falle darf niemanden treffen, der die Seite nicht sieht. `aria-hidden`
 * nimmt das Feld aus dem Screenreader-Baum, `tabIndex={-1}` aus der
 * Tastaturreihenfolge; ein blinder Bewerber kann es also weder hören noch
 * versehentlich ausfüllen (CLAUDE.md §3.4 — der Auftraggeber selbst ist
 * sehbehindert).
 *
 * BARRIEREFREIHEIT, verbindlich nach 8.5:
 *  - Jedes Feld hat ein SICHTBARES `<label>` mit `htmlFor`/`id`; der
 *    Platzhalter ist nie die Beschriftung. Getrennte statt umschließender
 *    Labels, damit `getByLabel()` in Playwright eindeutig greift
 *    (`e2e/marketplace-listing.spec.ts:45-50`).
 *  - Fehler stehen als TEXT in einer `role="alert"`-Meldung, nicht nur als
 *    Farbe; die Meldung ist fokussierbar und bekommt nach einem
 *    fehlgeschlagenen Absenden den Fokus. Ohne das landet ein Screenreader
 *    nach dem Neuzeichnen am Dokumentanfang und muss das ganze Formular
 *    erneut durchlaufen, um zu erfahren, was schiefging.
 *  - Die Erfolgsmeldung ist `role="status" aria-live="polite"` und bekommt
 *    ebenfalls den Fokus — das Formular verschwindet, es gibt also keine
 *    Stelle mehr, an der der Fokus sonst sinnvoll stünde.
 *  - Keine festen Pixelhöhen an Feldern und Knöpfen: bei 200 % Zoom wächst
 *    jede Zeile mit. Schaltflächen mindestens 40 px hoch über Innenabstand.
 *  - Kein `outline-none` ohne Ersatzring (`focus-visible:ring-2`).
 *
 * Die Beschriftungen der PROGRAMMEIGENEN Felder kommen bewusst NICHT aus
 * `messages/*.json`, sondern aus `application_fields[].label` — sie sind vom
 * Mandanten in seiner Einstellungsseite gesetzt, und eine Übersetzungsdatei
 * kann nicht wissen, wonach ein fremder Händler fragt.
 */
export function BewerbungForm({
  formToken,
  turnstileSiteKey,
  termsVersion,
  applicationNote,
  fields,
}: {
  formToken: string;
  turnstileSiteKey: string | null;
  termsVersion: number;
  applicationNote: string;
  fields: AffiliateApplicationField[];
}) {
  const t = useTranslations("affiliate.apply");
  const [state, action, pending] = useActionState(
    submitAffiliateApplication,
    initialAffiliateApplicationActionState,
  );

  const alertRef = useRef<HTMLParagraphElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);

  /**
   * Fokusführung nach der Server Action (8.5). Beim ersten Rendern steht
   * weder `error` noch `success`, es wird also nichts fokussiert — der Fokus
   * springt niemandem unaufgefordert ins Formular.
   */
  useEffect(() => {
    if (state.success) statusRef.current?.focus();
    else if (state.error) alertRef.current?.focus();
  }, [state]);

  const inputClass =
    "w-full rounded-xl border bg-white px-[15px] py-[13px] text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1";
  const inputStyle = { borderColor: "#D8DAEA", color: "#1A1A2E" } as const;
  const labelClass = "mb-[7px] block text-base font-semibold";
  const labelStyle = { color: "#3E3F66" } as const;
  const hintClass = "mt-1 block text-[15px]";
  const hintStyle = { color: "#66679B" } as const;

  return (
    <section aria-labelledby="bewerbung" className="rounded-2xl bg-white p-6 shadow-sm">
      <h2 id="bewerbung" className="mb-1 text-[24px] font-extrabold">
        {t("heading")}
      </h2>
      <p className="mb-5 text-base" style={hintStyle}>
        {t("description")}
      </p>

      {state.success ? (
        <p
          ref={statusRef}
          tabIndex={-1}
          role="status"
          aria-live="polite"
          className="rounded-xl px-4 py-3 text-base font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          style={{ background: "#EAF6F0", color: "#166B47" }}
        >
          {t("success")}
        </p>
      ) : (
        <form action={action} className="flex flex-col gap-5">
          <input type="hidden" name={CONTACT_TOKEN_FIELD} value={formToken} />
          <input type="hidden" name="termsVersion" value={termsVersion} />

          {/* Honeypot — siehe Kopf. Nie sichtbar, nie fokussierbar, nie vorgelesen. */}
          <div aria-hidden="true" className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden">
            <label htmlFor="bewerbung-website">{t("honeypotLabel")}</label>
            <input
              id="bewerbung-website"
              name={CONTACT_HONEYPOT_FIELD}
              type="text"
              tabIndex={-1}
              autoComplete="off"
              defaultValue=""
            />
          </div>

          <p className="text-[15px]" style={hintStyle}>
            {t("requiredHint")}
          </p>

          <div>
            <label htmlFor="bewerbung-name" className={labelClass} style={labelStyle}>
              {t("nameLabel")}
            </label>
            <input
              id="bewerbung-name"
              name="displayName"
              type="text"
              required
              maxLength={120}
              autoComplete="name"
              className={inputClass}
              style={inputStyle}
            />
          </div>

          <div>
            <label htmlFor="bewerbung-email" className={labelClass} style={labelStyle}>
              {t("emailLabel")}
            </label>
            <input
              id="bewerbung-email"
              name="email"
              type="email"
              required
              maxLength={200}
              autoComplete="email"
              className={inputClass}
              style={inputStyle}
            />
          </div>

          <div>
            <label htmlFor="bewerbung-company" className={labelClass} style={labelStyle}>
              {t("companyLabel")}
            </label>
            <input
              id="bewerbung-company"
              name="company"
              type="text"
              maxLength={200}
              autoComplete="organization"
              className={inputClass}
              style={inputStyle}
            />
          </div>

          <div>
            <label htmlFor="bewerbung-code" className={labelClass} style={labelStyle}>
              {t("codeLabel")}
            </label>
            <input
              id="bewerbung-code"
              name="code"
              type="text"
              maxLength={32}
              autoComplete="off"
              aria-describedby="bewerbung-code-hinweis"
              className={inputClass}
              style={inputStyle}
            />
            <span id="bewerbung-code-hinweis" className={hintClass} style={hintStyle}>
              {t("codeHint")}
            </span>
          </div>

          {/* Felder, die der Mandant selbst festgelegt hat (`application_fields`). */}
          {fields.map((field) => {
            const id = `bewerbung-feld-${field.key}`;
            return (
              <div key={field.key}>
                <label htmlFor={id} className={labelClass} style={labelStyle}>
                  {field.label}
                  {field.required ? "" : ` (${t("optional")})`}
                </label>
                {field.type === "textarea" ? (
                  <textarea
                    id={id}
                    name={`answer_${field.key}`}
                    rows={4}
                    required={field.required}
                    maxLength={2000}
                    className={`${inputClass} resize-y`}
                    style={inputStyle}
                  />
                ) : (
                  <input
                    id={id}
                    name={`answer_${field.key}`}
                    type={field.type === "url" ? "url" : "text"}
                    required={field.required}
                    maxLength={2000}
                    placeholder={field.type === "url" ? "https://" : undefined}
                    className={inputClass}
                    style={inputStyle}
                  />
                )}
              </div>
            );
          })}

          {applicationNote.trim() !== "" && (
            <p className="rounded-xl px-4 py-3 text-base" style={{ background: "#F4F5FA" }}>
              {applicationNote}
            </p>
          )}

          {/* Zustimmung: eigenes <label> neben der Checkbox, nicht umschließend. */}
          <div className="flex items-start gap-3">
            <input
              id="bewerbung-terms"
              name="acceptTerms"
              type="checkbox"
              required
              value="on"
              className="mt-1 h-5 w-5 shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1"
            />
            <label htmlFor="bewerbung-terms" className="text-base" style={labelStyle}>
              {t("termsLabel")}
            </label>
          </div>

          {turnstileSiteKey && (
            <TurnstileWidget siteKey={turnstileSiteKey} resetSignal={state.error} />
          )}

          {state.error && (
            <p
              ref={alertRef}
              tabIndex={-1}
              role="alert"
              className="rounded-xl px-4 py-3 text-base font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              style={{ background: "#FBECEC", color: "#9A2F2F" }}
            >
              {state.error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="rounded-xl px-6 py-[15px] text-base font-bold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:opacity-60"
            style={{ background: "var(--color-primary)", minHeight: 48 }}
          >
            {pending ? t("pending") : t("submit")}
          </button>
        </form>
      )}
    </section>
  );
}
