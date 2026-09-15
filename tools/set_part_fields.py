#!/usr/bin/env python3
"""Write Datasheet, MPN and Manufacturer fields into every schematic symbol,
and mirror them onto the matching PCB footprints.

Source of truth is tools/parts.json. Named parts are matched by the MPN
field already on the symbol; generic passives are matched by value and
land pattern. Files are patched in place by splicing text, so nothing else
in them (uuids, positions, formatting) changes.

    python3 tools/set_part_fields.py            # patch
    python3 tools/set_part_fields.py --check    # report only, no writes
"""

import json
import re
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import kicad_sexp as k  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SHEETS = ["mcu", "radio", "gnss", "sensors"]
FIELDS = ("Datasheet", "MPN", "Manufacturer")


def load_parts():
    with open(ROOT / "tools" / "parts.json") as f:
        return json.load(f)


def resolve(parts, value, footprint, mpn):
    """Return (key, part) for a symbol, or (None, None) if it is not bought."""
    for prefix in parts["not_purchased"]:
        if footprint.startswith(prefix):
            return None, None
    if mpn:
        mpn = parts["replace"].get(mpn, mpn)
        if mpn in parts["parts"]:
            return mpn, parts["parts"][mpn]
        raise KeyError(f"MPN {mpn!r} is not in parts.json")
    pkg = footprint.split(":", 1)[1] if ":" in footprint else footprint
    for key in (f"{value}|{pkg}", f"*|{pkg}"):
        if key in parts["generic"]:
            mpn = parts["generic"][key]
            return mpn, parts["parts"][mpn]
    raise KeyError(f"no part for {value!r} in {footprint!r}")


HEADER = re.compile(r'\(property\s+"([^"]+)"\s+"((?:[^"\\]|\\.)*)"')


def set_property(text, node, name, value, edits, new_uuid=False):
    """Queue edits that set property `name` to `value` on a symbol or
    footprint node. A missing property is cloned from the Datasheet one."""
    existing = k.prop(node, name)
    if existing is not None:
        m = HEADER.match(text, existing.start)
        if m.group(2) == value:
            return False
        edits.append((m.start(2) - 1, m.end(2) + 1, k.quote(value)))
        return True
    template = k.prop(node, "Datasheet")
    block = text[template.start:template.end]
    m = HEADER.match(block)
    block = block[: m.start(1) - 1] + k.quote(name) + " " + k.quote(value) + block[m.end(2) + 1 :]
    if new_uuid:
        block = re.sub(r'\(uuid "[^"]+"\)', f'(uuid "{uuid.uuid4()}")', block, count=1)
    # keep the template's indentation: it starts right after a newline+tabs
    indent = re.search(r"\n([ \t]*)$", text[: template.start])
    prefix = "\n" + (indent.group(1) if indent else "\t\t")
    edits.append((template.end, template.end, prefix + block))
    return True


def patch_schematics(parts, check):
    """Returns {symbol uuid: part fields} for the PCB pass."""
    by_uuid = {}
    unresolved = []
    for sheet in SHEETS:
        path = ROOT / f"{sheet}.kicad_sch"
        text = path.read_text()
        root = k.parse(text)[0]
        edits = []
        changed = 0
        for sym in k.children(root, "symbol"):
            lib_id = k.child(sym, "lib_id")[1]
            if lib_id.startswith("power:"):
                continue
            ref = k.prop(sym, "Reference")[2]
            value = k.prop(sym, "Value")[2]
            footprint = k.prop(sym, "Footprint")[2]
            mpn_prop = k.prop(sym, "MPN")
            in_bom = k.child(sym, "in_bom")
            if in_bom is not None and in_bom[1] == "no":
                continue
            try:
                key, part = resolve(parts, value, footprint, mpn_prop[2] if mpn_prop else "")
            except KeyError as e:
                unresolved.append(f"{sheet} {ref}: {e}")
                continue
            if key is None:
                continue
            fields = {"Datasheet": part["datasheet"], "MPN": key, "Manufacturer": part["manufacturer"]}
            by_uuid[k.child(sym, "uuid")[1]] = fields
            for name in FIELDS:
                if set_property(text, sym, name, fields[name], edits):
                    changed += 1
        print(f"  {sheet}.kicad_sch: {changed} field edits")
        if edits and not check:
            path.write_text(k.apply_edits(text, edits))
    if unresolved:
        print("  unresolved:")
        for u in unresolved:
            print("   ", u)
        sys.exit(1)
    return by_uuid


def patch_pcb(by_uuid, check):
    path = ROOT / "cc1200_balloon.kicad_pcb"
    text = path.read_text()
    root = k.parse(text)[0]
    edits = []
    changed = 0
    missing = []
    for fp in k.children(root, "footprint"):
        p = k.child(fp, "path")
        if p is None:
            continue
        sym_uuid = p[1].rsplit("/", 1)[-1]
        fields = by_uuid.get(sym_uuid)
        if fields is None:
            missing.append(k.prop(fp, "Reference")[2])
            continue
        for name in FIELDS:
            if set_property(text, fp, name, fields[name], edits, new_uuid=True):
                changed += 1
    print(f"  cc1200_balloon.kicad_pcb: {changed} field edits; footprints without a bought part: {' '.join(missing)}")
    if edits and not check:
        path.write_text(k.apply_edits(text, edits))


def main():
    check = "--check" in sys.argv
    parts = load_parts()
    by_uuid = patch_schematics(parts, check)
    patch_pcb(by_uuid, check)


if __name__ == "__main__":
    main()
