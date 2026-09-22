#!/usr/bin/env python3
"""Build digikey_bom.csv, BOM.md and bom.json from the schematic.

Reads the MPN field of every symbol in the four sheets (written by
set_part_fields.py) and joins it with tools/parts.json for the DigiKey
number, packaging, price and stock. Quantities are for one board; set the
multiplier in DigiKey's BOM Manager rather than scaling the file.
"""

import csv
import json
import re
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import kicad_sexp as k  # noqa: E402
from set_part_fields import SHEETS, load_parts, resolve  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PLANNED_BOARDS = 8


def natural(ref):
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", ref)]


def collect(parts):
    lines = {}
    problems = []
    for sheet in SHEETS:
        root = k.parse((ROOT / f"{sheet}.kicad_sch").read_text())[0]
        for sym in k.children(root, "symbol"):
            if k.child(sym, "lib_id")[1].startswith("power:"):
                continue
            in_bom = k.child(sym, "in_bom")
            if in_bom is not None and in_bom[1] == "no":
                continue
            ref = k.prop(sym, "Reference")[2]
            value = k.prop(sym, "Value")[2]
            footprint = k.prop(sym, "Footprint")[2]
            mpn_prop = k.prop(sym, "MPN")
            try:
                key, part = resolve(parts, value, footprint, mpn_prop[2] if mpn_prop else "")
            except KeyError as e:
                problems.append(f"{sheet} {ref}: {e}")
                continue
            if key is None:
                continue
            dnp = k.child(sym, "dnp")
            dnp = dnp is not None and dnp[1] == "yes"
            line = lines.setdefault((key, dnp), {
                "mpn": key, "value": value, "footprint": footprint, "dnp": dnp, "refs": [], **part})
            line["refs"].append(ref)
    if problems:
        print("cannot build the BOM until these are resolved:", file=sys.stderr)
        for p in problems:
            print("   ", p, file=sys.stderr)
        sys.exit(1)
    for line in lines.values():
        line["refs"].sort(key=natural)
    out = sorted(lines.values(), key=lambda l: natural(l["refs"][0]))
    for ob in parts["off_board"]:
        part = parts["parts"][ob["mpn"]]
        out.append({"mpn": ob["mpn"], "value": part["description"], "footprint": f"mates {ob['mates']}",
                    "dnp": False, "refs": [ob["mates"]], "off_board": ob["note"], **part})
    return out


def pkg(footprint):
    return footprint.split(":", 1)[1] if ":" in footprint else footprint


def customer_ref(line):
    refs = " ".join(line["refs"])
    if len(refs) <= 40:
        return refs
    short = pkg(line["footprint"]).split("_")[1] if "_" in pkg(line["footprint"]) else pkg(line["footprint"])
    return f"{line['value']} {short} x{len(line['refs'])}"


def write_csv(lines):
    with open(ROOT / "digikey_bom.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["Quantity", "Digi-Key Part Number", "Customer Reference"])
        n = 0
        for line in lines:
            if line["dnp"] or not line.get("digikey"):
                continue
            w.writerow([len(line["refs"]), line["digikey"], customer_ref(line)])
            n += 1
    return n


def money(x):
    return f"${x:.4f}" if x is not None else "-"


def write_md(lines, csv_lines):
    placements = sum(len(l["refs"]) for l in lines if not l["dnp"])
    total = 0.0
    unpriced = []
    for l in lines:
        if l["dnp"]:
            continue
        if l.get("price") is None:
            unpriced.append(l["mpn"])
        else:
            total += l["price"] * len(l["refs"])
    md = []
    md.append("# cc1200-balloon bill of materials\n")
    md.append(f"Generated {date.today().isoformat()} from the schematic by `tools/gen_digikey_bom.py`. "
              f"{len(lines)} lines, {placements} placements, {csv_lines} lines in `digikey_bom.csv`.\n")
    md.append("**Quantities are for 1 board. Set the multiplier in DigiKey's BOM Manager rather than scaling the file.** "
              "Nothing is rounded up to a pack or a reel.\n")
    md.append("Unit prices are DigiKey cut-tape prices at quantity 1 on the date shown in the last column; "
              "stock is what DigiKey listed that day. Where DigiKey only exposed the reel listing, the cut-tape "
              "number is derived (`-1-ND` / `CT-ND`) and the stock figure is the reel's. Indicative, not a quote.\n")
    md.append(f"**Board total (excluding DNP): ${total:.2f}**" +
              (f" - lines without a price: {', '.join(unpriced)}" if unpriced else "") + "\n")
    md.append("| Refs | Value | MPN | Manufacturer | Package | Qty | DigiKey | Packaging | Stock | Unit | Read |")
    md.append("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    for l in lines:
        refs = " ".join(l["refs"]) + (" (DNP)" if l["dnp"] else "")
        stock = "-" if l.get("stock") is None else str(l["stock"])
        md.append(f"| {refs} | {l['value']} | {l['mpn']} | {l['manufacturer']} | {pkg(l['footprint'])} | "
                  f"{len(l['refs'])} | {l.get('digikey') or '-'} | {l.get('packaging') or '-'} | {stock} | "
                  f"{money(l.get('price'))} | {l.get('priced', '-')} |")
    subs = [l for l in lines if l.get("substituted_for")]
    if subs:
        md.append("\n## Substituted parts\n")
        md.append("The part named in the design or in the earlier BOM is not orderable in cut tape at DigiKey, "
                  "so an equivalent that is was taken instead.\n")
        for l in subs:
            md.append(f"- `{l['substituted_for']}` -> `{l['mpn']}` ({l['value']}, {' '.join(l['refs'])})")
    md.append("\n## Not in digikey_bom.csv\n")
    md.append("DigiKey cannot fulfil these as uploaded, so they are left out of the upload rather than going in as blank lines.\n")
    for l in lines:
        if l["dnp"]:
            md.append(f"- `{l['mpn']}` ({l['value']}, {' '.join(l['refs'])}): do not populate"
                      + (f"; DigiKey {l['digikey']} if wanted" if l.get("digikey") else ""))
        elif not l.get("digikey"):
            md.append(f"- `{l['mpn']}` ({l['value']}, {' '.join(l['refs'])}): no DigiKey listing; {l.get('alt', 'source elsewhere')}")
    md.append("\n## Off-board\n")
    for l in lines:
        if l.get("off_board"):
            md.append(f"- `{l['mpn']}` ({l['footprint']}): {l['off_board']}")
    md.append(f"\n## Sourcing risks\n\nJudged against a {PLANNED_BOARDS}-board run.\n")
    risks = 0
    for l in lines:
        if l["dnp"]:
            continue
        need = PLANNED_BOARDS * len(l["refs"])
        notes = []
        if l.get("stock") is not None and l["stock"] < 4 * need:
            notes.append(f"only {l['stock']} in stock against {need} needed")
        if l.get("note"):
            notes.append(l["note"])
        if notes:
            md.append(f"- `{l['mpn']}` ({l['value']}, {' '.join(l['refs'])}): {'; '.join(notes)}")
            risks += 1
    if not risks:
        md.append("- none")
    (ROOT / "BOM.md").write_text("\n".join(md) + "\n")


def main():
    parts = load_parts()
    lines = collect(parts)
    n = write_csv(lines)
    write_md(lines, n)
    with open(ROOT / "bom.json", "w") as f:
        json.dump(lines, f, indent=1)
        f.write("\n")
    print(f"  {len(lines)} lines, {n} in digikey_bom.csv")


if __name__ == "__main__":
    main()
