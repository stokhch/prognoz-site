#!/usr/bin/env python3
"""Generate the DEMO data of the site (data/*.json) and the scan pictures (data/scans/*.jpg).

The pictures are drawn by ratan_forecast.scanplot (the same code that makes sunsao0.jpg / sunsao1.jpg for the
forecast), so the site shows exactly the forecast picture. Scans are synthetic: quiet-Sun disk convolved with a
fan beam plus a few local sources, brightness temperature in K, x window +-2 solar radii as in level2.

Usage: python3 tools/make_demo.py /path/to/ratan-forecast/src
"""
from __future__ import annotations

import datetime as dt
import json
import math
import random
import sys
from pathlib import Path

import numpy as np

SITE = Path(__file__).resolve().parent.parent
sys.path.insert(0, sys.argv[1] if len(sys.argv) > 1 else str(SITE.parent / "ratan-forecast" / "src"))
from ratan_forecast.level2 import Level2          # noqa: E402
from ratan_forecast.scanplot import render_pair    # noqa: E402

SOLAR_R = 960.0      # arcsec
CDELT = 10.0         # arcsec per sample
NX = 401             # -2000 .. +2000 arcsec
CRPIX = 200.0        # 0-based index of the disk centre (as scanplot uses it)
FREQ = np.round(np.arange(3.0, 18.01, 0.625), 3)   # 25 channels, GHz


def tq_sun(f):
    """Quiet-Sun temperature, K: log-interpolation through 10400 K at 2 cm and 131700 K at 31.6 cm."""
    lam = 30.0 / f
    a = math.log(131700 / 10400) / math.log(31.6 / 2.0)
    return 10400 * (lam / 2.0) ** a


def scan(day: int, az: int, rng: random.Random):
    x = (np.arange(NX) - CRPIX) * CDELT
    data = np.zeros((len(FREQ), 2, NX), np.float32)
    rot = day * 13.0                                    # arcsec/day drift with solar rotation
    sources = [(-640, 1.0, 40), (310, 1.7, 30), (520, 0.6, 45)]
    for i, f in enumerate(FREQ):
        tq = tq_sun(f)
        beam = 30.0 * 10 / f                             # horizontal beam, arcsec
        disk = np.where(np.abs(x) < SOLAR_R, np.sqrt(np.clip(1 - (x / SOLAR_R) ** 2, 0, 1)) ** 0.3, 0.0)
        k = np.exp(-0.5 * (np.arange(-60, 61) * CDELT / beam) ** 2)
        disk = np.convolve(disk, k / k.sum(), mode="same") * tq
        I = disk.copy()
        V = np.zeros(NX)
        for p, amp, w in sources:
            pp = p + rot + az * 2
            width = math.hypot(w, beam)
            g = np.exp(-0.5 * ((x - pp) / width) ** 2)
            peak = amp * 1.6e4 * (6.0 / f) ** 1.2 * (0.7 + 0.3 * math.sin(day / 2 + p))
            I += peak * g
            V += peak * g * (0.25 if p > 0 else -0.2) * (1 if f > 6 else -0.5)
        I += rng.gauss(0, 1) * 0.002 * tq
        data[i, 0], data[i, 1] = I, V
    return x, data


def main():
    rng = random.Random(7)
    out = SITE / "data"
    (out / "scans").mkdir(parents=True, exist_ok=True)
    start = dt.date(2026, 10, 26)
    obs = []
    for d in range(13):
        day = start + dt.timedelta(days=d)
        azs = [0] + ([16, -16] if d % 4 == 1 else [])
        for k, az in enumerate(azs):
            oid = f"{day:%Y%m%d}-az{'m' if az < 0 else ''}{abs(az)}"
            t = dt.datetime.combine(day, dt.time(9, 5 + 4 * k))
            x, data = scan(d, az, rng)
            obs.append({"id": oid, "date": day.isoformat(), "time_ut": f"{t:%H:%M}", "az": az,
                        "scans": int(len(FREQ) * 2), "defective": rng.choice([0, 0, 1, 2, 3]), "n_per_day": len(azs)})
            l2 = Level2(oid, t, data, FREQ.astype(float), np.array([tq_sun(f) for f in FREQ]),
                        np.full(len(FREQ), 20.0), np.ones(len(FREQ)), CRPIX, CDELT, SOLAR_R, 0.0, 0.0,
                        float(az), 0, {})
            small, big = render_pair(l2, out / "scans", robust=True)
            small.replace(out / "scans" / f"{oid}-small.jpg")
            big.replace(out / "scans" / f"{oid}.jpg")
            js = {"demo": True, "id": oid, "date": day.isoformat(), "time_ut": f"{t:%H:%M}", "az": az,
                  "units": "K", "solar_r": SOLAR_R,
                  "x_arcsec": {"start": float(x[0]), "step": CDELT, "n": NX},
                  "channels": [{"freq_ghz": float(f), "tqsun": round(tq_sun(f)),
                                "I": [round(float(v)) for v in data[i, 0]],
                                "V": [round(float(v)) for v in data[i, 1]]} for i, f in enumerate(FREQ)]}
            (out / "scans" / f"{oid}.json").write_text(json.dumps(js, separators=(",", ":")))
    (out / "observations.json").write_text(json.dumps(
        {"demo": True, "generated_at": "2026-11-09T09:30:00Z", "observations": obs}, ensure_ascii=False, indent=1))
    print(len(obs), "observations")


if __name__ == "__main__":
    main()
