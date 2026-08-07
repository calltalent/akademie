import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * DSGVO-Selbstauskunft/-Datenexport (Art. 15/20 DSGVO), Phase 4 Block 3.
 *
 * Sammelt alle personenbezogenen Daten EINES Nutzers über ALLE Mandanten
 * hinweg, bei denen er Mitglied ist — genau die Tabellen aus dem
 * Security-Review (Phase 1, Block 7) als DSGVO-relevant vorgemerkt:
 * profiles, memberships, progress, submissions, attempts, certificates,
 * orders, tutor_conversations, tutor_messages. Ergänzt (Marketplace-
 * Gesamtaudit, 04.08.2026, security-reviewer-Fund): enrollments — fehlte
 * hier seit Phase 4, wurde durch den Marketplace (Block M5) relevant, da ein
 * KOSTENLOSER Marketplace-Erwerb (src/lib/marketplace/acquire.ts) KEINE
 * orders-Zeile erzeugt; die enrollments-Zeile (source='marketplace') ist
 * dort der einzige Nachweis der Transaktion und muss deshalb Teil der
 * DSGVO-Selbstauskunft sein.
 *
 * WICHTIG (Sicherheitsregel, siehe PHASENSTATUS.md Block-3-Plan):
 * Diese Funktion prüft SELBST KEINE Berechtigung. `userId` MUSS vom
 * Aufrufer bereits aus einer serverseitig geprüften Session stammen
 * (`supabase.auth.getUser()`), NIEMALS aus Client-/URL-/Body-Parametern —
 * siehe src/app/profil/export/route.ts. `supabase` MUSS der Admin-Client
 * (service_role, `createAdminClient()`) sein, den der Aufrufer übergibt:
 * die Autorisierung ist zu diesem Zeitpunkt bereits durch die
 * Session-Prüfung des Aufrufers sichergestellt; RLS würde bei manchen
 * dieser Tabellen sonst inkonsistent/zu restriktiv filtern (z. B. hat
 * `tutor_messages` keine eigene "eigene Nachricht"-Select-Policy, nur
 * `tutor_msg_own_select` über den Umweg der Konversation).
 *
 * ABWEICHUNG vom wörtlichen architect-Plan (dokumentiert, technisch
 * zwingend): `tutor_messages` hat laut `0001_init.sql` (Zeilen 319-333)
 * KEINE `user_id`-Spalte — nur `tutor_conversations` hat `user_id`, die
 * Nachrichten hängen ausschließlich über `conversation_id` daran. Ein
 * direktes `.eq("user_id", userId)` auf `tutor_messages` ist technisch
 * nicht möglich. Stattdessen: zuerst die eigenen Konversations-IDs laden,
 * dann alle Nachrichten (Rolle "user" UND "assistant") dieser
 * Konversationen — das bildet den vollständigen eigenen Tutor-Chatverlauf
 * ab, exakt das, was der Nutzer nach Art. 15/20 DSGVO erwarten würde.
 *
 * Schichtplan-Nachzug (Block S2, 08.08.2026, SPEC.md §12): `calendar_workers`
 * hat KEINE direkte `user_id`-Filterung auf `calendar_shifts`/
 * `calendar_time_entries`/`calendar_absences` (die hängen an `worker_id`,
 * nicht an `user_id`) — gleiches Zwei-Schritt-Prinzip wie bei
 * `tutor_messages` oben: zuerst die eigenen Arbeiterzeilen (ein Nutzer kann
 * in mehreren Mandanten je eine Arbeiterzeile haben) laden, dann alle drei
 * Tabellen über `worker_id in (...)`. `calendar_absences` mit
 * `worker_id is null` (mandantenweite Feiertage) wird bewusst NICHT
 * aufgenommen — das sind keine personenbezogenen Daten dieses Nutzers.
 * `kind = 'sick'` ist ein Gesundheitsdatum (Art. 9 DSGVO), muss deshalb Teil
 * der Selbstauskunft sein, seit S2 real vorhanden — S1 hatte nur
 * `calendar_time_entries` (Ist-Zeiten, keine Gesundheitsdaten) hier bereits
 * angemahnt, aber noch nicht nachgezogen.
 *
 * Schichtplan-Nachzug (Block S3, 09.08.2026): `calendar_shift_change_requests`
 * hängt ebenfalls an `worker_id`, nicht an `user_id` — gleiches Zwei-
 * Schritt-Prinzip wie `calendar_shifts`/`calendar_time_entries`/
 * `calendar_absences` oben, über dieselben bereits geladenen
 * `calendarWorkerIds`.
 */
