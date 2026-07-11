import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Security-Fix (security-reviewer-Durchgang Phase 3, 11.07.2026, MITTEL):
 * SSRF-Schutz für vom Mandanten frei eingebbare Webhook-Ziel-URLs.
 * `createWebhook()` (src/lib/settings/actions.ts) prüfte bisher nur
 * `z.string().url()` — jede erreichbare interne/private Adresse (localhost,
 * RFC1918-Bereiche, Cloud-Metadaten-IP 169.254.169.254 usw.) war zulässig.
 * Ein Owner/Admin (oder ein kompromittiertes Admin-Konto) hätte den Server
 * damit zu beliebigen internen Requests verleiten können (klassisches
 * Webhook-SSRF-Muster).
 *
 * Prüft sowohl bei Anlage (`createWebhook`) als auch bei jedem einzelnen
 * Zustellversuch (`deliverWebhookAttempt`) — DNS-Antworten können sich nach
 * der Anlage ändern (DNS-Rebinding), ein einmaliger Check bei Anlage allein
 * wäre nicht ausreichend.
 *
 * Bewusst KEIN vollständiger Rebinding-Schutz (würde ein Pinning der
 * aufgelösten IP über fetch() hinweg erfordern, in Node/fetch nicht ohne
 * Custom-Agent möglich) — reduziert aber die Angriffsfläche erheblich
 * gegenüber dem vorherigen Zustand (gar keine Prüfung).
 */

const BLOCKED_HOSTNAMES = new Set(["localhost"]);

function isPrivateOrReservedIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true; // defensiv: unparsebar -> blocken
  const [a, b] = parts;
  if (a === 127) return true; // Loopback
  if (a === 10) return true; // RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 169 && b === 254) return true; // Link-local, inkl. Cloud-Metadaten 169.254.169.254
  if (a === 0) return true; // "diese" Netzwerk
  return false;
}

function isPrivateOrReservedIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1") return true; // Loopback
  if (normalized === "::") return true;
  if (normalized.startsWith("fe80:")) return true; // Link-local
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // Unique local (fc00::/7)
  if (normalized.startsWith("::ffff:")) {
    // IPv4-mapped IPv6 -> die eingebettete IPv4-Adresse prüfen
    const v4 = normalized.split(":").pop();
    return v4 ? isPrivateOrReservedIPv4(v4) : true;
  }
  return false;
}

function isPrivateOrReservedIP(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateOrReservedIPv4(ip);
  if (version === 6) return isPrivateOrReservedIPv6(ip);
  return true; // unbekanntes Format -> defensiv blocken
}

/**
 * Wirft eine Error mit nutzerverständlicher Meldung, wenn die URL als
 * Webhook-Ziel unsicher ist. Gibt sonst nichts zurück (kein Wert nötig).
 */
export async function assertSafeWebhookUrl(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Ungültige URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Nur http/https-URLs sind als Webhook-Ziel erlaubt.");
  }

  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost")) {
    throw new Error("Interne/lokale Adressen sind als Webhook-Ziel nicht erlaubt.");
  }

  // Falls der Hostname bereits eine IP-Literal ist, direkt prüfen (keine DNS-Auflösung nötig).
  if (isIP(hostname)) {
    if (isPrivateOrReservedIP(hostname)) {
      throw new Error("Interne/private Adressen sind als Webhook-Ziel nicht erlaubt.");
    }
    return;
  }

  // DNS auflösen und ALLE zurückgegebenen Adressen prüfen (nicht nur die erste).
  try {
    const results = await lookup(hostname, { all: true, verbatim: true });
    if (results.length === 0) {
      throw new Error("Webhook-URL konnte nicht aufgelöst werden.");
    }
    for (const { address } of results) {
      if (isPrivateOrReservedIP(address)) {
        throw new Error("Webhook-URL zeigt auf eine interne/private Adresse — nicht erlaubt.");
      }
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes("nicht erlaubt")) throw e;
    throw new Error("Webhook-URL konnte nicht aufgelöst werden.");
  }
}
