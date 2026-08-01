import type { ReactNode } from "react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { ShoppingBag, GraduationCap, CheckCircle2, Play, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { getPublicProduct, getPublicProductFeatures } from "@/lib/stripe/storefront";
import type { ProductKind } from "@/lib/stripe/schema";
import { BuyButton } from "@/components/learn/buy-button";

const ACCENT = "#5663AE";
const NAVY = "#3E3F66";

/**
 * Oeffentliche Kaufseite (SPEC 4.1: `/kaufen/[productSlug]`) - erreichbar
 * auch ohne vorheriges Login (Produktinfo laedt ueber getPublicProduct(),
 * die per Admin-Client die tenant-scoped RLS-Grenze fuer anonyme Besucher
 * sicher umgeht, siehe src/lib/stripe/storefront.ts).
 *
 * Login-vor-Kauf (bewusste Vereinfachung/Abweichung, siehe PHASENSTATUS.md):
 * ohne Session zeigt diese Seite einen Login/Registrieren-Hinweis statt
 * direkt zu Stripe zu leiten - kein Account-Anlage-Schritt im Checkout-Flow
 * selbst.
 *
 * Design-Block (18.07.2026, Claude-Design-Import KursKauf.dc.html aus dem
 * Design-Projekt "Calltalent-Akademie Studenten-Portal"). Markenkopfzeile,
 * Angebotsbanner, Produktkarte + sticky Kosten-Zusammenfassung im
 * Zwei-Spalten-Raster wie im Export.
 *
 * BEWUSST NICHT aus dem Export uebernommen (kein Ratsch bei einer reinen
 * Design-/Frontend-Aufgabe - keine Preis-/Geschaeftsmodell-/Rechtsentscheidung):
 * - Die Formularfelder "Rechnungsdaten"/"Zahlungsdaten" (Name, Adresse,
 *   USt-ID, Zahlungsmittel-Auswahl) sind im Export ein eigenes, lokales
 *   Formular. Diese App darf solche Daten nie selbst entgegennehmen (kein
 *   PCI-Scope) - sie werden weiterhin auf der gehosteten Stripe-Checkout-
 *   Seite erfasst (createCheckoutSession() in lib/stripe/checkout.ts, die
 *   Session sammelt seit diesem Import zusaetzlich Rechnungsadresse,
 *   Telefonnummer und USt-ID ab, um die Absicht des Exports einzuloesen).
 * - Der "Einmalig/Raten"-Umschalter entfaellt - es gibt kein
 *   Ratenzahlungs-Geschaeftsmodell (products.kind kennt nur
 *   one_time/subscription).
 * - Netto/19%-MwSt.-Aufschluesselung entfaellt - price_cents ist ein
 *   einzelner Gesamtbetrag ohne Steuersatz-Feld im Schema; eine erfundene
 *   19%-Zeile waere fuer AT/CH-Kunden oder einen anderen realen Satz schlicht
 *   falsch (keine erfundenen Zahlen, wie im ganzen Projekt).
 * - Widerrufsbelehrung/AGB-Checkboxen entfallen - es gibt noch keine echten
 *   Rechtstexte/-seiten im Repo, ein Haekchen neben einem toten Link waere
 *   schlimmer als gar keins (gleiches Prinzip wie beim Kontakt.dc.html-Import).
 * - Die Feature-Liste der Produktkarte ist im Export frei erfunden - hier
 *   stattdessen aus den ueber product.course_ids verknuepften Kursen
 *   berechnet (getPublicProductFeatures()), nur sichtbar wenn ein Kurs
 *   zugeordnet ist.
 *
 * Beschreibung/Bild (19.07.2026, Josips Auftrag "Unterseite Produkte" —
 * Texte/Bilder der Kaufseite bearbeiten, siehe admin/produkte/page.tsx):
 * `product.description` erscheint nur, wenn im Admin gepflegt (kein Pflicht-
 * feld). `product.imageUrl` ersetzt den bisherigen rein dekorativen
 * Platzhalter-Kasten (schraffierte Flaeche + Play-Symbol) - ohne Bild bleibt
 * genau dieser Platzhalter bestehen, damit die Karte nicht ploetzlich leer
 * wirkt.
 */
