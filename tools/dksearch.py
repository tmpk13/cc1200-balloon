#!/usr/bin/env python3
"""Query DigiKey (and Mouser) through the digi-mouse-search service.

Standalone driver, because digi-mouse-search is not registered as an MCP
server in this environment. Credentials come from its own secrets.txt.

    tools/dksearch.py search "RFID transponder coil 500kHz" [--n 10]
    tools/dksearch.py detail MPN [MPN ...]
"""
import argparse, asyncio, json, os, sys
from urllib.parse import quote

DMS = "/home/tmpk/digi-mouse-search"
sys.path.insert(0, os.path.join(DMS, "src"))

for line in open(os.path.join(DMS, "secrets.txt")):
    if "=" not in line:
        continue
    k, v = line.strip().split("=", 1)
    os.environ.setdefault(
        {"Client_ID": "DIGIKEY_CLIENT_ID", "Client_Secret": "DIGIKEY_CLIENT_SECRET"}.get(k, k), v
    )

from digi_mouse_search.service import SearchService  # noqa: E402


def brief(part, quantity):
    return {
        "mpn": part.mpn,
        "mfr": part.manufacturer,
        "desc": part.description,
        "dpn": part.distributor_pn,
        "stock": part.stock,
        "moq": part.min_order_qty,
        "lifecycle": part.lifecycle,
        "packaging": part.packaging,
        "price": part.unit_price_at(quantity),
        "datasheet": part.datasheet_url,
        "specs": part.specs,
    }


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["search", "detail", "offers"])
    ap.add_argument("terms", nargs="+")
    ap.add_argument("--n", type=int, default=8)
    ap.add_argument("--qty", type=int, default=1)
    ap.add_argument("--sources", default="digikey")
    ap.add_argument("--specs", action="store_true")
    ap.add_argument("--stock", action="store_true", help="in-stock offers only")
    args = ap.parse_args()
    srcs = args.sources.split(",")

    svc = SearchService()
    out = []
    try:
        if args.mode == "offers":
            # Packaging variations are what decide whether a line is orderable
            # at qty 1: DigiKey prices most parts per reel, and a marketplace
            # variation is a third-party offer rather than DigiKey stock.
            dk = svc.providers["digikey"]
            for term in args.terms:
              try:
                data = await dk._cached_request(
                    "details",
                    {"pn": term},
                    {
                        "method": "GET",
                        "url": f"{dk.config.base_url}/products/v4/search/"
                        f"{quote(term, safe='')}/productdetails",
                        "headers": await dk._headers(),
                    },
                )
                prod = (data or {}).get("Product") or {}
                rows = []
                for v in prod.get("ProductVariations") or []:
                    breaks = v.get("StandardPricing") or []
                    rows.append({
                        "dpn": v.get("DigiKeyProductNumber"),
                        "packaging": (v.get("PackageType") or {}).get("Name"),
                        "marketplace": v.get("MarketPlace"),
                        "moq": v.get("MinimumOrderQuantity"),
                        "stock": v.get("QuantityAvailableforPackageType"),
                        "price1": next((b.get("UnitPrice") for b in breaks
                                        if b.get("BreakQuantity") == 1), None),
                        "breaks": [(b.get("BreakQuantity"), b.get("UnitPrice")) for b in breaks][:3],
                    })
                out.append({
                    "term": term,
                    "mpn": prod.get("ManufacturerProductNumber"),
                    "mfr": (prod.get("Manufacturer") or {}).get("Name"),
                    "desc": (prod.get("Description") or {}).get("ProductDescription"),
                    "status": (prod.get("ProductStatus") or {}).get("Status"),
                    "datasheet": prod.get("DatasheetUrl"),
                    "variations": rows,
                })
              except Exception as exc:  # one missing part must not abort the batch
                out.append({"term": term, "mpn": None, "mfr": None,
                            "desc": f"NOT FOUND: {exc}", "variations": []})
            json.dump(out, sys.stdout, indent=1, default=str)
            print()
            return
        for term in args.terms:
            if args.mode == "search":
                res = await svc.search(term, sources=srcs, limit=args.n, in_stock_only=args.stock)
                parts = [o for m in res.parts for o in m.offers]
                errors = res.errors
            else:
                parts, errors = await svc.details(term, sources=srcs)
            rows = [brief(p, args.qty) for p in parts]
            if not args.specs:
                for r in rows:
                    r.pop("specs")
            out.append({"term": term, "errors": [str(e) for e in errors], "parts": rows})
    finally:
        await svc.aclose()
    json.dump(out, sys.stdout, indent=1, default=str)
    print()


asyncio.run(main())
