# Marketing-Skills (Fremdquelle)

Diese Skills stammen aus dem Repository
[coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills)
(MIT-Lizenz, siehe `LICENSE-marketingskills`).

- **Plugin-Version:** 2.11.0
- **Quell-Commit:** `becd60ee9df07f7d595c26e092253ba49f7a9ffc` (2026-08-24)
- **Installiert am:** 2026-08-26
- **Umfang:** 50 Skills unter `.claude/skills/` + Tool-Registry unter `.claude/tools/`

## Warum `.claude/tools/`

Viele Skills verlinken relativ auf `../../tools/REGISTRY.md` bzw.
`../../../tools/integrations/*.md`. Damit diese Verweise aufgehen, liegt das
`tools/`-Verzeichnis des Quell-Repos parallel zu `skills/` unter `.claude/`.

## DACH-Rechtsebene (lokal ergänzt)

Die Upstream-Skills beschreiben US-Recht (CAN-SPAM, TCPA, FTC). Für den
deutschsprachigen Raum gilt teilweise das Gegenteil — Kaltakquise per E-Mail
etwa ist nach § 7 Abs. 2 UWG ohne vorherige Einwilligung unzulässig, auch im
B2B. Deshalb liegt neben den Skills eine eigene Rechtsebene:

- **`marketing-recht-dach/`** — eigener Skill mit dem DACH-Rahmen: Schnellurteile
  je Maßnahme, vier Referenzen (Einwilligung, Tracking/Consent, Website- und
  Vertragspflichten, Werbeaussagen) und in `references/skill-audit.md` das
  Prüfergebnis für alle 50 Upstream-Skills mit konkreten Fundstellen.
- **Hinweisblöcke in 31 Upstream-`SKILL.md`** — je ein markierter Block
  (`DACH-HINWEIS`) unterhalb des Frontmatters mit dem für diesen Skill
  einschlägigen Punkt.

**Die US-Fassungen bleiben unverändert.** Die Blöcke sind reine Ergänzung; die
Upstream-Texte sind byteweise identisch mit dem Quell-Repo und gelten weiter
für US-Empfänger. Nachweisbar über den Rundlauf:

```bash
scripts/dach-hinweise-anwenden.sh --entfernen   # Blöcke raus -> exakter Upstream-Stand
scripts/dach-hinweise-anwenden.sh               # Blöcke wieder rein
scripts/dach-hinweise-anwenden.sh --pruefen     # Exit 1, wenn ein Block fehlt oder veraltet ist
```

Die Blocktexte liegen einzeln unter `scripts/dach-hinweise/<skill>.md` — dort
bearbeiten, nicht direkt in der `SKILL.md`, sonst überschreibt der nächste Lauf
die Änderung.

> Keine Rechtsberatung. Die Ebene verhindert offensichtliche Fehler; konkrete
> Funnels, Einwilligungstexte und Vertragsflows gehören vor dem Live-Gang zu
> einem Fachanwalt.

## Aktualisieren

```bash
git clone --depth 1 https://github.com/coreyhaines31/marketingskills.git /tmp/marketingskills
rm -rf .claude/skills/* .claude/tools
cp -r /tmp/marketingskills/skills/* .claude/skills/
cp -r /tmp/marketingskills/tools .claude/tools
cp /tmp/marketingskills/LICENSE .claude/skills/LICENSE-marketingskills
# danach diese README (Version, Commit, Datum) nachziehen
```

Die Skills werden nicht von uns gepflegt — Änderungen bitte upstream einreichen,
damit ein Update sie nicht überschreibt.

### Nach einem Update

```bash
scripts/dach-hinweise-anwenden.sh    # DACH-Hinweisblöcke erneut einspielen
```

Anschließend `marketing-recht-dach/references/skill-audit.md` gegen die neuen
Fundstellen prüfen — Zeilennummern verschieben sich, Aussagen können sich
ändern.

## Bekannte Linkfehler (upstream)

- `ad-creative/SKILL.md` → `../../ads/references/meta-decision-system.md`
  (falsche Relativtiefe, korrekt wäre `../ads/…`)
- `ads/references/creative-research-automation.md` → `../../positioning/SKILL.md`
  (Skill `positioning` existiert upstream nicht)
