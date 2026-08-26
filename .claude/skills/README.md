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

## Bekannte Linkfehler (upstream)

- `ad-creative/SKILL.md` → `../../ads/references/meta-decision-system.md`
  (falsche Relativtiefe, korrekt wäre `../ads/…`)
- `ads/references/creative-research-automation.md` → `../../positioning/SKILL.md`
  (Skill `positioning` existiert upstream nicht)
