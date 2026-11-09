# prognoz-site

Новый сайт «Прогноз солнечной активности по наблюдениям РАТАН-600» (СПбФ САО РАН) — замена страниц ION на старом сервере prognoz.

Сканы на сайте настоящие (level2 РАТАН-600); **прогноз пока демонстрационный** (в `data/forecast.json` стоит `"demo": true`, и сайт показывает плашку). Формат данных совпадает с выдачей новой системы прогноза `ratan-forecast`.

## Устройство

Статический сайт без сборки: HTML, CSS и JavaScript-модули (ES modules), графики рисуются в SVG без сторонних библиотек. Данные берутся из JSON-файлов в `data/`, поэтому сайт может раздавать любой веб-сервер (nginx, GitHub Pages).

| Файл | Что это | Замена на старом сайте |
| --- | --- | --- |
| `index.html` | главная: прогноз на 3 суток, последние сканы, разделы | `index.html`, `rat_sao.ion` |
| `forecast.html` | итог дня, таблица Танаки–Эноме, методика | `inf_method.html`, `rat2_tanaka.ion` |
| `data.html` | архив level2 по HTTP (год → месяц → день → файл) и режимы просмотра (`assets/views.js`): картинка прогноза, скан, наложение, разнесение, сетка, цветная и контурная карта, 3D; спектр в точке, соседние волны, гаусс-анализ, Фурье, вейвлет, азимуты дня. В режимах «Скан», «Наложение», «Разнесение», «Сетка» — опции: шаблон спокойного Солнца (показать или вычесть) и снимок Солнца SDO с Helioviewer, повёрнутый как в sunview. Параметры I, V, R, L, p и пары I+V (V — своя шкала справа), R+L, участок (диск, ±2R, вся запись, увеличение протягиванием), вычитание спокойного Солнца (подгонка физической модели диска по нижней огибающей — `assets/quietsun.js`, по WorkScanJ; скользящая огибающая; медиана), масштаб без выбросов | `rat1_top.ion`, `rat2_plot.ion` и `rat2_*`, `rat3_*`, `rat4_*` |
| `search.html` | поиск наблюдений по дате, азимуту, числу наблюдений в день | `rat_search`, `db.html` |
| `assets/` | стили, общие функции, построение графиков | |
| `data/` | JSON с прогнозом, списком наблюдений и сканами | Oracle (`RAT_*`) |

Ссылка на наблюдение: `data.html#2026/11/20261106_115716_sun0_out.fits`.

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

`data/observations.json` — список наблюдений: `{"observations": [{"id", "date", "time_ut", "az", "channels", "removed", "n_per_day"}]}`; `id` вида `20261106-085716-az0` (дата и время UT, азимут).

`data/scans/<id>.jpg` и `<id>-small.jpg` — картинки скана 663×450 и 221×150, те же, что в прогнозе (`sunsao1.jpg`, `sunsao0.jpg`): их рисует `ratan_forecast.scanplot` (`ratan-forecast scanplot --level2 … --out-dir …`). Страница анализа показывает её по умолчанию.

`data/scans/<id>.json` — скан level2: `x_arcsec` (`start`, `step`, `n`) и `channels` — `[{"freq_ghz", "I": [...], "V": [...]}]`.

Для настоящих данных эти файлы будет писать новая система прогноза (по расписанию, после обработки скана); поле `demo` тогда не ставится.

## Архив сканов на странице анализа

`data.html` читает дерево каталогов архива level2 по HTTP, как sunview (`remote_catalog.py`): берёт страницы Apache autoindex (`/data/ratan/ГГГГ/ММ/`), собирает ссылки `<a href>` и отбрасывает родительский каталог, ссылки сортировки и чужие адреса; имя с `/` — каталог. Листинги кэшируются в `sessionStorage` на 5 минут (кнопка «Обновить» сбрасывает кэш). Выбранный `*_out.fits` читается прямо в браузере (`assets/fits.js`), картинка скана рисуется на canvas портом `ratan_forecast/scanplot.py` (`assets/scanplot.js`: то же окно, масштабы, цвета и стили линий; подписи — шрифтом браузера, а не Hershey).

Источники перебираются по порядку (`assets/archive.js`):
1. `/data/ratan/` того же сервера, если сайт открыт с spbf.sao.ru;
2. `data/ratan/` — копия на сайте с реальным сканом (листинги в формате autoindex делает `tools/make_mirror_index.py`); пока архив из браузера недоступен, она идёт первой (`"prefer": "local"` в `data/config.json`);
3. адреса из `data/config.json` (`"archives": [{"name": …, "url": …}]`), сейчас `http://spbf.sao.ru/data/ratan/`. Когда архив станет доступен по https с CORS, поставьте `"prefer": "remote"`.

Чтобы читать архив с хранилища через solar.sao.ru, добавьте в `data/config.json` первым элементом его https-адрес (каталог, внутри которого `ГГГГ/ММ/…_out.fits`), например `{"name": "solar.sao.ru", "url": "https://solar.sao.ru/data/<каталог level2>/"}`. На стороне solar для этого каталога нужны: листинг каталогов (Apache `Options +Indexes` или nginx `autoindex on`) и заголовок CORS (`Access-Control-Allow-Origin: https://stokhch.github.io` или `*`; Apache — `Header set …` с mod_headers, nginx — `add_header … always`).

С GitHub Pages (https) браузер не даёт читать http-адрес, а Apache на prognoz не отдаёт заголовок CORS, поэтому там работает копия. Чтобы читать архив spbf напрямую с другого сайта, нужны https на spbf и `Header set Access-Control-Allow-Origin "*"` для `/data/ratan/`; проще всего разместить сайт на самом spbf.sao.ru.

Ссылка на скан: `data.html#ГГГГ/ММ/<файл>_out.fits`.

## Данные наблюдений

Сканы настоящие: `python3 tools/make_site_data.py --src /путь/к/ratan-forecast/src файл_out.fits …` читает level2, рисует картинки кодом прогноза и пишет `data/scans/` и `data/observations.json` (добавляет к уже выгруженным). Каналы с явно испорченным сигналом (максимум I больше чем в 10 раз выше медианы по каналам) отбрасываются и перечислены в JSON в поле `dropped`. Нужны numpy, matplotlib, opencv-python и Pillow.

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
