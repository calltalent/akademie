import Link from "next/link";
import {
  AFFILIATE_EVENT_BACKLOG_HOURS,
  defaultOperatorRange,
  formatOperatorCents,
  getOperatorAffiliateReport,
  operatorAffiliateFilterSchema,
} from "./queries";

/**
 * Betreiber-Aufsicht über das Partnerprogramm — NUR LESEN
 * (PLAN_Affiliate-System.md 8.4 und 7.7), Block B9.
 *
 * WOZU DIESE SEITE DA IST: der Betreiber ist Merchant of Record (1.3). Er
 * zahlt die Provision an die Partner aus, ist aber beim Partnerprogramm
 * selbst nicht Vertragspartei — er muss die ausgezahlten Beträge dem
 * Mandanten in Rechnung stellen. Genau diese Zahl steht hier: je Mandant,
 * Monat und Währung die Summe der auf `paid` gesetzten Provisionszeilen,
 * plus eine CSV für die Buchhaltung. Ein automatischer Abzug wird bewusst
 * NICHT gebaut (offene Entscheidung 12.1) — außerhalb des Marketplace gibt
 * es gar keinen Zahlungsstrom vom Betreiber zum Mandanten.
 *
 * KEINE AKTIONEN. Diese Seite hat kein Formular, das etwas verändert, und
 * deshalb auch keine Server Action und keine CSRF-Fläche. Der einzige
 * Formular-POST wäre ein Filter — und der läuft als `method="get"`, wie in
 * `portal/marketplace/auszahlungen/page.tsx`: eine Server Component liest
 * `searchParams`, es braucht kein zusätzliches JavaScript, und die Seite
 * funktioniert auch ohne aktives JS.
 *
 * WAS HIER NICHT STEHT (8.4, letzter Absatz): keine Bankverbindung eines
 * Partners, kein Partnername, keine Käuferdaten, keine Klickzeile. Bewusst
 * enger als die Marketplace-Auszahlungsansicht.
 *
 * BARRIEREFREIHEIT (8.5) — die Entscheidungen dieser Datei:
 *
 *  - JEDE Kennzahl steht als Text. Es gibt auf dieser Seite keine Grafik,
 *    keinen Balken und keinen Farbpunkt, der eine Zahl trägt. Eine
 *    Auffälligkeit ist ein deutscher Satz, kein rotes Dreieck.
 *  - Status und Schwere NIE nur über Farbe: jeder Befund trägt das Wort
 *    „Kritisch" bzw. „Hinweis" als Text; die Farbe wiederholt es nur.
 *  - Kontraste, nachgerechnet nach WCAG 2.1 (relative Luminanz) gegen den
 *    Kartengrund #0F172A:
 *        #F8FAFC (Werte, Überschriften)  17,06:1
 *        #A9B4C6 (Label, Sekundärtext)    8,53:1
 *        #FCA5A5 (kritischer Befund)      9,41:1
 *        #FDBA74 (Hinweis)               10,59:1
 *    Der im übrigen Portal verwendete Ton #64748B liegt auf demselben Grund
 *    bei 3,75:1 und fällt damit durch AA — er wird hier NICHT benutzt, auch
 *    nicht der Einheitlichkeit halber. Das global definierte `.rgrid-label`
 *    trägt fest #66679B (auf diesem Grund 3,38:1, also ebenfalls zu wenig)
 *    und bekommt deshalb an jeder Stelle eine Inline-Farbe, die die
 *    Klassenfarbe überschreibt.
 *  - Unter 1024 px stapeln die `rgrid`-Zeilen zu Karten; jede Zelle, deren
 *    Wert ohne Spaltenüberschrift mehrdeutig wäre, trägt ein `rgrid-label`.
 *  - Fließtext 15 px, Label 13 px; Klickziele mindestens 40 px hoch.
 *  - Skip-Link zum Hauptinhalt, sichtbar sobald er den Fokus hat.
 */

export const dynamic = "force-dynamic";

