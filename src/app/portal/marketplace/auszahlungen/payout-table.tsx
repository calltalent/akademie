"use client";

import { useMemo, useState, useTransition } from "react";
import { markPayoutPaid } from "@/lib/platform/marketplace";
import type { PayoutRow } from "@/lib/platform/marketplace";

/**
 * Ledger-Tabelle mit Mehrfachauswahl "Als ausgezahlt markieren" (Marketplace
 * M6, Plan Abschnitt 7). Direkter Aufruf von `markPayoutPaid()` per
 * `useTransition` — gleiches Muster wie `portal/marketplace/[id]/review-form.tsx`
 * (kein `useActionState`, da diese Server-Funktion bewusst ohne
 * FormData/`_prevState`-Signatur direkt mit `(ledgerIds, payoutReference)`
 * aufgerufen wird, siehe dortiger Kopfkommentar).
 *
 * Nur `payout_status='open'`-Zeilen bekommen eine Checkbox — bereits
 * ausgezahlte/stornierte Zeilen sind reine Historie und nicht mehr
 * veränderbar (`markPayoutPaid()` trifft laut Compare-and-Swap ohnehin nur
 * noch offene Zeilen).
 */

const STATUS_LABELS: Record<PayoutRow["payoutStatus"], string> = {
  open: "Offen",
  paid: "Ausgezahlt",
  cancelled: "Storniert",
};

const STATUS_COLORS: Record<PayoutRow["payoutStatus"], string> = {
  open: "#F5B841",
  paid: "#1F8A5B",
  cancelled: "#64748B",
};

