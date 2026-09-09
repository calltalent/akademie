import "server-only";
import { headers } from "next/headers";
import { getServerEnv, publicEnv } from "@/lib/env";

/**
 * Cloudflare Turnstile — serverseitige Prüfung des Widget-Tokens.
 *
 * Sechste Schicht des Kontaktformular-Bot-Schutzes (25.08.2026, Folge des
 * Spam-Vorfalls vom 24.08.2026 — siehe contact/spam.ts und PHASENSTATUS.md).
 * Turnstile ist die einzige Schicht, die einen Bot als Bot erkennt statt
 * seinen Inhalt zu bewerten: Cloudflare wertet Browser-Signale aus und
 * stellt nur im Zweifel eine sichtbare Aufgabe. Stack-nativ (das Projekt
 * läuft ohnehin auf Cloudflare Workers), kostenlos, ohne Cookies und ohne
 * Weitergabe personenbezogener Daten an Dritte im Sinne eines
 * Tracking-Dienstes — anders als reCAPTCHA, das für ein DSGVO-Projekt mit
 * EU-Nutzern ausscheidet.
 *
 * ABGESCHALTET, SOLANGE KEINE SCHLÜSSEL GESETZT SIND: ohne
 * `TURNSTILE_SECRET_KEY` (Server) und `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
 * (Client) gibt `verifyTurnstile()` "skipped" zurück und das Formular
 * verhält sich exakt wie vorher. Josip legt das Widget im
 * Cloudflare-Dashboard an (Turnstile -> Add Widget), trägt beide Werte als
 * Worker-Variablen ein, und die Prüfung greift ab dem nächsten Deploy von
 * selbst. Der Site Key ist öffentlich (steht im HTML), der Secret Key
 * ausschließlich serverseitig (CLAUDE.md §2.2).
 */

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Name des Felds, das das Turnstile-Widget selbst ins Formular schreibt. */
export const TURNSTILE_RESPONSE_FIELD = "cf-turnstile-response";

export const TURNSTILE_FAILED_MESSAGE =
  "Die Sicherheitsprüfung ist fehlgeschlagen. Bitte lade die Seite neu und sende erneut.";

/**
 * "skipped"     — nicht konfiguriert, Aufrufer ignoriert das Ergebnis.
 * "ok"          — Token gültig.
 * "failed"      — Token fehlt, ist abgelaufen, gefälscht oder bereits benutzt.
 * "unavailable" — Cloudflare nicht erreichbar (siehe FAIL-OPEN unten).
 */
export type TurnstileVerdict = "skipped" | "ok" | "failed" | "unavailable";

/** Ist Turnstile für diese Installation aktiv? Beide Schlüssel müssen gesetzt sein. */
export function isTurnstileConfigured(): boolean {
  return Boolean(getServerEnv().TURNSTILE_SECRET_KEY && publicEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
}

type SiteverifyResponse = {
  success?: boolean;
  "error-codes"?: string[];
};

/**
 * FAIL-OPEN bei technischem Ausfall (Netzfehler, Zeitüberschreitung,
 * 5xx von Cloudflare) — dieselbe Abwägung wie beim Rate-Limiter
 * (`security/rate-limit.ts`): ein Ausfall bei einem Dritten darf keine
 * echte Kundenanfrage verschlucken. Vertretbar, weil fünf weitere
 * Schichten unabhängig davon greifen. Ein UNGÜLTIGES Token führt dagegen
 * immer zur Ablehnung — das ist kein Ausfall, sondern ein Befund.
 */
export async function verifyTurnstile(token: unknown): Promise<TurnstileVerdict> {
  const secret = getServerEnv().TURNSTILE_SECRET_KEY;
  if (!secret || !publicEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY) return "skipped";

  if (typeof token !== "string" || token.trim() === "") return "failed";

  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);

  // Die Absender-IP ist optional, schärft die Prüfung aber (Cloudflare
  // vergleicht sie mit der IP, für die das Token ausgestellt wurde).
  const ip = (await headers()).get("cf-connecting-ip");
  if (ip) body.append("remoteip", ip);

  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      console.error(`Turnstile: siteverify antwortete mit ${response.status} (fail-open).`);
      return "unavailable";
    }

    const result = (await response.json()) as SiteverifyResponse;
    if (result.success === true) return "ok";

    // Fehlercodes sind Cloudflare-Konstanten wie "invalid-input-response"
    // oder "timeout-or-duplicate" — keine Nutzerdaten, Loggen unbedenklich.
    console.warn(`Turnstile: Token abgelehnt (${result["error-codes"]?.join(", ") ?? "ohne Code"}).`);
    return "failed";
  } catch (error) {
    // Bewusst ohne `error.message` im Klartext-Prefix: der String kann bei
    // fetch-Fehlern die vollständige URL inkl. Parametern enthalten
    // (CLAUDE.md §2.11).
    console.error("Turnstile: siteverify nicht erreichbar (fail-open).", error instanceof Error ? error.name : "unbekannt");
    return "unavailable";
  }
}
