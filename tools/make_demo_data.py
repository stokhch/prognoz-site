#!/usr/bin/env python3
"""Demonstration data for the pages that need many days: forecast archive, summaries, active region
history, comparison with other instruments, observation journal.

The files have the same format as the real export (README, «Архив и сводки») and carry "demo": true,
so the pages show the demo banner. A simple synthetic Sun: active regions are born, rotate across the
disk and decay; their 2/3/10 cm fluxes follow a smooth curve with noise; flares are drawn with a rate
that grows with the 3 cm flux, so the forecast rule has something to verify. Fixed seed: the output is
the same on every run.

    python3 tools/make_demo_data.py                 # 2025-01-01 .. the day before data/forecast.json
    python3 tools/make_demo_data.py --to 2026-12-31

Writes data/history/, data/indices/, data/journal/ and data/sources/<date>.json for the last days with
multi-azimuth series (dates that already have a real export in data/sources/ are left alone).
Real data replace these files one to one; nothing on the pages changes.
"""
import argparse
import json
import math
import random
from datetime import date, datetime, timedelta
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
RULE = "idl-2026-10"
WINDOW_H = (12, 84)          # flares counted 12..84 h after the start of the forecast day
R_SUN = 960.0                # arcsec
ROT = 13.2                   # deg/day, synodic rotation at low latitudes
NORP_F = ["1", "2", "3.75", "9.4", "17"]
QUIET = {"1": 40.0, "2": 70.0, "3.75": 105.0, "9.4": 255.0, "17": 545.0}   # quiet Sun, s.f.u.
AZIMUTHS = list(range(-24, 25, 2))


class Region:
    def __init__(self, rng, noaa, born):
        self.noaa = noaa
        self.born = born
        self.life = rng.randint(4, 32)
        self.lat = rng.choice([-1, 1]) * rng.uniform(5, 30)
        self.lon0 = rng.uniform(-75, 55)          # central-meridian distance at birth, deg (E < 0)
        self.peak = math.exp(rng.gauss(math.log(7.0), 0.9))
        self.r2 = rng.uniform(0.55, 1.15)        # F2/F3
        self.r10 = rng.uniform(0.25, 1.25)       # F10/F3
        self.pol = rng.choice([-1, 1]) * rng.uniform(0.05, 0.6)
        self.area = int(min(1500, max(10, self.peak * rng.uniform(15, 45))))

    def age(self, d):
        return (d - self.born).days

    def alive(self, d):
        return 0 <= self.age(d) < self.life

    def lon(self, d, hours=9.0):
        return self.lon0 + ROT * (self.age(d) + (hours - 9.0) / 24)

    def visible(self, d):
        return self.alive(d) and -88 <= self.lon(d) <= 88

    def flux3(self, d, rng, hours=9.0, noise=0.15):
        t = (self.age(d) + (hours - 9.0) / 24) / self.life
        env = math.sin(math.pi * min(max(t, 0.02), 0.98)) ** 1.4
        # limb darkening of the radio source on the projected disk (weak)
        mu = math.cos(math.radians(min(abs(self.lon(d, hours)), 89)))
        return max(0.05, self.peak * env * (0.55 + 0.45 * mu) * rng.uniform(1 - noise, 1 + noise))

    def location(self, d):
        lat, lon = round(self.lat), round(self.lon(d))
        return f"{'N' if lat >= 0 else 'S'}{abs(lat):02d}{'W' if lon >= 0 else 'E'}{abs(lon):02d}"


def beam_k(y):
    """Beam correction for the source ordinate y (arcsec): the RATAN-600 beam is long in y."""
    return round(math.exp(-0.5 * (y / 1150.0) ** 2), 3)


def xy(lat, lon):
    la, lo = math.radians(lat), math.radians(lon)
    return R_SUN * math.cos(la) * math.sin(lo), R_SUN * math.sin(la)


def rule(flux3, flux10, k, multi):
    f = flux3 / k if k else flux3
    if f >= 10 and flux10 > 0 and f >= flux10:
        return "positive"
    if flux3 >= 100 or multi:
        return "positive?"
    return "negative"


