"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireStaffTenant } from "@/lib/auth/staff";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import { createSubmissionSchema, gradeSubmissionSchema } from "@/lib/submissions/schema";
import { sendEmail } from "@/lib/email/client";
import { submissionGraded } from "@/lib/email/templates";
import type { GradeSubmissionActionState } from "@/lib/submissions/state";
import { dispatchWebhookEvent } from "@/lib/webhooks/dispatch";
import { translateDbError } from "@/lib/errors/db";
import { genericErrorMessage } from "@/lib/errors/generic";

type CreateSubmissionResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * Lernende: Abgabe einreichen. `tenant_id`/`user_id` kommen ausschließlich
 * aus dem Server-Kontext — `tenant_id` wird nicht vom Client übernommen,
 * sondern über die per RLS gefilterte `lessons`-Zeile nachgeschlagen
 * (dasselbe Muster wie `quizRow.tenant_id` in src/lib/quiz/actions.ts
 * `submitAttempt`). RLS `submissions_own_insert` erzwingt zusätzlich
 * `user_id = auth.uid() and member_role(tenant_id) is not null`.
 */
export async function createSubmission(input: unknown): Promise<CreateSubmissionResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Nicht angemeldet." };

    const allowed = await checkRateLimit("submission-create", {
      maxRequests: 20,
      windowSeconds: 3600,
      extraKey: user.id,
    });
    if (!allowed) return { ok: false, error: RATE_LIMIT_MESSAGE };

    const parsed = createSubmissionSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }

    // RLS lessons_member_select liefert null sowohl bei Nichtexistenz als
    // auch bei fehlender Mitgliedschaft — reicht als Existenz-/
    // Zugehörigkeitsprüfung, tenant_id kommt ausschließlich aus dieser Zeile.
    const { data: lessonRow } = await supabase
      .from("lessons")
      .select("id, tenant_id")
      .eq("id", parsed.data.lessonId)
      .maybeSingle();
    if (!lessonRow) return { ok: false, error: "Lektion nicht gefunden oder kein Zugriff." };

    const contentAndPath =
      parsed.data.kind === "text"
        ? { content: parsed.data.content, file_path: null as string | null }
        : { content: null as string | null, file_path: parsed.data.filePath };

    // Defense-in-Depth neben der Storage-Policy submissions_own_all: der
    // hochgeladene Pfad muss unter dem eigenen {tenant_id}/{user_id}/-Präfix
    // liegen (Pfad wurde serverseitig in upload-url/route.ts erzeugt, hier
    // nur nochmal geprüft, falls der Client ihn manipuliert hätte).
    if (
      parsed.data.kind === "file" &&
      !contentAndPath.file_path?.startsWith(`${lessonRow.tenant_id}/${user.id}/`)
    ) {
      return { ok: false, error: "Ungültiger Datei-Pfad." };
    }

    const { data, error } = await supabase
      .from("submissions")
      .insert({
        tenant_id: lessonRow.tenant_id,
        lesson_id: lessonRow.id,
        user_id: user.id,
        kind: parsed.data.kind,
        content: contentAndPath.content,
        file_path: contentAndPath.file_path,
        status: "submitted",
      })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: error ? translateDbError(error) : "Einreichen fehlgeschlagen." };

    // Block 7 (Webhooks): submission.created fire-and-forget nach der
    // erfolgreichen Abgabe (siehe dispatch.ts).
    dispatchWebhookEvent(lessonRow.tenant_id, "submission.created", {
      submission_id: data.id,
      lesson_id: lessonRow.id,
      user_id: user.id,
      kind: parsed.data.kind,
    }).catch(() => {});

    return { ok: true, id: data.id };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}

/**
 * Staff: Abgabe bewerten. `requireStaffTenant()` + `.eq("tenant_id", …)`
 * Defense-in-Depth (RLS `submissions_staff_all` deckt es zusätzlich ab).
 * Lädt danach Lernenden-Profil + Kurs-/Lektionstitel für die Mail und ruft
 * die bereits bestehende `submissionGraded()`-Vorlage auf — FAIL-SOFT:
 * `sendEmail()` wirft nie (siehe email/client.ts), ein Mailfehler darf die
 * Bewertung selbst nicht scheitern lassen, daher nur geloggt, nicht
 * blockierend behandelt.
 */
