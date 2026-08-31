#!/usr/bin/env bash
# Full regeneration of the cc1200-balloon schematic set from sources.
#
#   sheets/*.json + models/*.scad + tools/  ->  *.kicad_sch (placed by
#   kicad-vis, wired by flow-wire), libraries, root sheet, project files,
#   ERC report.
#
# Every step is deterministic; rerunning produces the same output.
set -euo pipefail
cd "$(dirname "$0")"

# kicad-vis scans symbol directories rather than sym-lib-table, so the
# project library has to be on its search path.
export KICAD_SYMBOL_DIR="$PWD/lib"
KV="pixi run --manifest-path /home/tmpk/kicad-vis/pixi.toml kicad-vis"

echo "== libraries"
bun run tools/gen_symbols.ts
bun run tools/gen_footprints.ts
bun run tools/gen_3d.ts

echo "== sheet layout (kicad-vis)"
# Sheets whose inputs are driven from another sheet fail standalone ERC by
# design (the driver is across the hierarchy); --force writes them anyway.
# The authoritative ERC is the full-hierarchy run at the end.
for s in power mcu radio gnss sensors; do
  ($KV layout "sheets/$s.json" -o "$s.kicad_sch" --json --force || true) \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print('  $s ok:', d['ok'], '' if d['ok'] else d['errors'])"
done

echo "== hierarchy (globalize inter-sheet labels, root sheet, project)"
bun run tools/assemble.ts

echo "== power flag dedupe"
bun run tools/fixflags.ts

echo "== connectivity patches"
bun run tools/patchnets.ts

echo "== flow-wire routing"
bun run tools/flowbridge.ts \
  power.kicad_sch mcu.kicad_sch radio.kicad_sch gnss.kicad_sch sensors.kicad_sch

echo "== global label text justification"
bun run tools/fixlabels.ts

echo "== cross-sheet global label guard"
bun run tools/checkglobals.ts

echo "== shorted rail guard"
bun run tools/checkshorts.ts

echo "== footprint resolution"
bun run tools/checkfootprints.ts

echo "== frame fit"
bun run tools/checkframe.ts

echo "== netlist vs sheets/*.json"
bun run tools/verify_nets.ts

echo "== full-hierarchy ERC"
kicad-cli sch erc --format json --output /tmp/cc1200_balloon_erc.json cc1200_balloon.kicad_sch >/dev/null
python3 - <<'EOF'
import json, collections, sys
d = json.load(open('/tmp/cc1200_balloon_erc.json'))
errs, warns = [], collections.Counter()
for s in d.get('sheets', []):
    for v in s.get('violations', []):
        if v['severity'] == 'error':
            errs.append(f"{s.get('path')} {v['type']}")
        else:
            warns[v['type']] += 1
print(f"  {len(errs)} errors, warnings: {dict(warns)}")
for e in errs: print("   ", e)
sys.exit(1 if errs else 0)
EOF
echo "== bill of materials"
bun run tools/gen_bom.ts
if [ "${SKIP_SOURCING:-0}" = "0" ]; then
  # Live DigiKey pass. Needs network and spends API quota, so it can be
  # skipped when only the schematic changed.
  /home/tmpk/digi-mouse-search/.venv/bin/python tools/source_bom.py --boards "${BOARDS:-1}" --planned "${PLANNED_BOARDS:-8}"
else
  echo "  sourcing skipped (SKIP_SOURCING=1)"
fi

echo "== done"