/** Kartengrund; alle Kontrastangaben im Kopf beziehen sich hierauf. */
const CARD = { borderColor: "#1e293b", background: "#0f172a" } as const;
const INPUT = { borderColor: "#334155", background: "#020617", color: "#f8fafc" } as const;
/** 8,53:1 auf #0F172A — der Sekundärton dieser Seite. */
const MUTED = "#A9B4C6";
const FOCUS =
  "focus:outline-none focus:ring-2 focus:ring-slate-200 focus:ring-offset-2 focus:ring-offset-slate-950";

const PROGRAM_STATUS_LABELS: Record<string, string> = {
  draft: "Entwurf",
  active: "Aktiv",
  paused: "Pausiert",
  unbekannt: "Unbekannt",
};

function formatPercent(value: number | null): string {
  if (value === null) return "—";
  return `${(value * 100).toFixed(1).replace(".", ",")} %`;
}

function formatMonth(month: string): string {
  const [year, m] = month.split("-");
  const names = [
    "Januar",
    "Februar",
    "März",
    "April",
    "Mai",
    "Juni",
    "Juli",
    "August",
    "September",
    "Oktober",
    "November",
    "Dezember",
  ];
  const index = Number(m) - 1;
  return names[index] ? `${names[index]} ${year}` : month;
}

function Label({ children }: { children: React.ReactNode }) {
  // Inline-Farbe schlägt die globale `.rgrid-label`-Farbe (#66679B, auf
  // diesem Grund nur 3,38:1) — siehe Kopfkommentar.
  return (
    <span className="rgrid-label" style={{ color: MUTED }}>
      {children}
    </span>
  );
}

