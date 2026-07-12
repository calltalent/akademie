"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenant } from "@/lib/tenant/context";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import { enforceQuota, recordTutorMessage } from "@/lib/ai/usage";
import { retrieveChunks, type RetrievedChunk } from "@/lib/ai/retrieve";
import { buildTutorSystemPrompt } from "@/lib/tutor/prompt";
import { createAnthropicClient } from "@/lib/ai/anthropic";
import { AI_MODELS } from "@/lib/ai/config";
import { sendEmail } from "@/lib/email/client";
import { tutorEscalation } from "@/lib/email/templates";
import type { AskTutorResult, TutorSource } from "@/lib/tutor/state";

/**
 * Tutor-Chat (RAG + Eskalation) — Phase 3, Block 4. Server Actions:
 * `askTutor()` (Frage stellen, RAG-Antwort per Claude Haiku) und
 * `escalateToTrainer()` (Konversation an aktive Staff-Mitglieder mailen).
 *
 * SICHERHEITSKRITISCHER NACHFILTER — genau wie in src/lib/ai/search.ts
 * (Block 3), hier ERNEUT angewendet: `retrieveChunks()` (Block 2) liefert
 * Treffer OHNE zu prüfen, ob die zugehörige Lektion aktuell noch
 * `status = 'published'` ist (Embeddings können Entwurfsinhalte enthalten,
 * z. B. wenn Staff "Kurs für KI-Suche einbetten" auf einem Kurs mit
 * gemischtem Lektionsstatus geklickt hat). Für den Tutor ist das SOGAR
 * kritischer als bei der Suche, weil die Antwort dem Nutzer Kontext aus
 * einer möglicherweise unveröffentlichten Lektion VORLESEN und als
 * "Quelle" ZITIEREN könnte. `filterToPublishedChunks()` prüft deshalb
 * `lessons.status`/`courses.status` GEGEN DEN AKTUELLEN DB-STAND (nicht den
 * Stand zum Zeitpunkt des Embeddings), BEVOR Chunks (a) in den an Claude
 * gesendeten Prompt-Kontext eingehen und (b) als Quellen-Zitat in der
 * Antwort erscheinen. Nicht (mehr) veröffentlichte Treffer werden
 * vollständig aus dem Kontext verworfen.
 *
 * SCHEMA-ABWEICHUNG vom architect-Plan (dokumentiert wie CLAUDE.md §4.1
 * verlangt — "Weiche nur ab, wenn der Plan technisch nicht umsetzbar ist —
 * dann dokumentiere die Abweichung in PHASENSTATUS.md"; Details dort):
 * `tutor_conversations` hat laut 0001_init.sql KEINE `escalated`-Spalte —
 * dieses Feld existiert nur auf `tutor_messages` (Zeile 326). Der ursprüngliche
 * Plantext ("setzt tutor_conversations.escalated = true") ist damit nicht
 * wörtlich umsetzbar. `escalateToTrainer()` markiert deshalb stattdessen
 * alle Nachrichten der Konversation (`tutor_messages.escalated = true`).
 * Keine neue Migration nötig — exakt wie vom architect für diesen Block
 * erwartet ("alle benötigten Tabellen existieren bereits").
 */

const askTutorInputSchema = z.object({
  courseId: z.string().uuid("Ungültige Kurs-ID."),
  conversationId: z.string().uuid().optional(),
  message: z
    .string()
    .trim()
    .min(1, "Bitte eine Frage eingeben.")
    .max(2000, "Frage ist zu lang (max. 2000 Zeichen)."),
});

/**
 * Filtert von retrieveChunks() gelieferte Treffer auf den AKTUELLEN
 * DB-Stand von `lessons.status`/`courses.status` — identisches Muster wie
 * `searchLessons()` in src/lib/ai/search.ts, hier für den Tutor-Kontext
 * eigenständig nachgebaut (kleine, bewusst unabhängige Funktion statt eines
 * Cross-Block-Imports aus search.ts, dessen Rückgabeform für die Suche
 * zugeschnitten ist und keine Rohtexte für den Claude-Kontext liefert).
 * Alle Lese-Zugriffe über den regulären RLS-Client des angemeldeten
 * Nutzers, `.eq("tenant_id", tenantId)` zusätzlich als Defense-in-Depth.
 */
