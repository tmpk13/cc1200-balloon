#!/usr/bin/env python3
"""Resolve bom.json against live DigiKey stock, then write BOM.md and
digikey_bom.csv.

For each line the preferred MPN is looked up first. A part that is missing,
discontinued or at zero stock falls back to the line's keyword query with
DigiKey's in-stock filter, and the cheapest orderable offer wins - a
preferred part nobody can ship is worse than no preference at all.

Offers are chosen per packaging variation, not per product: DigiKey prices
most parts only per reel, and the cut-tape variation of the same product is
what a one-off build can actually order.

    tools/source_bom.py [--qty 1] [--boards 1]

digi-mouse-search is not registered as an MCP server here, so its service is
driven directly; see tools/dksearch.py for the same credential handling.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import re
import os
import sys
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
DMS = Path("/home/tmpk/digi-mouse-search")
sys.path.insert(0, str(DMS / "src"))

for line in (DMS / "secrets.txt").read_text().splitlines():
    if "=" not in line:
        continue
    k, v = line.split("=", 1)
    os.environ.setdefault(
        {"Client_ID": "DIGIKEY_CLIENT_ID", "Client_Secret": "DIGIKEY_CLIENT_SECRET"}.get(k, k), v
    )

from digi_mouse_search.service import SearchService  # noqa: E402

DEAD_STATUS = {
    "obsolete", "discontinued at digi-key", "discontinued at digikey",
    "last time buy", "not for new designs",
}

# DigiKey renders values as "0.1 uF", "1800 pF", "10 kOhms", "4.7 uH".
UNIT = {
    "f": 1.0, "mf": 1e-3, "uf": 1e-6, "\u00b5f": 1e-6, "nf": 1e-9, "pf": 1e-12,
    "ohms": 1.0, "ohm": 1.0, "kohms": 1e3, "mohms": 1e6, "milliohms": 1e-3,
    "h": 1.0, "mh": 1e-3, "uh": 1e-6, "\u00b5h": 1e-6, "nh": 1e-9, "ph": 1e-12,
}


def magnitude(text: str) -> float | None:
    """Numeric value of a DigiKey parameter string, in SI base units."""
    m = re.match(r"\s*([-\d.]+)\s*([^\s]+)", (text or "").replace("\u03bc", "\u00b5"))
    if not m:
        return None
    unit = UNIT.get(m.group(2).strip().lower())
    if unit is None:
        return None
    try:
        return float(m.group(1)) * unit
    except ValueError:
        return None


def parameters(product: dict) -> dict[str, str]:
    return {
        (p.get("ParameterText") or ""): (p.get("ValueText") or "")
        for p in product.get("Parameters") or []
    }


def matches(product: dict, expect: dict | None) -> bool:
    """True when a candidate really is the declared value in the declared size.

    Keyword search is a text match, so it is perfectly happy to answer a
    request for 1 uF with a 0.1 uF part. Nothing gets substituted without
    the parametric value and the package agreeing.
    """
    if not expect:
        return False
    params = parameters(product)
    got = magnitude(params.get(expect["param"], ""))
    if got is None:
        return False
    want = expect["value"]
    if want == 0:
        if got != 0:
            return False
    elif abs(got - want) > abs(want) * 1e-3:
        return False
    case = (params.get("Package / Case") or "") + " " + (params.get("Supplier Device Package") or "")
    return expect["pkg"] in case


def packaging_rank(name: str) -> int:
    """Prefer loose parts over anything reeled.

    Cut Tape and Digi-Reel carry the same unit price and the same stock, so
    without this the choice between them is arbitrary - and Digi-Reel adds a
    per-line reeling charge that has no business on an eight-board build.
    """
    n = (name or "").lower()
    if "cut tape" in n:
        return 3
    if "digi-reel" in n or "digireel" in n:
        return 1
    if "tape & reel" in n or "tape and reel" in n:
        return 0
    return 2  # bulk, tray, box, bag


def score(variation: dict, quantity: int) -> tuple:
    """Rank a packaging variation: orderable, in stock, loose, cheap."""
    breaks = variation.get("StandardPricing") or []
    unit = None
    for b in sorted(breaks, key=lambda b: b.get("BreakQuantity") or 0):
        if (b.get("BreakQuantity") or 0) <= quantity:
            unit = b.get("UnitPrice")
    moq = variation.get("MinimumOrderQuantity") or 0
    stock = variation.get("QuantityAvailableforPackageType") or 0
    return (
        0 if variation.get("MarketPlace") else 1,
        1 if unit is not None else 0,
        1 if moq <= quantity else 0,
        1 if stock >= quantity else 0,
        # Packaging outranks price on purpose. Digi-Reel is sometimes a few
        # cents cheaper per part than cut tape and then adds a per-line
        # reeling charge that dwarfs the saving on a handful of boards.
        packaging_rank((variation.get("PackageType") or {}).get("Name", "")),
        -(unit if unit is not None else 1e9),
    )


def best_variation(product: dict, quantity: int) -> dict | None:
    variations = product.get("ProductVariations") or []
    if not variations:
        return None
    return max(variations, key=lambda v: score(v, quantity))


def summarise(product: dict, quantity: int) -> dict | None:
    v = best_variation(product, quantity)
    if v is None:
        return None
    breaks = sorted(v.get("StandardPricing") or [], key=lambda b: b.get("BreakQuantity") or 0)
    unit, at = None, 0
    for b in breaks:
        if (b.get("BreakQuantity") or 0) <= quantity:
            unit, at = b.get("UnitPrice"), b.get("BreakQuantity") or 0
    if unit is None and breaks:
        # Pack-only lines price nothing at qty 1; quote the smallest break
        # rather than leaving the board total silently short.
        unit, at = breaks[0].get("UnitPrice"), breaks[0].get("BreakQuantity") or 0
    return {
        "price_break_qty": at,
        "mpn": product.get("ManufacturerProductNumber"),
        "manufacturer": (product.get("Manufacturer") or {}).get("Name", ""),
        "description": (product.get("Description") or {}).get("ProductDescription", ""),
        "status": (product.get("ProductStatus") or {}).get("Status", ""),
        "datasheet": product.get("DatasheetUrl", ""),
        "dpn": v.get("DigiKeyProductNumber"),
        "packaging": (v.get("PackageType") or {}).get("Name", ""),
        "marketplace": bool(v.get("MarketPlace")),
        "moq": v.get("MinimumOrderQuantity") or 0,
        "stock": v.get("QuantityAvailableforPackageType") or 0,
        "unit_price": unit,
    }


def usable(
    offer: dict | None, quantity: int, relax_moq: bool = False, allow_dead: bool = False
) -> bool:
    """Can this offer actually be bought for this build?

    `allow_dead` is for lines with no substitute to fall back to: a
    discontinued part the design specifically calls for still belongs in the
    BOM, flagged as a risk, rather than being dropped for a blank.
    """
    if offer is None or offer["marketplace"]:
        return False
    if not allow_dead and (offer["status"] or "").strip().lower() in DEAD_STATUS:
        return False
    if not relax_moq and offer["moq"] > quantity:
        return False
    return offer["stock"] >= quantity


async def product(dk, part_number: str) -> dict | None:
    try:
        data = await dk._cached_request(
            "details",
            {"pn": part_number},
            {
                "method": "GET",
                "url": f"{dk.config.base_url}/products/v4/search/"
                f"{quote(part_number, safe='')}/productdetails",
                "headers": await dk._headers(),
            },
        )
    except Exception:
        return None
    return (data or {}).get("Product")


async def keyword(dk, text: str) -> list[dict]:
    try:
        data = await dk._cached_request(
            "search",
            {"kw": text, "limit": 10, "stock": True},
            {
                "method": "POST",
                "url": f"{dk.config.base_url}/products/v4/search/keyword",
                "headers": await dk._headers(),
                "json": {
                    "Keywords": text[:250],
                    "Limit": 10,
                    "Offset": 0,
                    "FilterOptionsRequest": {"SearchOptions": ["InStock"]},
                },
            },
        )
    except Exception:
        return []
    return (data or {}).get("Products") or []


async def resolve(dk, line: dict, quantity: int) -> dict:
    need = quantity * len(line["refs"])
    chosen, source = None, ""
    offboard = bool(line.get("offboard"))
    substitutable = bool(line.get("query"))
    prod = await product(dk, line["mpn"])
    if prod:
        offer = summarise(prod, need)
        if usable(offer, need, relax_moq=offboard, allow_dead=not substitutable):
            chosen, source = offer, "off-board" if offboard else "preferred"
    if chosen is None and line.get("query"):
        candidates = []
        for p in await keyword(dk, line["query"]):
            if not matches(p, line.get("expect")):
                continue
            offer = summarise(p, need)
            if usable(offer, need):
                candidates.append(offer)
        if candidates:
            chosen = min(candidates, key=lambda o: o["unit_price"] or 1e9)
            source = "substituted"
    if chosen is None and prod:
        offer = summarise(prod, need)
        if offer:
            chosen, source = offer, "preferred (not orderable)"
    return {**line, "need": need, "offer": chosen, "source": source}


def reference(line: dict) -> str:
    """Short customer reference.

    DigiKey shows this next to the line and prints it on the bag label, so a
    94-character designator list is worse than useless. Short reference
    lists stay verbatim; long ones collapse to the value and package, which
    is what you actually need when a bag of 19 identical 0402s arrives.
    """
    refs = " ".join(line["refs"])
    if len(refs) <= 32:
        return refs
    pkg = line["footprint"].split(":")[-1].split("_")
    size = next((p for p in pkg if re.fullmatch(r"\d{4}", p)), "")
    return " ".join(x for x in (line["value"], size, f"x{len(line['refs'])}") if x)


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--boards", type=int, default=1, help="board count the CSV quantities are for")
    ap.add_argument(
        "--planned", type=int, default=1,
        help="board count actually being built; only used to warn about stock, "
             "so the CSV can stay at one board's worth while the check covers the run",
    )
    args = ap.parse_args()

    bom = json.loads((ROOT / "bom.json").read_text())
    svc = SearchService()
    dk = svc.providers["digikey"]
    try:
        resolved = [await resolve(dk, line, args.boards) for line in bom]
    finally:
        await svc.aclose()

    total = 0.0
    unpriced: list[str] = []
    for r in resolved:
        o = r["offer"]
        if o and o["unit_price"] is not None and not r["dnp"]:
            total += o["unit_price"] * r["need"]
        elif not r["dnp"]:
            unpriced.append(r["mpn"])

    # --- digikey_bom.csv --------------------------------------------------
    # Deliberately minimal. DigiKey's BOM Manager matches on the part number
    # and takes the quantity; every other column it either ignores or tries
    # to map, and a wide file with prices, stock figures and long designator
    # lists is what makes an upload come back mangled. Lines it cannot match
    # are left out entirely rather than uploaded blank.
    csv_path = ROOT / "digikey_bom.csv"
    skipped: list[dict] = []
    with csv_path.open("w", newline="") as fh:
        w = csv.writer(fh, quoting=csv.QUOTE_MINIMAL)
        w.writerow(["Quantity", "Digi-Key Part Number", "Customer Reference"])
        for r in resolved:
            o = r["offer"] or {}
            if r["dnp"] or not o.get("dpn"):
                skipped.append(r)
                continue
            w.writerow([r["need"], o["dpn"], reference(r)])

    # --- BOM.md -----------------------------------------------------------
    rows = []
    for r in resolved:
        o = r["offer"] or {}
        unit = o.get("unit_price")
        rows.append(
            "| {refs} | {value} | {mpn} | {mfr} | {pkg} | {qty} | {dpn} | {packing} | {stock} | {price} | {note} |".format(
                refs=" ".join(r["refs"]),
                value=r["value"],
                mpn=o.get("mpn", r["mpn"]),
                mfr=o.get("manufacturer", ""),
                pkg=r["footprint"].split(":")[-1],
                qty=r["need"],
                dpn=o.get("dpn", "-"),
                packing=o.get("packaging", "-") or "-",
                stock=o.get("stock", "-"),
                price=f"${unit:.4f}" if unit is not None else "-",
                note=("DNP " if r["dnp"] else "") + r["source"],
            )
        )

    subs = [r for r in resolved if r["source"] == "substituted"]
    bad = [r for r in resolved if r["offer"] is None or "not orderable" in r["source"]]

    # A line can be orderable today and still be a bad bet: a lifecycle that
    # is not Active, a pack quantity far above what one board needs, or so
    # little stock that a second build will not find any.
    risks = []
    for r in resolved:
        o = r["offer"]
        if o is None or any(r is b for b in bad):
            continue
        run = r["need"] * args.planned
        why = []
        if (o["status"] or "Active").strip().lower() != "active":
            why.append(o["status"])
        if o["moq"] > run:
            why.append(f"pack of {o['moq']} (need {run})")
        if o["stock"] < run:
            why.append(f"only {o['stock']} in stock, {args.planned} boards need {run}")
        elif o["stock"] < max(run * 5, 50):
            why.append(f"only {o['stock']} in stock")
        if why:
            risks.append((r, "; ".join(why)))

    reeled = [
        r for r in resolved
        if r["offer"] and packaging_rank(r["offer"].get("packaging", "")) < 2
    ]

    md = [
        "# cc1200-balloon bill of materials",
        "",
        f"{len(resolved)} lines, {sum(len(r['refs']) for r in resolved)} placements.",
        "",
        f"**Quantities are for {args.boards} board. Set the multiplier in DigiKey's "
        "BOM Manager rather than scaling this file** - per-line quantities here are "
        "one board's worth, and nothing is rounded up to a pack or a reel.",
        "",
        "DigiKey stock and pricing read live; totals are indicative, not a quote.",
        "",
        f"**Board total (excluding DNP): ${total:.2f}**",
        "",
        "| Refs | Value | MPN | Manufacturer | Package | Qty | DigiKey | Packaging | Stock | Unit | Source |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        *rows,
        "",
    ]
    if subs:
        md += [
            "## Substituted parts",
            "",
            "The preferred part was out of stock or not orderable at this quantity, "
            "so the cheapest in-stock equivalent was taken instead.",
            "",
            *[f"- `{r['mpn']}` -> `{r['offer']['mpn']}` ({r['value']}, {' '.join(r['refs'])})" for r in subs],
            "",
        ]
    if skipped:
        md += [
            "## Not in digikey_bom.csv",
            "",
            "DigiKey cannot fulfil these as uploaded, so they are left out of the "
            "upload rather than going in as blank lines. Order them separately or "
            "add them by hand.",
            "",
            *[
                f"- `{(r['offer'] or {}).get('mpn', r['mpn'])}` ({r['value']}, "
                + " ".join(r["refs"])
                + "): "
                + (
                    "do not populate"
                    + (
                        f" - optional, DigiKey {r['offer']['dpn']} if you want it"
                        if r["offer"] and r["offer"].get("dpn")
                        else ""
                    )
                    if r["dnp"]
                    else "no DigiKey match"
                    + (f"; order from {r['alt']}" if r.get("alt") else "")
                )
                for r in skipped
            ],
            "",
        ]
    if reeled:
        md += [
            "## Reeled lines",
            "",
            "These resolved to a reel or Digi-Reel rather than cut tape, which adds "
            "a handling charge. Check them before ordering.",
            "",
            *[f"- `{r['offer']['mpn']}`: {r['offer']['packaging']}" for r in reeled],
            "",
        ]
    if risks:
        md += [
            "## Sourcing risks",
            "",
            f"Orderable, but not comfortably so. Stock is judged against the "
            f"{args.planned}-board run, not the one board the CSV quantities are for.",
            "",
            *[
                f"- `{r['offer']['mpn']}` ({r['value']}, {' '.join(r['refs'])}): {why}"
                for r, why in risks
            ],
            "",
        ]
    if bad:
        md += [
            "## Needs attention",
            "",
            *[
                f"- `{r['mpn']}` ({r['value']}, {' '.join(r['refs'])}): "
                + (
                    "not stocked at DigiKey"
                    + (f"; order from {r['alt']}" if r.get("alt") else "")
                    if r["offer"] is None
                    else f"{r['offer']['status']}, stock {r['offer']['stock']}"
                )
                for r in bad
            ],
            "",
        ]
    if unpriced:
        md += ["Lines with no unit price at this quantity: " + ", ".join(f"`{m}`" for m in unpriced), ""]

    (ROOT / "BOM.md").write_text("\n".join(md))
    with csv_path.open() as fh:
        csv_lines = sum(1 for _ in fh) - 1
    print(f"  BOM.md: {len(resolved)} lines, ${total:.2f}/board, {len(subs)} substituted, "
          f"{len(risks)} risky, {len(bad)} need attention")
    print(f"  digikey_bom.csv: {csv_lines} orderable lines for {args.boards} board, "
          f"{len(skipped)} left out, {len(reeled)} reeled")
    return 0


sys.exit(asyncio.run(main()))
