# prognoz-site

Новый сайт «Прогноз солнечной активности по наблюдениям РАТАН-600» (СПбФ САО РАН) — замена страниц ION на старом сервере prognoz.

Сейчас на сайте **демонстрационные данные** (в JSON стоит `"demo": true`, и сайт показывает плашку). Формат данных совпадает с выдачей новой системы прогноза `ratan-forecast`.

## Устройство

Статический сайт без сборки: HTML, CSS и JavaScript-модули (ES modules), графики рисуются в SVG без сторонних библиотек. Данные берутся из JSON-файлов в `data/`, поэтому сайт может раздавать любой веб-сервер (nginx, GitHub Pages).

| Файл | Что это | Замена на старом сайте |
| --- | --- | --- |
| `index.html` | главная: прогноз на 3 суток, последние сканы, разделы | `index.html`, `rat_sao.ion` |
| `forecast.html` | итог дня, таблица Танаки–Эноме, методика | `inf_method.html`, `rat2_tanaka.ion` |
| `data.html` | анализ скана: каналы, I/V, спокойное Солнце, соседние волны, спектр | `rat1_top.ion`, `rat2_plot.ion` |
| `search.html` | поиск наблюдений по дате, азимуту, числу наблюдений в день | `rat_search`, `db.html` |
| `assets/` | стили, общие функции, построение графиков | |
| `data/` | JSON с прогнозом, списком наблюдений и сканами | Oracle (`RAT_*`) |

Ссылка на наблюдение: `data.html#obs-<id>`, например `data.html#obs-20261027-az0`.

## Формат данных

`data/forecast.json` — выдача `ratan-forecast forecast --json` плюс строки расчёта:

```json
{"day": "2026-11-09", "data_day": "2026-11-07", "age_days": 2, "label": "positive?",
 "quality": "B", "rule_version": "idl-2026-10", "generated_at": "2026-11-09T09:30:00Z",
 "last_scan": {"id": "20261107-az0", "time_ut": "09:05", "az": 0},
 "rows": [{"noaa": "14268_14269", "location": "N08W12", "flux2": 63.0, "flux3": 58.2,
           "flux10": 41.5, "beam": 0.99, "flux3_corr": 57.62, "label": "positive?"}]}
```

`label`: `positive`, `positive?`, `negative`, `negative?`, `no data`.

`data/observations.json` — список наблюдений: `{"observations": [{"id", "date", "time_ut", "az", "scans", "defective", "n_per_day"}]}`.

`data/scans/<id>.json` — скан level2: `x_arcsec` (`start`, `step`, `n`) и `channels` — `[{"freq_ghz", "I": [...], "V": [...]}]`.

Для настоящих данных эти файлы будет писать новая система прогноза (по расписанию, после обработки скана); поле `demo` тогда не ставится.

## Запуск у себя

```
python3 -m http.server 8000
```

и открыть http://localhost:8000/. Открывать файлы напрямую (`file://`) нельзя: браузер не даст загрузить JSON.

## Публикация

При каждом push в `main` GitHub Actions (`.github/workflows/pages.yml`) выкладывает сайт на GitHub Pages: https://stokhch.github.io/prognoz-site/

## Что дальше

- Экспорт настоящих данных из `ratan-forecast` (PostgreSQL) в `data/`.
- Английская версия.
- Перенос вычислений (EFRAT, ДНА, моделирование) — пока ссылки ведут на старый сайт.
