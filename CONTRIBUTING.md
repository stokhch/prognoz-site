# Как вносить изменения

1. Создайте ветку и внесите правки. Для страниц: `python3 tools/build_pages.py` после изменений в `partials/` или в словаре `PAGES`.
2. Запустите проверки: `python3 tools/validate_site.py` и `node --test tests/*.test.mjs` (подробности в README, раздел «Разработка»).
3. Откройте pull request: CI (`checks`) должен пройти.

Данные в `data/` в боевом режиме пишет система прогноза `ratan-forecast`, руками их не правят; формат описан в README.
