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
  return j;
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

export function obsHref(id) {
  return 'data.html#obs-' + id;
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
