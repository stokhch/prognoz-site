#!/usr/bin/env python3
"""Cache busting for GitHub Pages: append ?v=<version> to the site's own scripts, styles and module imports,
so a browser never mixes a new page with modules it cached from the previous version.

Usage (in the Pages workflow, before upload): python3 tools/stamp_version.py <version>
"""
import re
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
v = (sys.argv[1] if len(sys.argv) > 1 else "dev")[:12]

js_import = re.compile(r"""((?:from|import)\s*\(?\s*['"])(\.{1,2}/[^'"?]+\.js)(['"])""")
html_ref = re.compile(r"""((?:src|href)=["'])((?:\./)?assets/[^"'?]+\.(?:js|css))(["'])""")

for f in list(SITE.glob("*.html")) + list((SITE / "assets").glob("*.js")):
    s = f.read_text(encoding="utf-8")
    t = js_import.sub(lambda m: f"{m.group(1)}{m.group(2)}?v={v}{m.group(3)}", s)
    t = html_ref.sub(lambda m: f"{m.group(1)}{m.group(2)}?v={v}{m.group(3)}", t)
    if t != s:
        f.write_text(t, encoding="utf-8")
        print("stamped", f.relative_to(SITE))
