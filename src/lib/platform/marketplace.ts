"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/platform/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { platformReviewNoteSchema, payoutReferenceSchema } from "@/lib/platform/schema";
import { translateDbError } from "@/lib/errors/db";
import { genericErrorMessage } from "@/lib/errors/generic";

/**
 * Betreiber-Portal-Moderation für `marketplace_listings` (Marketplace M3,
 * Plan "ich-möchte-einen-eigenen-groovy-toast.md" Abschnitt 7). Jede
 * Funktion beginnt mit `requirePlatformAdmin()` — ein Platform-Admin ist
 * KEIN Mandanten-Mitglied und hätte über die reguläre RLS auf
 * `marketplace_listings` (`ml_staff_*`-Policies,
 * 20260803100100_marketplace_listings.sql) ohnehin keinen Zugriff auf
 * fremde Zeilen. Alle eigentlichen Queries laufen deshalb über
 * `createAdminClient()` (service_role, umgeht RLS) — exakt das Muster aus
 * `src/lib/platform/actions.ts` (siehe dortiger Kopfkommentar).
 *
 * `status` wird ausschließlich hier auf 'approved'/'rejected'/'suspended'
 * gesetzt — das ist laut `ml_staff_update`s `with check`-Klausel der EINZIGE
 * Ort im System, an dem das technisch möglich ist (Mandanten-Staff kann
 * `status` nie selbst über diese Werte hinaus setzen, siehe Migrations-
 * Kommentar). `approveListing`/`rejectListing` erlauben nur den Übergang aus
 * 'submitted', `suspendListing` nur aus 'approved' — Anwendungsregeln
 * zusätzlich zur (großzügigeren) RLS, mit klarer deutscher Fehlermeldung
 * statt eines rohen Datenbankfehlers.
 *
 * ABWEICHUNG vom Funktionsnamen `updateCommissionRate(tenantId, rateBp)` aus
 * dem ursprünglichen Plan (Abschnitt 7-Tabelle) — dokumentiert in
 * PHASENSTATUS.md: der Provisionssatz je Mandant wird stattdessen als Teil
 * von `updateTenantFeatures()` (`src/lib/platform/actions.ts`) geschrieben,
 * zusammen mit `marketplace_enabled` im selben Formular/derselben
 * Merge-Patch-Operation auf `tenants.settings` — eine zweite, unabhängige
 * Schreibfunktion auf dasselbe JSONB-Feld hätte nur Race-Potenzial und
 * Code-Duplikation gebracht, ohne einen eigenen Nutzen zu haben.
 */

export type MarketplaceModerationState = { error: string | null; success?: boolean };

function errorState(e: unknown): MarketplaceModerationState {
  return { error: genericErrorMessage(e) };
}

const PENDING_QUEUE_PATH = "/portal/marketplace";

function reviewDetailPath(listingId: string): string {
  return `/portal/marketplace/${listingId}`;
}

export type PendingListingRow = {
  id: string;
  publicSlug: string;
  headline: string | null;
  priceCents: number;
  currency: string;
  submittedAt: string | null;
  courseTitle: string;
  tenantName: string;
};

/**
 * Prüf-Warteschlange: alle `status='submitted'`-Listings, älteste zuerst
 * (Plan Abschnitt 7). Zwei Zusatzabfragen für Kurstitel/Mandantenname statt
 * eines PostgREST-Embeds (`courses(title), tenants(name)`) — im restlichen
 * Projekt (z. B. `admin/marketplace/page.tsx`) werden Titel-Zuordnungen
 * ebenfalls über separate Abfragen + `Map` aufgelöst, kein Embed-Muster
 * bislang etabliert.
 */