function formatDateDe(iso: string): string {
  return new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatAmount(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function formatCommission(bp: number): string {
  return `${(bp / 100).toString().replace(".", ",")} %`;
}

export function PayoutTable({ rows }: { rows: PayoutRow[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [payoutReference, setPayoutReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();

  const openRows = useMemo(() => rows.filter((r) => r.payoutStatus === "open"), [rows]);
  const allOpenSelected = openRows.length > 0 && openRows.every((r) => selected.has(r.id));

  function toggleRow(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAllOpen(checked: boolean) {
    setSelected(checked ? new Set(openRows.map((r) => r.id)) : new Set());
  }

  function handleMarkPaid() {
    setError(null);
    setSuccess(false);
    if (selected.size === 0) {
      setError("Bitte mindestens eine offene Zeile auswählen.");
      return;
    }
    if (payoutReference.trim().length < 3) {
      setError("Bitte eine Auszahlungsreferenz angeben (mindestens 3 Zeichen).");
      return;
    }
    startTransition(async () => {
      const result = await markPayoutPaid([...selected], payoutReference);
      if (result.error) {
        setError(result.error);
      } else {
        setSuccess(true);
        setSelected(new Set());
        setPayoutReference("");
      }
    });
  }

  if (rows.length === 0) {
    return (
      <div
        className="rounded-[14px] border p-14 text-center"
        style={{ borderColor: "#1e293b", background: "#0f172a", color: "#64748B" }}
      >
        <div className="mb-1.5 text-base font-bold" style={{ color: "#CBD5E1" }}>
          Keine Ledger-Einträge
        </div>
        <div className="text-sm">Für die gewählten Filter liegen keine Marketplace-Bestellungen vor.</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {openRows.length > 0 && (
        <div
          className="flex flex-wrap items-end gap-4 rounded-[14px] border p-5"
          style={{ borderColor: "#1e293b", background: "#0f172a" }}
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="payout-reference" className="text-sm font-semibold text-slate-200">
              Auszahlungsreferenz
            </label>
            <input
              id="payout-reference"
              type="text"
              value={payoutReference}
              onChange={(e) => setPayoutReference(e.target.value)}
              placeholder="z. B. SEPA-Überweisung Ref. XY"
              className="w-72 rounded-lg border bg-transparent px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-300"
              style={{ borderColor: "#1e293b" }}
            />
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={handleMarkPaid}
            className="rounded-[10px] px-[18px] py-2.5 text-sm font-bold text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-950"
            style={{ background: "#1F8A5B" }}
          >
            {pending ? "Markiert …" : `Ausgewählte als ausgezahlt markieren (${selected.size})`}
          </button>
          {error && (
            <p role="alert" className="w-full text-sm text-red-400">
              {error}
            </p>
          )}
          {success && !error && (
            <p role="status" aria-live="polite" className="w-full text-sm text-green-400">
              Als ausgezahlt markiert.
            </p>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-[14px] border" style={{ borderColor: "#1e293b", background: "#0f172a" }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Marketplace-Auszahlungen, eine Zeile je Bestellung</caption>
            <thead>
              <tr style={{ borderBottom: "1px solid #1e293b" }}>
                {openRows.length > 0 && (
                  <th scope="col" className="px-4 py-3 text-left">
                    <label className="sr-only" htmlFor="select-all-open">
                      Alle offenen Zeilen auswählen
                    </label>
                    <input
                      id="select-all-open"
                      type="checkbox"
                      checked={allOpenSelected}
                      onChange={(e) => toggleAllOpen(e.target.checked)}
                      style={{ accentColor: "#5663AE" }}
                    />
                  </th>
                )}
                <th scope="col" className="px-4 py-3 text-left font-bold" style={{ color: "#64748B" }}>
                  Mandant
                </th>
                <th scope="col" className="px-4 py-3 text-left font-bold" style={{ color: "#64748B" }}>
                  Bestellung
                </th>
                <th scope="col" className="px-4 py-3 text-left font-bold" style={{ color: "#64748B" }}>
                  Datum
                </th>
                <th scope="col" className="px-4 py-3 text-right font-bold" style={{ color: "#64748B" }}>
                  Brutto
                </th>
                <th scope="col" className="px-4 py-3 text-right font-bold" style={{ color: "#64748B" }}>
                  Provision
                </th>
                <th scope="col" className="px-4 py-3 text-right font-bold" style={{ color: "#64748B" }}>
                  Netto
                </th>
                <th scope="col" className="px-4 py-3 text-left font-bold" style={{ color: "#64748B" }}>
                  Status
                </th>
                <th scope="col" className="px-4 py-3 text-left font-bold" style={{ color: "#64748B" }}>
                  Referenz
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderBottom: "1px solid #1e293b" }}>
                  {openRows.length > 0 && (
                    <td className="px-4 py-3">
                      {r.payoutStatus === "open" && (
                        <>
                          <label className="sr-only" htmlFor={`row-${r.id}`}>
                            Zeile auswählen: {r.tenantName}, Bestellung {r.orderId}, {formatDateDe(r.createdAt)}
                          </label>
                          <input
                            id={`row-${r.id}`}
                            type="checkbox"
                            checked={selected.has(r.id)}
                            onChange={(e) => toggleRow(r.id, e.target.checked)}
                            style={{ accentColor: "#5663AE" }}
                          />
                        </>
                      )}
                    </td>
                  )}
                  <td className="px-4 py-3 text-slate-100">{r.tenantName}</td>
                  <td className="max-w-[160px] break-all px-4 py-3 font-mono text-xs" style={{ color: "#CBD5E1" }}>
                    {r.orderId}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap" style={{ color: "#CBD5E1" }}>
                    {formatDateDe(r.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap text-slate-100">
                    {formatAmount(r.grossCents)} {r.currency.toUpperCase()}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap" style={{ color: "#CBD5E1" }}>
                    {formatAmount(r.commissionCents)} {r.currency.toUpperCase()}
                    <span className="ml-1" style={{ color: "#475569" }}>
                      ({formatCommission(r.commissionRateBp)})
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-slate-100">
                    {formatAmount(r.netCents)} {r.currency.toUpperCase()}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap font-semibold" style={{ color: STATUS_COLORS[r.payoutStatus] }}>
                    {STATUS_LABELS[r.payoutStatus] ?? r.payoutStatus}
                  </td>
                  <td className="px-4 py-3" style={{ color: "#64748B" }}>
                    {r.payoutReference ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
