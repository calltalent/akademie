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
 *
 * `ariaLabel`/`title` kommen vorformatiert vom Aufrufer (Block C4, i18n):
 * einer der beiden Aufrufer ist eine Client Component
 * (`product-row.tsx`), der andere eine Server Component
 * (`orders-table.tsx`) — ein eigener `useTranslations()`/`getTranslations()`-
 * Aufruf hier würde diese Komponente an einen der beiden Component-Typen
 * binden, gleiches Muster wie `PageChrome`s `brandName`-Props (Block C2).
 */
export function PayLinkIcon({
  productSlug,
  ariaLabel,
  title,
}: {
  productSlug: string | null;
  ariaLabel: string;
  title: string;
}) {
  if (!productSlug) return null;

  return (
    <a
      href={`/kaufen/${productSlug}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={ariaLabel}
      title={title}
      className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-[8px]"
      style={{ background: "#F4F5FA" }}
    >
      <ExternalLink size={15} color="#5663AE" strokeWidth={2.2} aria-hidden="true" />
    </a>
  );
}
