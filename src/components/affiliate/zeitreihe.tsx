import { getFormatter, getTranslations } from "next-intl/server";
import {
  PARTNER_BORDER,
  PARTNER_CARD_CLASS,
  PARTNER_HAIRLINE,
  PARTNER_INK,
  PARTNER_MUTED,
  PARTNER_NAVY,
} from "@/components/affiliate/partner-shell";

/**
 * Affiliate-System, Block B7-A — eine Zeitreihe als TABELLE UND Diagramm,
 * nie nur als Diagramm (PLAN_Affiliate-System.md 8.5, erster Punkt;
 * CLAUDE.md §3.4).
 *
 * Der Auftraggeber ist stark sehbehindert. Die Regel des Plans ist deshalb
 * wörtlich zu nehmen: „Jede Kennzahl steht als Text, bevor sie als Grafik
 * erscheint. Kein Wert existiert ausschließlich in einem Chart." Diese
 * Komponente rendert deshalb in dieser Reihenfolge:
 *
 *   1. die vollständige Wertetabelle mit allen Zahlen,
 *   2. eine Summenzeile,
 *   3. DANACH das Diagramm — mit `role="img"` und einem `aria-label`, das
 *      die tatsächlichen Zahlen nennt (Muster `reporting/page.tsx:120-126`),
 *      nicht bloß „Diagramm der Klicks".
 *
 * Wer das Diagramm nicht sieht, verliert dadurch keine einzige Information.
 * Wer es sieht, bekommt den Verlauf schneller. Das Diagramm ist also
 * Zugabe, nie Träger.
 *
 * ## Warum kein `<table>` und trotzdem Tabellensemantik
 *
 * Plan 8 verlangt für dieses Projekt `rgrid-header`/`rgrid-row` statt
 * `<table>`, damit jede Zeile unter 1024 px zur Karte stapelt (globals.css).
 * Eine gestapelte Karte ohne Spaltenbezug ist für einen Screenreader aber
 * genau der Verlust, den 8.5 verhindern will. Beides zusammen gibt es nur
 * über die ARIA-Rollen: das Raster trägt `role="table"`/`row`/`columnheader`/
 * `cell`, die Zeilen-/Spaltenbeziehung bleibt damit unabhängig davon, wie
 * das CSS die Zellen gerade anordnet. Zusätzlich trägt jede Zahlenzelle ein
 * sichtbares `rgrid-label`, das im Kartenmodus erscheint — für sehende
 * Nutzer mit kleinem Fenster.
 *
 * ## Warum handgeschriebenes SVG
 *
 * G16: keine neue npm-Abhängigkeit (Worker-Größenlimit 3 MiB gzip). Eine
 * Diagrammbibliothek wäre für vier Balkenreihen ohnehin unverhältnismäßig.
 * Das SVG skaliert über `viewBox` und trägt KEINE feste Pixelhöhe — bei
 * 200 % Zoom wächst es mit, statt abzuschneiden.
 */

export type ZeitreihePunkt = {
  /** Sortier- und Reihenschlüssel (ISO-Tag oder Kampagnenname). */
  key: string;
  /** Beschriftung in der Tabelle, bereits lokalisiert. */
  label: string;
  clicks: number;
  unique_clicks: number;
  orders: number;
  commission_cents: number;
};

const COLS = "1.4fr 1fr 1fr 1fr 1.2fr";

/**
 * Farbe des Verkaufsbalkens und der Grundlinie (Korrektur 11.09.2026, Befund
 * A11Y-7). #7C84BC auf #FFFFFF = 3,57:1 — nachgerechnet, über der
 * 3:1-Schwelle für grafische Objekte (WCAG 1.4.11 Non-text Contrast). Der
 * Vorgänger #9AA0D0 lag mit 2,53:1 darunter, die Grundlinie mit #E7E8F2
 * sogar bei 1,22:1 — auf einem kontrastarmen Bildschirm war der Nullpunkt
 * des Diagramms schlicht nicht zu sehen. Wer die Farbe ändert, rechnet nach.
 */
const CHART_SALES = "#7C84BC";

