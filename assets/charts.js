// SVG charts for the archive pages: time series with a date axis, scatter plots, a day calendar.
// No external libraries. Every chart returns a <figure>-like <div class="chart"> with the SVG and a legend.

const NS = 'http://www.w3.org/2000/svg';
const FONT = 'JetBrains Mono, monospace';
const INK = '#0F1B2D', MUTED = '#4A5668', GRID = '#E3E8EF', AXIS = '#9AA6B5';
const MON = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

function s(tag, attrs = {}, text) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) e.setAttribute(k, v);
  for (const k of kids) if (k !== null && k !== undefined) e.append(k);
  return e;
}

// "nice" ticks between lo and hi
export function niceTicks(lo, hi, n = 5) {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / n, p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(k => k * p).find(k => k >= raw) || 10 * p;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

export function logTicks(lo, hi) {
  const out = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++)
    for (const k of [1, 2, 5]) { const v = k * Math.pow(10, e); if (v >= lo && v <= hi) out.push(v); }
  return out;
}

// date ticks (UTC ms) for a span; label: day.month, month, or year
export function dateTicks(t0, t1) {
  const days = (t1 - t0) / 864e5, out = [];
  const d = new Date(t0);
  if (days <= 2) {
    const hrs = days * 24, step = [0.25, 0.5, 1, 2, 3, 6].find(k => hrs / k <= 10) || 6;
    for (let t = Math.ceil(t0 / (step * 36e5)) * step * 36e5; t <= t1; t += step * 36e5) out.push([t, new Date(t).toISOString().slice(11, 16)]);
    return out;
  }
  if (days <= 62) {
    const step = days <= 10 ? 1 : days <= 21 ? 2 : days <= 45 ? 7 : 10;
    let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    if (t < t0) t += 864e5;
    for (; t <= t1; t += step * 864e5) { const x = new Date(t); out.push([t, x.getUTCDate() + '.' + String(x.getUTCMonth() + 1).padStart(2, '0')]); }
    return out;
  }
  const mstep = days <= 400 ? 1 : days <= 800 ? 2 : days <= 1600 ? 3 : 12;
  let y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  if (m > 11) { m = 0; y++; }
  while (m % mstep) { m++; if (m > 11) { m = 0; y++; } }
  for (let t = Date.UTC(y, m, 1); t <= t1; ) {
    const x = new Date(t), mm = x.getUTCMonth();
    out.push([t, mm === 0 ? String(x.getUTCFullYear()) : MON[mm]]);
    t = Date.UTC(x.getUTCFullYear(), mm + mstep, 1);
  }
  return out;
}

const fmtV = v => !Number.isFinite(v) ? '—' : Number.isInteger(v) && Math.abs(v) < 1e6 ? String(v) : Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : Math.abs(v) >= 0.01 || v === 0 ? v.toFixed(2) : v.toExponential(1);
const fmtDay = t => { const x = new Date(t); return String(x.getUTCDate()).padStart(2, '0') + '.' + String(x.getUTCMonth() + 1).padStart(2, '0') + '.' + x.getUTCFullYear(); };

function legendOf(series) {
  return h('div', { class: 'chart-legend' }, ...series.filter(a => a.name).map(a => {
    const i = h('i');
    i.style.background = a.color;
    if (a.kind === 'dots') i.style.borderRadius = '50%';
    if (a.dash) i.style.background = `repeating-linear-gradient(90deg, ${a.color} 0 5px, transparent 5px 8px)`;
    return h('span', {}, i, a.name + (a.axis === 'right' ? ' (правая шкала)' : ''));
  }));
}

