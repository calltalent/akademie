---
typ: branding-paket
projekt: calltalent-akademie
mandant: SalesTalent (Tenant-ID 9707965d-b9aa-4841-9d70-68e3cae803f6)
erstellt: 2026-08-01
bezug: Branding/BRANDING.md (Calltalent-Stammmarke), DESIGN-MASTERPROMPT.md §3, SPEC.md §4.5
---

# SalesTalent — Branding-Paket (angelehnt an Calltalent)

Sibling-Marke für den internationalen Markt: gleiches Design-System wie Calltalent (Schrift, Radius, Barrierefreiheits-Regeln), eigene Akzentfarbe — analog zum Produktprinzip "eine Akzentfarbe je Mandant" (SPEC.md §4.5).

## 1. Übernommen von Calltalent (unverändert)

| Token | Wert | Quelle |
|---|---|---|
| Schrift | Montserrat | `Branding/BRANDING.md` §3 |
| Eckenradius | `14px` | `--ct-radius` |
| Cream (Akzent/Schrift auf dunkel) | `#F7EED4` | `--ct-cream` |
| Ink (Fließtext) | `#1A1A2E` | `--ct-ink` |
| Weiß | `#FFFFFF` | `--ct-white` |
| Barrierefreiheit | WCAG AA, Grundschrift ≥ 18px, Zeilenhöhe 1,6, Buttons/Links zusätzlich zur Farbe erkennbar, linienbasierte Einfarb-Icons, keine Verläufe außer optionalem Hero | `Branding/BRANDING.md` §4/§5, DESIGN-MASTERPROMPT.md §3 |

Bewusst **nicht** eine zweite Schriftfamilie eingeführt (Regel "keine zweite Schriftfamilie" gilt produktweit, nicht nur für Calltalent selbst).

## 2. Eigene Akzentfarbe für SalesTalent

Grund für eine eigene statt der identischen Periwinkle-Farbe: Das Produkt selbst ist als "eine Akzentfarbe je Mandant" konzipiert (SPEC.md §4.5) — SalesTalent ist technisch ein Mandant wie jeder Kunde auch, sollte sich also auch optisch als eigenständige Marke lesen lassen, nicht als umbenannter Klon.

| Token | Wert | Vergleich |
|---|---|---|
| `--st-cobalt` (Primär) | `#4655C6` | Gleiche Blau-Violett-Familie wie Calltalents Periwinkle `#5663AE`, satter/kühler — liest sich international/vertriebsorientiert statt warm-beraterisch. |
| `--st-cobalt-light` (Hover/Sekundär, dekorativ) | `#6B78D6` | Nur für Hover-Zustände, nicht für Text (Kontrast reicht dafür nicht). |
| `--st-indigo-dark` (dunkle Sektionen) | `#2E3163` | Etwas kühler als Calltalents `--ct-indigo-dark` (`#3E3F66`). |

**Kontrast geprüft (WCAG AA, Pflicht laut Branding-Regel — der Auftraggeber ist sehbehindert):** `#4655C6` auf Weiß und Weiß auf `#4655C6` ergeben ein Kontrastverhältnis von **6,2:1** — über der AA-Mindestanforderung von 4,5:1 für Fließtext, sogar etwas höher als Calltalents eigenes Periwinkle (5,5:1).

## 3. Live angewendet (Tenant-Datensatz, 01.08.2026)

Direkt in `tenants.branding` gesetzt (Supabase, Tenant `salestalent`):

```json
{
  "color_primary": "#4655C6",
  "color_bg": "#FFFFFF",
  "font": "Montserrat",
  "radius": "14px",
  "login_heading": "Welcome to SalesTalent",
  "login_subheading": "Sales training built for the way modern teams sell. Sign in to continue your program.",
  "login_copyright": "© 2026 SalesTalent. All rights reserved."
}
```

`color_primary`, `color_bg`, `radius` und die drei `login_*`-Felder sind **sofort sichtbar** auf `salestalent.app` (werden über `src/components/branding/theme-style.tsx` bzw. direkt in `login-form.tsx` eingebunden).

Copyright-Zeile bewusst neutral gehalten ("SalesTalent", keine Rechtsträger-Angabe wie "a Calltalent brand") — die Rechtsträger-Frage ist laut `Entscheidungs-Log.md` (30.07.2026) noch offen. Sobald geklärt, diese Zeile anpassen.

## 4. Bewusst NICHT gemacht — ehrlicher Stand

1. **`font: "Montserrat"` hat aktuell keine sichtbare Wirkung.** Laut Code-Kommentar in `src/lib/tenant/types.ts` ist das Feld "noch nicht in CSS eingebunden" (`theme-style.tsx` injiziert nur `--color-primary`/`--color-background`/`--radius`, keine Schriftart). Gesetzt für Dokumentationszwecke/Zukunftssicherheit, aber die Seite zeigt bis zu einem Code-Fix weiterhin die technische Fallback-Schrift.
2. **Kein Logo/Wortmarke als Bilddatei.** `branding.logo_url` bleibt leer — ohne Logo fällt die Oberfläche auf den Mandantennamen als Überschrift zurück (bereits vorhandenes, getestetes Verhalten, kein Fehlerzustand). Eine echte Wortmarke wäre ein eigener kleiner Auftrag (Logo-Design + Upload in den Storage-Bucket `branding/{tenant_id}/...`) — bewusst nicht Teil dieses Durchgangs, um keinen Datei-Upload mit Produktions-Zugangsdaten ad hoc zu improvisieren.
3. **`support_email` nicht gesetzt** — es existiert noch keine echte Mailbox für SalesTalent, ein Platzhalter hätte einen funktionierenden Kontaktweg vorgetäuscht.
4. **Rechtstexte weiterhin offen** (`legal.impressum_url`/`datenschutz_url`) — unverändert seit `SALESTALENT-KLON-ANLEITUNG.md` Abschnitt 6.
5. **Kein Eingriff in die Icon-/Layout-Ebene** (Dashboard, Kurskarten usw.) — das sind hartcodierte, mandantenunabhängige Komponenten (siehe `PHASENSTATUS.md`/`DESIGN-MASTERPROMPT.md` §4.3: "jede neue Komponente muss über `var(--color-primary)` arbeiten" ist als Soll-Regel dokumentiert, aber laut Code-Fund vom 30.07.2026 in weiten Teilen der Admin-/Portal-Oberfläche noch nicht umgesetzt — hartcodierte Hex-Werte statt CSS-Variablen). Diese Lücke betrifft alle Mandanten gleichermaßen, kein SalesTalent-spezifisches Problem.
