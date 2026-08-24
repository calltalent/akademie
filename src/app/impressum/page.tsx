import { redirect } from "next/navigation";

/**
 * Deutschsprachiger Alias auf die kanonische Rechtsseite `/legal-notice`
 * (24.08.2026). Die Rechtsseiten der Mandanten liegen unter englischen
 * Pfaden, weil sie mit der internationalen Marke salestalent.app eingeführt
 * wurden — bestehende deutsche Links/Direkteingaben (`/impressum`, Muster der
 * Marketplace-Seiten) sollen trotzdem ankommen statt ins Leere zu laufen.
 *
 * Bewusst außerhalb der Route-Group `(legal)`: deren Layout prüft den
 * hinterlegten Rechtsträger und würde hier nur unnötig laufen, bevor
 * ohnehin weitergeleitet wird. Auf `marketplace.calltalent.ai` wird
 * `/impressum` schon in der Middleware auf `/marketplace/impressum`
 * umgeschrieben (tenant/routing.ts) — diese Datei sieht der Marketplace-Host
 * also nie.
 */
export default function ImpressumAliasPage() {
  redirect("/legal-notice");
}
