"use server";

import { contactFormSchema } from "@/lib/contact/schema";
import type { ContactActionState } from "@/lib/contact/state";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
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
 * Rate-Limit IP-basiert (kein Login vorausgesetzt, wie bei den
 * Auth-Formularen) — verhindert Formular-Spam auf eine öffentlich
 * erreichbare, ungeschützte Route.
 */
export async function submitContactForm(
  _prevState: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  if (!(await checkRateLimit("contact-form", { maxRequests: 5, windowSeconds: 300 }))) {
    return { error: RATE_LIMIT_MESSAGE };
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