function scale(lo, hi, a, b, log) {
  if (log) { const l0 = Math.log10(lo), l1 = Math.log10(hi); return v => a + (Math.log10(v) - l0) / (l1 - l0) * (b - a); }
  return v => a + (v - lo) / (hi - lo) * (b - a);
}
function domain(vals, log, pad = 0.05, zero = false) {
  let v = vals.filter(x => Number.isFinite(x) && (!log || x > 0));
  if (!v.length) return log ? [1, 10] : [0, 1];
  let lo = Math.min(...v), hi = Math.max(...v);
  if (zero && !log) lo = Math.min(0, lo);
  if (log) return [Math.pow(10, Math.floor(Math.log10(lo) * 4) / 4), Math.pow(10, Math.ceil(Math.log10(hi) * 4) / 4)];
  if (lo === hi) { lo -= 1; hi += 1; }
  const d = (hi - lo) * pad;
  return [zero && lo === 0 ? 0 : lo - d, hi + d];
}

/**
 * Time series.
 * series: [{name, color, points: [[t ms, value], ...], kind: 'line'|'dots'|'bars' (barDays — bar width in days), axis: 'left'|'right', dash, width, maxGapDays}]
 * opts: {from, to (ms), width, height, log, yLabel, y2Label, y2Log, zero, markers: [{t, label, color}], bands: [{t0, t1, color}],
 *        minSpan (ms, default 1 day), fmtT(t), onClick(t), title}
 */
