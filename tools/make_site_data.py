#!/usr/bin/env python3
"""Export RATAN-600 level2 scans (*_out.fits) to the site: data/scans/<id>.jpg, <id>-small.jpg, <id>.json
and data/observations.json.

The pictures are drawn by ratan_forecast.scanplot (the code of the forecast pictures sunsao1.jpg / sunsao0.jpg).
Channels with an obviously broken signal (max of I more than BAD_FACTOR times the median of the per-channel
maxima) are dropped before drawing and export; they are listed in the JSON as "dropped".

The JSON keeps the +-2 solar radii window of the picture, thinned to about STEP_ARCSEC per point.

Usage: python3 tools/make_site_data.py --src /path/to/ratan-forecast/src file1_out.fits [file2_out.fits ...]
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import replace
from pathlib import Path

import numpy as np

SITE = Path(__file__).resolve().parent.parent
BAD_FACTOR = 10.0
STEP_ARCSEC = 8.0
N_CHANNELS_FULL = 90      # channels of the new complex before the level1 -> level2 cleaning


def obs_id(t, az: float) -> str:
    a = int(round(az))
    return f"{t:%Y%m%d-%H%M%S}-az{'m' if a < 0 else ''}{abs(a)}"


def clean(scan):
    """Drop channels whose I maximum is far above the others (spikes the cleaning missed)."""
    mx = np.nanmax(np.nan_to_num(scan.data[:, 0], nan=0.0), axis=1)
    keep = mx <= BAD_FACTOR * np.median(mx)
    dropped = [round(float(f), 3) for f in scan.freq[~keep]]
    return replace(scan, data=scan.data[keep], freq=scan.freq[keep], tqsun=scan.tqsun[keep],
                   theta=scan.theta[keep], kflux=scan.kflux[keep]), dropped


def export(path: Path, out: Path) -> dict:
    from ratan_forecast.level2 import read_level2
    from ratan_forecast.scanplot import render_pair
    raw = read_level2(path)
    scan, dropped = clean(raw)
    oid = obs_id(scan.obs_time, scan.azimuth)
    small, big = render_pair(scan, out, robust=False)
    small.replace(out / f"{oid}-small.jpg")
    big.replace(out / f"{oid}.jpg")
    # the same x window as the picture: +-2 solar radii around the centre
    rx = int(round(scan.solar_r / scan.cdelt1))
    x1 = max(int(round(scan.crpix1 - 2 * rx)), 0)
    x2 = min(x1 + 4 * rx, scan.n_x - 1)
    k = max(1, int(round(STEP_ARCSEC / scan.cdelt1)))
    idx = np.arange(x1, x2 + 1, k)
    x = (idx - scan.crpix1) * scan.cdelt1
    d = np.nan_to_num(scan.data.astype(float), nan=0.0)
    js = {"id": oid, "file": path.name, "date": f"{scan.obs_time:%Y-%m-%d}", "time_ut": f"{scan.obs_time:%H:%M:%S}",
          "az": round(float(scan.azimuth), 1), "units": "K", "solar_r": round(float(scan.solar_r), 2),
          "x_arcsec": {"start": round(float(x[0]), 2), "step": round(float(k * scan.cdelt1), 4), "n": int(len(idx))},
          "dropped": dropped,
          "channels": [{"freq_ghz": round(float(f), 4), "tqsun": round(float(scan.tqsun[i])),
                        "I": [round(float(v)) for v in d[i, 0, idx]],
                        "V": [round(float(v)) for v in d[i, 1, idx]]} for i, f in enumerate(scan.freq)]}
    (out / f"{oid}.json").write_text(json.dumps(js, separators=(",", ":")))
    print(f"{path.name} -> {oid}: {scan.n_chan} channels, dropped {dropped or 'none'}")
    return {"id": oid, "date": js["date"], "time_ut": js["time_ut"][:5], "az": int(round(scan.azimuth)),
            "channels": int(scan.n_chan), "removed": int(N_CHANNELS_FULL - scan.n_chan)}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--src", required=True, help="ratan-forecast/src")
    ap.add_argument("files", nargs="+", type=Path)
    a = ap.parse_args()
    sys.path.insert(0, a.src)
    out = SITE / "data" / "scans"
    out.mkdir(parents=True, exist_ok=True)
    idx_path = SITE / "data" / "observations.json"
    old = json.loads(idx_path.read_text()) if idx_path.exists() else {}
    obs = {o["id"]: o for o in old.get("observations", []) if not old.get("demo")}
    for f in a.files:
        o = export(f, out)
        obs[o["id"]] = o
    items = sorted(obs.values(), key=lambda o: (o["date"], o["time_ut"]))
    per_day = {}
    for o in items:
        per_day[o["date"]] = per_day.get(o["date"], 0) + 1
    for o in items:
        o["n_per_day"] = per_day[o["date"]]
    idx_path.write_text(json.dumps({"observations": items}, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
