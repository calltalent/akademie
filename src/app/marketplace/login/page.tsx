"use client";

import { useActionState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { signInWithPassword, signInWithMagicLink } from "@/lib/auth/actions";
import type { AuthActionState } from "@/lib/auth/actions";
import { resolveSafeNextParam } from "@/lib/marketplace/redirect";

const initialState: AuthActionState = { error: null };

/**
 * Marketplace-Login (M5, notwendige Ergänzung zum Auftrag — Abweichung
 * dokumentiert, CLAUDE.md §4/1, siehe PHASENSTATUS.md "Marketplace M5" und
 * Kopfkommentar `marketplace/kurs/[slug]/page.tsx`): der Kauf-Server-Action
 * verlangt eine bestehende Session (Muster `kaufen/[productSlug]/page.tsx`).
 * Supabase-Auth-Cookies sind domain-gebunden (Plan Abschnitt 5) — ohne eine
 * eigene Login-Seite auf `marketplace.calltalent.ai` könnte sich hier
 * NIEMAND je anmelden (ein Link auf das tenant-bezogene `/login` würde durch
 * `prefixRewrite()`, `lib/tenant/routing.ts`, zu `/marketplace/login`
 * umgeschrieben — ohne diese Datei ein 404). Gleiches Prinzip wie
 * `src/app/portal/login/page.tsx` (schlanke Variante ohne Marken-Panel,
 * dieselben bestehenden Server Actions, kein neues Auth-System).
 *
 * `signInWithPassword()`/`signInWithMagicLink()` sind bereits host-
 * unabhängig (kein `getTenant()`-Zwang) — funktionieren hier unverändert.
 *
 * BEWUSST OHNE Registrieren-Formular: `signUpWithPassword()` verlangt
 * zwingend `getTenant()` (`lib/auth/actions.ts`) — auf dem Marketplace-Host
 * `null`, jeder Registrierungsversuch schlägt mit "Kein Mandant zu diesem
 * Host gefunden." fehl. Eine mandantenlose Selbstregistrierung wäre eine
 * eigene, größere Änderung an einer von JEDEM Mandanten genutzten,
 * sicherheitskritischen Kernfunktion — außerhalb des Auftrags dieses Blocks
 * ("Checkout und Webhook"), für M5 bewusst zurückgestellt.
 *
 * `next` (Query-Parameter, z. B. `?next=/kurs/xyz`): nach erfolgreichem
 * Login zurück zur Kursseite navigieren, von der aus der Kauf gestartet
 * wurde, statt immer zur Marketplace-Startseite
 * (`signInWithPassword()`s Standard-`redirectTo` kennt den
 * Marketplace-Kontext nicht, siehe dortiger Kommentar "tenant ?
 * '/dashboard' : '/'"). Bewusst über `window.location.search` statt
 * `useSearchParams()` gelesen (kein Suspense-Boundary-Zwang nötig) — gleiches
 * Muster wie der bestehende Hash-Fehler-Read in
 * `(auth)/login/login-form.tsx`.
 */
export default function MarketplaceLoginPage() {
  const t = useTranslations("marketplace.login");
  const [pwState, pwAction, pwPending] = useActionState(signInWithPassword, initialState);
  const [magicState, magicAction, magicPending] = useActionState(signInWithMagicLink, initialState);

  useEffect(() => {
    if (!pwState.redirectTo) return;
    const next = new URLSearchParams(window.location.search).get("next");
    // Open-Redirect-Schutz (security-reviewer-Fund, 03.08.2026, MITTEL,
    // behoben): Prüf-Logik nach `@/lib/marketplace/redirect.ts` ausgelagert
    // (unit-getestet in `redirect.test.ts`, siehe dortiger Kopfkommentar) —
    // hier nur noch der Aufruf.
    const safeNext = resolveSafeNextParam(next);
    window.location.href = safeNext || pwState.redirectTo;
  }, [pwState.redirectTo]);

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center gap-8 px-6 py-16">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-muted-400">{t("eyebrow")}</p>
        <h1 className="text-2xl font-extrabold text-ink">{t("heading")}</h1>
      </div>

      <form action={pwAction} className="flex flex-col gap-3" aria-label={t("passwordFormAriaLabel")}>
        <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
          {t("emailLabel")}
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="rounded-md border border-border-100 px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
          {t("passwordLabel")}
          <input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="current-password"
            className="rounded-md border border-border-100 px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-1"
          />
        </label>
        {pwState.error && (
          <p role="alert" className="text-sm text-red-600">
            {pwState.error}
          </p>
        )}
        <button
          type="submit"
          disabled={pwPending}
          className="rounded-md bg-accent px-4 py-2.5 text-base font-bold text-white disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          {t("submitButton")}
        </button>
      </form>

      <div className="flex items-center gap-3 text-sm text-muted-400" aria-hidden="true">
        <span className="h-px flex-1 bg-border-100" />
        {t("orDivider")}
        <span className="h-px flex-1 bg-border-100" />
      </div>

      <form action={magicAction} className="flex flex-col gap-3" aria-label={t("magicLinkFormAriaLabel")}>
        <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
          {t("magicLinkEmailLabel")}
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="rounded-md border border-border-100 px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-1"
          />
        </label>
        {magicState.error && (
          <p role="alert" className="text-sm text-red-600">
            {magicState.error}
          </p>
        )}
        {magicState.success && (
          <p role="status" className="text-sm text-green-700">
            {t("magicLinkSuccess")}
          </p>
        )}
        <button
          type="submit"
          disabled={magicPending}
          className="rounded-md border border-border-100 px-4 py-2.5 text-[15px] font-semibold text-ink disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          {t("magicLinkSubmitButton")}
        </button>
      </form>

      <p className="text-center text-sm text-muted-400">{t("noAccountHint")}</p>
    </div>
  );
}