export async function gradeSubmission(
  submissionId: string,
  _prevState: GradeSubmissionActionState,
  formData: FormData,
): Promise<GradeSubmissionActionState> {
  try {
    const { tenant, user, supabase } = await requireStaffTenant();

    const allowed = await checkRateLimit("submission-grade", {
      maxRequests: 60,
      windowSeconds: 3600,
      extraKey: tenant.id,
    });
    if (!allowed) return { error: RATE_LIMIT_MESSAGE };

    const parsed = gradeSubmissionSchema.safeParse({
      status: formData.get("status"),
      grade: formData.get("grade"),
      feedback: formData.get("feedback"),
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }

    const { data: updated, error } = await supabase
      .from("submissions")
      .update({
        status: parsed.data.status,
        grade: parsed.data.grade ?? null,
        feedback: parsed.data.feedback ?? null,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", submissionId)
      .eq("tenant_id", tenant.id)
      .select("id, lesson_id, user_id")
      .single();
    if (error || !updated) return { error: error ? translateDbError(error) : "Bewertung fehlgeschlagen." };

    // Mail (fail-soft) — Lernenden-Profil + Kurs-/Lektionstitel laden.
    // submissions hat keine direkte course_id — Weg über lessons.module_id
    // -> modules.course_id -> courses.title (dieselbe Kette wie im
    // Abgaben-Inbox-Ladepfad, admin/abgaben/page.tsx).
    const { data: learnerProfile } = await supabase
      .from("profiles")
      .select("email, full_name")
      .eq("id", updated.user_id)
      .maybeSingle();

    const { data: lessonRow } = await supabase
      .from("lessons")
      .select("title, module_id")
      .eq("id", updated.lesson_id)
      .maybeSingle();

    let courseTitle = "";
    if (lessonRow?.module_id) {
      const { data: moduleRow } = await supabase
        .from("modules")
        .select("course_id")
        .eq("id", lessonRow.module_id)
        .maybeSingle();
      if (moduleRow?.course_id) {
        const { data: courseRow } = await supabase
          .from("courses")
          .select("title")
          .eq("id", moduleRow.course_id)
          .maybeSingle();
        courseTitle = courseRow?.title ?? "";
      }
    }

    // FIX (Josips Testlauf, 12.07.2026): `sendEmail()` wurde hier bisher
    // AWAITED, obwohl der Kommentar/die Absicht "FAIL-SOFT" lautet — das
    // deckt nur Fehler ab, nicht Langsamkeit. Ohne eigenes Timeout kann ein
    // langsamer/hängender Resend-API-Aufruf (z. B. gegen eine synthetische
    // Test-Adresse) die gesamte Server Action minutenlang blockieren, obwohl
    // die Bewertung selbst (DB-Update oben) bereits sicher gespeichert ist.
    // Gleiches Fire-and-forget-Muster wie überall sonst im Projekt für
    // Nebeneffekt-Mails/Webhooks (z. B. dispatchWebhookEvent(), Push in
    // completeLesson()) — `revalidatePath`/Rückgabe warten NICHT mehr auf
    // den Mailversand.
    if (learnerProfile?.email) {
      const html = submissionGraded({
        tenantName: tenant.name,
        recipientName: learnerProfile.full_name ?? undefined,
        courseTitle,
        lessonTitle: lessonRow?.title ?? "",
        status: parsed.data.status,
        feedback: parsed.data.feedback,
        accentColor: tenant.branding.color_primary,
      });
      sendEmail({
        to: learnerProfile.email,
        subject: "Abgabe bewertet",
        html,
        tenant: { name: tenant.name },
      })
        .then((mailResult) => {
          if (!mailResult.success) {
            console.error("[submissions/actions] Bewertungsmail fehlgeschlagen (fail-soft):", mailResult.error);
          }
        })
        .catch((mailError) => {
          console.error("[submissions/actions] Ausnahme beim Bewertungsmail-Versand (fail-soft):", mailError);
        });
    }

    revalidatePath("/admin/abgaben");
    return { error: null, success: true };
  } catch (e) {
    return { error: genericErrorMessage(e) };
  }
}

type DownloadUrlResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * Staff: kurzlebige signierte Download-URL für eine Datei-Abgabe (5 Min.
 * TTL) — NIE eine dauerhafte öffentliche URL (Bucket `submissions` ist
 * privat). Nutzt den Nutzer-Client (nicht Admin-Client): RLS
 * `submissions_staff_read` auf storage.objects erzwingt zusätzlich
 * `is_staff(tenant_id)` auf den Pfad, `.eq("tenant_id", …)` auf der
 * submissions-Zeile ist Defense-in-Depth davor.
 */
export async function getSubmissionDownloadUrl(submissionId: string): Promise<DownloadUrlResult> {
  try {
    const { tenant, supabase } = await requireStaffTenant();

    const allowed = await checkRateLimit("submission-download", {
      maxRequests: 60,
      windowSeconds: 3600,
      extraKey: tenant.id,
    });
    if (!allowed) return { ok: false, error: RATE_LIMIT_MESSAGE };

    const { data: submission } = await supabase
      .from("submissions")
      .select("file_path")
      .eq("id", submissionId)
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    if (!submission?.file_path) return { ok: false, error: "Keine Datei zu dieser Abgabe." };

    const { data, error } = await supabase.storage
      .from("submissions")
      .createSignedUrl(submission.file_path, 60 * 5);
    if (error || !data) {
      return { ok: false, error: "Download-URL konnte nicht erzeugt werden." };
    }

    return { ok: true, url: data.signedUrl };
  } catch (e) {
    return { ok: false, error: genericErrorMessage(e) };
  }
}
