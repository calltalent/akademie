import { ExternalLink } from "lucide-react";

/**
 * "Zahlungsseite ansehen"-Symbol (Design-Import AdminZahlungen.dc.html,
 * 19.07.2026) — führt auf die echte, bereits bestehende Kaufseite
 * `/kaufen/[productSlug]`, nicht auf einen Mockup-Platzhalter. Geteilt
 * zwischen der Produkt- und der Bestellungen-Tabelle (dieselbe Zielseite,
 * nur aus zwei verschiedenen Zeilentypen heraus verlinkt).
 *
 * `productSlug` kann bei einer Bestellung fehlen (verknüpftes Produkt
 * inzwischen gelöscht) — dann kein Link statt eines toten Verweises.
 */
export function PayLinkIcon({
  productSlug,
  productTitle,
}: {
  productSlug: string | null;
  productTitle: string;
}) {
  if (!productSlug) return null;

  return (
    <a
      href={`/kaufen/${productSlug}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Zahlungsseite ansehen: ${productTitle}`}
      title="Zahlungsseite ansehen"
      className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-[8px]"
      style={{ background: "#F4F5FA" }}
    >
      <ExternalLink size={15} color="#5663AE" strokeWidth={2.2} aria-hidden="true" />
    </a>
  );
}