async function filterToPublishedChunks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  chunks: RetrievedChunk[],
): Promise<(RetrievedChunk & { lessonTitle: string })[]> {
  if (chunks.length === 0) return [];

  const lessonIds = Array.from(new Set(chunks.map((c) => c.lessonId)));
  const { data: currentLessons } = await supabase
    .from("lessons")
    .select("id, title, status")
    .eq("tenant_id", tenantId)
    .in("id", lessonIds)
    .eq("status", "published");
  const publishedLessonById = new Map((currentLessons ?? []).map((l) => [l.id, l]));
  if (publishedLessonById.size === 0) return [];

  const remainingCourseIds = Array.from(
    new Set(chunks.filter((c) => publishedLessonById.has(c.lessonId)).map((c) => c.courseId)),
  );
  const { data: currentCourses } = await supabase
    .from("courses")
    .select("id, status")
    .eq("tenant_id", tenantId)
    .in("id", remainingCourseIds)
    .eq("status", "published");
  const publishedCourseIds = new Set((currentCourses ?? []).map((c) => c.id));

  const result: (RetrievedChunk & { lessonTitle: string })[] = [];
  for (const chunk of chunks) {
    const lesson = publishedLessonById.get(chunk.lessonId);
    if (!lesson) continue; // Lektion nicht (mehr) veröffentlicht
    if (!publishedCourseIds.has(chunk.courseId)) continue; // Kurs nicht (mehr) veröffentlicht
    result.push({ ...chunk, lessonTitle: lesson.title });
  }
  return result;
}

