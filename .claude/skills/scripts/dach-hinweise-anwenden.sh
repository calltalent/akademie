#!/usr/bin/env bash
# Fügt die DACH-Rechtshinweise in die Upstream-SKILL.md-Dateien ein.
#
# Die Skills unter .claude/skills/ stammen aus coreyhaines31/marketingskills und
# beschreiben US-Recht. Dieses Skript ergänzt je Skill einen markierten
# Hinweisblock unterhalb des Frontmatters, ohne den Upstream-Inhalt zu ändern.
#
# Idempotent: Ein vorhandener Block wird ersetzt, nicht verdoppelt.
# Nach jedem Upstream-Update erneut ausführen (siehe .claude/skills/README.md).
#
#   ./dach-hinweise-anwenden.sh          # Hinweise einfügen/aktualisieren
#   ./dach-hinweise-anwenden.sh --pruefen # nur melden, was fehlt (Exit 1 bei Lücke)
#   ./dach-hinweise-anwenden.sh --entfernen # alle Blöcke wieder entfernen

set -euo pipefail

SKRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_DIR="$(cd "$SKRIPT_DIR/.." && pwd)"
HINWEIS_DIR="$SKRIPT_DIR/dach-hinweise"

MODUS="anwenden"
case "${1:-}" in
  --pruefen)   MODUS="pruefen" ;;
  --entfernen) MODUS="entfernen" ;;
  "")          ;;
  *) echo "Unbekannte Option: $1" >&2; exit 2 ;;
esac

export MODUS SKILLS_DIR HINWEIS_DIR

python3 - <<'PY'
import os
import pathlib
import sys

skills_dir = pathlib.Path(os.environ["SKILLS_DIR"])
hinweis_dir = pathlib.Path(os.environ["HINWEIS_DIR"])
modus = os.environ["MODUS"]

START = "<!-- DACH-HINWEIS:START — lokale Ergaenzung, nicht Bestandteil von coreyhaines31/marketingskills -->"
ENDE = "<!-- DACH-HINWEIS:ENDE -->"

geaendert, unveraendert, fehlend = [], [], []


def block_entfernen(text: str) -> str:
    """Entfernt einen vorhandenen Hinweisblock samt umgebender Leerzeilen."""
    while START in text and ENDE in text:
        a = text.index(START)
        b = text.index(ENDE) + len(ENDE)
        text = text[:a].rstrip("\n") + "\n\n" + text[b:].lstrip("\n")
    return text


def einfuegepunkt(text: str) -> int:
    """Position nach dem YAML-Frontmatter. 0, wenn keines vorhanden ist."""
    if not text.startswith("---\n"):
        return 0
    ende = text.find("\n---\n", 4)
    if ende == -1:
        return 0
    return ende + len("\n---\n")


for hinweis_datei in sorted(hinweis_dir.glob("*.md")):
    name = hinweis_datei.stem
    ziel = skills_dir / name / "SKILL.md"
    if not ziel.exists():
        fehlend.append(name)
        continue

    text = ziel.read_text(encoding="utf-8")
    ohne = block_entfernen(text)

    if modus == "entfernen":
        if ohne != text:
            ziel.write_text(ohne, encoding="utf-8")
            geaendert.append(name)
        else:
            unveraendert.append(name)
        continue

    kern = hinweis_datei.read_text(encoding="utf-8").strip()
    zitat = "\n".join(("> " + z).rstrip() for z in kern.splitlines())
    block = (
        f"{START}\n"
        f"> ### ⚠️ DACH-Kontext (DE/AT/CH)\n"
        f">\n"
        f"{zitat}\n"
        f">\n"
        f"> **Vor der Umsetzung lesen:** `marketing-recht-dach`\n"
        f"> (`.claude/skills/marketing-recht-dach/SKILL.md`), Prüfergebnis je Skill in\n"
        f"> `references/skill-audit.md`. Keine Rechtsberatung — vor dem Live-Gang\n"
        f"> anwaltlich prüfen lassen.\n"
        f">\n"
        f"> Die folgende US-Fassung bleibt unverändert und gilt weiter für\n"
        f"> US-Empfänger.\n"
        f"{ENDE}"
    )

    pos = einfuegepunkt(ohne)
    neu = ohne[:pos].rstrip("\n") + "\n\n" + block + "\n\n" + ohne[pos:].lstrip("\n")

    if neu != text:
        if modus == "pruefen":
            fehlend.append(name)
        else:
            ziel.write_text(neu, encoding="utf-8")
            geaendert.append(name)
    else:
        unveraendert.append(name)

if modus == "pruefen":
    if fehlend:
        print(f"Hinweis fehlt oder ist veraltet ({len(fehlend)}): {', '.join(fehlend)}")
        sys.exit(1)
    print(f"Alle {len(unveraendert)} DACH-Hinweise sind aktuell.")
else:
    verb = "entfernt" if modus == "entfernen" else "gesetzt"
    print(f"{len(geaendert)} Hinweis(e) {verb}, {len(unveraendert)} unverändert.")
    if geaendert:
        print("  " + ", ".join(geaendert))
    if fehlend:
        print(f"  Kein passender Skill gefunden für: {', '.join(fehlend)}", file=sys.stderr)
        sys.exit(1)
PY
