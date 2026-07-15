import { redirect } from "next/navigation";

/**
 * Die Teilnehmer-Verwaltung zog nach /admin/teilnehmer um (Folgeauftrag
 * „AdminTeilnehmer.dc.html"). Diese Route bleibt als dauerhafte
 * Weiterleitung, damit alte Links/Lesezeichen weiter funktionieren. Die
 * frühere serverseitige `?q=`-Suche ist dort durch eine client-seitige Suche
 * ersetzt, der Parameter entfällt daher.
 */
export default function AdminNutzerPage() {
  redirect("/admin/teilnehmer");
}
