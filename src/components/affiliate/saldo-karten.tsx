import { getFormatter, getTranslations } from "next-intl/server";
import type { AffiliateBalances } from "@/lib/affiliate/types";
import {
  PARTNER_BORDER,
  PARTNER_CARD_CLASS,
  PARTNER_INK,
  PARTNER_MUTED,
} from "@/components/affiliate/partner-shell";

/**
 * Affiliate-System, Block B7-A — die FÜNF getrennten Salden
 * (PLAN_Affiliate-System.md 5.10, 8.2 Zeile „/partner", G5, 5.11, 8.5).
 *
 * ## Warum fünf Zahlen und nie eine
 *
 * „Offen", „in Reserve", „in Prüfung", „verfügbar" und „ausgezahlt" sind
 * fünf verschiedene Dinge, und der Partner trifft an ihnen seine Erwartung:
 * wann kommt das Geld, und wie viel davon kann noch wegfallen. Eine
 * Gesamtsumme beantwortet keine dieser beiden Fragen und beantwortet
 * stattdessen eine dritte falsch — sie sieht aus wie ein Guthaben.
 *
 * Der Plan begründet das auch technisch (G5): der Sicherheitseinbehalt ist
 * eine eigene physische Zeile, und der Auszahlungslauf sammelt eine Zeile
 * ganz oder gar nicht ein. Eine Summe über alle Eimer wiche damit
 * zwangsläufig vom Auszahlungsbetrag ab — und eine Geldzahl, die von der
 * Überweisung abweicht, ist der Anfang eines Streits.
 *
 * Gerechnet wird hier NICHTS. Die Zahlen kommen aus `computeBalances()`
 * (compute.ts, 5.10) — der einzigen getesteten Stelle, an der die
 * Eimer-Zuordnung stattfindet, insbesondere die Regel, dass eine
 * Gegenbuchung in den Eimer ihres Elternteils gehört. Eine zweite Rechnung
 * in der Anzeige wäre genau die Stelle, an der Partneransicht und
 * Auszahlungslauf auseinanderlaufen.
 *
 * ## Währungen (5.11)
 *
 * Je `(partner_id, currency)` ein eigener Satz Karten. Es gibt keine
 * Umrechnung und keine währungsübergreifende Summe; ein Partner mit
 * Buchungen in zwei Währungen bekommt zwei Auszahlungen und sieht deshalb
 * auch zwei Blöcke.
 *
 * ## Barrierefreiheit (8.5)
 *
 * Jede Zahl steht als Text, jede Karte trägt ihren Erklärungssatz im Klartext
 * — keine Aussage steckt in einer Farbe oder in der Anordnung. Die fünf
 * Karten sind eine `<ul>`, damit ein Screenreader ihre Anzahl ansagt; die
 * Überschrift je Währung ist eine echte `<h3>`, damit sie in der
 * Überschriftenliste auftaucht. Ein negativer „verfügbar"-Wert (5.10: er
 * DARF negativ sein) wird zusätzlich in Worten erklärt und nicht nur durch
 * ein Minuszeichen.
 */

export type SaldoKartenEintrag = {
  balances: AffiliateBalances;
  /**
   * Frühestes `hold_until` der offenen Zeilen bzw. der Reserve-Zeilen —
   * „das Datum, ab dem der Betrag frei wird" (8.2). `null`, wenn der Eimer
   * leer ist; dann steht kein Datum da, statt eines erfundenen.
   */
  openFreeFrom: string | null;
  reservedFreeFrom: string | null;
};

