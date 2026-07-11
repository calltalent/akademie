import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * DSGVO-Selbstauskunft/-Datenexport (Art. 15/20 DSGVO), Phase 4 Block 3.
 *
 * Sammelt alle personenbezogenen Daten EINES Nutzers über ALLE Mandanten
 * hinweg, bei denen er Mitglied ist — genau die Tabellen aus dem
 * Security-Review (Phase 1, Block 7) als DSGVO-relevant vorgemerkt:
 * profiles, memberships, progress, submissions, attempts, certificates,
 * orders, tutor_conversations, tutor_messages.
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
 */
export async function exportUserData(supabase: SupabaseClient, userId: string) {
  const [
    profileRes,
    membershipsRes,
    progressRes,
    submissionsRes,
    attemptsRes,
    certificatesRes,
    ordersRes,
    tutorConversationsRes,
  ] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    supabase.from("memberships").select("*").eq("user_id", userId),
    supabase.from("progress").select("*").eq("user_id", userId),
    supabase.from("submissions").select("*").eq("user_id", userId),
    supabase.from("attempts").select("*").eq("user_id", userId),
    supabase.from("certificates").select("*").eq("user_id", userId),
    supabase.from("orders").select("*").eq("user_id", userId),
    supabase.from("tutor_conversations").select("*").eq("user_id", userId),
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

  return {
    exported_at: new Date().toISOString(),
    profile: profileRes.data ?? null,
    memberships: membershipsRes.data ?? [],
    progress: progressRes.data ?? [],
    submissions: submissionsRes.data ?? [],
    attempts: attemptsRes.data ?? [],
    certificates: certificatesRes.data ?? [],
    orders: ordersRes.data ?? [],
    tutor_conversations: conversations,
    tutor_messages: tutorMessages,
  };
}
