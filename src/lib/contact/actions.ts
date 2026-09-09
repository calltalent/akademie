"use server";

import { createHash } from "node:crypto";
import { contactFormSchema } from "@/lib/contact/schema";
import type { ContactActionState } from "@/lib/contact/state";
import { classifyContactSubmission } from "@/lib/contact/spam";
import { CONTACT_HONEYPOT_FIELD, CONTACT_TOKEN_FIELD } from "@/lib/contact/patterns";
import { verifyContactFormToken } from "@/lib/contact/form-token";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import {
  TURNSTILE_FAILED_MESSAGE,
  TURNSTILE_RESPONSE_FIELD,
  verifyTurnstile,
} from "@/lib/security/turnstile";
import { sendEmail } from "@/lib/email/client";
import { contactFormNotification } from "@/lib/email/templates";
import { getTenant } from "@/lib/tenant/context";

/**
 * Design-Block 4 (12.07.2026) — Server Action für /kontakt (Kontakt.dc.html).
 *
 * Empfänger NEU (03.08.2026, Josips Auftrag "eigene Kontaktdaten und
 * Support" pro Mandant): `settings.support_email` des über `getTenant()`
 * aufgelösten Mandanten (Admin-Einstellungen, tenant/types.ts), NICHT mehr
 * hart `office@calltalent.ai`. `getTenant()` liest aus den von middleware.ts
 * gesetzten Request-Headern und funktioniert dadurch auch innerhalb einer
 * Server Action (derselbe Request). Fällt zurück auf `office@calltalent.ai`
 * (real, in Resend verifiziert — PHASENSTATUS.md "Block 5 — Resend
 * Produktions-Domain"), wenn kein Mandant ermittelt werden kann (Portal-
 * Host) oder der Mandant noch keine eigene Support-Adresse hinterlegt hat —
 * damit geht keine Anfrage ins Leere.
 *
 * Bot-Schutz NEU (25.08.2026, Josips Fund: SEO-Spam über das Formular,
 * CLAUDE.md §2.7). Fünf Schichten, in dieser Reihenfolge — die billigen
 * zuerst, damit ein Bot gar nicht erst DB-/Mail-Kosten verursacht:
 *
 *  1. Honeypot-Feld (`website`): für Menschen unsichtbar, Bots füllen es aus.
 *  2. Zeitfalle: signiertes Token aus der Seite, Absenden in unter drei
 *     Sekunden oder ganz ohne Token ist maschinell (form-token.ts).
 *  3. Rate-Limits auf drei Ebenen: IP, Absender-Adresse und Mandant
 *     insgesamt. Die dritte Ebene ist die Lehre aus dem Vorfall — die
 *     `rate_limits`-Tabelle zeigt vier Spam-Anfragen von vier verschiedenen
 *     IPs mit je einem Treffer, ein reines IP-Limit greift dagegen nie.
 *  4. Cloudflare Turnstile, sobald konfiguriert (security/turnstile.ts) —
 *     die einzige Schicht, die den Absender selbst als Bot erkennt statt
 *     seinen Inhalt zu bewerten. Ohne gesetzte Schlüssel übersprungen.
 *  5. zod-Schema: keine Links/Markup in Namensfeldern (schema.ts).
 *  6. Inhaltsbewertung der Nachricht (spam.ts).
 *
 * Erkannte Bots (Schicht 1/2) bekommen bewusst dieselbe Erfolgsmeldung wie
 * Menschen: eine sichtbare Ablehnung ist für den Betreiber eines Spam-Bots
 * die Rückmeldung, mit der er sein Muster anpasst. Schicht 4/5 melden
 * dagegen einen konkreten, korrigierbaren Fehler — dort ist ein
 * Fehlurteil gegen einen echten Absender denkbar, und der soll seine
 * Anfrage anpassen können statt ins Leere zu schreiben. Turnstile liegt
 * dazwischen: ein ungültiges Token wird abgelehnt, ein Ausfall bei
 * Cloudflare dagegen durchgelassen (fail-open, siehe turnstile.ts).
 */