export async function SaldoKarten({
  entries,
  complete,
}: {
  entries: readonly SaldoKartenEintrag[];
  /**
   * `false` heißt: mindestens eine Seite der Abfrage kam nicht an
   * (`fetchAllRows()` in queries.ts). Dann steht überall „nicht ermittelbar"
   * statt einer zu kleinen Zahl. Eine falsche Geldzahl ist schlimmer als gar
   * keine — und ein sehbehinderter Betrachter hat keine Chance, sie als
   * falsch zu erkennen.
   */
  complete: boolean;
}) {
  const t = await getTranslations("affiliate.dashboard");
  const format = await getFormatter();

  const money = (cents: number, currency: string): string => {
    if (!complete) return t("unavailable");
    const code = /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : "EUR";
    return format.number(cents / 100, { style: "currency", currency: code });
  };

  const day = (iso: string): string =>
    format.dateTime(new Date(iso), { year: "numeric", month: "2-digit", day: "2-digit" });

  return (
    <section aria-labelledby="saldo-heading" className="flex flex-col gap-4">
      <h2 id="saldo-heading" className="text-[17px] font-bold" style={{ color: PARTNER_INK }}>
        {t("balanceHeading")}
      </h2>

      {entries.length === 0 ? (
        <p className="text-[15px]" style={{ color: PARTNER_MUTED }}>
          {t("empty")}
        </p>
      ) : (
        entries.map((entry) => {
          const { balances } = entry;
          // Die fünf Eimer in der Reihenfolge, in der Geld sie durchläuft:
          // gebucht -> einbehalten -> geprüft -> frei -> überwiesen. Das ist
          // dieselbe Reihenfolge wie im Zustandsdiagramm (6.2) und damit die,
          // die ein Partner erwartet, wenn er von oben nach unten liest.
          const cards: Array<{
            id: string;
            label: string;
            hint: string;
            cents: number;
            freeFrom: string | null;
          }> = [
            {
              id: "open",
              label: t("balanceOpen"),
              hint: t("balanceOpenHint"),
              cents: balances.open_cents,
              freeFrom: entry.openFreeFrom,
            },
            {
              id: "reserved",
              label: t("balanceReserve"),
              hint: t("balanceReserveHint"),
              cents: balances.reserved_cents,
              freeFrom: entry.reservedFreeFrom,
            },
            {
              id: "in_review",
              label: t("balanceOnHold"),
              hint: t("balanceOnHoldHint"),
              cents: balances.in_review_cents,
              freeFrom: null,
            },
            {
              id: "available",
              label: t("balanceAvailable"),
              hint: t("balanceAvailableHint"),
              cents: balances.available_cents,
              freeFrom: null,
            },
            {
              id: "paid",
              label: t("balancePaid"),
              hint: t("balancePaidHint"),
              cents: balances.paid_cents,
              freeFrom: null,
            },
          ];

          return (
            <div key={balances.currency} className="flex flex-col gap-3">
              {entries.length > 1 && (
                <h3 className="text-[15px] font-bold" style={{ color: PARTNER_INK }}>
                  {balances.currency.toUpperCase()}
                </h3>
              )}
              <ul
                className="grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-5"
              >
                {cards.map((card) => (
                  <li
                    key={card.id}
                    className={`${PARTNER_CARD_CLASS} p-[16px_18px]`}
                    style={{ borderColor: PARTNER_BORDER }}
                  >
                    <p className="text-[13px] font-semibold" style={{ color: PARTNER_MUTED }}>
                      {card.label}
                    </p>
                    <p
                      className="mt-1 text-[20px] font-extrabold"
                      style={{ color: PARTNER_INK }}
                    >
                      {money(card.cents, balances.currency)}
                    </p>
                    <p className="mt-1 text-[13px]" style={{ color: PARTNER_MUTED }}>
                      {card.hint}
                    </p>
                    {card.freeFrom !== null && complete && (
                      <p className="mt-1 text-[13px]" style={{ color: PARTNER_MUTED }}>
                        {t("freeFrom", { date: day(card.freeFrom) })}
                      </p>
                    )}
                    {card.id === "available" && card.cents < 0 && complete && (
                      // Ein negativer verfügbarer Saldo entsteht durch Stornos
                      // nach einer Auszahlung (5.10). Er wird NICHT als Schuld
                      // eingezogen, sondern mit künftigen Provisionen
                      // verrechnet — das muss dastehen, sonst liest der
                      // Partner ein Minuszeichen als Forderung.
                      <p className="mt-1 text-[13px] font-semibold" style={{ color: PARTNER_INK }}>
                        {t("balanceNegativeHint")}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}
    </section>
  );
}
