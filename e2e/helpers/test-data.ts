import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Phase 4, Block 6 — gemeinsame Hilfsfunktionen für die vollständige
 * E2E-Suite (global-setup.ts, global-teardown.ts, alle e2e/*.spec.ts).
 *
 * DOKUMENTIERTE ABWEICHUNG vom architect-Plan-Wortlaut ("Service-Role-
 * Admin-Client, Muster src/lib/supabase/admin.ts"): Playwright führt diese
 * Datei außerhalb von Next.js' Build-/Bundler-Kontext in einem reinen
 * Node-Prozess aus. `src/lib/supabase/admin.ts` beginnt mit
 * `import "server-only"` — das Paket "server-only" ist aber KEINE echte
 * npm-Dependency in node_modules, sondern wird ausschließlich über Next.js'
 * eigenen Bundler-Alias (webpack/Turbopack) aufgelöst. Ein direkter Import
 * dieser Datei aus einem Playwright-Testprozess würde deshalb sofort mit
 * einem "Module not found"-Fehler abbrechen. Diese Datei baut denselben
 * Client (service_role, kein Auto-Refresh/keine Session-Persistenz)
 * deshalb eigenständig nach, siehe PHASENSTATUS.md Block 6.
 */
export function createE2eAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY fehlen (.env prüfen, siehe .env.example) — die E2E-Suite braucht einen Service-Role-Zugriff.",
    );
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export const DEMO_TENANT_SLUG = "demo-blau";
export const DEMO_TENANT_HOST = `${DEMO_TENANT_SLUG}.localhost:3000`;
export const DEMO_TENANT_URL = `http://${DEMO_TENANT_HOST}`;

/** Absolute URL auf demo-blau — baseURL in playwright.config.ts bleibt bewusst http://localhost:3000 (siehe Kommentar dort), Mandanten-Seiten brauchen die absolute Subdomain-URL. */
export function tenantUrl(path: string): string {
  return `${DEMO_TENANT_URL}${path}`;
}

/** Präfix für JEDE von der E2E-Suite angelegte Zeile (Kurs-Slug, Produkt-Slug, Test-E-Mail) — global-teardown.ts erkennt daran, was aufzuräumen ist. */
export const E2E_PREFIX = "e2e-";

let cachedTenantId: string | null = null;

export async function getDemoTenantId(admin: SupabaseClient): Promise<string> {
  if (cachedTenantId) return cachedTenantId;
  const { data, error } = await admin
    .from("tenants")
    .select("id")
    .eq("slug", DEMO_TENANT_SLUG)
    .maybeSingle();
  if (error || !data) {
    throw new Error(
      `Mandant "${DEMO_TENANT_SLUG}" nicht gefunden — Voraussetzung für die E2E-Suite (siehe PHASENSTATUS.md Block 6).`,
    );
  }
  cachedTenantId = data.id as string;
  return cachedTenantId;
}

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

/** Gültiger Slug (^[a-z0-9]+(-[a-z0-9]+)*$) MIT e2e-Präfix — für Teardown-Erkennung. */
export function e2eSlug(base: string): string {
  const cleanBase = base
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${E2E_PREFIX}${cleanBase}-${uniqueSuffix()}`;
}

// -------------------------------------------------------------
// Block-Helfer — kleine, eigenständige Kopie der Block-Form aus
// src/lib/courses/schema.ts (bewusst KEIN Import von dort: obwohl diese
// eine Datei kein "server-only" enthält, bleiben die E2E-Helfer damit
// vollständig unabhängig von der App-internen Modulauflösung/den
// TS-Pfad-Aliasen, die Playwright nicht garantiert genauso auflöst wie
// Next.js' eigener Compiler).
// -------------------------------------------------------------

export type TestBlock = Record<string, unknown> & { id: string; type: string };

export function textBlock(html: string): TestBlock {
  return { id: randomUUID(), type: "text", html };
}

export function quizBlock(quizId: string, title: string): TestBlock {
  return { id: randomUUID(), type: "quiz", quizId, title };
}

export function submissionBlock(instructions: string): TestBlock {
  return { id: randomUUID(), type: "submission", instructions };
}

// -------------------------------------------------------------
// Testdaten-Anlage — direkt per Service-Role-Client (schneller/robuster als
// der komplette Admin-Editor-UI-Flow für jedes Setup, siehe
// PHASENSTATUS.md Block 6; die eigentliche Prüfhandlung jedes Specs läuft
// trotzdem echt über die jeweilige UI).
// -------------------------------------------------------------

export async function createPublishedCourse(
  admin: SupabaseClient,
  tenantId: string,
  titleBase: string,
): Promise<{ id: string; slug: string; title: string }> {
  const slug = e2eSlug(titleBase);
  const title = `E2E ${titleBase}`;
  const { data, error } = await admin
    .from("courses")
    .insert({ tenant_id: tenantId, title, slug, status: "published" })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Testkurs "${title}" konnte nicht angelegt werden: ${error?.message}`);
  }
  return { id: data.id as string, slug, title };
}