export default async function KaufenPage({
  params,
}: {
  params: Promise<{ productSlug: string }>;
}) {
  const { productSlug } = await params;
  const t = await getTranslations("learn.buy");
  const tShared = await getTranslations("learn.shared");
  const tPayments = await getTranslations("payments");
  const tAuthShared = await getTranslations("auth.shared");
  const format = await getFormatter();
  const tenant = await getTenant();

  if (!tenant) {
    return (
      <PageChrome
        brandInitial={tAuthShared("brandInitial")}
        brandName={tAuthShared("brandName")}
        brandSuffix={tAuthShared("brandSuffix")}
      >
        <p className="text-base" style={{ color: "#66679B" }}>
          {t("tenantNotFound")}
        </p>
      </PageChrome>
    );
  }

  const paymentsEnabled = tenant.settings.payments_enabled !== false;

  if (!paymentsEnabled) {
    return (
      <PageChrome
        brandInitial={tAuthShared("brandInitial")}
        brandName={tAuthShared("brandName")}
        brandSuffix={tAuthShared("brandSuffix")}
      >
        <h1 className="mb-2 text-2xl font-extrabold" style={{ color: "#1A1A2E" }}>
          {tenant.name}
        </h1>
        <p className="text-base" style={{ color: "#66679B" }}>
          {tPayments("paymentsDisabled")}
        </p>
      </PageChrome>
    );
  }

  const product = await getPublicProduct(tenant.id, productSlug);
  if (!product) {
    return (
      <PageChrome
        brandInitial={tAuthShared("brandInitial")}
        brandName={tAuthShared("brandName")}
        brandSuffix={tAuthShared("brandSuffix")}
      >
        <h1 className="mb-2 text-2xl font-extrabold" style={{ color: "#1A1A2E" }}>
          {tenant.name}
        </h1>
        <p className="text-base" style={{ color: "#66679B" }}>
          {tPayments("productUnavailable")}
        </p>
      </PageChrome>
    );
  }

  const [supabase, features] = await Promise.all([
    createClient(),
    getPublicProductFeatures(tenant.id, productSlug),
  ]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const durationLabel = (() => {
    if (!features || features.totalMinutes <= 0) return null;
    const hours = Math.floor(features.totalMinutes / 60);
    const minutes = features.totalMinutes % 60;
    if (hours <= 0) return t("durationMinutesOnly", { minutes });
    return minutes > 0
      ? t("durationHoursMinutes", { hours, minutes })
      : t("durationHoursOnly", { hours });
  })();

  // moduleCount > 0 statt nur "features vorhanden" pruefen: product.course_ids
  // kann auf eine zwischenzeitlich geloeschte/leere Kurs-ID zeigen (verwaiste
  // Referenz, z. B. beim Test-Produkt "technik-test") - dann liefert
  // getPublicProductFeatures() ein Nullobjekt {0,0,0} zurueck. Eine "0 Module
  // · 0 Lektionen"-Zeile waere kein Fehler in der Berechnung, sieht fuer
  // Kaufinteressenten aber wie ein kaputtes Produkt aus - deshalb komplett
  // ausblenden statt eine leere/negative Zahl zu zeigen.
  const featureBullets =
    features && features.moduleCount > 0
      ? [
          `${tShared("modulesCount", { count: features.moduleCount })} · ${tShared("lessonsCount", { count: features.lessonCount })}`,
          durationLabel,
          t("certificateBullet"),
        ].filter((v): v is string => Boolean(v))
      : [];

  const accessNote = product.kind === "subscription" ? t("accessNoteSubscription") : t("accessNoteOneTime");
  const kindLabels: Record<ProductKind, string> = {
    one_time: tPayments("kinds.one_time"),
    subscription: tPayments("kinds.subscription"),
  };

  return (
    <PageChrome
      brandInitial={tAuthShared("brandInitial")}
      brandName={tAuthShared("brandName")}
      brandSuffix={tAuthShared("brandSuffix")}
    >
      <div
        className="mb-7 flex items-center gap-3.5 rounded-[14px] p-[18px_22px]"
        style={{
          background: NAVY,
          backgroundImage:
            "repeating-linear-gradient(135deg,rgba(86,99,174,.5) 0 16px, rgba(62,63,102,.5) 16px 32px)",
        }}
      >
        <span
          className="flex h-10 w-10 flex-none items-center justify-center rounded-[10px]"
          style={{ background: "rgba(255,255,255,.14)" }}
          aria-hidden="true"
        >
          <ShoppingBag size={20} color="#F7EED4" strokeWidth={2} />
        </span>
        <div>
          <div className="text-[17px] font-extrabold text-white">{t("heroBadgeTitle")}</div>
          <div className="text-sm font-semibold" style={{ color: "#C9CBE6" }}>
            {t("heroBadgeSubtitle")}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_340px]">
        {/* Linke Spalte */}
        <div className="min-w-0 rounded-[16px] border bg-white p-[22px]" style={{ borderColor: "#E7E8F2" }}>
          <div className="mb-4 flex items-center gap-2.5">
            <span
              className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px]"
              style={{ background: "#EDEEF7" }}
              aria-hidden="true"
            >
              <GraduationCap size={17} color={ACCENT} strokeWidth={2.2} />
            </span>
            <h2 className="m-0 text-lg font-extrabold">{t("selectedProductHeading")}</h2>
          </div>

          <div
            className="flex flex-wrap gap-[22px] overflow-hidden rounded-[14px] p-[22px]"
            style={{
              background: NAVY,
              backgroundImage:
                "repeating-linear-gradient(135deg,rgba(86,99,174,.5) 0 16px, rgba(62,63,102,.5) 16px 32px)",
            }}
          >
            <div className="min-w-0 flex-1 basis-[300px]">
              <div
                className="inline-flex items-center gap-1.5 text-[13px] font-extrabold"
                style={{ letterSpacing: "0.08em", color: "#C9CBE6" }}
              >
                {kindLabels[product.kind].toUpperCase()}
              </div>
              <div className="mb-2 mt-1 text-xl font-extrabold text-white">{product.title}</div>
              {featureBullets.length > 0 && (
                <div className="mt-4 flex flex-col gap-2">
                  {featureBullets.map((f) => (
                    <div
                      key={f}
                      className="flex items-center gap-2.5 text-sm font-semibold"
                      style={{ color: "#EDEEF7" }}
                    >
                      <span
                        className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[6px]"
                        style={{ background: "rgba(139,224,183,.22)" }}
                        aria-hidden="true"
                      >
                        <CheckCircle2 size={13} color="#8BE0B7" strokeWidth={3} />
                      </span>
                      {f}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {product.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- Storage-URL, kein next/image-Loader konfiguriert
              <img
                src={product.imageUrl}
                alt=""
                className="h-[150px] w-full flex-none rounded-[12px] object-cover object-center sm:w-[200px]"
              />
            ) : (
              <div
                className="flex h-[150px] w-full flex-none items-center justify-center rounded-[12px] sm:w-[200px]"
                style={{
                  backgroundColor: "#2C2D4A",
                  backgroundImage:
                    "repeating-linear-gradient(45deg,#2C2D4A 0 12px, rgba(86,99,174,.35) 12px 24px)",
                }}
                aria-hidden="true"
              >
                <span className="flex h-[52px] w-[52px] items-center justify-center rounded-full" style={{ background: ACCENT }}>
                  <Play size={22} color="#fff" fill="#fff" />
                </span>
              </div>
            )}
          </div>

          {product.description && (
            <p className="mt-4 whitespace-pre-line text-sm" style={{ color: "#3E3F66" }}>
              {product.description}
            </p>
          )}

          <div className="mt-4 rounded-xl border p-[14px_16px]" style={{ borderColor: "#EEF0F7" }}>
            <div className="mb-1 text-sm font-extrabold" style={{ color: "#1A1A2E" }}>
              {accessNote}
            </div>
            <div className="text-[13px] font-semibold" style={{ color: "#3E3F66" }}>
              {t("billingHint")}
            </div>
          </div>
        </div>

        {/* Rechte Spalte: Kosten-Zusammenfassung */}
        <div className="rounded-[16px] border bg-white p-[22px] lg:sticky lg:top-6" style={{ borderColor: "#E7E8F2" }}>
          <h2 className="m-0 mb-4 text-lg font-extrabold">{t("costSummaryHeading")}</h2>

          <div className="mb-4 flex items-center gap-2 rounded-[11px] p-[11px_14px]" style={{ background: ACCENT }}>
            <ShoppingBag size={15} color="#fff" strokeWidth={2.2} aria-hidden="true" />
            <span className="text-[13px] font-extrabold" style={{ letterSpacing: "0.04em", color: "#fff" }}>
              {kindLabels[product.kind].toUpperCase()}
            </span>
          </div>

          <div
            className="flex items-center justify-between border-b pb-3.5 pt-1"
            style={{ borderColor: "#EEF0F7" }}
          >
            <span className="text-sm font-extrabold" style={{ color: "#1A1A2E" }}>
              {t("totalLabel")}
            </span>
            <span
              className="rounded-[9px] px-3.5 py-1.5 text-[17px] font-extrabold text-white"
              style={{ background: "#1A1A2E" }}
            >
              {format.number(product.priceCents / 100, { style: "currency", currency: product.currency.toUpperCase() })}
              {product.kind === "subscription" && <span className="text-sm font-normal">{t("perMonthSuffix")}</span>}
            </span>
          </div>

          {user ? (
            <div className="mt-5">
              <BuyButton productSlug={product.slug} />
            </div>
          ) : (
            <div className="mt-5 flex flex-col gap-3 rounded-xl border p-4" style={{ borderColor: "#E0E2EF" }}>
              <p className="text-sm font-semibold" style={{ color: "#3E3F66" }}>
                {tPayments("loginRequired")}
              </p>
              <div className="flex gap-2.5">
                <Link
                  href="/login"
                  className="flex-1 rounded-[11px] px-4 py-2.5 text-center text-sm font-bold text-white no-underline"
                  style={{ background: ACCENT }}
                >
                  {tPayments("login")}
                </Link>
                <Link
                  href="/registrieren"
                  className="flex-1 rounded-[11px] border px-4 py-2.5 text-center text-sm font-bold no-underline"
                  style={{ borderColor: "#D8DAEA", color: NAVY }}
                >
                  {tPayments("register")}
                </Link>
              </div>
            </div>
          )}

          <div
            className="mt-3.5 flex items-center justify-center gap-1.5 text-center text-xs font-semibold"
            style={{ color: "#66679B" }}
          >
            <ShieldCheck size={14} strokeWidth={2.2} aria-hidden="true" />
            {t("secureBadge")}
          </div>
        </div>
      </div>
    </PageChrome>
  );
}

/**
 * Markenkopfzeile + Seitenrahmen, gleiche Farbwerte wie Modul/Lektion/KursUebersicht.
 * `brand*`-Props (i18n Block C2): der Aufrufer reicht `auth.shared` durch —
 * exakt dieselben Marken-Textbausteine wie im Login-Formular (Block C1),
 * siehe PHASENSTATUS.md. Kein eigener `learn.buy`-Namensraum-Duplikat dafür.
 */
function PageChrome({
  children,
  brandInitial,
  brandName,
  brandSuffix,
}: {
  children: ReactNode;
  brandInitial: string;
  brandName: string;
  brandSuffix: string;
}) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#F4F5FA",
        fontFamily: "var(--font-sans)",
        fontSize: 18,
        lineHeight: 1.6,
        color: "#1A1A2E",
        paddingBottom: 64,
      }}
    >
      <div
        className="flex items-center justify-center gap-3 border-b bg-white p-[22px]"
        style={{ borderColor: "#E7E8F2" }}
      >
        <div
          className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] text-lg font-extrabold"
          style={{ background: "var(--color-primary)", color: "var(--color-cream)" }}
          aria-hidden="true"
        >
          {brandInitial}
        </div>
        <div className="text-base font-extrabold" style={{ letterSpacing: "0.02em", color: NAVY }}>
          {brandName}
          <span className="ml-2 text-sm font-semibold" style={{ letterSpacing: "0.2em", color: "#A9AAC4" }}>
            {brandSuffix}
          </span>
        </div>
      </div>
      <div className="mx-auto max-w-[1120px] px-7 py-7">{children}</div>
    </div>
  );
}