export async function exportUserData(supabase: SupabaseClient, userId: string) {
  const [
    profileRes,
    membershipsRes,
    enrollmentsRes,
    progressRes,
    submissionsRes,
    attemptsRes,
    certificatesRes,
    ordersRes,
    tutorConversationsRes,
    calendarWorkersRes,
  ] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    supabase.from("memberships").select("*").eq("user_id", userId),
    supabase.from("enrollments").select("*").eq("user_id", userId),
    supabase.from("progress").select("*").eq("user_id", userId),
    supabase.from("submissions").select("*").eq("user_id", userId),
    supabase.from("attempts").select("*").eq("user_id", userId),
    supabase.from("certificates").select("*").eq("user_id", userId),
    supabase.from("orders").select("*").eq("user_id", userId),
    supabase.from("tutor_conversations").select("*").eq("user_id", userId),
    supabase.from("calendar_workers").select("*").eq("user_id", userId),
  ]);

  const conversations = tutorConversationsRes.data ?? [];
  const conversationIds = conversations.map((c) => c.id as string);

  let tutorMessages: unknown[] = [];
  if (conversationIds.length > 0) {
    const { data } = await supabase
      .from("tutor_messages")
      .select("*")
      .in("conversation_id", conversationIds);
    tutorMessages = data ?? [];
  }

  const calendarWorkers = calendarWorkersRes.data ?? [];
  const calendarWorkerIds = calendarWorkers.map((w) => w.id as string);

  let calendarShifts: unknown[] = [];
  let calendarTimeEntries: unknown[] = [];
  let calendarAbsences: unknown[] = [];
  let calendarChangeRequests: unknown[] = [];
  if (calendarWorkerIds.length > 0) {
    const [shiftsRes, timeEntriesRes, absencesRes, changeRequestsRes] = await Promise.all([
      supabase.from("calendar_shifts").select("*").in("worker_id", calendarWorkerIds),
      supabase.from("calendar_time_entries").select("*").in("worker_id", calendarWorkerIds),
      supabase.from("calendar_absences").select("*").in("worker_id", calendarWorkerIds),
      supabase.from("calendar_shift_change_requests").select("*").in("worker_id", calendarWorkerIds),
    ]);
    calendarShifts = shiftsRes.data ?? [];
    calendarTimeEntries = timeEntriesRes.data ?? [];
    calendarAbsences = absencesRes.data ?? [];
    calendarChangeRequests = changeRequestsRes.data ?? [];
  }

  return {
    exported_at: new Date().toISOString(),
    profile: profileRes.data ?? null,
    memberships: membershipsRes.data ?? [],
    enrollments: enrollmentsRes.data ?? [],
    progress: progressRes.data ?? [],
    submissions: submissionsRes.data ?? [],
    attempts: attemptsRes.data ?? [],
    certificates: certificatesRes.data ?? [],
    orders: ordersRes.data ?? [],
    tutor_conversations: conversations,
    tutor_messages: tutorMessages,
    calendar_workers: calendarWorkers,
    calendar_shifts: calendarShifts,
    calendar_time_entries: calendarTimeEntries,
    calendar_absences: calendarAbsences,
    calendar_shift_change_requests: calendarChangeRequests,
  };
}
