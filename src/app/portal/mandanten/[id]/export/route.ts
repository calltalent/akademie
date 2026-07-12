import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import { genericErrorMessage } from "@/lib/errors/generic";

/**
 * GET /portal/mandanten/[id]/export — Mandanten-Gesamtexport für den
 * Betreiber (Art. 28 DSGVO, Verantwortlicher-Pflicht gegenüber dem
 * Mandanten als datenschutzrechtlich Verantwortlichem), Phase 4 Block 3.
 *
 * `requirePlatformAdmin()`-Gate zuerst (Session-Client-Prüfung gegen
 * `platform_admins`), danach ausschließlich `createAdminClient()`
 * (service_role) für jede mandanten-gebundene Tabelle — RLS würde
 * Platform-Admins (keine Mandanten-Mitglieder) ohnehin überall aussperren.
 *
 * ABWEICHUNG/ERGÄNZUNG gegenüber der im Auftrag genannten Tabellenliste
 * (dokumentiert, geprüft gegen `supabase/migrations/*.sql`, nicht nur gegen
 * `0001_init.sql`): zusätzlich zur Auftragsliste sind
 * - `bunny_videos` (Migration 20260710233815_bunny_videos_tenant_binding.sql,
 *   hat `tenant_id`) und
 * - `deletion_requests` (Migration 20260711222020_deletion_requests.sql,
 *   hat `tenant_id` UND ist selbst personenbezogene DSGVO-Daten des
 *   Mandanten — ausgerechnet in diesem Block einzuführen und dann aus dem
 *   Mandanten-Export auszulassen wäre inkonsequent)
 * mit aufgenommen. `rate_limits` (kein `tenant_id`, rein technischer
 * Zähler ohne Mandanten-/Personenbezug) und `platform_admins` (kein
 * `tenant_id`, plattformweite Rolle, keine Mandantendaten) bleiben bewusst
 * außen vor — beide wurden geprüft und haben keine `tenant_id`-Spalte.
 *
 * `profiles` hat keine `tenant_id`-Spalte: die betroffenen Nutzer-IDs
 * werden aus den bereits geladenen `memberships`-Zeilen gesammelt und per
 * `.in("id", …)` nachgeladen (wie im Auftrag vorgegeben).
 *
 * `embeddings`: explizite Spaltenliste OHNE die Vektorspalte `embedding`
 * (siehe PHASENSTATUS.md-Design-Entscheidung — abgeleiteter, aus
 * `lessons.content`/`transcript` regenerierbarer Inhalt, kein Primärdatum,
 * der reine Vektor ist ohnehin nicht sinnvoll lesbar).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user } = await requirePlatformAdmin();
    const { id } = await params;

    // BUGFIX (Security-Audit Block 7, 12.07.2026): 24 parallele
    // Tabellenabfragen ohne Rate-Limit — geringeres Risiko als beim
    // Selbst-Export (nur Platform-Admins haben Zugriff), aber als
    // Absicherung gegen einen kompromittierten Platform-Admin-Account und
    // zur Konsistenz mit jedem anderen kosten-/lastintensiven Endpunkt.
    if (
      !(await checkRateLimit("platform-tenant-export", {
        maxRequests: 20,
        windowSeconds: 3600,
        extraKey: user.id,
      }))
    ) {
      return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
    }

    const admin = createAdminClient();

    const { data: tenant, error: tenantError } = await admin
      .from("tenants")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (tenantError || !tenant) {
      return NextResponse.json({ error: "Mandant nicht gefunden." }, { status: 404 });
    }

    const [
      memberships,
      courses,
      modules,
      lessons,
      enrollments,
      progress,
      quizzes,
      questions,
      attempts,
      submissions,
      certificates,
      products,
      orders,
      subscriptions,
      aiJobs,
      embeddings,
      tutorConversations,
      tutorMessages,
      webhooks,
      webhookDeliveries,
      apiKeys,
      usageCounters,
      auditLog,
      bunnyVideos,
      deletionRequests,
    ] = await Promise.all([
      admin.from("memberships").select("*").eq("tenant_id", id),
      admin.from("courses").select("*").eq("tenant_id", id),
      admin.from("modules").select("*").eq("tenant_id", id),
      admin.from("lessons").select("*").eq("tenant_id", id),
      admin.from("enrollments").select("*").eq("tenant_id", id),
      admin.from("progress").select("*").eq("tenant_id", id),
      admin.from("quizzes").select("*").eq("tenant_id", id),
      admin.from("questions").select("*").eq("tenant_id", id),
      admin.from("attempts").select("*").eq("tenant_id", id),
      admin.from("submissions").select("*").eq("tenant_id", id),
      admin.from("certificates").select("*").eq("tenant_id", id),
      admin.from("products").select("*").eq("tenant_id", id),
      admin.from("orders").select("*").eq("tenant_id", id),
      admin.from("subscriptions").select("*").eq("tenant_id", id),
      admin.from("ai_jobs").select("*").eq("tenant_id", id),
      admin
        .from("embeddings")
        .select("id, tenant_id, course_id, lesson_id, chunk_index, content")
        .eq("tenant_id", id),
      admin.from("tutor_conversations").select("*").eq("tenant_id", id),
      admin.from("tutor_messages").select("*").eq("tenant_id", id),
      admin.from("webhooks").select("*").eq("tenant_id", id),
      admin.from("webhook_deliveries").select("*").eq("tenant_id", id),
      admin.from("api_keys").select("*").eq("tenant_id", id),
      admin.from("usage_counters").select("*").eq("tenant_id", id),
      admin.from("audit_log").select("*").eq("tenant_id", id),
      admin.from("bunny_videos").select("*").eq("tenant_id", id),
      admin.from("deletion_requests").select("*").eq("tenant_id", id),
    ]);

    const membershipRows = memberships.data ?? [];
    const profileIds = Array.from(
      new Set(
        membershipRows
          .map((m) => m.user_id as string | null)
          .filter((v): v is string => Boolean(v)),
      ),
    );

    let profileRows: unknown[] = [];
    if (profileIds.length > 0) {
      const { data } = await admin.from("profiles").select("*").in("id", profileIds);
      profileRows = data ?? [];
    }

    const payload = {
      exported_at: new Date().toISOString(),
      tenant,
      profiles: profileRows,
      memberships: membershipRows,
      courses: courses.data ?? [],
      modules: modules.data ?? [],
      lessons: lessons.data ?? [],
      enrollments: enrollments.data ?? [],
      progress: progress.data ?? [],
      quizzes: quizzes.data ?? [],
      questions: questions.data ?? [],
      attempts: attempts.data ?? [],
      submissions: submissions.data ?? [],
      certificates: certificates.data ?? [],
      products: products.data ?? [],
      orders: orders.data ?? [],
      subscriptions: subscriptions.data ?? [],
      ai_jobs: aiJobs.data ?? [],
      embeddings: embeddings.data ?? [],
      tutor_conversations: tutorConversations.data ?? [],
      tutor_messages: tutorMessages.data ?? [],
      webhooks: webhooks.data ?? [],
      webhook_deliveries: webhookDeliveries.data ?? [],
      api_keys: apiKeys.data ?? [],
      usage_counters: usageCounters.data ?? [],
      audit_log: auditLog.data ?? [],
      bunny_videos: bunnyVideos.data ?? [],
      deletion_requests: deletionRequests.data ?? [],
    };

    const filename = `mandant-${tenant.slug}-export.json`;

    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    // Status-Ermittlung braucht die ROHE Meldung von requirePlatformAdmin()
    // (feste Strings "Nicht angemeldet."/"...nur für..." aus platform/auth.ts)
    // — die an die UI zurückgegebene Meldung bleibt trotzdem generisch.
    const rawMessage = e instanceof Error ? e.message : "";
    const status =
      rawMessage.includes("Nicht angemeldet") || rawMessage.includes("nur für") ? 403 : 500;
    return NextResponse.json({ error: genericErrorMessage(e) }, { status });
  }
}
