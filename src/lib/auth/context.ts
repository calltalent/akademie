import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/**
 * Performance-Fix (19.07.2026, Josips Fund: Login/Löschen spürbar
 * langsam). `supabase.auth.getUser()` macht laut Supabase absichtlich
 * IMMER einen echten Netzwerk-Rundlauf zum Auth-Server (anders als das
 * schnellere, aber weniger sichere `getSession()`, das nur das Cookie
 * lokal liest) — pro Anfrage validiert middleware.ts das JWT damit bereits
 * EINMAL (Session-Refresh, siehe Kommentar in supabase/server.ts). Bisher
 * rief praktisch jede Seite zusätzlich noch ihr eigenes
 * `supabase.auth.getUser()` auf — bei `/admin/kurse` z. B. einmal in
 * `admin/layout.tsx` (`checkStaffAccess()`) UND ein zweites Mal in der
 * Seite selbst (`checkAdminAccess()`), macht mit middleware.ts insgesamt
 * DREI Netzwerk-Rundläufe für dieselbe, in derselben Anfrage ohnehin schon
 * gültige Sitzung.
 *
 * `cache()` (React, Next.js-Server-Component-Konvention wie bereits bei
 * `getTenant()` in tenant/context.ts) dedupliziert das INNERHALB einer
 * einzelnen Anfrage — Layout + Seite rufen `getAuthUser()` trotzdem beide
 * auf, der eigentliche `getUser()`-Netzwerkaufruf passiert aber nur einmal.
 * Sicherheitsrelevant unverändert: es wird weiterhin `getUser()`
 * aufgerufen (kein Zurückfallen auf `getSession()`/Cookie-Vertrauen), nur
 * eben nicht mehrfach pro Anfrage.
 */
export const getAuthUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
