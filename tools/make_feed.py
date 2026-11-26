#!/usr/bin/env python3
"""RSS 2.0 feed of the forecast (feed.xml): one item a day, newest first, from data/forecast.json and the
archive data/history/<year>.json. Replaces the e-mail notices of the old site (rat_alert, sendnotice1.pl):
anyone can subscribe in a feed reader, and the server sends no mail.

    python3 tools/make_feed.py            # writes feed.xml (the Pages workflow runs it before publishing)
    python3 tools/make_feed.py --check    # exit 1 if feed.xml is out of date
"""
import json
import sys
from datetime import datetime, timezone
from email.utils import format_datetime
from pathlib import Path
from xml.sax.saxutils import escape

SITE = Path(__file__).resolve().parent.parent
BASE = "https://stokhch.github.io/prognoz-site/"
DAYS = 30
TEXT = {
    "negative": "Мощных вспышек в ближайшие 3 суток не ожидается.",
    "negative?": "Мощных вспышек не ожидается (признак проверен не полностью).",
    "positive?": "Вероятность выше средней: признак есть, но сомнительный.",
    "positive": "Хотя бы в одной активной области вероятна мощная вспышка.",
    "no data": "Нет наблюдений за последние 3 суток — прогноз не строится.",
}


def load(p):
    try:
        return json.loads((SITE / p).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def dmy(iso):
    return f"{iso[8:10]}.{iso[5:7]}.{iso[:4]}"


def item(day, label, rows, data_day, flares=None, demo=False, page=None):
    pos = [r["noaa"] for r in rows if r.get("label") in ("positive", "positive?")]
    desc = [TEXT.get(label, "")]
    if data_day and data_day != day:
        desc.append(f"По наблюдениям {dmy(data_day)}.")
    if pos:
        desc.append("Области с признаком: " + ", ".join(pos) + ".")
    if flares:
        desc.append("Вспышки за 12–84 ч после дня: " + ", ".join(f["class"] for f in flares) + ".")
    if demo:
        desc.append("Демонстрационные данные.")
    t = datetime.fromisoformat(day).replace(hour=13, tzinfo=timezone.utc)   # 16:00 MSK, publication time
    link = f"{BASE}{page}" if page else f"{BASE}archive.html#{day}"
    return (f"  <item>\n    <title>{escape(dmy(day))}: {escape(label)}</title>\n    <link>{link}</link>\n"
            f"    <guid isPermaLink=\"false\">prognoz-{day}</guid>\n    <pubDate>{format_datetime(t)}</pubDate>\n"
            f"    <category>{escape(label)}</category>\n    <description>{escape(' '.join(desc))}</description>\n  </item>\n")


def build():
    ix = load("data/history/index.json") or {"years": []}
    days = []
    for y in ix.get("years", [])[-2:]:
        h = load(f"data/history/{y}.json")
        if h:
            days += [dict(d, demo=h.get("demo", False)) for d in h["days"]]
    f = load("data/forecast.json")
    by = {d["day"]: d for d in days}
    if f and f.get("day") and f["day"] not in by:
        by[f["day"]] = {"day": f["day"], "label": f["label"], "rows": f.get("rows", []), "data_day": f.get("data_day"),
                        "flares": [], "demo": f.get("demo", False), "page": "forecast.html"}
    latest = sorted(by.values(), key=lambda d: d["day"], reverse=True)[:DAYS]
    items = "".join(item(d["day"], d["label"], d.get("rows") or [], d.get("data_day"),
                         d.get("flares") if d is not latest[0] else None, d.get("demo"), d.get("page")) for d in latest)
    built = format_datetime(datetime.fromisoformat(latest[0]["day"]).replace(hour=13, tzinfo=timezone.utc)) if latest else ""
    return ('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n<channel>\n'
            "  <title>Прогноз солнечных вспышек · РАТАН-600</title>\n"
            f"  <link>{BASE}</link>\n"
            f'  <atom:link href="{BASE}feed.xml" rel="self" type="application/rss+xml"/>\n'
            "  <description>Трёхсуточный прогноз мощных солнечных вспышек по наблюдениям РАТАН-600 (СПбФ САО РАН)</description>\n"
            "  <language>ru</language>\n"
            f"  <lastBuildDate>{built}</lastBuildDate>\n  <ttl>360</ttl>\n" + items + "</channel>\n</rss>\n")


def main():
    out = SITE / "feed.xml"
    new = build()
    if "--check" in sys.argv:
        if not out.exists() or out.read_text(encoding="utf-8") != new:
            print("feed.xml is out of date (run tools/make_feed.py)")
            sys.exit(1)
        print("feed.xml up to date")
        return
    out.write_text(new, encoding="utf-8")
    print("wrote feed.xml")


if __name__ == "__main__":
    main()