export async function Zeitreihe({
  points,
  currency,
  heading,
  firstColumnLabel,
  incompleteLabel = null,
}: {
  points: readonly ZeitreihePunkt[];
  currency: string;
  heading: string;
  /** „Tag" oder „Kampagne" — die einzige Spalte, die sich je Sicht ändert. */
  firstColumnLabel: string;
  /**
   * Gesetzt, wenn die zugrunde liegende Abfrage NICHT vollständig geladen hat
   * (Korrektur 11.09.2026, Befund A11Y-6). Der Text ist die lokalisierte
   * Ersatzangabe („Nicht ermittelbar"); `null` heißt vollständig.
   *
   * Die Einzelzeilen bleiben stehen — die geladenen Zeilen sind für sich
   * richtig. Falsch werden nur die SUMME (sie addiert über eine Lücke) und
   * die Form des Diagramms (ihm fehlen Tage). Genau diese beiden werden
   * deshalb zurückgehalten, statt eine zu kleine Zahl fett darzustellen: „ein
   * sehbehinderter Betrachter hat keine Chance, sie als falsch zu erkennen"
   * (Kopfkommentar von `partner/page.tsx`).
   */
  incompleteLabel?: string | null;
}) {
  const t = await getTranslations("affiliate.statistics");
  const format = await getFormatter();

  /** Kurzform: eine Ersatzangabe liegt vor, die Reihe ist also lückenhaft. */
  const incomplete = typeof incompleteLabel === "string" && incompleteLabel !== "";

  const code = /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : "EUR";
  const money = (cents: number): string =>
    format.number(cents / 100, { style: "currency", currency: code });
  const num = (value: number): string => format.number(value);

  const total = points.reduce(
    (acc, point) => ({
      clicks: acc.clicks + point.clicks,
      unique_clicks: acc.unique_clicks + point.unique_clicks,
      orders: acc.orders + point.orders,
      commission_cents: acc.commission_cents + point.commission_cents,
    }),
    { clicks: 0, unique_clicks: 0, orders: 0, commission_cents: 0 },
  );

  const maxClicks = points.reduce((max, point) => Math.max(max, point.clicks), 0);

  /**
   * Das `aria-label` des Diagramms nennt die Zahlen, nicht die Bildart. Es
   * fasst zusammen, was ein sehender Betrachter im Verlauf erkennt: Summe,
   * Spitzenwert und wann dieser lag. Die Einzelwerte stehen ohnehin darüber
   * in der Tabelle — das Label wiederholt sie nicht, es beschreibt den
   * Verlauf.
   */
  const peak = points.reduce<ZeitreihePunkt | null>(
    (best, point) => (best === null || point.clicks > best.clicks ? point : best),
    null,
  );
  const chartLabel = t("chartLabel", {
    summary:
      peak === null
        ? num(0)
        : `${num(total.clicks)} / ${num(total.orders)} — ${peak.label}: ${num(peak.clicks)}`,
  });

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-[17px] font-bold" style={{ color: PARTNER_INK }}>
        {heading}
      </h2>

      {points.length === 0 ? (
        <p className="text-[15px]" style={{ color: PARTNER_MUTED }}>
          {t("empty")}
        </p>
      ) : (
        <>
          {/* 1. Die Werte. Immer zuerst, immer vollständig. */}
          <div
            role="table"
            aria-label={heading}
            className={`${PARTNER_CARD_CLASS} overflow-hidden`}
            style={{ borderColor: PARTNER_BORDER }}
          >
            <div
              role="row"
              className="rgrid-header px-[18px] py-3 text-[13px] font-bold lg:px-[24px]"
              style={
                {
                  "--rgrid-cols": COLS,
                  color: PARTNER_MUTED,
                  borderBottom: `1px solid ${PARTNER_HAIRLINE}`,
                } as React.CSSProperties
              }
            >
              <div role="columnheader">{firstColumnLabel}</div>
              <div role="columnheader">{t("columnClicks")}</div>
              <div role="columnheader">{t("columnUniqueClicks")}</div>
              <div role="columnheader">{t("columnSales")}</div>
              <div role="columnheader">{t("columnCommission")}</div>
            </div>

            {points.map((point) => (
              <div
                key={point.key}
                role="row"
                className="rgrid-row px-[18px] py-3 text-[15px] lg:px-[24px]"
                style={
                  {
                    "--rgrid-cols": COLS,
                    borderBottom: `1px solid ${PARTNER_HAIRLINE}`,
                    color: PARTNER_INK,
                  } as React.CSSProperties
                }
              >
                <div role="cell" className="font-semibold">
                  {point.label}
                </div>
                <div role="cell">
                  <span className="rgrid-label">{t("columnClicks")}</span>
                  {num(point.clicks)}
                </div>
                <div role="cell">
                  <span className="rgrid-label">{t("columnUniqueClicks")}</span>
                  {num(point.unique_clicks)}
                </div>
                <div role="cell">
                  <span className="rgrid-label">{t("columnSales")}</span>
                  {num(point.orders)}
                </div>
                <div role="cell">
                  <span className="rgrid-label">{t("columnCommission")}</span>
                  {money(point.commission_cents)}
                </div>
              </div>
            ))}

            {/* 2. Summenzeile — sie beantwortet die Frage, die sonst jeder
                   selbst addieren müsste. Bei unvollständiger Abfrage steht
                   hier die Ersatzangabe statt einer zu kleinen Summe. */}
            <div
              role="row"
              className="rgrid-row px-[18px] py-3 text-[15px] font-bold lg:px-[24px]"
              style={{ "--rgrid-cols": COLS, color: PARTNER_INK } as React.CSSProperties}
            >
              <div role="cell">{t("totalRow")}</div>
              <div role="cell">
                <span className="rgrid-label">{t("columnClicks")}</span>
                {incomplete ? incompleteLabel : num(total.clicks)}
              </div>
              <div role="cell">
                <span className="rgrid-label">{t("columnUniqueClicks")}</span>
                {incomplete ? incompleteLabel : num(total.unique_clicks)}
              </div>
              <div role="cell">
                <span className="rgrid-label">{t("columnSales")}</span>
                {incomplete ? incompleteLabel : num(total.orders)}
              </div>
              <div role="cell">
                <span className="rgrid-label">{t("columnCommission")}</span>
                {incomplete ? incompleteLabel : money(total.commission_cents)}
              </div>
            </div>
          </div>

          {/* 3. Erst jetzt das Diagramm — und nur, wenn die Reihe
                 vollständig ist (Befund A11Y-6). Einem Verlauf sieht niemand
                 an, dass ihm Tage fehlen; die Kurve wirkt genauso plausibel
                 wie eine richtige. Die Einzelwerte stehen oben in der
                 Tabelle, es geht also keine Information verloren. */}
          {incomplete ? (
            <p className="text-[15px] font-semibold" style={{ color: PARTNER_MUTED }}>
              {incompleteLabel}
            </p>
          ) : (
            <div
              className={`${PARTNER_CARD_CLASS} p-[18px_20px]`}
              style={{ borderColor: PARTNER_BORDER }}
            >
              <svg
                role="img"
                aria-label={chartLabel}
                viewBox={`0 0 ${Math.max(points.length * 10, 10)} 40`}
                preserveAspectRatio="none"
                className="h-auto w-full"
                style={{ maxHeight: "12rem", minHeight: "6rem" }}
              >
                {points.map((point, index) => {
                  // Höhe relativ zum Spitzenwert. `maxClicks === 0` wird als
                  // Höhe 0 gezeichnet statt durch null geteilt.
                  const height = maxClicks === 0 ? 0 : (point.clicks / maxClicks) * 34;
                  const ordersHeight =
                    maxClicks === 0 ? 0 : Math.min((point.orders / maxClicks) * 34, 34);
                  return (
                    <g key={point.key}>
                      <rect
                        x={index * 10 + 1.5}
                        y={38 - height}
                        width={4}
                        height={height}
                        fill={PARTNER_NAVY}
                      />
                      {/* Verkäufe als zweiter, schmalerer Balken. Er ist nicht
                          nur anders gefärbt, sondern anders breit und versetzt —
                          eine Unterscheidung allein über Farbe wäre für eine
                          Farbsehschwäche keine. Farbe jetzt `CHART_SALES`
                          (3,57:1 statt 2,53:1, Befund A11Y-7); der Abstand zum
                          Hauptbalken (#3E3F66 = 9,96:1 auf Weiß) bleibt dabei
                          deutlich erhalten. */}
                      <rect
                        x={index * 10 + 6}
                        y={38 - ordersHeight}
                        width={2.5}
                        height={ordersHeight}
                        fill={CHART_SALES}
                      />
                    </g>
                  );
                })}
                {/* Grundlinie im selben Ton wie der Verkaufsbalken: vorher
                    `PARTNER_BORDER` mit 1,22:1 auf Weiß (Befund A11Y-7). */}
                <line x1="0" y1="38" x2={Math.max(points.length * 10, 10)} y2="38" stroke={CHART_SALES} strokeWidth="0.5" />
              </svg>
              <p className="mt-2 text-[13px]" style={{ color: PARTNER_MUTED }}>
                {t("chartLegend")}
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