/** Robuste Text-Extraktion aus der Claude-Antwort ohne Kopplung an interne SDK-Typnamen. */
function extractAnswerText(content: unknown): string {
  if (!Array.isArray(content)) return "Entschuldigung, ich konnte keine Antwort erzeugen.";
  const text = content
    .filter(
      (block): block is { type: string; text: string } =>
        typeof block === "object" &&
        block !== null &&
        (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string",
    )
    .map((block) => block.text)
    .join("\n")
    .trim();
  return text.length > 0 ? text : "Entschuldigung, ich konnte keine Antwort erzeugen.";
}

export async function askTutor(params: unknown): Promise<AskTutorResult> {
  try {
    // b) zod-Validierung der Eingabe (Eingabegrenze, CLAUDE.md §2.3).
    const parsed = askTutorInputSchema.safeParse(params);
    if (!parsed.success) {
      return { ok: false, reason: "error", message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
    }
    const { courseId, message } = parsed.data;
    let conversationId = parsed.data.conversationId;

    // a) Angemeldeten Nutzer + Mandant laden — kein Redirect in einer Server
    // Action möglich (anders als in Server Components).
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, reason: "error", message: "Nicht angemeldet." };

    const tenant = await getTenant();
    if (!tenant) return { ok: false, reason: "error", message: "Kein Mandant zu diesem Host gefunden." };

    // Defense-in-Depth (gleiches Muster wie payments_enabled-Gate in
    // src/lib/stripe/checkout.ts, Zeile 114): das Tutor-Panel wird in der
    // Lernansicht nur bei tutor_enabled === true überhaupt angezeigt, diese
    // Prüfung wird hier serverseitig wiederholt, damit ein direkter Aufruf
    // der Server Action das Feature-Gate nicht umgehen und Kosten verursachen
    // kann, während der Mandant den Tutor bewusst deaktiviert hat.
    if (tenant.settings.tutor_enabled !== true) {
      return { ok: false, reason: "error", message: "Der Tutor ist für diese Akademie nicht aktiviert." };
    }

    // c) courseId gehört zum Mandanten UND ist veröffentlicht (Defense-in-
    // Depth-Pattern wie reembedCourse()/CSV-Route).
    const { data: course } = await supabase
      .from("courses")
      .select("id")
      .eq("id", courseId)
      .eq("tenant_id", tenant.id)
      .eq("status", "published")
      .maybeSingle();
    if (!course) {
      return { ok: false, reason: "not_found", message: "Kurs nicht gefunden oder nicht veröffentlicht." };
    }

    // d) Rate-Limit PRO NUTZER (nicht pro Mandant — ein einzelner Nutzer
    // soll das Mandanten-Kontingent nicht im Alleingang verbrauchen können,
    // bevor überhaupt das Monatskontingent aus Schritt e greift).
    const allowedRate = await checkRateLimit("tutor-ask", {
      maxRequests: 30,
      windowSeconds: 3600,
      extraKey: user.id,
    });
    if (!allowedRate) return { ok: false, reason: "error", message: RATE_LIMIT_MESSAGE };

    // e) Kontingent VOR jedem Claude-Aufruf (CLAUDE.md §3.7, nicht
    // verhandelbar — siehe Vertrag in src/lib/ai/usage.ts).
    const quota = await enforceQuota(tenant.id, "tutor");
    if (!quota.allowed) {
      return {
        ok: false,
        reason: "quota_exceeded",
        message: "Das monatliche KI-Kontingent ist aufgebraucht.",
      };
    }

    // f) Retrieval (Top 6, SPEC §6: "pgvector-Suche über Kurs-Chunks (Top 6)").
    const rawChunks = await retrieveChunks({
      tenantId: tenant.id,
      courseIds: [courseId],
      query: message,
      k: 6,
    });

    // g) Sicherheitskritischer Nachfilter (siehe Dateikopf-Kommentar).
    const publishedChunks = await filterToPublishedChunks(supabase, tenant.id, rawChunks);

    // h) System-Prompt (nur mit den nachgefilterten Chunks) + Claude-Haiku-Aufruf.
    const systemPrompt = buildTutorSystemPrompt(
      publishedChunks.map((c) => ({ lessonTitle: c.lessonTitle, content: c.content })),
    );

    const anthropic = createAnthropicClient();
    const response = await anthropic.messages.create({
      model: AI_MODELS.haiku,
      max_tokens: 700,
      system: systemPrompt,
      messages: [{ role: "user", content: message }],
    });

    const answer = extractAnswerText(response.content);
    const tokensIn = response.usage?.input_tokens ?? 0;
    const tokensOut = response.usage?.output_tokens ?? 0;

    // i) Konversation anlegen/fortsetzen: eine übergebene conversationId wird
    // nur wiederverwendet, wenn sie nachweislich zu user_id + tenant_id +
    // courseId gehört — sonst wird eine neue Konversation angelegt statt
    // eine fremde zu kapern.
    if (conversationId) {
      const { data: existingConv } = await supabase
        .from("tutor_conversations")
        .select("id")
        .eq("id", conversationId)
        .eq("tenant_id", tenant.id)
        .eq("user_id", user.id)
        .eq("course_id", courseId)
        .maybeSingle();
      if (!existingConv) conversationId = undefined;
    }
    if (!conversationId) {
      const { data: newConv, error: convError } = await supabase
        .from("tutor_conversations")
        .insert({ tenant_id: tenant.id, course_id: courseId, user_id: user.id })
        .select("id")
        .single();
      if (convError || !newConv) {
        return { ok: false, reason: "error", message: "Konversation konnte nicht angelegt werden." };
      }
      conversationId = newConv.id;
    }

    // TypeScript kann über die beiden if-Blöcke oben hinweg (Narrowing ->
    // Reassignment -> erneutes Narrowing) nicht beweisen, dass
    // conversationId hier immer gesetzt ist (12.07.2026, build-Fund) —
    // Guard rein für die Typprüfung, im Normalbetrieb unerreichbar.
    if (!conversationId) {
      return { ok: false, reason: "error", message: "Konversation konnte nicht angelegt werden." };
    }

    // j) Nutzer- UND Assistenten-Nachricht protokollieren. source_lessons
    // nur an der Assistenten-Antwort (das ist, was tatsächlich zitiert
    // wurde); Tokens/Kosten nur am tatsächlichen Claude-Aufruf.
    const sourceLessonIds = Array.from(new Set(publishedChunks.map((c) => c.lessonId)));
    await recordTutorMessage({
      tenantId: tenant.id,
      conversationId,
      role: "user",
      content: message,
      tokensIn: 0,
      tokensOut: 0,
    });
    await recordTutorMessage({
      tenantId: tenant.id,
      conversationId,
      role: "assistant",
      content: answer,
      sourceLessons: sourceLessonIds,
      tokensIn,
      tokensOut,
    });

    // k) eindeutige Quellenliste für die UI.
    const seen = new Set<string>();
    const sources: TutorSource[] = [];
    for (const chunk of publishedChunks) {
      if (seen.has(chunk.lessonId)) continue;
      seen.add(chunk.lessonId);
      sources.push({ lessonId: chunk.lessonId, lessonTitle: chunk.lessonTitle });
    }

    return { ok: true, conversationId, answer, sources };
  } catch (e) {
    // Sicherheitsfix (gefunden bei Josips manuellem Test, 11.07.2026): der
    // ursprüngliche Code gab e.message UNGEFILTERT an die UI zurück — bei
    // einem Anthropic-API-Fehler (z. B. "credit balance too low") landet
    // die rohe API-Fehlermeldung (inkl. internem JSON, request_id) direkt
    // sichtbar beim Lernenden. Das ist ein Informationsleck (interne
    // Fehlerstruktur/Kontostand-Details werden Endnutzern gezeigt) und
    // inkonsistent mit dem Muster in search/page.tsx (dort bewusst eine
    // generische deutsche Meldung statt der rohen Exception). Fix: volle
    // Details nur noch serverseitig loggen, Nutzer bekommt eine generische,
    // nicht-technische deutsche Meldung.
    const messageText = e instanceof Error ? e.message : "Unbekannter Fehler beim Tutor-Aufruf.";
    console.error("[tutor/actions] askTutor fehlgeschlagen:", messageText);
    return {
      ok: false,
      reason: "error",
      message: "Der Tutor ist gerade nicht verfügbar. Bitte später erneut versuchen.",
    };
  }
}

/**
 * Leitet eine Konversation an alle aktiven Staff-Mitglieder (owner/admin/
 * trainer) des Mandanten weiter — Frontend-Button "An Trainer weiterleiten"
 * (SPEC §6, DoD §8). Siehe Dateikopf zur Schema-Abweichung (escalated liegt
 * auf tutor_messages, nicht tutor_conversations).
 */
export async function escalateToTrainer(conversationId: string): Promise<{ success: boolean; message: string }> {
  try {
    const parsedId = z.string().uuid().safeParse(conversationId);
    if (!parsedId.success) return { success: false, message: "Ungültige Konversation." };

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { success: false, message: "Nicht angemeldet." };

    const tenant = await getTenant();
    if (!tenant) return { success: false, message: "Kein Mandant zu diesem Host gefunden." };

    const allowedRate = await checkRateLimit("tutor-escalate", {
      maxRequests: 5,
      windowSeconds: 3600,
      extraKey: user.id,
    });
    if (!allowedRate) return { success: false, message: RATE_LIMIT_MESSAGE };

    // Konversation gehört nachweislich zum angemeldeten Nutzer + Mandant.
    const { data: conversation } = await supabase
      .from("tutor_conversations")
      .select("id, course_id")
      .eq("id", conversationId)
      .eq("tenant_id", tenant.id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!conversation) return { success: false, message: "Konversation nicht gefunden." };

    // SCHEMA-ABWEICHUNG (siehe Dateikopf): escalated liegt auf
    // tutor_messages, nicht tutor_conversations (Spalte existiert dort
    // nicht). tutor_messages hat außerdem keine UPDATE-Policy für
    // irgendeine Rolle (0001_init.sql) — Admin-Client zwingend nötig.
    const admin = createAdminClient();
    const { error: updateError } = await admin
      .from("tutor_messages")
      .update({ escalated: true })
      .eq("conversation_id", conversationId)
      .eq("tenant_id", tenant.id);
    if (updateError) {
      return { success: false, message: "Eskalation konnte nicht gespeichert werden." };
    }

    // Aktive Staff-Mitglieder (owner/admin/trainer) des Mandanten laden.
    const { data: staffMemberships } = await admin
      .from("memberships")
      .select("user_id")
      .eq("tenant_id", tenant.id)
      .eq("status", "active")
      .in("role", ["owner", "admin", "trainer"]);
    const staffUserIds = (staffMemberships ?? [])
      .map((m) => m.user_id)
      .filter((id): id is string => Boolean(id));

    let staffProfiles: { email: string; full_name: string | null }[] = [];
    if (staffUserIds.length > 0) {
      const { data: profiles } = await admin.from("profiles").select("email, full_name").in("id", staffUserIds);
      staffProfiles = profiles ?? [];
    }

    const { data: courseRow } = await admin
      .from("courses")
      .select("title")
      .eq("id", conversation.course_id)
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    const { data: learnerProfile } = await admin
      .from("profiles")
      .select("full_name, email")
      .eq("id", user.id)
      .maybeSingle();
    const learnerName = learnerProfile?.full_name?.trim() || learnerProfile?.email || "Ein Lernender";

    // Mail an jedes Staff-Mitglied — FAIL-SOFT (Vertrag email/client.ts): ein
    // Mailfehler darf die bereits gespeicherte Eskalation (escalated=true)
    // nicht rückgängig machen, nur geloggt.
    for (const staffProfile of staffProfiles) {
      const html = tutorEscalation({
        tenantName: tenant.name,
        recipientName: staffProfile.full_name ?? undefined,
        learnerName,
        courseTitle: courseRow?.title ?? "",
        conversationId,
        accentColor: tenant.branding.color_primary,
      });
      const mailResult = await sendEmail({
        to: staffProfile.email,
        subject: "Tutor-Frage an Trainer weitergeleitet",
        html,
        tenant: { name: tenant.name },
      });
      if (!mailResult.success) {
        console.error("[tutor/actions] Eskalationsmail fehlgeschlagen (fail-soft):", mailResult.error);
      }
    }

    return { success: true, message: "An den Trainer weitergeleitet." };
  } catch (e) {
    // Gleicher Fix wie in askTutor() oben: keine rohe Exception-Message an
    // die UI, nur serverseitig loggen.
    const messageText = e instanceof Error ? e.message : "Unbekannter Fehler.";
    console.error("[tutor/actions] escalateToTrainer fehlgeschlagen:", messageText);
    return { success: false, message: "Weiterleitung fehlgeschlagen. Bitte später erneut versuchen." };
  }
}
