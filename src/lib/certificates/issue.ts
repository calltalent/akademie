import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeCourseProgress } from "@/lib/progress/compute";
import { generateCertificateSerial } from "@/lib/certificates/serial";
import { generateCertificatePdf } from "@/lib/certificates/pdf";
import { sendEmail } from "@/lib/email/client";
import { certificateIssued } from "@/lib/email/templates";
import { translateDbError } from "@/lib/errors/db";

/**
 * Zertifikats-Ausstellung nach Kursabschluss (Phase 2, Block 4).
 *
 * SICHERHEITSKRITISCH — genau wie `submitAttempt`/`gradeSubmission`:
 * `courseId`/`userId`/`tenantId` kommen AUSSCHLIESSLICH aus dem bereits
 * geprüften Server-Kontext des Aufrufers (`completeLesson()`), nie aus
 * Client-Eingabe. `certificates` hat weder eine INSERT- noch eine
 * UPDATE-RLS-Policy (nur `certificates_own_select`/`certificates_staff_select`,
 * siehe 0001_init.sql Zeilen 524-528) — Ausstellung läuft deshalb komplett
 * über den Admin-Client (service_role, umgeht RLS). Diese Datei ist die
 * EINZIGE Stelle im Projekt, die den Admin-Client für Zertifikate nutzt
 * (Regel: Admin-Client-Nutzung eng auf issue.ts begrenzt, nicht in
 * Komponenten/Routen direkt).
 *
 * Eignungskriterium ist AUSSCHLIESSLICH "alle veröffentlichten Lektionen
 * abgeschlossen" (`computeCourseProgress(...).isComplete`) — kein
 * zusätzliches Quiz-/Abgaben-Gating (mit Josip abgestimmte Entscheidung,
 * siehe PHASENSTATUS.md "Phase 2 — Geschäft", Entscheidung 4). Diese
 * Funktion prüft die Vollständigkeit SELBST neu (lädt Module/Lektionen/
 * Fortschritt), statt dem Aufrufer zu vertrauen — Defense-in-Depth, falls
 * `issueCertificateIfEligible` künftig von einer weiteren Stelle als
 * `completeLesson()` aufgerufen wird.
 *
 * Zusätzlich (Entscheidung 4, "steuerbar über courses.settings.certificate_enabled"):
 * ist das Feld explizit auf `false` gesetzt, wird kein Zertifikat
 * ausgestellt. Fehlt das Feld (Standard-Zustand aller bisherigen Kurse),
 * gilt die Ausstellung als aktiviert — es gibt in Phase 2 noch keine
 * Editor-UI, um das Feld zu setzen (bewusste Vereinfachung, siehe
 * PHASENSTATUS.md-Eintrag zu diesem Block).
 */

const DUMMY_UUID = "00000000-0000-0000-0000-000000000000";

export type IssueCertificateResult =
  | { ok: true; alreadyExisted: boolean; certificateId?: string }
  | { ok: false; error: string };

type CourseSettings = { certificate_enabled?: boolean };
type TenantBranding = { color_primary?: string };
type TenantSettings = { certificates_enabled?: boolean };

