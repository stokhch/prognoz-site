#!/usr/bin/env python3
"""Write Apache-autoindex-style index.html into every directory of data/ratan/ (the copy of the archive shipped
with the site), so the analysis page reads it with the same code as http://spbf.sao.ru/data/ratan/.

Usage: python3 tools/make_mirror_index.py
"""
from __future__ import annotations

import datetime as dt
import html
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent / "data" / "ratan"


def size(n: int) -> str:
    for unit in ("", "K", "M", "G"):
        if n < 1024 or unit == "G":
            return f"{n:.0f}{unit}" if unit == "" else f"{n:.1f}{unit}"
        n /= 1024
    return str(n)


def write(d: Path) -> None:
    rel = "/data/ratan/" + str(d.relative_to(ROOT)).replace(".", "").strip("/")
    rel = rel.rstrip("/") + "/"
    rows = ['<tr><td><a href="?C=N;O=D">Name</a></td><td><a href="?C=M;O=A">Last modified</a></td>'
            '<td><a href="?C=S;O=A">Size</a></td></tr>',
            '<tr><td><a href="../">Parent Directory</a></td><td>&nbsp;</td><td>-</td></tr>']
    for p in sorted(d.iterdir()):
        if p.name == "index.html":
            continue
        t = dt.datetime.fromtimestamp(p.stat().st_mtime).strftime("%d-%b-%Y %H:%M")
        name = p.name + ("/" if p.is_dir() else "")
        sz = "-" if p.is_dir() else size(p.stat().st_size)
        rows.append(f'<tr><td><a href="{quote(name)}">{html.escape(name)}</a></td><td align="right">{t}</td>'
                    f'<td align="right">{sz}</td></tr>')
    (d / "index.html").write_text(
        "<!DOCTYPE HTML PUBLIC \"-//W3C//DTD HTML 3.2 Final//EN\">\n<html>\n<head>\n"
        f"<title>Index of {rel}</title>\n</head>\n<body>\n<h1>Index of {rel}</h1>\n<table>\n"
        + "\n".join(rows) + "\n</table>\n</body></html>\n")
    for p in d.iterdir():
        if p.is_dir():
            write(p)


if __name__ == "__main__":
    write(ROOT)
    print("index.html written under", ROOT)
