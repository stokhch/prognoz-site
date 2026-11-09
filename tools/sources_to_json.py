#!/usr/bin/env python3
"""TSV from tools/export_sources.sh -> data/sources/<YYYY-MM-DD>.json, one file per day.

Each file: {"source": "...", "rows": [{dateobs, fname, pos, posy, noaa, location, area, freq, flux_i, flux_v,
freq10, flux_i10, flux_i2, posykoeff, te3, prognoz}, ...]}. Numbers stay numbers, empty cells become null.
Usage: python3 tools/sources_to_json.py sources.tsv
"""
import csv
import json
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
TEXT = {"dateobs", "fname", "noaa", "location", "prognoz"}


def cell(k, v):
    v = v.strip()
    if v == "":
        return None
    if k in TEXT:
        return v
    try:
        x = float(v.replace(",", "."))
        return int(x) if x.is_integer() and k in {"area", "te3"} else x
    except ValueError:
        return v


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 1
    days = {}
    with open(sys.argv[1], newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f, delimiter="\t"):
            if not r.get("dateobs"):
                continue
            row = {k: cell(k, v or "") for k, v in r.items() if k}
            days.setdefault(row["dateobs"][:10], []).append(row)
    out = SITE / "data" / "sources"
    out.mkdir(parents=True, exist_ok=True)
    for d, rows in sorted(days.items()):
        (out / f"{d}.json").write_text(json.dumps({"source": "prognoz DB, V_RAT_AR_NOAA", "rows": rows}, ensure_ascii=False, indent=0))
        print(f"{d}: {len(rows)} rows -> data/sources/{d}.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
