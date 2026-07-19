"use client";

import { useActionState, useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createTenant } from "@/lib/platform/actions";
import type { PlatformActionState } from "@/lib/platform/actions";
import { TENANT_PLANS, TENANT_PLAN_LABELS } from "@/lib/platform/schema";

const initialState: PlatformActionState = { error: null };

/**
 * Anlage-Formular fuer neue Mandanten (Betreiber-Portal, Phase 4 Block 2).
 * DoD-Messung (SPEC.md §4.3): Formular ausfuellen → Absenden → Mandant
 * sofort erreichbar unter `{slug}.calltalent.ai` (Produktion) bzw.
 * `{slug}.localhost:3000` (lokal) — der "< 5 Minuten"-Test.
 *
 * `redirect()` passiert bewusst NICHT in der Server Action (siehe
 * src/lib/platform/actions.ts-Kommentar) — bei Erfolg liefert `createTenant`
 * `{success:true,id,slug}`, der Redirect zur Detailseite laeuft hier
 * client-seitig per `useRouter()` in einem `useEffect`.
 *
 * Design-Update (19.07.2026, Claude-Design-Import MandantenNeu.dc.html,
 * DESIGN-MASTERPROMPT-PORTAL-MANDANTEN.md): dunkles Karten-Layout mit
 * Breadcrumb "Mandanten / Neuer Mandant" statt der bisherigen schlichten
 * Formularseite. `tenantOrigin()` (lib/tenant/url.ts) ist `server-only` und
 * hier als Client-Komponente nicht nutzbar — dieselbe Env-Fallunterscheidung
 * (`NODE_ENV`, von Next.js zur Build-Zeit auch im Client-Bundle ersetzt)
 * wird deshalb direkt inline nachgebildet statt eine zweite serverfähige
 * Variante zu duplizieren.
 */
const DOMAIN_SUFFIX = process.env.NODE_ENV !== "production" ? ".localhost:3000" : ".calltalent.ai";

export default function NeuerMandantPage() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(createTenant, initialState);
  const [slug, setSlug] = useState("");

  useEffect(() => {
    // NEU (Phase 5, Block 8, 12.07.2026): bei einer fehlgeschlagenen
    // Inhaber-Einladung NICHT sofort wegnavigieren — Josip soll den Hinweis
    // tatsächlich lesen können, bevor die Seite wechselt. Der Mandant ist in
    // beiden Fällen bereits angelegt (siehe actions.ts-Kommentar); ohne
    // Fehler bleibt der bisherige sofortige Redirect unverändert.
    if (state.success && state.id && !state.ownerInviteError) {
      router.push(`/portal/mandanten/${state.id}`);
    }
  }, [state, router]);

  const inputStyle: CSSProperties = {
    width: "100%",
    borderColor: "#1e293b",
    background: "#020617",
    color: "#F8FAFC",
  };

  return (
    <main className="flex flex-col gap-1" style={{ maxWidth: 640 }}>
      <div>
        <Link href="/portal/mandanten" className="text-[13px] font-semibold no-underline" style={{ color: "#64748B" }}>
          Mandanten
        </Link>
        <span className="text-[13px] font-semibold" style={{ color: "#64748B" }}>
          {" "}
          / Neuer Mandant
        </span>
        <h1 className="mt-1.5 text-[26px] font-extrabold text-slate-50" style={{ letterSpacing: "-0.01em" }}>
          Mandant anlegen
        </h1>
      </div>

      <form
        action={formAction}
        className="mt-4 flex flex-col gap-[18px] rounded-[14px] border p-7"
        style={{ borderColor: "#1e293b", background: "#0f172a" }}
      >
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold" htmlFor="name" style={{ color: "#94A3B8" }}>
          Name
          <input
            id="name"
            name="name"
            type="text"
            required
            maxLength={200}
            autoComplete="off"
            placeholder="z. B. Muster GmbH"
            className="rounded-[10px] border px-3.5 py-2.5 text-base font-normal focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
            style={inputStyle}
          />
        </label>

        <label className="flex flex-col gap-1.5 text-[13px] font-semibold" htmlFor="slug" style={{ color: "#94A3B8" }}>
          Subdomain / Slug
          <input
            id="slug"
            name="slug"
            type="text"
            required
            pattern="[a-z0-9][a-z0-9-]{1,40}"
            placeholder="muster-gmbh"
            autoComplete="off"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            aria-describedby="slug-hint"
            className="rounded-[10px] border px-3.5 py-2.5 text-base font-normal focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
            style={inputStyle}
          />
          <span id="slug-hint" className="text-[13px] font-normal" style={{ color: "#64748B" }}>
            Erreichbar unter <strong style={{ color: "#CBD5E1" }}>{slug || "slug"}{DOMAIN_SUFFIX}</strong>
          </span>
        </label>

        <fieldset className="flex flex-col gap-2.5">
          <legend className="mb-1 text-[13px] font-semibold" style={{ color: "#94A3B8" }}>
            Paket
          </legend>
          {TENANT_PLANS.map((plan) => (
            <label key={plan} className="flex items-center gap-2.5 text-sm" htmlFor={`plan-${plan}`}>
              <input
                id={`plan-${plan}`}
                type="radio"
                name="plan"
                value={plan}
                defaultChecked={plan === "komplett"}
                style={{ accentColor: "#5663AE" }}
              />
              {TENANT_PLAN_LABELS[plan]}
            </label>
          ))}
        </fieldset>

        <label className="flex flex-col gap-1.5 text-[13px] font-semibold" htmlFor="ownerEmail" style={{ color: "#94A3B8" }}>
          Inhaber-E-Mail (optional)
          <input
            id="ownerEmail"
            name="ownerEmail"
            type="email"
            autoComplete="off"
            placeholder="inhaber@firma.de"
            aria-describedby="owner-hint"
            className="rounded-[10px] border px-3.5 py-2.5 text-base font-normal focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
            style={inputStyle}
          />
          <span id="owner-hint" className="text-[13px] font-normal" style={{ color: "#64748B" }}>
            Leer lassen = Mandant ohne Inhaber anlegen (z. B. interner Test-Mandant). Ausfüllen =
            Owner-Konto wird direkt mit angelegt, Einladungsmail wird verschickt.
          </span>
        </label>

        {state.error && (
          <p role="alert" className="text-sm text-red-400">
            {state.error}
          </p>
        )}

        {state.success && state.ownerInviteError && (
          <div className="rounded-md border border-amber-700 bg-amber-950/40 p-3 text-sm text-amber-200">
            <p>
              Mandant wurde angelegt, die Inhaber-Einladung ist aber fehlgeschlagen:{" "}
              {state.ownerInviteError}
            </p>
            <a href={`/portal/mandanten/${state.id}`} className="mt-2 inline-block underline">
              Trotzdem zum Mandanten →
            </a>
          </div>
        )}

        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center gap-2 rounded-[11px] px-[18px] py-3 text-[15px] font-bold text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
          style={{ background: "var(--color-primary)" }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 5v14"></path>
            <path d="M5 12h14"></path>
          </svg>
          {pending ? "Wird angelegt …" : "Mandant anlegen"}
        </button>
      </form>
    </main>
  );
}
