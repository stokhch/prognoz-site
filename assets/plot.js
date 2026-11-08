// SVG plotting of RATAN-600 one-dimensional scans (no external libraries).

const NS = 'http://www.w3.org/2000/svg';
export const PALETTE = ['#C2410C', '#1E4FB8', '#0F766E', '#7C3AED', '#B45309', '#BE185D', '#15803D', '#0369A1', '#9A3412', '#4338CA'];

function s(tag, attrs) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

export function xs(scan) {
  const { start, step, n } = scan.x_arcsec;
  return Array.from({ length: n }, (_, i) => start + i * step);
}

// Lower envelope: moving minimum then moving mean; a simple quiet-Sun estimate.
export function quietSun(y, win = 25) {
  const n = y.length, lo = new Array(n), out = new Array(n);
  for (let i = 0; i < n; i++) {
    let m = Infinity;
    for (let j = Math.max(0, i - win); j <= Math.min(n - 1, i + win); j++) m = Math.min(m, y[j]);
    lo[i] = m;
  }
  for (let i = 0; i < n; i++) {
    let sum = 0, c = 0;
    for (let j = Math.max(0, i - win); j <= Math.min(n - 1, i + win); j++) { sum += lo[j]; c++; }
    out[i] = sum / c;
  }
  return out;
}

// series: [{name, color, x:[], y:[]}]
export function linePlot(series, { width = 1200, height = 380, xLabel = '', yLabel = '' } = {}) {
  const pad = { l: 56, r: 16, t: 14, b: 38 };
  const all = series.flatMap(a => a.y).filter(Number.isFinite);
  const allx = series.flatMap(a => a.x);
  let y0 = Math.min(...all), y1 = Math.max(...all);
  if (y0 === y1) { y0 -= 1; y1 += 1; }
  const x0 = Math.min(...allx), x1 = Math.max(...allx);
  const X = v => pad.l + (v - x0) / (x1 - x0) * (width - pad.l - pad.r);
  const Y = v => height - pad.b - (v - y0) / (y1 - y0) * (height - pad.t - pad.b);
  const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': yLabel + ' от ' + xLabel });
  const ticks = 5;
  for (let i = 0; i <= ticks; i++) {
    const v = y0 + (y1 - y0) * i / ticks, y = Y(v);
    svg.append(s('line', { x1: pad.l, x2: width - pad.r, y1: y, y2: y, stroke: '#E3E8EF', 'stroke-dasharray': '3 6' }));
    const t = s('text', { x: pad.l - 8, y: y + 4, fill: '#4A5668', 'font-size': 12, 'text-anchor': 'end', 'font-family': 'JetBrains Mono, monospace' });
    t.textContent = Math.abs(y1 - y0) < 10 ? v.toFixed(1) : Math.round(v);
    svg.append(t);
  }
  for (let i = 0; i <= 6; i++) {
    const v = x0 + (x1 - x0) * i / 6, x = X(v);
    const t = s('text', { x, y: height - 14, fill: '#4A5668', 'font-size': 12, 'text-anchor': 'middle', 'font-family': 'JetBrains Mono, monospace' });
    t.textContent = Math.round(v);
    svg.append(t);
  }
  if (y0 < 0 && y1 > 0) svg.append(s('line', { x1: pad.l, x2: width - pad.r, y1: Y(0), y2: Y(0), stroke: '#9AA6B5' }));
  for (const a of series) {
    const pts = a.x.map((x, i) => Number.isFinite(a.y[i]) ? X(x).toFixed(1) + ',' + Y(a.y[i]).toFixed(1) : null).filter(Boolean).join(' ');
    svg.append(s('polyline', { points: pts, fill: 'none', stroke: a.color, 'stroke-width': 1.8, 'stroke-linejoin': 'round' }));
  }
  return svg;
}

// Small sparkline-like preview of one channel, for observation cards.
export function preview(scan, ch = 0) {
  const x = xs(scan), y = scan.channels[ch].I;
  return linePlot([{ x, y, color: '#C2410C' }], { width: 600, height: 160 });
}

export function legend(series) {
  const box = document.createElement('div');
  box.className = 'legend';
  for (const a of series) {
    const sp = document.createElement('span');
    const i = document.createElement('i');
    i.style.background = a.color;
    sp.append(i, a.name);
    box.append(sp);
  }
  return box;
}