export default async function PortalAffiliatePage({
  searchParams,
}: {
  searchParams: Promise<{ tenantId?: string; from?: string; to?: string }>;
}) {
  const raw = await searchParams;
  const parsed = operatorAffiliateFilterSchema.safeParse({
    tenantId: raw.tenantId || undefined,
    from: raw.from || undefined,
    to: raw.to || undefined,
  });
  // Ein unbrauchbarer Filter (manuell bearbeiteter Link) führt still zum
  // Vorgabezeitraum statt zu einer Fehlerseite — dieselbe Toleranz wie in
  // `portal/marketplace/auszahlungen/page.tsx`. Der CSV-Export ist strenger:
  // dort ist eine 400-Antwort die ehrlichere Auskunft.
  const filter = parsed.success ? parsed.data : {};
  const fallback = defaultOperatorRange();

  const report = await getOperatorAffiliateReport(filter);

  const exportParams = new URLSearchParams();
  if (filter.tenantId) exportParams.set("tenantId", filter.tenantId);
  exportParams.set("from", report.from);
  exportParams.set("to", report.to);
  const exportHref = `/portal/affiliate/export?${exportParams.toString()}`;

  const totalsByCurrency = new Map<string, number>();
  for (const row of report.billing) {
    totalsByCurrency.set(row.currency, (totalsByCurrency.get(row.currency) ?? 0) + row.netCents);
  }

  const allFindings = report.tenants.flatMap((t) =>
    t.findings.map((f) => ({ ...f, tenantName: t.tenantName, tenantId: t.tenantId })),
  );

  return (
    <>
      <a
        href="#inhalt"
        className={`sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-slate-100 focus:px-4 focus:py-2 focus:text-[15px] focus:font-bold focus:text-slate-900 ${FOCUS}`}
      >
        Zum Hauptinhalt springen
      </a>

      <main id="inhalt" className="flex flex-col gap-6 text-[15px]">
        <div>
          <Link href="/portal" className={`text-[13px] font-semibold no-underline ${FOCUS}`} style={{ color: MUTED }}>
            Portal
          </Link>
          <span className="text-[13px] font-semibold" style={{ color: MUTED }}>
            {" "}
            / Partnerprogramm
          </span>
          <h1 className="mt-0.5 text-[26px] font-extrabold text-slate-50" style={{ letterSpacing: "-0.01em" }}>
            Partnerprogramm — Aufsicht
          </h1>
          <p className="mt-1 max-w-3xl" style={{ color: MUTED }}>
            Nur-Lese-Ansicht. Sie zeigt, welche Mandanten ein Partnerprogramm betreiben und welche
            Provision der Betreiber im gewählten Zeitraum ausgezahlt hat — also den Betrag, der dem
            jeweiligen Mandanten in Rechnung zu stellen ist. Partner-Bankdaten und Käuferdaten
            erscheinen hier nicht.
          </p>
        </div>

        <form
          method="get"
          className="flex flex-wrap items-end gap-4 rounded-[14px] border p-5"
          style={CARD}
          aria-labelledby="filter-heading"
        >
          <h2 id="filter-heading" className="sr-only">
            Zeitraum und Mandant eingrenzen
          </h2>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="filter-tenantId" className="text-[13px] font-bold text-slate-100">
              Mandant
            </label>
            <select
              id="filter-tenantId"
              name="tenantId"
              defaultValue={filter.tenantId ?? ""}
              className={`min-h-[40px] w-60 rounded-lg border px-3 py-2 text-[15px] ${FOCUS}`}
              style={INPUT}
            >
              <option value="">Alle Mandanten</option>
              {report.tenants.map((t) => (
                <option key={t.tenantId} value={t.tenantId}>
                  {t.tenantName}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="filter-from" className="text-[13px] font-bold text-slate-100">
              Von (Buchungsdatum)
            </label>
            <input
              id="filter-from"
              name="from"
              type="date"
              defaultValue={filter.from ?? fallback.from}
              className={`min-h-[40px] rounded-lg border px-3 py-2 text-[15px] ${FOCUS}`}
              style={INPUT}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="filter-to" className="text-[13px] font-bold text-slate-100">
              Bis (Buchungsdatum)
            </label>
            <input
              id="filter-to"
              name="to"
              type="date"
              defaultValue={filter.to ?? fallback.to}
              className={`min-h-[40px] rounded-lg border px-3 py-2 text-[15px] ${FOCUS}`}
              style={INPUT}
            />
          </div>
          <button
            type="submit"
            className={`min-h-[40px] rounded-[10px] px-[18px] py-2.5 text-[15px] font-bold text-white ${FOCUS}`}
            style={{ background: "var(--color-primary)" }}
          >
            Filtern
          </button>
          <Link
            href="/portal/affiliate"
            className={`min-h-[40px] rounded-[10px] px-2 py-2.5 text-[15px] font-semibold no-underline ${FOCUS}`}
            style={{ color: MUTED }}
          >
            Zurücksetzen
          </Link>
          <a
            href={exportHref}
            className={`ml-auto min-h-[40px] rounded-[10px] border px-[18px] py-2.5 text-[15px] font-bold no-underline text-slate-100 ${FOCUS}`}
            style={{ borderColor: "#334155" }}
          >
            CSV für die Buchhaltung
          </a>
        </form>

        {report.truncated && (
          <p
            role="alert"
            className="rounded-[14px] border px-5 py-4 text-[15px] font-semibold"
            style={{ ...CARD, borderColor: "#FDBA74", color: "#FDBA74" }}
          >
            Achtung: Der Zeitraum enthält mehr Provisionszeilen, als ein Bericht auf einmal lädt. Die
            Summen unten sind deshalb UNVOLLSTÄNDIG. Bitte den Zeitraum verkleinern oder einen
            einzelnen Mandanten wählen.
          </p>
        )}

        {/* --- Auffälligkeiten ------------------------------------------- */}
        <section className="rounded-[14px] border p-5" style={CARD} aria-labelledby="auffaelligkeiten">
          <h2 id="auffaelligkeiten" className="text-[17px] font-bold text-slate-50">
            Auffälligkeiten
          </h2>
          <p className="mt-1 text-[13px]" style={{ color: MUTED }}>
            Stornoquote über 20 %, Negativsalden älter als 90 Tage, Zahlungsereignisse älter als{" "}
            {AFFILIATE_EVENT_BACKLOG_HOURS} Stunden, Abweichungen aus dem Kontrollabgleich.
          </p>
          {allFindings.length === 0 ? (
            <p className="mt-4" style={{ color: MUTED }}>
              Keine Auffälligkeiten im gewählten Zeitraum.
            </p>
          ) : (
            <ul className="mt-4 flex flex-col gap-3">
              {allFindings.map((finding, index) => (
                <li
                  key={`${finding.tenantId}-${finding.kind}-${index}`}
                  className="rounded-[10px] border px-4 py-3"
                  style={{ borderColor: "#334155" }}
                >
                  {/* Schwere als WORT, nicht nur als Farbe (8.5). */}
                  <span
                    className="text-[13px] font-bold uppercase"
                    style={{
                      letterSpacing: "0.06em",
                      color: finding.severity === "critical" ? "#FCA5A5" : "#FDBA74",
                    }}
                  >
                    {finding.severity === "critical" ? "Kritisch" : "Hinweis"}
                  </span>
                  <p className="mt-1 text-slate-50">
                    <strong className="font-bold">{finding.tenantName}:</strong> {finding.text}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {(report.unassignedEvents.pending > 0 || report.unassignedEvents.errored > 0) && (
            <p className="mt-4 text-[15px]" style={{ color: "#FDBA74" }}>
              <span className="font-bold uppercase text-[13px]" style={{ letterSpacing: "0.06em" }}>
                Hinweis
              </span>
              {" — "}
              {report.unassignedEvents.pending + report.unassignedEvents.errored} Zahlungsereignisse
              ohne zugeordneten Mandanten liegen länger als {AFFILIATE_EVENT_BACKLOG_HOURS} Stunden
              (davon {report.unassignedEvents.errored} mit Fehler
              {report.unassignedEvents.oldestAt
                ? `, ältestes vom ${report.unassignedEvents.oldestAt.slice(0, 10)}`
                : ""}
              ). Sie gehören keinem Mandanten und erscheinen deshalb in keinem Mandanten-Dashboard.
            </p>
          )}
        </section>

        {/* --- Mandanten -------------------------------------------------- */}
        <section className="rounded-[14px] border p-5" style={CARD} aria-labelledby="mandanten">
          <h2 id="mandanten" className="text-[17px] font-bold text-slate-50">
            Mandanten mit Partnerprogramm
          </h2>
          <p className="mt-1 text-[13px]" style={{ color: MUTED }}>
            {report.tenants.length} Mandant(en). Zeitraum {report.from} bis {report.to}.
          </p>

          {report.tenants.length === 0 ? (
            <p className="mt-4" style={{ color: MUTED }}>
              Kein Mandant betreibt derzeit ein Partnerprogramm.
            </p>
          ) : (
            <div className="mt-4 flex flex-col">
              <div
                className="rgrid-header border-b pb-2 text-[13px] font-bold uppercase"
                style={{ ["--rgrid-cols" as string]: "2fr 1fr 1fr 1fr 1.4fr", borderColor: "#334155", color: MUTED, letterSpacing: "0.04em" }}
              >
                <span>Mandant</span>
                <span>Programm</span>
                <span>Partner aktiv</span>
                <span>Bewerbungen offen</span>
                <span>Stornoquote</span>
              </div>
              {report.tenants.map((t) => (
                <div
                  key={t.tenantId}
                  className="rgrid-row border-b py-3"
                  style={{ ["--rgrid-cols" as string]: "2fr 1fr 1fr 1fr 1.4fr", borderColor: "#1e293b" }}
                >
                  <span className="font-bold text-slate-50">{t.tenantName}</span>
                  <span className="text-slate-100">
                    <Label>Programm</Label>
                    {PROGRAM_STATUS_LABELS[t.programStatus] ?? t.programStatus}
                  </span>
                  <span className="text-slate-100">
                    <Label>Partner aktiv</Label>
                    {t.activePartners}
                  </span>
                  <span className="text-slate-100">
                    <Label>Bewerbungen offen</Label>
                    {t.pendingApplications}
                  </span>
                  <span className="text-slate-100">
                    <Label>Stornoquote</Label>
                    {formatPercent(t.reversalRate)}
                    {t.paid.length > 0 && (
                      <span className="block text-[13px]" style={{ color: MUTED }}>
                        ausgezahlt:{" "}
                        {t.paid.map((p) => formatOperatorCents(p.netCents, p.currency)).join(" · ")}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* --- Abrechnung -------------------------------------------------- */}
        <section className="rounded-[14px] border p-5" style={CARD} aria-labelledby="abrechnung">
          <h2 id="abrechnung" className="text-[17px] font-bold text-slate-50">
            Weiterbelastung an die Mandanten
          </h2>
          <p className="mt-1 max-w-3xl text-[13px]" style={{ color: MUTED }}>
            Summe der auf „bezahlt“ gesetzten Provisionszeilen, gruppiert nach Mandant, Auszahlungsmonat
            und Währung. Gegenbuchungen (Storno, Rückbuchung) sind mit negativem Vorzeichen bereits
            abgezogen; belastet wird der Netto-Betrag.
          </p>

          {report.billing.length === 0 ? (
            <p className="mt-4" style={{ color: MUTED }}>
              Im gewählten Zeitraum wurde keine Provision ausgezahlt.
            </p>
          ) : (
            <>
              <div className="mt-4 flex flex-col">
                <div
                  className="rgrid-header border-b pb-2 text-[13px] font-bold uppercase"
                  style={{ ["--rgrid-cols" as string]: "2fr 1.2fr 1fr 1fr 1fr 0.7fr", borderColor: "#334155", color: MUTED, letterSpacing: "0.04em" }}
                >
                  <span>Mandant</span>
                  <span>Monat</span>
                  <span>Ausgezahlt</span>
                  <span>Storniert</span>
                  <span>Netto</span>
                  <span>Zeilen</span>
                </div>
                {report.billing.map((row) => (
                  <div
                    key={`${row.tenantId}-${row.month}-${row.currency}`}
                    className="rgrid-row border-b py-3"
                    style={{ ["--rgrid-cols" as string]: "2fr 1.2fr 1fr 1fr 1fr 0.7fr", borderColor: "#1e293b" }}
                  >
                    <span className="font-bold text-slate-50">{row.tenantName}</span>
                    <span className="text-slate-100">
                      <Label>Monat</Label>
                      {formatMonth(row.month)}
                    </span>
                    <span className="text-slate-100">
                      <Label>Ausgezahlt</Label>
                      {formatOperatorCents(row.paidCents, row.currency)}
                    </span>
                    <span className="text-slate-100">
                      <Label>Storniert</Label>
                      {formatOperatorCents(row.reversedCents, row.currency)}
                    </span>
                    <span className="font-bold text-slate-50">
                      <Label>Netto</Label>
                      {formatOperatorCents(row.netCents, row.currency)}
                    </span>
                    <span className="text-slate-100">
                      <Label>Zeilen</Label>
                      {row.lines}
                    </span>
                  </div>
                ))}
              </div>

              {/* Die Gesamtsumme steht als eigener Satz und nicht nur als
                  Tabellenfuß: sie ist die Zahl, wegen der jemand diese Seite
                  öffnet, und sie muss ohne Tabellennavigation lesbar sein. */}
              <p className="mt-4 text-slate-50">
                <strong className="font-bold">Gesamt im Zeitraum:</strong>{" "}
                {[...totalsByCurrency.entries()]
                  .sort((a, b) => a[0].localeCompare(b[0]))
                  .map(([currency, cents]) => formatOperatorCents(cents, currency))
                  .join(" · ")}
              </p>
            </>
          )}
        </section>
      </main>
    </>
  );
}