export async function createTestModule(
  admin: SupabaseClient,
  tenantId: string,
  courseId: string,
  title = "Modul 1",
  position = 0,
): Promise<string> {
  const { data, error } = await admin
    .from("modules")
    .insert({ tenant_id: tenantId, course_id: courseId, title, position })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Testmodul konnte nicht angelegt werden: ${error?.message}`);
  }
  return data.id as string;
}

export async function createTestLesson(
  admin: SupabaseClient,
  tenantId: string,
  moduleId: string,
  params: {
    title: string;
    blocks?: TestBlock[];
    status?: "draft" | "published";
    position?: number;
  },
): Promise<string> {
  const { data, error } = await admin
    .from("lessons")
    .insert({
      tenant_id: tenantId,
      module_id: moduleId,
      title: params.title,
      blocks: params.blocks ?? [],
      status: params.status ?? "published",
      position: params.position ?? 0,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Testlektion "${params.title}" konnte nicht angelegt werden: ${error?.message}`);
  }
  return data.id as string;
}

export async function createTestQuiz(
  admin: SupabaseClient,
  tenantId: string,
  courseId: string,
  title: string,
  passPct = 70,
): Promise<string> {
  const { data, error } = await admin
    .from("quizzes")
    .insert({
      tenant_id: tenantId,
      course_id: courseId,
      title,
      kind: "quiz",
      pass_pct: passPct,
      settings: {},
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Test-Quiz "${title}" konnte nicht angelegt werden: ${error?.message}`);
  }
  return data.id as string;
}

/**
 * EIN `multi`-Fragetyp (Mehrfachauswahl) mit genau einer richtigen Option
 * reicht laut architect-Plan (PHASENSTATUS.md Block 6) für den
 * Quiz-Versuch-Test.
 */
export async function createMultiChoiceQuestion(
  admin: SupabaseClient,
  tenantId: string,
  quizId: string,
  params: { prompt: string; correctText: string; wrongText: string },
): Promise<{ correctOptionId: string; wrongOptionId: string }> {
  const correctOptionId = randomUUID();
  const wrongOptionId = randomUUID();
  const { error } = await admin.from("questions").insert({
    tenant_id: tenantId,
    quiz_id: quizId,
    position: 0,
    kind: "multi",
    prompt: params.prompt,
    options: [
      { id: correctOptionId, text: params.correctText },
      { id: wrongOptionId, text: params.wrongText },
    ],
    answer: { correctOptionIds: [correctOptionId] },
    points: 1,
  });
  if (error) {
    throw new Error(`Testfrage konnte nicht angelegt werden: ${error.message}`);
  }
  return { correctOptionId, wrongOptionId };
}

// -------------------------------------------------------------
// Aufräumen (global-teardown.ts)
// -------------------------------------------------------------

/**
 * Löscht alle während eines E2E-Laufs angelegten Mandanten-Zeilen mit
 * `e2e-`-Präfix. Kurse kaskadieren automatisch modules/lessons/quizzes/
 * questions/enrollments/progress/certificates/submissions/attempts
 * (`on delete cascade`, siehe supabase/migrations/0001_init.sql).
 * `orders.product_id` ist NICHT kaskadierend (`on delete set null`) —
 * betroffene Bestellungen werden deshalb vor dem Produkt explizit gelöscht.
 *
 * Der vom Kurs-Generator-Test erzeugte Kurs (course-generator.spec.ts)
 * räumt sich bewusst SELBST auf (courseId direkt bekannt) statt sich auf
 * dieses Slug-Präfix-Muster zu verlassen — sein Slug hängt vom
 * KI-generierten Titel ab und trägt deshalb nicht zuverlässig das
 * `e2e-`-Präfix (dokumentierte Abweichung, siehe PHASENSTATUS.md Block 6).
 */
export async function cleanupE2eTenantData(admin: SupabaseClient, tenantId: string): Promise<void> {
  const { data: products } = await admin
    .from("products")
    .select("id")
    .eq("tenant_id", tenantId)
    .ilike("slug", `${E2E_PREFIX}%`);
  const productIds = (products ?? []).map((p) => p.id as string);
  if (productIds.length > 0) {
    await admin.from("orders").delete().in("product_id", productIds);
    await admin.from("products").delete().in("id", productIds);
  }

  await admin.from("courses").delete().eq("tenant_id", tenantId).ilike("slug", `${E2E_PREFIX}%`);
}

/** Löscht alle Auth-Nutzer mit `e2e-`-Präfix im E-Mail-Lokalteil AUSSER den übergebenen (die beiden persistenten Test-Accounts). auth.users -> profiles -> memberships kaskadiert automatisch (FK `on delete cascade`). */
export async function cleanupE2eUsers(admin: SupabaseClient, keepEmails: string[]): Promise<void> {
  const keep = new Set(keepEmails.map((e) => e.toLowerCase()));
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const toDelete = (data?.users ?? []).filter(
    (u) => u.email?.toLowerCase().startsWith(E2E_PREFIX) && !keep.has(u.email.toLowerCase()),
  );
  for (const user of toDelete) {
    await admin.auth.admin.deleteUser(user.id);
  }
}
