#!/usr/bin/env python3
"""Checks that need no network: data files against the documented format (README), local links and
anchors in the pages, and the basics of every page (language, title, one h1).

    python3 tools/validate_site.py        # exit code 1 if anything is wrong
"""
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
LABELS = {"positive", "positive?", "negative", "negative?", "no data"}
errors = []

def err(msg):
    errors.append(msg)

def load(path):
    try:
        return json.loads((SITE / path).read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        err(f"{path}: {e}")
        return None

# ---- data files ----
f = load("data/forecast.json")
if f:
    for k in ("day", "data_day", "label", "rows"):
        if k not in f:
            err(f"data/forecast.json: no '{k}'")
    if f.get("label") not in LABELS:
        err(f"data/forecast.json: bad label {f.get('label')!r}")
    for r in f.get("rows", []):
        if r.get("label") not in LABELS:
            err(f"data/forecast.json: bad row label {r.get('label')!r}")
        for k in ("noaa", "flux3", "flux10"):
            if k not in r:
                err(f"data/forecast.json: row without '{k}': {r}")
    if not f.get("demo") and "generated_at" not in f:
        err("data/forecast.json: a real forecast needs generated_at (the site warns when it is stale)")

o = load("data/observations.json")
if o:
    for ob in o.get("observations", []):
        for k in ("id", "date", "time_ut", "az"):
            if k not in ob:
                err(f"data/observations.json: observation without '{k}': {ob}")
        if not (SITE / "data/scans" / f"{ob.get('id')}.jpg").exists():
            err(f"data/observations.json: no data/scans/{ob.get('id')}.jpg")

c = load("data/config.json")
if c:
    if c.get("prefer") not in ("local", "remote"):
        err("data/config.json: 'prefer' must be 'local' or 'remote'")
    for a in c.get("archives", []):
        if not str(a.get("url", "")).endswith("/"):
            err(f"data/config.json: archive url must end with '/': {a}")

# archive: data/history, data/indices, data/journal (README, «Архив и сводки»)
hi = load("data/history/index.json")
if hi:
    for y in hi.get("years", []):
        h = load(f"data/history/{y}.json")
        if h:
            prev = ""
            for d in h.get("days", []):
                for k in ("day", "label", "rows", "flares", "observed"):
                    if k not in d:
                        err(f"data/history/{y}.json: day without '{k}': {d.get('day')}")
                if d.get("label") not in LABELS:
                    err(f"data/history/{y}.json: bad label {d.get('label')!r} on {d.get('day')}")
                if d.get("day", "") <= prev:
                    err(f"data/history/{y}.json: days not in order at {d.get('day')}")
                prev = d.get("day", "")
                for r in d.get("rows", []):
                    for k in ("noaa", "flux3", "flux3_corr", "flux10", "label"):
                        if k not in r:
                            err(f"data/history/{y}.json: row without '{k}' on {d['day']}")
                for fl in d.get("flares", []):
                    if not re.match(r"^[CMX]\d+(\.\d+)?$", str(fl.get("class", ""))) or "peak" not in fl:
                        err(f"data/history/{y}.json: bad flare {fl} on {d['day']}")
        ix = load(f"data/indices/{y}.json")
        if ix:
            for d in ix.get("days", []):
                if "date" not in d or "norp" not in d:
                    err(f"data/indices/{y}.json: day without date or norp: {d}")
        j = load(f"data/journal/{y}.json")
        if j:
            for e in j.get("entries", []):
                for k in ("date", "n_scans", "az", "first_ut"):
                    if k not in e:
                        err(f"data/journal/{y}.json: entry without '{k}': {e}")
si = SITE / "data/sources/index.json"
if si.exists():
    listed = set(load("data/sources/index.json").get("dates", []))
    files = {p.stem for p in (SITE / "data/sources").glob("????-??-??.json")}
    if listed != files:
        err("data/sources/index.json does not match the files in data/sources/ (run tools/sources_to_json.py)")

# ---- pages ----
class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids, self.links, self.h1, self.lang, self.title, self._in_title = set(), [], 0, None, "", False
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if "id" in a:
            self.ids.add(a["id"])
        if tag == "html":
            self.lang = a.get("lang")
        if tag == "h1":
            self.h1 += 1
        if tag == "title":
            self._in_title = True
        for k in ("href", "src"):
            if k in a and a[k]:
                self.links.append(a[k])
    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
    def handle_data(self, d):
        if self._in_title:
            self.title += d

pages = {}
for p in sorted(SITE.glob("*.html")):
    pg = Page()
    pg.feed(p.read_text(encoding="utf-8"))
    pages[p.name] = pg
    if not pg.lang:
        err(f"{p.name}: no lang")
    if not pg.title.strip():
        err(f"{p.name}: no title")
    if pg.h1 != 1:
        err(f"{p.name}: {pg.h1} h1 elements (need 1)")

for name, pg in pages.items():
    for link in pg.links:
        if re.match(r"(https?:|mailto:|data:|//|javascript:)", link):
            continue
        path, _, frag = link.partition("#")
        path = path.split("?")[0]
        if path:
            target = SITE / path
            if not target.exists():
                err(f"{name}: broken link {link}")
                continue
        else:
            target = SITE / name
        # anchors only inside pages whose ids are static (data.html uses #YYYY/MM/file for the archive)
        if frag and target.suffix == ".html" and target.name in pages and not re.match(r"\d{4}/", frag):
            if frag not in pages[target.name].ids:
                err(f"{name}: no anchor #{frag} in {target.name}")

if errors:
    print("\n".join(errors))
    sys.exit(1)
print(f"ok: {len(pages)} pages, data files valid")