export async function listPendingListings(): Promise<PendingListingRow[]> {
  await requirePlatformAdmin();
  const admin = createAdminClient();

  const { data: listings } = await admin
    .from("marketplace_listings")
    .select("id, public_slug, headline, price_cents, currency, submitted_at, course_id, tenant_id")
    .eq("status", "submitted")
    .order("submitted_at", { ascending: true });

  const rows = listings ?? [];
  if (rows.length === 0) return [];

  const courseIds = [...new Set(rows.map((r) => r.course_id))];
  const tenantIds = [...new Set(rows.map((r) => r.tenant_id))];

  const [{ data: courses }, { data: tenants }] = await Promise.all([
    admin.from("courses").select("id, title").in("id", courseIds),
    admin.from("tenants").select("id, name").in("id", tenantIds),
  ]);
  const courseTitleById = new Map((courses ?? []).map((c) => [c.id, c.title]));
  const tenantNameById = new Map((tenants ?? []).map((t) => [t.id, t.name]));

  return rows.map((r) => ({
    id: r.id,
    publicSlug: r.public_slug,
    headline: r.headline,
    priceCents: r.price_cents,
    currency: r.currency,
    submittedAt: r.submitted_at,
    courseTitle: courseTitleById.get(r.course_id) ?? "Unbekannter Kurs",
    tenantName: tenantNameById.get(r.tenant_id) ?? "Unbekannter Mandant",
  }));
}

export type ListingReviewDetail = {
  id: string;
  status: "draft" | "submitted" | "approved" | "rejected" | "suspended";
  publicSlug: string;
  headline: string | null;
  summary: string | null;
  coverUrl: string | null;
  priceCents: number;
  currency: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  tenantId: string;
  tenantName: string;
  courseId: string;
  courseTitle: string;
  moduleCount: number;
  lessonCount: number;
  /** Aktuell wirksamer Provisionssatz in Basispunkten — mandantenspezifisch
   * (`tenants.settings.marketplace_commission_bp`), sonst der globale
   * Standardsatz aus `platform_settings.commission_rate_bp`. */
  commissionRateBp: number;
};

/**
 * Detaildaten für die Prüfansicht (Plan Abschnitt 7). Kursstruktur bewusst
 * nur als Zahlen (Modul-/Lektionsanzahl) statt der vollen Blockstruktur —
 * für eine Freigabe-Entscheidung reicht der Umfang, nicht der Inhalt jeder
 * einzelnen Lektion. `lessons` hat kein direktes `course_id` (nur
 * `module_id`, siehe 0001_init.sql Zeile 111-114) — deshalb zweistufig: erst
 * Modul-IDs des Kurses, dann Lektionen dieser Module zählen.
 */
export async function getListingForReview(listingId: string): Promise<ListingReviewDetail | null> {
  await requirePlatformAdmin();
  const admin = createAdminClient();

  const { data: listing } = await admin
    .from("marketplace_listings")
    .select(
      "id, tenant_id, course_id, public_slug, headline, summary, cover_url, price_cents, currency, status, submitted_at, reviewed_at, review_note",
    )
    .eq("id", listingId)
    .maybeSingle();
  if (!listing) return null;

  const [{ data: course }, { data: tenant }, { data: modules }, { data: platformSettings }] = await Promise.all([
    admin.from("courses").select("title").eq("id", listing.course_id).maybeSingle(),
    admin.from("tenants").select("name, settings").eq("id", listing.tenant_id).maybeSingle(),
    admin.from("modules").select("id").eq("course_id", listing.course_id),
    admin.from("platform_settings").select("commission_rate_bp").eq("id", true).maybeSingle(),
  ]);

  const moduleIds = (modules ?? []).map((m) => m.id);
  let lessonCount = 0;
  if (moduleIds.length > 0) {
    const { count } = await admin
      .from("lessons")
      .select("id", { count: "exact", head: true })
      .in("module_id", moduleIds);
    lessonCount = count ?? 0;
  }

  const tenantSettings = (tenant?.settings ?? {}) as { marketplace_commission_bp?: number };
  const commissionRateBp = tenantSettings.marketplace_commission_bp ?? platformSettings?.commission_rate_bp ?? 2000;

  return {
    id: listing.id,
    status: listing.status as ListingReviewDetail["status"],
    publicSlug: listing.public_slug,
    headline: listing.headline,
    summary: listing.summary,
    coverUrl: listing.cover_url,
    priceCents: listing.price_cents,
    currency: listing.currency,
    submittedAt: listing.submitted_at,
    reviewedAt: listing.reviewed_at,
    reviewNote: listing.review_note,
    tenantId: listing.tenant_id,
    tenantName: tenant?.name ?? "Unbekannter Mandant",
    courseId: listing.course_id,
    courseTitle: course?.title ?? "Unbekannter Kurs",
    moduleCount: moduleIds.length,
    lessonCount,
    commissionRateBp,
  };
}