export function timeChart(series, opts = {}) {
  const W = opts.width || 1000, H = opts.height || 320;
  const right = series.some(a => a.axis === 'right');
  const pad = { l: 64, r: right ? 64 : 18, t: opts.markers && opts.markers.length ? 22 : 12, b: 34 };
  const all = series.flatMap(a => a.points);
  const t0 = opts.from ?? Math.min(...all.map(p => p[0])), t1 = opts.to ?? Math.max(...all.map(p => p[0]));
  const span = Math.max(t1 - t0, opts.minSpan ?? 864e5);
  const X = v => pad.l + (v - t0) / span * (W - pad.l - pad.r);
  const ax = side => {
    const ss = series.filter(a => (a.axis || 'left') === side), log = side === 'left' ? opts.log : opts.y2Log;
    const [lo, hi] = domain(ss.flatMap(a => a.points.map(p => p[1])), log, 0.06, side === 'left' ? opts.zero : opts.y2Zero);
    return { lo, hi, log, Y: scale(lo, hi, H - pad.b, pad.t, log) };
  };
  const L = ax('left'), R = right ? ax('right') : null;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opts.title || series.map(a => a.name).join(', ') });
  svg.style.width = '100%';
  svg.style.height = 'auto';
  for (const b of opts.bands || []) svg.append(s('rect', { x: X(b.t0), y: pad.t, width: Math.max(1, X(b.t1) - X(b.t0)), height: H - pad.t - pad.b, fill: b.color }));
  // grid and axes
  const yt = L.log ? logTicks(L.lo, L.hi) : niceTicks(L.lo, L.hi, 5);
  for (const v of yt) {
    const y = L.Y(v);
    svg.append(s('line', { x1: pad.l, x2: W - pad.r, y1: y, y2: y, stroke: GRID, 'stroke-dasharray': '3 6' }));
    svg.append(s('text', { x: pad.l - 8, y: y + 4, fill: MUTED, 'font-size': 12, 'text-anchor': 'end', 'font-family': FONT }, fmtV(v)));
  }
  if (R) for (const v of R.log ? logTicks(R.lo, R.hi) : niceTicks(R.lo, R.hi, 5))
    svg.append(s('text', { x: W - pad.r + 8, y: R.Y(v) + 4, fill: MUTED, 'font-size': 12, 'font-family': FONT }, fmtV(v)));
  for (const [t, lab] of dateTicks(t0, t1)) {
    const x = X(t);
    svg.append(s('line', { x1: x, x2: x, y1: pad.t, y2: H - pad.b, stroke: GRID }));
    svg.append(s('text', { x, y: H - 12, fill: MUTED, 'font-size': 12, 'text-anchor': 'middle', 'font-family': FONT }, lab));
  }
  svg.append(s('line', { x1: pad.l, x2: W - pad.r, y1: H - pad.b, y2: H - pad.b, stroke: AXIS }));
  if (opts.yLabel) svg.append(s('text', { x: 14, y: pad.t + (H - pad.t - pad.b) / 2, fill: MUTED, 'font-size': 12, 'text-anchor': 'middle', transform: `rotate(-90 14 ${pad.t + (H - pad.t - pad.b) / 2})` }, opts.yLabel));
  if (R && opts.y2Label) svg.append(s('text', { x: W - 12, y: pad.t + (H - pad.t - pad.b) / 2, fill: MUTED, 'font-size': 12, 'text-anchor': 'middle', transform: `rotate(90 ${W - 12} ${pad.t + (H - pad.t - pad.b) / 2})` }, opts.y2Label));
  // data
  const bw = Math.max(1.5, (W - pad.l - pad.r) / (span / 864e5) * 0.7);
  for (const a of series) {
    const A = (a.axis === 'right' ? R : L), gap = (a.maxGapDays ?? 4) * 864e5;
    const pts = a.points.filter(p => Number.isFinite(p[1]) && (!A.log || p[1] > 0) && p[0] >= t0 - 864e5 && p[0] <= t1 + 864e5);
    if (a.kind === 'bars') {
      const base = A.Y(A.log ? A.lo : Math.max(A.lo, 0));
      const w = a.barDays ? Math.max(1.5, a.barDays * 864e5 / span * (W - pad.l - pad.r)) : bw;
      for (const [t, v] of pts) svg.append(s('rect', { x: X(t) - w / 2, y: Math.min(A.Y(v), base), width: w, height: Math.abs(base - A.Y(v)), fill: a.color, opacity: a.opacity ?? 0.85 }));
    } else if (a.kind === 'dots') {
      for (const [t, v] of pts) svg.append(s('circle', { cx: X(t), cy: A.Y(v), r: a.r || 3, fill: a.color }));
    } else {
      let d = '', prev = null;
      for (const [t, v] of pts) {
        d += (prev === null || t - prev > gap ? 'M' : 'L') + X(t).toFixed(1) + ',' + A.Y(v).toFixed(1);
        prev = t;
      }
      svg.append(s('path', { d, fill: 'none', stroke: a.color, 'stroke-width': a.width || 1.8, 'stroke-linejoin': 'round', 'stroke-dasharray': a.dash ? '6 4' : null }));
      if (a.points.length < 60) for (const [t, v] of pts) svg.append(s('circle', { cx: X(t), cy: A.Y(v), r: 2.6, fill: a.color }));
    }
  }
  // markers (flares): small triangles on top, title on hover
  for (const m of opts.markers || []) {
    const x = X(m.t);
    if (x < pad.l || x > W - pad.r) continue;
    const g = s('g');
    g.append(s('line', { x1: x, x2: x, y1: pad.t, y2: H - pad.b, stroke: m.color, 'stroke-opacity': 0.35, 'stroke-dasharray': '2 3' }));
    g.append(s('path', { d: `M${x - 5},${pad.t - 14} L${x + 5},${pad.t - 14} L${x},${pad.t - 4}Z`, fill: m.color }));
    g.append(s('title', {}, m.label));
    svg.append(g);
  }
  // hover read-out
  const cross = s('line', { y1: pad.t, y2: H - pad.b, stroke: INK, 'stroke-opacity': 0.4, visibility: 'hidden' });
  const box = s('g', { visibility: 'hidden' }), boxBg = s('rect', { rx: 6, fill: '#fff', stroke: '#C5CFDB' }), boxTxt = s('text', { 'font-size': 12, 'font-family': FONT, fill: INK });
  box.append(boxBg, boxTxt);
  svg.append(cross, box);
  const hit = s('rect', { x: pad.l, y: pad.t, width: W - pad.l - pad.r, height: H - pad.t - pad.b, fill: 'transparent', style: opts.onClick ? 'cursor:pointer' : null });
  svg.append(hit);
  const at = ev => {
    const r = svg.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width * W;
    return t0 + (x - pad.l) / (W - pad.l - pad.r) * span;
  };
  hit.addEventListener('mousemove', ev => {
    const t = at(ev), lines = [];
    let tx = null;
    for (const a of series) {
      let best = null;
      for (const p of a.points) if (Number.isFinite(p[1]) && (!best || Math.abs(p[0] - t) < Math.abs(best[0] - t))) best = p;
      if (best && Math.abs(best[0] - t) <= Math.max(864e5, span / 200)) { lines.push([a, best[1]]); tx = tx ?? best[0]; }
    }
    if (tx === null) { cross.setAttribute('visibility', 'hidden'); box.setAttribute('visibility', 'hidden'); return; }
    const x = X(tx);
    cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
    boxTxt.replaceChildren(s('tspan', { x: 0, dy: 0, 'font-weight': 600 }, opts.fmtT ? opts.fmtT(tx) : fmtDay(tx)),
      ...lines.map(([a, v]) => s('tspan', { x: 0, dy: 16, fill: a.color }, (a.name || '') + ': ' + (a.fmt ? a.fmt(v) : fmtV(v)))));
    const bw2 = 12 + 7.4 * Math.max(10, ...lines.map(([a, v]) => ((a.name || '') + ': ' + fmtV(v)).length)), bh = 14 + 16 * (lines.length + 1) - 10;
    const bx = x + bw2 + 16 > W - pad.r ? x - bw2 - 10 : x + 10;
    boxBg.setAttribute('x', -6); boxBg.setAttribute('y', -14); boxBg.setAttribute('width', bw2); boxBg.setAttribute('height', bh);
    box.setAttribute('transform', `translate(${bx + 6},${pad.t + 18})`);
    box.setAttribute('visibility', 'visible');
  });
  hit.addEventListener('mouseleave', () => { cross.setAttribute('visibility', 'hidden'); box.setAttribute('visibility', 'hidden'); });
  if (opts.onClick) hit.addEventListener('click', ev => opts.onClick(at(ev)));
  return h('div', { class: 'chart' }, svg, legendOf(series));
}

