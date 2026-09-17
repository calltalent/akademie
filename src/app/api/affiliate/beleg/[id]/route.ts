import { NextResponse } from "next/server";
import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { requireAffiliatePartner } from "@/lib/affiliate/access";
import { affiliateCreditNotePath } from "@/lib/affiliate/credit-note";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import { CSRF_REJECT_MESSAGE, verifySameOrigin } from "@/lib/security/origin";
import { genericErrorMessage } from "@/lib/errors/generic";

/**
 * Affiliate-System, Block B8-C — der Belegabruf DES PARTNERS
 * (PLAN_Affiliate-System.md 7.2, 7.7, 8.2 Zeilen 4 und 5, 11.5, 11.15;
 * CLAUDE.md §2.5, §2.9, §2.15).
 *
 * Eine Gutschrift trägt Anschrift, Steuerstatus und Jahresumsatz eines
 * Partners. Der Bucket `affiliate-documents` ist deshalb privat und hat
 * bewusst KEINE erlaubende Storage-Policy: eine SELECT-Policy auf
 * `storage.objects` wäre zugleich ein Listing-Recht auf den Mandantenordner —
 * genau das Leck, das in diesem Repo schon zweimal geschlossen werden musste
 * (20260710233735, 20260801151000). Dieser Handler ist deshalb der EINZIGE
 * Weg an die Datei.
 *
 * ## VIER SCHRITTE, UND DIE REIHENFOLGE IST DER SCHUTZ
 *
 *   1. Origin prüfen (§2.9) — `route.ts`-Handler tragen den CSRF-Schutz
 *      selbst, Next.js' eingebauter Check gilt nur für Server Actions.
 *   2. Partner-Gate (`requireAffiliatePartner()`, G9): ein Partner hat keine
 *      `memberships`-Zeile, die Zugehörigkeit kommt aus
 *      `affiliate_partner_id(tenant)` und gilt nur für `status='active'`.
 *   3. BESITZPRÜFUNG: die Zeile wird mit `.eq("tenant_id", …)` UND
 *      `.eq("partner_id", …)` gelesen. Die `id` aus dem Pfad wird nie
 *      durchgereicht — weder in eine Abfrage ohne diese beiden Filter noch in
 *      einen Storage-Pfad.
 *   4. Erst DANN eine kurzlebige Signed URL (60 s) und eine Weiterleitung
 *      darauf.
 *
 * ## DIE DATEI WIRD NIE SELBST AUSGELIEFERT
 *
 * Kein `download()` und kein Durchreichen des Datenstroms: der Worker müsste
 * das PDF vollständig in den Speicher holen, und jede Zwischenstation
 * (Cloudflare-Cache, Proxy) sähe den Inhalt. Stattdessen eine 303-Antwort auf
 * eine signierte URL, die nach einer Minute abläuft. `download` im
 * Signaturaufruf setzt `Content-Disposition: attachment`, der Browser lädt
 * also herunter und die Partnerseite bleibt stehen.
 *
 * ## DER PFAD WIRD BERECHNET, NICHT GELESEN
 *
 * `document_path` steht zwar in der Zeile, wird hier aber gegen den aus
 * `tenant_id` und `payout_id` BERECHNETEN Pfad geprüft (`affiliateCreditNotePath()`,
 * dieselbe Konvention, die der CHECK auf der Spalte erzwingt). Unterschieden
 * sich die beiden, wird nicht signiert: eine abweichende Zeichenkette in
 * dieser Spalte wäre der einzige Weg, mit der Signatur auf eine fremde Datei
 * zu zeigen.
 *
 * ## EINE MELDUNG FÜR DREI FÄLLE
 *
 * „gibt es nicht", „gehört einem anderen Partner" und „gehört zu einem
 * anderen Mandanten" bekommen denselben Text und denselben Status (11.15,
 * §2.15). Nur „der Beleg ist noch nicht erstellt" ist ein eigener Fall — er
 * ist eine Aussage über einen Satz, den der Partner ohnehin sieht, und ohne
 * ihn stünde er vor einem Knopf, der nichts tut.
 */

const paramsSchema = z.object({ id: z.string().uuid() });

/** Gültigkeit der Signatur. Kurz genug, dass eine weitergegebene Adresse
 *  wertlos ist, lang genug für eine langsame Verbindung — dieselbe
 *  Größenordnung wie beim Abgaben-Download (5 Minuten) und beim Zertifikat
 *  (10 Minuten), hier bewusst am unteren Ende, weil der Beleg Steuerdaten
 *  trägt. */
