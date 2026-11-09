#!/usr/bin/env python3
"""Export RATAN-600 level2 scans (*_out.fits) to the site: data/scans/<id>.jpg, <id>-small.jpg, <id>.json
and data/observations.json.

The pictures are drawn by ratan_forecast.scanplot (the code of the forecast pictures sunsao1.jpg / sunsao0.jpg).
Channels with an obviously broken signal (max of I more than BAD_FACTOR times the median of the per-channel
maxima) are dropped before drawing and export; they are listed in the JSON as "dropped".

The JSON keeps the +-2 solar radii window of the picture, thinned to about STEP_ARCSEC per point.

With --sun the SDO pictures for the observation time are downloaded from Helioviewer (takeScreenshot) into
data/sun/<file>-<layer>.png, so the analysis page shows them without asking Helioviewer from the browser.

With --regions the NOAA active regions of the day are saved to data/regions/<date>.json.
With --goes the GOES X-ray flux of the day (SWPC, last 7 days only) is saved to data/goes/<date>.json.

Usage: python3 tools/make_site_data.py --src /path/to/ratan-forecast/src [--sun] [--regions] [--goes] file1_out.fits [...]
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
SUN_LAYERS = {             # same keys as assets/views.js SUN_LAYERS
    "aia193": "[SDO,AIA,AIA,193,1,100]", "aia171": "[SDO,AIA,AIA,171,1,100]", "aia304": "[SDO,AIA,AIA,304,1,100]",
    "aia1600": "[SDO,AIA,AIA,1600,1,100]", "aia94": "[SDO,AIA,AIA,94,1,100]",
    "hmimag": "[SDO,HMI,HMI,magnetogram,1,100]", "hmicont": "[SDO,HMI,HMI,continuum,1,100]",
}


def fetch_goes(date: str) -> None:
    """GOES X-ray flux of the day from SWPC xrays-7-day.json -> data/goes/<date>.json
    ({source, long: [[minute, flux]], short: [...]}); SWPC keeps only the last 7 days."""
    out = SITE / "data" / "goes"
    out.mkdir(parents=True, exist_ok=True)
    try:
        req = urllib.request.Request("https://services.swpc.noaa.gov/json/goes/primary/xrays-7-day.json", headers={"User-Agent": "prognoz-site"})
        with urllib.request.urlopen(req, timeout=60) as r:
            rows = json.load(r)
    except Exception as e:  # network problems must not stop the export
        print(f"  goes: {e}")
        return
    long, short, sat = [], [], ""
    for x in rows:
        t = str(x.get("time_tag", ""))
        if t[:10] != date or not (x.get("flux") or 0) > 0:
            continue
        m = int(t[11:13]) * 60 + int(t[14:16])
        (long if str(x.get("energy", "")).startswith("0.1") else short).append([m, x["flux"]])
        sat = x.get("satellite", sat)
    if not long:
        print(f"  goes: no SWPC data for {date} (only the last 7 days are kept)")
        return
    (out / f"{date}.json").write_text(json.dumps({"source": f"NOAA SWPC, GOES-{sat} (copy)", "long": long, "short": short}))
    print(f"  goes: {len(long)} minutes -> data/goes/{date}.json")


def fetch_regions(date: str) -> None:
    """NOAA active regions of the day from SWPC solar_regions.json -> data/regions/<date>.json
    (list of {noaa, location, area, mag}); the analysis page reads it before asking SWPC itself."""
    import urllib.request
    out = SITE / "data" / "regions"
    out.mkdir(parents=True, exist_ok=True)
    try:
        req = urllib.request.Request("https://services.swpc.noaa.gov/json/solar_regions.json", headers={"User-Agent": "prognoz-site"})
        with urllib.request.urlopen(req, timeout=60) as r:
            allr = json.loads(r.read())
    except Exception as e:  # noqa: BLE001
        print(f"  regions: {e}")
        return
    day = [x for x in allr if str(x.get("observed_date", ""))[:10] == date]
    if not day:
        print(f"  regions: no SWPC summary for {date} (the list keeps only recent days; use the SRS archive)")
        return
    lst = [{"noaa": x.get("region"), "location": x.get("location"), "area": x.get("area"), "mag": x.get("mag_class")} for x in day]
    (out / f"{date}.json").write_text(json.dumps(lst, ensure_ascii=False, indent=1))
    print(f"  regions: {len(lst)} -> data/regions/{date}.json")


def fetch_sun(path: Path, when, layers=("aia193", "hmimag", "hmicont", "aia304")) -> None:
    """Download the Helioviewer screenshots (900 px, 2.8 arcsec/px, disk centre in the middle) for the scan."""
    import time
    import urllib.request
    out = SITE / "data" / "sun"
    out.mkdir(parents=True, exist_ok=True)
    stem = path.name[:-5] if path.name.lower().endswith(".fits") else path.stem
    for lay in layers:
        dst = out / f"{stem}-{lay}.png"
        if dst.exists() and dst.stat().st_size > 10000:
            continue
        url = ("https://api.helioviewer.org/v2/takeScreenshot/?date=" + when.strftime("%Y-%m-%dT%H:%M:%SZ")
               + "&imageScale=2.8&layers=" + SUN_LAYERS[lay]
               + "&x0=0&y0=0&width=900&height=900&display=true&watermark=false&events=[AR,all,1]&eventLabels=true")
        req = urllib.request.Request(url.replace("[", "%5B").replace("]", "%5D").replace(",", "%2C"),
                                     headers={"User-Agent": "prognoz-site"})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                data = r.read()
                ctype = r.headers.get("Content-Type", "")
        except Exception as e:  # noqa: BLE001
            print(f"  {lay}: {e}")
            continue
        if not data.startswith(b"\x89PNG") and "image" not in ctype:
            print(f"  {lay}: not an image ({ctype}): {data[:200]!r}")
            continue
        dst.write_bytes(data)
        print(f"  {lay}: {dst.name} ({len(data)} bytes)")
        time.sleep(1)


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
    return {"id": oid, "path": f"{path.name[:4]}/{path.name[4:6]}/{path.name}", "date": js["date"], "time_ut": js["time_ut"][:5], "az": int(round(scan.azimuth)),
            "channels": int(scan.n_chan), "removed": int(N_CHANNELS_FULL - scan.n_chan)}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--src", required=True, help="ratan-forecast/src")
    ap.add_argument("--sun", action="store_true", help="also download SDO pictures from Helioviewer")
    ap.add_argument("--regions", action="store_true", help="also save the NOAA regions of the day (SWPC) to data/regions/")
    ap.add_argument("--goes", action="store_true", help="also save the GOES X-ray flux of the day (SWPC, last 7 days) to data/goes/")
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
        if a.sun:
            from ratan_forecast.level2 import read_level2
            fetch_sun(f, read_level2(f).obs_time)
        if a.regions:
            fetch_regions(o["date"])
        if a.goes:
            fetch_goes(o["date"])
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