export async function issueCertificateIfEligible(
  courseId: string,
  userId: string,
  tenantId: string,
): Promise<IssueCertificateResult> {
  try {
    const admin = createAdminClient();

    // (a) Kurs laden + Mandantenzugehörigkeit prüfen (Defense-in-Depth).
    const { data: course, error: courseError } = await admin
      .from("courses")
      .select("id, tenant_id, title, settings")
      .eq("id", courseId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (courseError || !course) {
      return { ok: false, error: "Kurs nicht gefunden oder falscher Mandant." };
    }

    // (a) Vollständigkeit neu berechnen — nur veröffentlichte Lektionen
    // zählen, exakt dieselbe Definition wie in src/app/(learn)/kurs/[slug]/page.tsx.
    const { data: modules } = await admin.from("modules").select("id").eq("course_id", courseId);
    const moduleIds = (modules ?? []).map((m) => m.id);

    const { data: lessons } = await admin
      .from("lessons")
      .select("id")
      .in("module_id", moduleIds.length > 0 ? moduleIds : [DUMMY_UUID])
      .eq("status", "published");
    const lessonIds = (lessons ?? []).map((l) => l.id);

    const { data: progressRows } = await admin
      .from("progress")
      .select("lesson_id, status")
      .eq("user_id", userId)
      .in("lesson_id", lessonIds.length > 0 ? lessonIds : [DUMMY_UUID]);

    const completedIds = new Set(
      (progressRows ?? []).filter((p) => p.status === "completed").map((p) => p.lesson_id),
    );
    const progress = computeCourseProgress([
      { id: "all", lessons: lessonIds.map((id) => ({ id, completed: completedIds.has(id) })) },
    ]);
    if (!progress.isComplete) {
      // Nicht (mehr) berechtigt — kein Fehler, einfach noch nichts zu tun.
      return { ok: true, alreadyExisted: false };
    }

    const settings = (course.settings ?? {}) as CourseSettings;
    if (settings.certificate_enabled === false) {
      return { ok: true, alreadyExisted: false };
    }

    // (c) Mandanten-Branding + Zertifikats-Schalter laden — vorgezogen
    // (Design-Block 6, 13.07.2026, AdminEinstellungen.dc.html "Zertifikate
    // ausstellen"): war vorher erst NACH der Idempotenz-Prüfung geladen,
    // jetzt hier gebraucht für das mandantenweite Gate NEBEN dem
    // bestehenden kursbezogenen `certificate_enabled`-Feld. Standard bei
    // fehlendem Feld weiterhin "aktiviert" (unverändertes Verhalten für
    // alle Mandanten ohne das Feld).
    const { data: tenantRow } = await admin
      .from("tenants")
      .select("name, branding, settings")
      .eq("id", tenantId)
      .maybeSingle();
    const tenantSettings = (tenantRow?.settings ?? {}) as TenantSettings;
    if (tenantSettings.certificates_enabled === false) {
      return { ok: true, alreadyExisted: false };
    }

    // (b) Idempotenz: existiert bereits ein Zertifikat? Kein Duplikat, keine zweite Mail.
    const { data: existing } = await admin
      .from("certificates")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("course_id", courseId)
      .eq("user_id", userId)
      .maybeSingle();
    if (existing) {
      return { ok: true, alreadyExisted: true, certificateId: existing.id };
    }

    const tenantName = tenantRow?.name ?? "Calltalent-Akademie";
    const accentColor = (tenantRow?.branding as TenantBranding | null)?.color_primary;

    const { data: profile } = await admin
      .from("profiles")
      .select("email, full_name")
      .eq("id", userId)
      .maybeSingle();
    const recipientName = profile?.full_name?.trim() || profile?.email || "Teilnehmer";

    // (d) PDF erzeugen.
    const serial = generateCertificateSerial();
    const issuedAt = new Date();
    const pdfBytes = await generateCertificatePdf({
      tenantName,
      courseTitle: course.title,
      recipientName,
      issuedAt,
      serial,
      accentColor,
    });

    // (e) In den privaten Bucket `certificates` hochladen — NUR über den
    // Admin-Client möglich (storage-Policy `certificates_staff_all` verlangt
    // is_staff(), ein Lernender beim eigenen Kursabschluss ist das i. d. R. nicht).
    const storagePath = `${tenantId}/${userId}/${crypto.randomUUID()}.pdf`;
    const { error: uploadError } = await admin.storage
      .from("certificates")
      .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: false });
    if (uploadError) {
      console.error("[certificates/issue] Zertifikat-Upload fehlgeschlagen.", uploadError.message);
      return { ok: false, error: "Zertifikat-Upload fehlgeschlagen." };
    }

    // (f) certificates-Zeile schreiben — letzte Verteidigungslinie: der
    // DB-Unique-Constraint `certificates(course_id, user_id)` (siehe
    // 0001_init.sql, funktional gleichwertig zu tenant_id+course_id+user_id,
    // weil ein Kurs genau einem Mandanten gehört) fängt eine Race Condition
    // ab, falls die Idempotenz-Prüfung oben durch parallele Aufrufe umgangen
    // wurde (z. B. zwei fast gleichzeitige "Abschließen"-Klicks).
    const { data: inserted, error: insertError } = await admin
      .from("certificates")
      .insert({
        tenant_id: tenantId,
        course_id: courseId,
        user_id: userId,
        serial,
        pdf_path: storagePath,
        issued_at: issuedAt.toISOString(),
      })
      .select("id")
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        const { data: raceExisting } = await admin
          .from("certificates")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("course_id", courseId)
          .eq("user_id", userId)
          .maybeSingle();
        return { ok: true, alreadyExisted: true, certificateId: raceExisting?.id };
      }
      return { ok: false, error: `Zertifikat-Zeile konnte nicht angelegt werden: ${translateDbError(insertError)}` };
    }

    // (g) Mail — FAIL-SOFT (Vertrag aus src/lib/email/client.ts): ein
    // Mailfehler darf die bereits erfolgte Ausstellung nicht rückgängig
    // machen oder als Fehler nach oben gemeldet werden.
    if (profile?.email) {
      const html = certificateIssued({
        tenantName,
        recipientName: profile.full_name ?? undefined,
        courseTitle: course.title,
        accentColor,
      });
      const mailResult = await sendEmail({
        to: profile.email,
        subject: "Zertifikat ausgestellt",
        html,
        tenant: { name: tenantName },
      });
      if (!mailResult.success) {
        console.error(
          "[certificates/issue] Zertifikatsmail fehlgeschlagen (fail-soft):",
          mailResult.error,
        );
      }
    }

    return { ok: true, alreadyExisted: false, certificateId: inserted.id };
  } catch (e) {
    // e.message kann eine rohe/technische Meldung sein — Detail nur loggen,
    // der Rückgabewert bekommt einen klaren deutschen Satz.
    console.error("[certificates/issue] Ausnahme:", e instanceof Error ? e.message : e);
    return { ok: false, error: "Unbekannter Fehler bei der Zertifikat-Ausstellung." };
  }
}