export async function approveListing(listingId: string): Promise<MarketplaceModerationState> {
  try {
    const { user } = await requirePlatformAdmin();
    const admin = createAdminClient();

    const { data: existing } = await admin
      .from("marketplace_listings")
      .select("id, status")
      .eq("id", listingId)
      .maybeSingle();
    if (!existing) {
      return { error: "Listing nicht gefunden." };
    }
    if (existing.status !== "submitted") {
      return { error: "Nur eingereichte Listings können freigegeben werden." };
    }

    // Compare-and-swap gegen Race Conditions (security-reviewer-Fund,
    // 03.08.2026, MITTEL): die vorherige Fassung prüfte status nur per
    // separatem SELECT vor dem UPDATE — zwei nahezu gleichzeitige Aufrufe
    // (z. B. zwei Admin-Tabs, Freigeben+Ablehnen im selben Moment) konnten
    // beide die Vorprüfung mit dem alten Status bestehen, "last write wins"
    // ohne Fehlermeldung. Die status-Bedingung jetzt direkt im UPDATE selbst
    // (atomar) statt nur davor — betrifft die Anweisung 0 Zeilen, wenn der
    // Status inzwischen von einem anderen Aufruf geändert wurde.
    const { data: updated, error } = await admin
      .from("marketplace_listings")
      .update({
        status: "approved",
        reviewed_at: new Date().toISOString(),
        reviewed_by: user.id,
        review_note: null,
      })
      .eq("id", listingId)
      .eq("status", "submitted")
      .select("id")
      .maybeSingle();
    if (error) {
      return { error: "Freigeben fehlgeschlagen: " + translateDbError(error) };
    }
    if (!updated) {
      return { error: "Dieses Listing wurde zwischenzeitlich bereits bearbeitet." };
    }

    revalidatePath(PENDING_QUEUE_PATH);
    revalidatePath(reviewDetailPath(listingId));
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

export async function rejectListing(listingId: string, reviewNote: string): Promise<MarketplaceModerationState> {
  try {
    const { user } = await requirePlatformAdmin();

    const parsedNote = platformReviewNoteSchema.safeParse(reviewNote);
    if (!parsedNote.success) {
      return { error: parsedNote.error.issues[0]?.message ?? "Ungültige Begründung." };
    }

    const admin = createAdminClient();
    const { data: existing } = await admin
      .from("marketplace_listings")
      .select("id, status")
      .eq("id", listingId)
      .maybeSingle();
    if (!existing) {
      return { error: "Listing nicht gefunden." };
    }
    if (existing.status !== "submitted") {
      return { error: "Nur eingereichte Listings können abgelehnt werden." };
    }

    // Compare-and-swap gegen Race Conditions, siehe Kommentar in
    // approveListing() oben (gleicher security-reviewer-Fund).
    const { data: updated, error } = await admin
      .from("marketplace_listings")
      .update({
        status: "rejected",
        reviewed_at: new Date().toISOString(),
        reviewed_by: user.id,
        review_note: parsedNote.data,
      })
      .eq("id", listingId)
      .eq("status", "submitted")
      .select("id")
      .maybeSingle();
    if (error) {
      return { error: "Ablehnen fehlgeschlagen: " + translateDbError(error) };
    }
    if (!updated) {
      return { error: "Dieses Listing wurde zwischenzeitlich bereits bearbeitet." };
    }

    revalidatePath(PENDING_QUEUE_PATH);
    revalidatePath(reviewDetailPath(listingId));
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

/**
 * Sperrt ein bereits freigegebenes Listing (z. B. bei nachträglich
 * entdeckten Problemen) — nur aus `status='approved'` erlaubt. Begründung
 * PFLICHT (Design-Entscheidung, siehe Kopfkommentar `platformReviewNoteSchema`
 * in schema.ts): der Plan nennt das für `suspendListing` nicht ausdrücklich
 * als Pflicht, eine begründungslose Sperre eines bereits laufenden,
 * öffentlichen Listings wäre für den betroffenen Mandanten aber
 * intransparent — dieselbe Konsequenz wie bei `rejectListing`, also
 * dieselbe Pflicht.
 */
export async function suspendListing(listingId: string, reviewNote: string): Promise<MarketplaceModerationState> {
  try {
    const { user } = await requirePlatformAdmin();

    const parsedNote = platformReviewNoteSchema.safeParse(reviewNote);
    if (!parsedNote.success) {
      return { error: parsedNote.error.issues[0]?.message ?? "Ungültige Begründung." };
    }

    const admin = createAdminClient();
    const { data: existing } = await admin
      .from("marketplace_listings")
      .select("id, status")
      .eq("id", listingId)
      .maybeSingle();
    if (!existing) {
      return { error: "Listing nicht gefunden." };
    }
    if (existing.status !== "approved") {
      return { error: "Nur freigegebene Listings können gesperrt werden." };
    }

    // Compare-and-swap gegen Race Conditions, siehe Kommentar in
    // approveListing() oben (gleicher security-reviewer-Fund).
    const { data: updated, error } = await admin
      .from("marketplace_listings")
      .update({
        status: "suspended",
        reviewed_at: new Date().toISOString(),
        reviewed_by: user.id,
        review_note: parsedNote.data,
      })
      .eq("id", listingId)
      .eq("status", "approved")
      .select("id")
      .maybeSingle();
    if (error) {
      return { error: "Sperren fehlgeschlagen: " + translateDbError(error) };
    }
    if (!updated) {
      return { error: "Dieses Listing wurde zwischenzeitlich bereits bearbeitet." };
    }

    revalidatePath(PENDING_QUEUE_PATH);
    revalidatePath(reviewDetailPath(listingId));
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}

/**
 * Auszahlungen (Marketplace M6, Plan Abschnitt 7 "Betreiber-Portal", die
 * Auszahlungs-Zeilen, die in M3 bewusst ausgelassen wurden). Liest
 * `marketplace_ledger` (kein Client-RLS, siehe Kopfkommentar von
 * `20260803100200_marketplace_ledger.sql` — nur `service_role`/
 * `requirePlatformAdmin()`, exakt dasselbe Muster wie
 * `listPendingListings()`/`getListingForReview()` oben).
 */

const PAYOUTS_PATH = "/portal/marketplace/auszahlungen";

export type PayoutFilter = { tenantId?: string; from?: string; to?: string };

export type PayoutRow = {
  id: string;
  tenantId: string;
  tenantName: string;
  orderId: string;
  createdAt: string;
  grossCents: number;
  commissionRateBp: number;
  commissionCents: number;
  netCents: number;
  currency: string;
  payoutStatus: "open" | "paid" | "cancelled";
  payoutReference: string | null;
};

export type PayoutTenantSummary = {
  tenantId: string;
  tenantName: string;
  /** Nur zur Anzeige gebündelt mit `currency` — siehe Design-Entscheidung
   * unten (mehrere Währungen je Mandant sind theoretisch möglich, `orders`
   * hat keine Mandanten-weite Einheitswährung erzwungen). */
  currency: string;
  openNetCents: number;
  paidNetCents: number;
};

/**
 * Liefert Ledger-Zeilen für die Auszahlungs-Ansicht + ihren CSV-Export,
 * optional gefiltert nach Mandant/Zeitraum. Zwei Zusatzabfragen für den
 * Mandantennamen statt eines PostgREST-Embeds — gleiches Muster wie
 * `listPendingListings()` oben (im ganzen Portal-Bereich kein
 * Embed-Muster etabliert).
 *
 * DESIGN-ENTSCHEIDUNG (Auftrag: "entscheide selbst, ob das eine zweite
 * Funktion `getPayoutSummaryByTenant()` wird oder mitgeliefert wird"):
 * die aggregierten Summen werden als zweites Rückgabefeld
 * (`summaryByTenant`) MITGELIEFERT statt einer eigenen Funktion. Eine
 * zweite Funktion hätte entweder dieselben gefilterten Ledger-Zeilen ein
 * zweites Mal aus der DB geladen (unnötige Zusatzlast bei jedem
 * Seitenaufruf, da die Portal-Seite beides gleichzeitig braucht) oder die
 * Filterlogik duplizieren müssen. Die Aggregation selbst passiert in
 * TypeScript über die bereits geladenen Zeilen (kein SQL `group by` nötig
 * für die hier erwarteten Datenmengen).
 *
 * `currency` bleibt Teil des Aggregationsschlüssels (`tenantId:currency`)
 * statt eines einzelnen Summenfelds je Mandant — `marketplace_ledger.currency`
 * hat keine Mandanten-weite Einheitswährungs-Regel (jede Zeile trägt ihre
 * eigene Währung, kopiert von der jeweiligen Bestellung), ein blindes aufaddieren
 * über mögliche Währungen hinweg wäre schlicht falsch.
 *
 * `filter.from`/`filter.to` sind reine Datumsstrings (JJJJ-MM-TT, siehe
 * `payoutFilterQuerySchema`). `to` wird hier auf das Tagesende (23:59:59.999)
 * erweitert, damit der gewählte Endtag selbst noch mitgezählt wird — ein
 * einfaches `.lte("created_at", "2026-08-04")` würde sonst faktisch
 * Mitternacht dieses Tages als Grenze nehmen und den ganzen Tag ausschließen.
 */
export async function getPayoutRows(
  filter: PayoutFilter = {},
): Promise<{ rows: PayoutRow[]; summaryByTenant: PayoutTenantSummary[] }> {
  await requirePlatformAdmin();
  const admin = createAdminClient();

  let query = admin
    .from("marketplace_ledger")
    .select(
      "id, tenant_id, order_id, gross_cents, commission_rate_bp, commission_cents, net_cents, currency, payout_status, payout_reference, created_at",
    )
    .order("created_at", { ascending: false });

  if (filter.tenantId) query = query.eq("tenant_id", filter.tenantId);
  if (filter.from) query = query.gte("created_at", `${filter.from}T00:00:00.000Z`);
  if (filter.to) query = query.lte("created_at", `${filter.to}T23:59:59.999Z`);

  const { data: ledgerRows } = await query;
  const rows = ledgerRows ?? [];

  const tenantIds = [...new Set(rows.map((r) => r.tenant_id))];
  const tenantNameById = new Map<string, string>();
  if (tenantIds.length > 0) {
    const { data: tenants } = await admin.from("tenants").select("id, name").in("id", tenantIds);
    for (const t of tenants ?? []) tenantNameById.set(t.id, t.name);
  }

  const payoutRows: PayoutRow[] = rows.map((r) => ({
    id: r.id,
    tenantId: r.tenant_id,
    tenantName: tenantNameById.get(r.tenant_id) ?? "Unbekannter Mandant",
    orderId: r.order_id,
    createdAt: r.created_at,
    grossCents: r.gross_cents,
    commissionRateBp: r.commission_rate_bp,
    commissionCents: r.commission_cents,
    netCents: r.net_cents,
    currency: r.currency,
    payoutStatus: r.payout_status as PayoutRow["payoutStatus"],
    payoutReference: r.payout_reference,
  }));

  const summaryMap = new Map<string, PayoutTenantSummary>();
  for (const row of payoutRows) {
    const key = `${row.tenantId}:${row.currency}`;
    const bucket =
      summaryMap.get(key) ??
      ({
        tenantId: row.tenantId,
        tenantName: row.tenantName,
        currency: row.currency,
        openNetCents: 0,
        paidNetCents: 0,
      } satisfies PayoutTenantSummary);
    if (row.payoutStatus === "open") bucket.openNetCents += row.netCents;
    else if (row.payoutStatus === "paid") bucket.paidNetCents += row.netCents;
    summaryMap.set(key, bucket);
  }

  return {
    rows: payoutRows,
    summaryByTenant: [...summaryMap.values()].sort((a, b) => a.tenantName.localeCompare(b.tenantName)),
  };
}

export type TenantOption = { id: string; name: string };

/** Mandanten-Dropdown für den Auszahlungs-Filter — alle Mandanten, nicht nur
 * solche mit bereits vorhandenen Ledger-Zeilen (ein Mandant ohne bisherige
 * Verkäufe soll trotzdem wählbar sein, liefert dann nur eine leere Liste). */
export async function listTenantsForPayoutFilter(): Promise<TenantOption[]> {
  await requirePlatformAdmin();
  const admin = createAdminClient();
  const { data } = await admin.from("tenants").select("id, name").order("name", { ascending: true });
  return data ?? [];
}

/**
 * Markiert Ledger-Zeilen als ausgezahlt (manuelle Überweisung, Plan
 * Abschnitt 7). Batch-fähig — ein Mandant/Zeitraum kann mehrere
 * Ledger-Zeilen umfassen, sollen aber in einer Buchung/Überweisung
 * zusammengefasst werden.
 *
 * COMPARE-AND-SWAP (Auftrag: "gleiches Muster wie approveListing/
 * rejectListing/suspendListing, nicht den alten Fehler wiederholen"): die
 * `payout_status='open'`-Bedingung sitzt DIREKT im `update()`-Aufruf selbst
 * (`.eq("payout_status", "open")` unmittelbar vor `.select()`), nicht nur in
 * einer vorgelagerten SELECT-Prüfung. Das UPDATE-Statement ist damit atomar:
 * jede Zeile, die zwischen einer möglichen Vorprüfung und diesem Aufruf von
 * einem anderen gleichzeitigen Aufruf bereits auf 'paid'/'cancelled' gesetzt
 * wurde, wird von DIESEM Aufruf einfach nicht mehr getroffen (0 betroffene
 * Zeilen für sie), statt sie ein zweites Mal (mit einer neuen `paid_at`/
 * `payout_reference`) zu überschreiben. Es gibt bewusst KEINE vorgelagerte
 * SELECT-Prüfung wie bei `approveListing()` (dort existiert sie zusätzlich
 * nur für eine bessere Fehlermeldung bei einer EINZELNEN Zeile) — bei einem
 * Batch aus potenziell vielen IDs wäre eine Vorab-SELECT-Prüfung ohnehin nur
 * eine weitere Momentaufnahme, die durch die Zeit bis zum eigentlichen
 * UPDATE genauso veralten könnte; das atomare UPDATE selbst ist hier die
 * einzige verlässliche Prüfung.
 *
 * Trifft ein Aufruf auf einen GEMISCHTEN Batch (manche Zeilen noch offen,
 * manche bereits bezahlt/storniert), werden nur die noch offenen
 * aktualisiert — kein Fehler, solange mindestens eine Zeile betroffen war.
 * Das entspricht demselben "wer zuerst kommt"-Prinzip wie bei den
 * Listing-Aktionen, nur auf Zeilenebene statt auf Formular-Ebene.
 */
export async function markPayoutPaid(
  ledgerIds: string[],
  payoutReference: string,
): Promise<MarketplaceModerationState> {
  try {
    await requirePlatformAdmin();

    if (!Array.isArray(ledgerIds) || ledgerIds.length === 0) {
      return { error: "Keine Zeilen ausgewählt." };
    }

    const parsedReference = payoutReferenceSchema.safeParse(payoutReference);
    if (!parsedReference.success) {
      return { error: parsedReference.error.issues[0]?.message ?? "Ungültige Auszahlungsreferenz." };
    }

    const admin = createAdminClient();

    // Compare-and-swap gegen Race Conditions, siehe Kopfkommentar oben
    // (gleicher security-reviewer-Fund wie approveListing/rejectListing/
    // suspendListing).
    const { data: updated, error } = await admin
      .from("marketplace_ledger")
      .update({
        payout_status: "paid",
        paid_at: new Date().toISOString(),
        payout_reference: parsedReference.data,
      })
      .in("id", ledgerIds)
      .eq("payout_status", "open")
      .select("id");

    if (error) {
      return { error: "Als ausgezahlt markieren fehlgeschlagen: " + translateDbError(error) };
    }
    if (!updated || updated.length === 0) {
      return { error: "Keine der ausgewählten Zeilen war noch offen — vermutlich bereits bearbeitet." };
    }

    revalidatePath(PAYOUTS_PATH);
    return { error: null, success: true };
  } catch (e) {
    return errorState(e);
  }
}
