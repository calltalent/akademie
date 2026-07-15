import { redirect } from "next/navigation";

/**
 * Der Einstellungen-Bereich zog nach /einstellungen um (Folgeauftrag „Voller
 * Ausbau", Einstellungen.dc.html). Diese Route bleibt als dauerhafte
 * Weiterleitung, damit alte Links/Lesezeichen (z. B.
 * /profil?tab=benachrichtigungen) weiter funktionieren. Die Unterroute
 * /profil/export (Datenexport) bleibt davon unberührt.
 */
export default async function ProfilPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  redirect(tab ? `/einstellungen?tab=${encodeURIComponent(tab)}` : "/einstellungen");
}
