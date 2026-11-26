// Prognoz RATAN-600 site: shared helpers (ES module, no build step).

export const LABEL_TEXT = {
  'negative': 'Мощных вспышек в ближайшие 3 суток не ожидается.',
  'negative?': 'Мощных вспышек не ожидается (нет потока на 10 см, признак не проверен полностью).',
  'positive?': 'Вероятность выше средней: признак есть, но сомнительный (очень большой поток или неоднозначный номер NOAA).',
  'positive': 'Хотя бы в одной активной области вероятна мощная вспышка.',
  'no data': 'Нет наблюдений за последние 3 суток — прогноз не строится.'
};

export async function getJSON(path) {
  const r = await fetch(path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(path + ': HTTP ' + r.status);
  const j = await r.json();
  if (j && j.demo) document.body.classList.add('is-demo');
  if (j && j.generated_at && !j.demo) warnIfStale(j);
  return j;
}

// A forecast older than STALE_HOURS is shown with a warning: the site must never present an old result as current.
export const STALE_HOURS = 36;

export function warnIfStale(f, now = Date.now()) {
  const t = Date.parse(f.generated_at);
  if (!Number.isFinite(t) || document.querySelector('.notice.stale')) return false;
  const hours = (now - t) / 36e5;
  if (hours <= STALE_HOURS) return false;
  const days = Math.floor(hours / 24);
  const banner = el('div', { class: 'notice stale', role: 'alert' },
    el('div', { class: 'wrap' },
      el('b', { text: 'Прогноз устарел. ' }),
      'Последнее обновление: ' + fmtDate(f.generated_at) + ' (' + days + ' сут назад). Данные могли не прийти или обработка остановилась; пользуйтесь итогом с осторожностью.'));
  const hdr = document.querySelector('header.site-header');
  (hdr || document.body).after(banner);
  return true;
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return d + '.' + m + '.' + y;
}

export function fmtAz(az) {
  return 'az ' + (az > 0 ? '+' : '') + az + '°';
}

export function num(v, digits = 2) {
  return (v === null || v === undefined || v === '') ? '—' : Number(v).toFixed(digits);
}

export function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const k of kids) if (k !== null && k !== undefined) e.append(k);
  return e;
}

export function setText(id, value) {
  const n = document.getElementById(id);
  if (n) n.textContent = value;
}

// Link to an observation on the analysis page: by its archive path (YYYY/MM/<file>_out.fits).
export function obsHref(o) {
  return o && o.path ? 'data.html#' + o.path : 'data.html';
}

export function showError(container, err) {
  container.replaceChildren(el('div', { class: 'empty', role: 'alert', text: 'Не удалось загрузить данные: ' + err.message }));
}

// Forecast card used on the home and forecast pages.
export function renderState(node, f) {
  node.dataset.label = f.label;
  node.querySelector('.v').textContent = f.label;
  node.querySelector('.t').textContent = LABEL_TEXT[f.label] || f.message || '';
}
