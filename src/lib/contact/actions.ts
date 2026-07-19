"use server";

import { contactFormSchema } from "@/lib/contact/schema";
import type { ContactActionState } from "@/lib/contact/state";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import { sendEmail } from "@/lib/email/client";
import { contactFormNotification } from "@/lib/email/templates";

/**
 * Design-Block 4 (12.07.2026) — Server Action für /kontakt (Kontakt.dc.html).
 *
 * Empfänger bewusst `office@calltalent.ai` (real, in Resend verifiziert —
 * siehe PHASENSTATUS.md "Block 5 — Resend Produktions-Domain"), NICHT die
 * im Mockup gezeigte Platzhalteradresse `support@calltalent-akademie.de`
 * (existiert nicht/keine echte Subdomain-Verifizierung). Gleiches Muster
 * wie an anderer Stelle im Projekt dokumentiert: keine erfundenen Werte aus
 * dem Mockup übernehmen, nur echte Daten.
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

  const result = await sendEmail({
    to: "office@calltalent.ai",
    subject: `Kontaktformular: ${subject} — ${firstName} ${lastName}`,
    html: contactFormNotification({ firstName, lastName, email, subject, message }),
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
