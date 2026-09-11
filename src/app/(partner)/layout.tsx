import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { checkAffiliatePartnerAccess } from "@/lib/affiliate/access";
import { createClient } from "@/lib/supabase/server";
import { PartnerAccessNotice, PartnerShell } from "@/components/affiliate/partner-shell";
import { TermsGate } from "@/components/affiliate/partner-forms";

/**
 * Affiliate-System, Block B7-A — das Gate des Partnerbereichs
 * (PLAN_Affiliate-System.md 8.2, G9, 9.8, 11.15).
 *
 * ## Drei Aufgaben, mehr nicht
 *
 * 1. GATE. `checkAffiliatePartnerAccess()` → `affiliate_partner_id(tenant)`.
 *    Ein Partner hat in der Regel KEINE `memberships`-Zeile (G9), `member_role()`
 *    liefert für ihn `null`; deshalb gibt es die eigene Security-Definer-
 *    Funktion, und deshalb ist dieser Bereich eine eigene Route-Gruppe ohne
 *    jede Berührung mit `(admin)` oder `(portal)`. Das Gate prüft zugleich
 *    den Feature-Schalter, den RLS nicht kennt (9.8).
 *
 * 2. BEDINGUNGSSPERRE. Ist `affiliate_programs.terms_version` höher als die
 *    vom Partner akzeptierte Fassung, ersetzt die Zustimmung den gesamten
 *    Seiteninhalt (8.2, letzte Zeile der Tabelle) — auf ALLEN Seiten außer
 *    `/partner/bedingungen` selbst, wo derselbe Text ohnehin steht.
 *    Serverseitig, nicht als eingeblendeter JS-Dialog: siehe die Begründung
 *    an `TermsGate` in `partner-forms.tsx`.
 *
 * 3. BRANDING. Es passiert hier NICHTS dafür. Die Mandantenfarben injiziert
 *    bereits `ThemeStyle` im Wurzel-Layout (`src/app/layout.tsx`) für jede
 *    Seite dieser Domain; `PartnerShell` benutzt sie über
 *    `var(--color-primary)`/`var(--color-background)`. Eine zweite Injektion
 *    hier wäre eine zweite Quelle für dieselbe Farbe.
 *
 * ## Warum der Rahmen NICHT hier gerendert wird
 *
 * Jede Seite hat ihren eigenen Titel und ihren eigenen aktiven Menüpunkt und
 * ruft `PartnerShell` deshalb selbst auf — dieselbe Aufteilung wie im
 * Händlerbereich. Jede Seite fährt außerdem ihr eigenes Gate: ein Layout-Gate
 * allein wäre eine Zusicherung, die eine später hinzugefügte Seite still
 * verlieren kann, und die Seiten lesen über `createAdminClient()`.
 *
 * ## Die eine Meldung
 *
 * Für „nie beworben", „Bewerbung offen", „abgelehnt" und „gesperrt" steht
 * derselbe Text (11.15). Aus vier verschiedenen Antworten ließe sich sonst
 * der Partnerbestand des Mandanten erfragen.
 */
export default async function PartnerLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const access = await checkAffiliatePartnerAccess();
  if (!access.ok) return <PartnerAccessNotice reason={access.reason} />;

  const supabase = await createClient();

  // Session-Client, kein Admin-Client: `affiliate_programs` liest ein aktiver
  // Partner laut Policy `affiliate_programs_select` vollständig, und das
  // Tabellenrecht umfasst alle Spalten (anders als bei `affiliate_partners`).
  // Die Partnerzeile dagegen MUSS ihre Spalten benennen — `select("*")` bricht
  // dort mit 42501 ab, weil das SELECT-Recht ein Spalten-Grant ist.
  const [{ data: program }, { data: partner }, headerList, t] = await Promise.all([
    supabase
      .from("affiliate_programs")
      .select("id, terms_version, terms_text, tier2_enabled")
      .eq("tenant_id", access.tenant.id)
      .maybeSingle(),
    supabase
      .from("affiliate_partners")
      .select("id, terms_version_accepted")
      .eq("tenant_id", access.tenant.id)
      .eq("id", access.partnerId)
      .maybeSingle(),
    headers(),
    getTranslations("affiliate"),
  ]);

  // Ohne Programmzeile gibt es keine Fassung, der zugestimmt werden könnte.
  // Dann wird NICHT gesperrt: der Partner kann nichts tun, um die Sperre zu
  // lösen, und eine Sperre ohne Ausweg ist eine tote Seite.
  const termsVersion = Number(program?.terms_version ?? 0);
  const accepted = Number(partner?.terms_version_accepted ?? 0);

  // `x-portal-pathname` setzt die Middleware bei JEDEM Request auf den
  // tatsächlich ausgelieferten Pfad und überschreibt einen mitgeschickten
  // Wert (middleware.ts:128) — der Header ist also nicht fälschbar. Selbst
  // wenn er es wäre, könnte man damit nur die Sperre auf der Bedingungsseite
  // umgehen, auf der sie ohnehin nicht gilt.
  const pathname = headerList.get("x-portal-pathname") ?? "";
  const onTermsPage = pathname === "/partner/bedingungen";

  const blocked = program !== null && termsVersion > accepted && !onTermsPage;

  if (blocked) {
    return (
      <PartnerShell
        active="terms"
        title={t("terms.title")}
        tenantName={access.tenant.name}
        logoUrl={access.tenant.branding?.logo_url ?? null}
        showTeam={program?.tier2_enabled === true}
      >
        <TermsGate version={termsVersion} termsText={program?.terms_text ?? ""} />
      </PartnerShell>
    );
  }

  return <>{children}</>;
}
