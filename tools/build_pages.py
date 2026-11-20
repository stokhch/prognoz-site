#!/usr/bin/env python3
"""Keep the parts shared by all pages in one place.

The site has no build step for visitors, but the header, the footer and the <head> metadata
(description, Open Graph) are identical in every page. They live in partials/ and in PAGES below;
this script writes them between marker comments in each *.html.

    python3 tools/build_pages.py          # rewrite the pages
    python3 tools/build_pages.py --check  # exit 1 if a page is out of date (used by CI)
"""
import re
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
BASE = "https://stokhch.github.io/prognoz-site/"

PAGES = {
    "index.html": "Трёхсуточный прогноз мощных солнечных вспышек и данные наблюдений Солнца на радиотелескопе РАТАН-600.",
    "forecast.html": "Итог дня, таблица критерия Танаки–Эноме по активным областям и методика прогноза мощных вспышек по наблюдениям РАТАН-600.",
    "data.html": "Просмотр и анализ сканов Солнца РАТАН-600 из архива level2 прямо в браузере: графики, карты, спектры, Фурье и вейвлеты.",
    "search.html": "Поиск наблюдений Солнца РАТАН-600 по дате, азимуту и числу наблюдений в день.",
    "observations.html": "Как РАТАН-600 наблюдает Солнце: режимы, форматы данных, обработка и доступ к архиву.",
    "instrument.html": "Радиотелескоп РАТАН-600: устройство, параметры, антенны и приёмные комплексы.",
    "tools.html": "Расчётные инструменты: эфемериды EFRAT, диаграмма направленности, моделирование радиоизлучения активных областей.",
    "activity.html": "Классификации солнечной активности и каталог ссылок на службы прогноза и данные о космической погоде.",
    "about.html": "О проекте: история системы «Прогноз», команда, публикации и ссылки.",
    "404.html": "Страница не найдена.",
}

def block(name, body):
    return f"<!-- partial:{name} -->\n{body.rstrip()}\n<!-- /partial:{name} -->\n"

def esc(s):
    return s.replace("&", "&amp;").replace('"', "&quot;")

def render(path):
    s = path.read_text(encoding="utf-8")
    lang = re.search(r'<html lang="(\w+)"', s).group(1)
    lang_attr = "" if lang == "ru" else ' lang="ru"'
    page = path.name

    header = (SITE / "partials/header.html").read_text(encoding="utf-8")
    header = header.replace("{lang}", lang_attr)
    header = re.sub(r"\{cur:([\w.]+)\}", lambda m: ' aria-current="page"' if m.group(1) == page else "", header)
    footer = (SITE / "partials/footer.html").read_text(encoding="utf-8").replace("{lang}", lang_attr)

    title = re.search(r"<title>(.*?)</title>", s, re.S).group(1)
    desc = PAGES[page]
    meta = "\n".join([
        f'<meta name="description" content="{esc(desc)}">',
        '<meta property="og:type" content="website">',
        f'<meta property="og:title" content="{esc(title)}">',
        f'<meta property="og:description" content="{esc(desc)}">',
        f'<meta property="og:url" content="{BASE}{"" if page == "index.html" else page}">',
        f'<meta property="og:locale" content="{"ru_RU" if lang == "ru" else "en_US"}">',
        '<meta name="twitter:card" content="summary">',
    ])

    # the old single description line (index.html) is replaced by the managed block
    s = re.sub(r'<meta name="description"[^>]*>\n?', "", s)
    s = re.sub(r"<!-- partial:meta -->.*?<!-- /partial:meta -->\n?", "", s, flags=re.S)
    s = s.replace("</title>\n", "</title>\n" + block("meta", meta), 1)

    hdr_re = re.compile(r"(?:<!-- partial:header -->\n)?<a class=\"skip\".*?</header>\n?(?:<noscript>.*?</noscript>\n?)?(?:<!-- /partial:header -->\n?)?", re.S)
    assert hdr_re.search(s), page
    s = hdr_re.sub(lambda m: block("header", header), s, count=1)
    ftr_re = re.compile(r"(?:<!-- partial:footer -->\n)?<footer.*?</footer>\n?(?:<!-- /partial:footer -->\n?)?", re.S)
    assert ftr_re.search(s), page
    s = ftr_re.sub(lambda m: block("footer", footer), s, count=1)
    return s

def sitemap():
    urls = [BASE if n == "index.html" else BASE + n for n in PAGES if n != "404.html"]
    body = "\n".join(f"  <url><loc>{u}</loc></url>" for u in urls)
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + body + "\n</urlset>\n")

def main():
    check = "--check" in sys.argv
    stale = []
    for name in PAGES:
        path = SITE / name
        new = render(path)
        if new != path.read_text(encoding="utf-8"):
            stale.append(name)
            if not check:
                path.write_text(new, encoding="utf-8")
    sm = SITE / "sitemap.xml"
    if not sm.exists() or sm.read_text(encoding="utf-8") != sitemap():
        stale.append("sitemap.xml")
        if not check:
            sm.write_text(sitemap(), encoding="utf-8")
    extra = {p.name for p in SITE.glob("*.html")} - set(PAGES)
    if extra:
        print("pages not listed in PAGES:", ", ".join(sorted(extra)))
        sys.exit(1)
    if check and stale:
        print("out of date (run tools/build_pages.py):", ", ".join(stale))
        sys.exit(1)
    print(("out of date: " if check else "updated: ") + (", ".join(stale) or "none"))

if __name__ == "__main__":
    main()