/**
 * Scatter plot. points: [{x, y, color, r, title, href}]
 * opts: {width, height, xLabel, yLabel, xLog, yLog, lines: [{points: [[x, y]], color, title}], fit (least squares line + r), xFmt, yFmt, yTicks, xTicks, square, onClick(p)}
 */
export function scatterChart(points, opts = {}) {
  const W = opts.width || 640, H = opts.height || (opts.square ? W : 420);
  const pad = { l: 64, r: 18, t: 14, b: 42 };
  const [x0, x1] = opts.xDomain || domain(points.map(p => p.x), opts.xLog);
  const [y0, y1] = opts.yDomain || domain(points.map(p => p.y), opts.yLog);
  const X = scale(x0, x1, pad.l, W - pad.r, opts.xLog), Y = scale(y0, y1, H - pad.b, pad.t, opts.yLog);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': (opts.yLabel || '') + ' / ' + (opts.xLabel || '') });
  svg.style.width = '100%';
  svg.style.height = 'auto';
  const yt = opts.yTicks || (opts.yLog ? logTicks(y0, y1).map(v => [v, fmtV(v)]) : niceTicks(y0, y1, 6).map(v => [v, (opts.yFmt || fmtV)(v)]));
  const xt = opts.xTicks || (opts.xLog ? logTicks(x0, x1).map(v => [v, fmtV(v)]) : niceTicks(x0, x1, 7).map(v => [v, (opts.xFmt || fmtV)(v)]));
  for (const [v, lab] of yt) {
    const y = Y(v);
    svg.append(s('line', { x1: pad.l, x2: W - pad.r, y1: y, y2: y, stroke: GRID, 'stroke-dasharray': '3 6' }));
    svg.append(s('text', { x: pad.l - 8, y: y + 4, fill: MUTED, 'font-size': 12, 'text-anchor': 'end', 'font-family': FONT }, lab));
  }
  for (const [v, lab] of xt) {
    const x = X(v);
    svg.append(s('line', { x1: x, x2: x, y1: pad.t, y2: H - pad.b, stroke: GRID, 'stroke-dasharray': '3 6' }));
    svg.append(s('text', { x, y: H - pad.b + 18, fill: MUTED, 'font-size': 12, 'text-anchor': 'middle', 'font-family': FONT }, lab));
  }
  if (opts.xLabel) svg.append(s('text', { x: pad.l + (W - pad.l - pad.r) / 2, y: H - 6, fill: MUTED, 'font-size': 12, 'text-anchor': 'middle' }, opts.xLabel));
  if (opts.yLabel) svg.append(s('text', { x: 14, y: pad.t + (H - pad.t - pad.b) / 2, fill: MUTED, 'font-size': 12, 'text-anchor': 'middle', transform: `rotate(-90 14 ${pad.t + (H - pad.t - pad.b) / 2})` }, opts.yLabel));
  for (const g of opts.guides || []) svg.append(s('line', { x1: X(g.x0 ?? x0), x2: X(g.x1 ?? x1), y1: Y(g.y0 ?? y0), y2: Y(g.y1 ?? y1), stroke: g.color || AXIS, 'stroke-dasharray': '5 4' }));
  for (const ln of opts.lines || []) {
    const d = ln.points.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b)).map(([a, b], i) => (i ? 'L' : 'M') + X(a).toFixed(1) + ',' + Y(b).toFixed(1)).join('');
    const path = s('path', { d, fill: 'none', stroke: ln.color, 'stroke-width': ln.width || 1.6, 'stroke-opacity': ln.opacity ?? 1, 'stroke-dasharray': ln.dash ? '6 4' : null });
    if (ln.title) path.append(s('title', {}, ln.title));
    svg.append(path);
  }
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const c = s('circle', { cx: X(p.x), cy: Y(p.y), r: p.r || 3.5, fill: p.color || '#1E4FB8', 'fill-opacity': p.opacity ?? 0.75, stroke: p.stroke || 'none', style: opts.onClick ? 'cursor:pointer' : null });
    if (p.title) c.append(s('title', {}, p.title));
    if (opts.onClick) c.addEventListener('click', () => opts.onClick(p));
    svg.append(c);
  }
  let note = null;
  if (opts.fit) {
    const f = linearFit(points.map(p => opts.xLog ? Math.log10(p.x) : p.x), points.map(p => opts.yLog ? Math.log10(p.y) : p.y));
    if (f) {
      const back = (v, log) => log ? Math.pow(10, v) : v;
      const xa = opts.xLog ? Math.log10(x0) : x0, xb = opts.xLog ? Math.log10(x1) : x1;
      svg.append(s('line', { x1: X(back(xa, opts.xLog)), x2: X(back(xb, opts.xLog)), y1: Y(back(f.a + f.b * xa, opts.yLog)), y2: Y(back(f.a + f.b * xb, opts.yLog)), stroke: INK, 'stroke-width': 1.4 }));
      note = h('div', { class: 'muted mono chart-note' }, `n = ${f.n} · r = ${f.r.toFixed(3)} · y = ${f.a.toFixed(2)} + ${f.b.toFixed(3)}·x` + (opts.xLog || opts.yLog ? ' (в логарифмах)' : ''));
    }
  }
  return h('div', { class: 'chart' }, svg, opts.legend ? legendOf(opts.legend) : null, note);
}

// least squares y = a + b x and Pearson r; null if fewer than 3 finite pairs
export function linearFit(x, y) {
  const p = x.map((v, i) => [v, y[i]]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  const n = p.length;
  if (n < 3) return null;
  const mx = p.reduce((s0, q) => s0 + q[0], 0) / n, my = p.reduce((s0, q) => s0 + q[1], 0) / n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const [a, b] of p) { sxx += (a - mx) ** 2; syy += (b - my) ** 2; sxy += (a - mx) * (b - my); }
  if (!sxx || !syy) return null;
  const b = sxy / sxx;
  return { n, a: my - b * mx, b, r: sxy / Math.sqrt(sxx * syy) };
}