export async function submitContactForm(
  _prevState: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  const honeypot = formData.get(CONTACT_HONEYPOT_FIELD);
  if (typeof honeypot === "string" && honeypot.trim() !== "") {
    console.warn("Kontaktformular: Honeypot ausgelöst, Anfrage verworfen.");
    return { error: null, success: true };
  }

  const tokenVerdict = await verifyContactFormToken(formData.get(CONTACT_TOKEN_FIELD));
  if (tokenVerdict === "too-fast" || tokenVerdict === "invalid") {
    console.warn(`Kontaktformular: Zeitfalle ausgelöst (${tokenVerdict}), Anfrage verworfen.`);
    return { error: null, success: true };
  }
  if (tokenVerdict === "expired") {
    return {
      error: "Das Formular ist abgelaufen. Bitte lade die Seite neu und sende erneut.",
    };
  }

  if (!(await checkRateLimit("contact-form", { maxRequests: 5, windowSeconds: 300 }))) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  // Nach dem IP-Limit, damit eine Flut nicht ungebremst Anfragen an
  // Cloudflares siteverify-Endpunkt auslöst.
  if ((await verifyTurnstile(formData.get(TURNSTILE_RESPONSE_FIELD))) === "failed") {
    return { error: TURNSTILE_FAILED_MESSAGE };
  }

  const parsed = contactFormSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
    subject: formData.get("subject"),
    message: formData.get("message"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }

  const { firstName, lastName, email, subject, message } = parsed.data;

  const tenant = await getTenant();
  const recipient = tenant?.settings?.support_email?.trim() || "office@calltalent.ai";
  const tenantName = tenant?.name || "Calltalent";

  // Pro Absender-Adresse (sha256-Hash, keine PII im rate_limits-Schlüssel —
  // gleiches Muster wie "auth-login-email" in auth/actions.ts).
  const emailKey = createHash("sha256").update(email.toLowerCase()).digest("hex");
  if (
    !(await checkRateLimit("contact-form-email", {
      maxRequests: 3,
      windowSeconds: 3600,
      extraKey: emailKey,
    }))
  ) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  // Obergrenze pro Empfänger-Postfach, unabhängig von IP und Absender:
  // fängt genau den verteilten Bot ab, gegen den die beiden Limits davor
  // machtlos sind. 30/Stunde liegt weit über dem realen Aufkommen (fünf
  // Anfragen seit dem 10.07.2026) und deckelt trotzdem eine Flut.
  if (
    !(await checkRateLimit("contact-form-recipient", {
      maxRequests: 30,
      windowSeconds: 3600,
      extraKey: recipient.toLowerCase(),
    }))
  ) {
    console.warn(`Kontaktformular: Stundenlimit für ${tenantName} erreicht.`);
    return { error: RATE_LIMIT_MESSAGE };
  }

  const verdict = classifyContactSubmission({ firstName, lastName, subject, message });
  if (verdict.blocked) {
    console.warn(
      `Kontaktformular: als Spam eingestuft (Score ${verdict.score}, ${verdict.reasons.join(", ")}), nicht zugestellt.`,
    );
    return {
      error: verdict.reasons.includes("links-in-message")
        ? `Bitte sende deine Nachricht ohne Links — sie wird sonst automatisch als Spam eingestuft. Alternativ erreichst du uns direkt unter ${recipient}.`
        : `Deine Nachricht wurde automatisch als Spam eingestuft und nicht zugestellt. Bitte formuliere sie ohne Werbeinhalte oder schreibe uns direkt unter ${recipient}.`,
    };
  }

  const result = await sendEmail({
    to: recipient,
    subject: `Kontaktformular: ${subject} — ${firstName} ${lastName}`,
    html: contactFormNotification({ firstName, lastName, email, subject, message, tenantName }),
  });

  // sendEmail() ist FAIL-SOFT (siehe email/client.ts) und wirft nie — bei
  // einem echten Versandfehler soll der Nutzer das aber sehen (anders als
  // beim Passwort-Reset gibt es hier keinen Enumeration-Schutz zu wahren),
  // damit er notfalls per Login-Seite verweisbaren Weg noch einmal versucht.
  if (!result.success) {
    return { error: "Nachricht konnte nicht gesendet werden. Bitte versuche es später erneut." };
  }

  return { error: null, success: true };
}
