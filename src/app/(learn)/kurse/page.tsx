import { redirect } from "next/navigation";

/**
 * Der Kurskatalog zog nach /kurskatalog um (Folgeauftrag „Kurskatalog nach
 * Kurskatalog.dc.html"). Diese Route bleibt als dauerhafte Weiterleitung
 * bestehen, damit alte Links/Lesezeichen (und die frühere Sidebar-
 * Verlinkung) weiter funktionieren.
 */
export default function KursePage() {
  redirect("/kurskatalog");
}