const SIGNED_URL_SECONDS = 60;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    // 1. CSRF.
    if (!verifySameOrigin(request)) {
      return NextResponse.json({ error: CSRF_REJECT_MESSAGE }, { status: 403 });
    }

    // 2. Gate.
    const { tenant, partnerId } = await requireAffiliatePartner();

    // 3. Rate-Limit je PARTNER, nicht je IP: eine IP-Grenze träfe ein ganzes
    //    Büro gemeinsam, und ein einzelner Partner umginge sie mit jedem
    //    Mobilfunk-Reconnect. Fail-open (Lastschutz, keine
    //    Sicherheitszusage — die ist das Gate darüber).
    if (
      !(await checkRateLimit("affiliate-beleg", {
        maxRequests: 60,
        windowSeconds: 3600,
        extraKey: partnerId,
      }))
    ) {
      return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
    }

    const t = await getTranslations("affiliate.payouts");

    const parsed = paramsSchema.safeParse(await context.params);
    // Eine unbrauchbare ID bekommt denselben Text wie eine fremde — aus der
    // Unterscheidung ließe sich sonst ablesen, welche IDs es gibt.
    if (!parsed.success) {
      return NextResponse.json({ error: t("downloadNotFound") }, { status: 404 });
    }

    // 4. Besitzprüfung. `createAdminClient()` NACH dem Gate, weil
    //    `document_path` keinem Client-Spaltenrecht unterliegt (Migration
    //    20260911150000) — die Mandanten- und Besitzbindung steht deshalb
    //    vollständig in diesen beiden Filtern.
    const admin = createAdminClient();
    const { data: payout, error } = await admin
      .from("affiliate_payouts")
      .select("id, partner_id, status, document_no, document_path")
      .eq("tenant_id", tenant.id)
      .eq("partner_id", partnerId)
      .eq("id", parsed.data.id)
      .maybeSingle<{
        id: string;
        document_no: string | null;
        document_path: string | null;
      }>();

    if (error) {
      // Nur der SQLSTATE ins Log (§2.11).
      console.error(
        `[api/affiliate/beleg] Lesen fehlgeschlagen (Code ${
          (error as { code?: string }).code ?? "unbekannt"
        }).`,
      );
      return NextResponse.json({ error: genericErrorMessage(error) }, { status: 500 });
    }
    if (payout === null) {
      return NextResponse.json({ error: t("downloadNotFound") }, { status: 404 });
    }

    // Beleg gültig, Datei noch nicht erzeugt (7.2): der Reparaturlauf holt
    // sie nach. Das ist kein Fehler, sondern ein Zwischenstand.
    if (payout.document_no === null || payout.document_path === null) {
      return NextResponse.json({ error: t("downloadUnavailable") }, { status: 409 });
    }

    const expectedPath = affiliateCreditNotePath(tenant.id, payout.id);
    if (payout.document_path !== expectedPath) {
      console.error("[api/affiliate/beleg] Belegpfad weicht von der Konvention ab.");
      return NextResponse.json({ error: t("downloadUnavailable") }, { status: 409 });
    }

    // 5. Kurzlebige Signatur auf den BERECHNETEN Pfad.
    const filename = `${payout.document_no.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`;
    const { data: signed, error: signError } = await admin.storage
      .from("affiliate-documents")
      .createSignedUrl(expectedPath, SIGNED_URL_SECONDS, { download: filename });

    if (signError || signed === null) {
      console.error("[api/affiliate/beleg] Signatur fehlgeschlagen.");
      return NextResponse.json({ error: t("downloadUnavailable") }, { status: 409 });
    }

    // 303: die Antwort auf ein POST ist eine andere Ressource, und der
    // Browser soll sie mit GET holen. `no-store`, damit die signierte
    // Adresse in keinem Zwischenspeicher landet.
    return NextResponse.redirect(signed.signedUrl, {
      status: 303,
      headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
    });
  } catch (e) {
    // Die Gate-Meldungen aus `access.ts` dürfen durch — sie sind Aussagen
    // über den Anfragenden selbst und unterscheiden bewusst NICHT, warum
    // jemand kein Partner ist (11.15).
    const raw = e instanceof Error ? e.message : "";
    const status =
      raw.includes("Nicht angemeldet") ||
      raw.includes("Kein Zugriff") ||
      raw.includes("nicht aktiviert") ||
      raw.includes("Kein Mandant")
        ? 403
        : 500;
    if (status === 500) {
      console.error("[api/affiliate/beleg] Belegabruf fehlgeschlagen.");
    }
    return NextResponse.json(
      { error: status === 403 ? raw : genericErrorMessage(e) },
      { status },
    );
  }
}