def day_label(rows):
    labels = {r["label"] for r in rows}
    for lab in ("positive", "positive?"):
        if lab in labels:
            return lab
    return "negative"


def flare_class(rng):
    # power law in peak flux above M1: N(>F) ~ F^-0.8
    f = 1e-5 * (1 - rng.random()) ** (-1 / 0.8)
    if f >= 1e-4:
        return f"X{min(f / 1e-4, 9.9):.1f}"
    return f"M{f / 1e-5:.1f}"


def write_sources_index():
    """data/sources/index.json: dates that have a source table, so pages do not probe missing files."""
    d = SITE / "data/sources"
    dates = sorted(p.stem for p in d.glob("????-??-??.json"))
    (d / "index.json").write_text(json.dumps({"dates": dates}, separators=(",", ":")) + "\n", encoding="utf-8")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--from", dest="d0", default="2025-01-01")
    ap.add_argument("--to", dest="d1", default=None)
    ap.add_argument("--seed", type=int, default=2026)
    a = ap.parse_args()
    rng = random.Random(a.seed)
    fc = json.loads((SITE / "data/forecast.json").read_text(encoding="utf-8"))
    d0 = date.fromisoformat(a.d0)
    # the archive ends the day before the current forecast, which stays in data/forecast.json
    d1 = date.fromisoformat(a.d1) if a.d1 else date.fromisoformat(fc["day"]) - timedelta(days=1)
    real = {o["date"] for o in json.loads((SITE / "data/observations.json").read_text(encoding="utf-8"))["observations"]}
    now = f"{d1.isoformat()}T09:30:00Z"   # fixed: the same output on every run

    # ---- the synthetic Sun -------------------------------------------------------------------
    regions, noaa = [], 13940
    for i in range((d1 - d0).days + 40):
        d = d0 - timedelta(days=30) + timedelta(days=i)
        # activity slowly declines after the maximum of cycle 25
        rate = 0.62 - 0.18 * (d - d0).days / 700
        for _ in range(sum(rng.random() < rate / 2 for _ in range(2))):
            noaa += 1
            regions.append(Region(rng, noaa, d))

    # observation days: ~80%, bad weather comes in spells
    observed, bad = {}, 0
    days = [d0 + timedelta(days=i) for i in range((d1 - d0).days + 1)]
    for d in days:
        if d.isoformat() in real:            # days with real scans on the site are observed
            observed[d] = {"multi": False}
            continue
        if bad > 0:
            bad -= 1
            continue
        if rng.random() < 0.09:
            bad = rng.randint(0, 3)
            continue
        multi = rng.random() < 0.35
        observed[d] = {"multi": multi}

    # flares, with the region they come from
    flares = []
    for d in [days[0] - timedelta(days=1)] + days + [days[-1] + timedelta(days=i) for i in (1, 2, 3, 4)]:
        for r in regions:
            if not r.visible(d):          # NOAA attributes flares to regions on the visible disk only
                continue
            f3 = r.flux3(d, random.Random(hash((r.noaa, d.toordinal())) & 0xffff))
            k = beam_k(xy(r.lat, r.lon(d))[1])
            rate = 0.085 * (f3 / k / 6.0) ** 1.35 + 0.004 * (r.area / 300)
            for _ in range(3):
                if rng.random() < rate / 3:
                    t = datetime(d.year, d.month, d.day) + timedelta(minutes=rng.randint(0, 1439))
                    flares.append({"class": flare_class(rng), "peak": t.strftime("%Y-%m-%dT%H:%M"),
                                   "noaa": str(r.noaa)})
    flares.sort(key=lambda f: f["peak"])

    # ---- daily records --------------------------------------------------------------------------
    hist, indices, journal, sources = {}, {}, {}, {}
    last_rows, last_day = None, None
    for d in days:
        drng = random.Random(d.toordinal())
        vis = [r for r in regions if r.visible(d)]
        obs = observed.get(d)
        rows = []
        if obs:
            for r in vis:
                f3 = r.flux3(d, drng)
                x, y = xy(r.lat, r.lon(d))
                k = beam_k(y)
                rows.append({"noaa": str(r.noaa), "location": r.location(d), "x": round(x), "y": round(y),
                             "flux2": round(f3 * r.r2 * drng.uniform(0.9, 1.1), 2), "flux3": round(f3, 2),
                             "flux10": round(f3 * r.r10 * drng.uniform(0.9, 1.1), 2), "beam": k,
                             "flux3_corr": round(f3 / k, 2), "pol": round(r.pol * drng.uniform(0.8, 1.2), 3),
                             "area": r.area})
            rows.sort(key=lambda w: w["x"])
            # one-dimensional beam: two sources closer than ~40" are one source with two numbers
            merged = []
            for w in rows:
                if merged and abs(w["x"] - merged[-1]["x"]) < 40 and drng.random() < 0.7:
                    m = merged[-1]
                    m["noaa"] += "_" + w["noaa"]
                    for f in ("flux2", "flux3", "flux10"):
                        m[f] = round(m[f] + w[f], 2)
                    m["flux3_corr"] = round(m["flux3"] / m["beam"], 2)
                    continue
                merged.append(w)
            rows = merged
            for w in rows:
                w["label"] = rule(w["flux3"], w["flux10"], w["beam"], "_" in w["noaa"])
            last_rows, last_day = rows, d
        age = (d - last_day).days if last_day else None
        if obs:
            label, data_day, use = day_label(rows), d, rows
        elif last_day and age <= 3:
            label, data_day, use = day_label(last_rows), last_day, last_rows
        else:
            label, data_day, use = "no data", last_day, []
        t0 = datetime(d.year, d.month, d.day)
        w0, w1 = (t0 + timedelta(hours=WINDOW_H[0])).strftime("%Y-%m-%dT%H:%M"), (t0 + timedelta(hours=WINDOW_H[1])).strftime("%Y-%m-%dT%H:%M")
        fl = [f for f in flares if w0 <= f["peak"] < w1]
        rec = {"day": d.isoformat(), "data_day": data_day.isoformat() if data_day else None,
               "age_days": age if age is not None else None, "label": label,
               "quality": "no data" if label == "no data" else ("A" if obs else ("B" if age <= 1 else "C")),
               "observed": bool(obs), "rows": use if obs else [], "flares": fl}
        if not obs and label != "no data":
            rec["rows_from"] = data_day.isoformat()
        hist.setdefault(d.year, []).append(rec)

        # ---- whole-disk fluxes: Penticton F10.7, NoRP, RATAN ----
        f10_sum = sum(r.flux3(d, drng) * r.r10 for r in vis)
        f3_sum = sum(r.flux3(d, drng) for r in vis)
        f2_sum = sum(r.flux3(d, drng) * r.r2 for r in vis)
        def spec(fr):
            g = {"1": 0.6 * f10_sum, "2": 1.0 * f10_sum, "3.75": 0.5 * (f10_sum + f3_sum),
                 "9.4": f3_sum, "17": 0.85 * f2_sum}[fr]
            return QUIET[fr] + g
        nr = {fr: round(spec(fr) * drng.uniform(0.98, 1.02), 1) for fr in NORP_F}
        ix = {"date": d.isoformat(), "f107": round((66 + 0.95 * f10_sum + 0.5 * f3_sum) * drng.uniform(0.98, 1.02), 1),
              "norp": nr}
        if obs:
            ix["ratan"] = {fr: round(spec(fr) * 1.04 * drng.uniform(0.95, 1.05), 1) for fr in ("2", "3.75", "9.4", "17")}
        indices.setdefault(d.year, []).append(ix)

        # ---- observation journal ----
        if obs:
            if obs["multi"]:
                n = len(AZIMUTHS) - drng.randint(0, 4)
                az = AZIMUTHS[:n]
                first = datetime(d.year, d.month, d.day, 7, 0) + timedelta(minutes=drng.randint(-20, 20))
                last = first + timedelta(minutes=4 * (n - 1))
            else:
                az, first = [0], datetime(d.year, d.month, d.day, 9, 0) + timedelta(minutes=drng.randint(-25, 25))
                last = first
            note = drng.choice(["", "", "", "", "ветер", "помехи на 3–4 ГГц", "облачность", "профилактика облучателя"])
            journal.setdefault(d.year, []).append({"date": d.isoformat(), "n_scans": len(az), "az": az,
                                                   "first_ut": first.strftime("%H:%M"), "last_ut": last.strftime("%H:%M"),
                                                   "mode": "многоазимутальный" if len(az) > 1 else "az 0", "note": note})
            if obs["multi"] and (d1 - d).days < 21:
                srows = []
                for i, azv in enumerate(az):
                    t = first + timedelta(minutes=4 * i)
                    h = t.hour + t.minute / 60
                    srng = random.Random(d.toordinal() * 100 + i)
                    fname = f"{t:%Y%m%d_%H%M%S}_sun{azv:+d}".replace("+", "") + "_out.fits"
                    for r in vis:
                        f3 = r.flux3(d, random.Random(d.toordinal()), h, noise=0.0) * srng.uniform(0.97, 1.03)
                        x, y = xy(r.lat, r.lon(d, h))
                        k = beam_k(y)
                        f10 = f3 * r.r10 * srng.uniform(0.97, 1.03)
                        srows.append({"dateobs": t.strftime("%Y-%m-%d %H:%M:%S"), "fname": fname, "pos": round(x, 1),
                                      "posy": round(y, 1), "noaa": str(r.noaa), "location": r.location(d), "area": r.area,
                                      "freq": 10.0, "flux_i": round(f3, 2), "flux_v": round(f3 * r.pol, 2), "freq10": 3.0,
                                      "flux_i10": round(f10, 2), "flux_i2": round(f3 * r.r2 * srng.uniform(0.97, 1.03), 2),
                                      "posykoeff": k, "te3": int(f3 / k >= 10 and f3 / k >= f10),
                                      "prognoz": rule(f3, f10, k, False)})
                sources[d.isoformat()] = srows

    # ---- write ----------------------------------------------------------------------------------
    def dump(path, obj):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")

    years = sorted(hist)
    for y in years:
        dump(SITE / f"data/history/{y}.json", {"demo": True, "year": y, "rule_version": RULE, "window_h": list(WINDOW_H),
                                              "flare_min": "M1.0", "generated_at": now, "days": hist[y]})
        dump(SITE / f"data/indices/{y}.json", {"demo": True, "year": y, "norp_ghz": NORP_F,
                                              "sources": {"f107": "DRAO Penticton, adjusted flux 10.7 cm",
                                                          "norp": "Nobeyama Radio Polarimeters, daily flux",
                                                          "ratan": "RATAN-600, whole-disk flux from level2"},
                                              "days": indices[y]})
        dump(SITE / f"data/journal/{y}.json", {"demo": True, "year": y, "entries": journal.get(y, [])})
    dump(SITE / "data/history/index.json", {"demo": True, "years": years, "first": days[0].isoformat(),
                                           "last": days[-1].isoformat(), "generated_at": now})
    for dd, srows in sources.items():
        p = SITE / f"data/sources/{dd}.json"
        if p.exists() and not json.loads(p.read_text(encoding="utf-8")).get("demo"):
            continue
        dump(p, {"demo": True, "source": "demo (tools/make_demo_data.py), format of V_RAT_AR_NOAA", "rows": srows})
    write_sources_index()
    n_fl = sum(len(r["flares"]) for y in years for r in hist[y])
    print(f"{len(days)} days, {len(observed)} observed, {len(regions)} regions, {len(flares)} flares "
          f"({n_fl} in forecast windows), {len(sources)} days with sources")


if __name__ == "__main__":
    main()
