// View modes of the analysis page (port of the old ION "Type" / "Stokes" / "SubQuietSun" options and analysis
// buttons). Everything is computed in the browser from one level2 scan (see fits.js).
import { value } from './fits.js';
import { palette } from './scanplot.js';
import { template as qsTemplate } from './quietsun.js';

// ---------- data access ----------
export const RANGES = { disk: 1, sun2: 2, full: 0 };   // x window in solar radii (0 = whole record)

// -> {x: arcsec[], idx: sample index[]}; thinned to <= maxN points
export function grid(s, range = 'sun2', maxN = 900) {
  const r = RANGES[range];
  let i1 = 0, i2 = s.nX - 1;
  if (r) {
    const rx = s.solarR / s.cdelt1;
    i1 = Math.max(0, Math.round(s.crpix1 - r * rx));
    i2 = Math.min(s.nX - 1, Math.round(s.crpix1 + r * rx));
  }
  const k = Math.max(1, Math.ceil((i2 - i1 + 1) / maxN));
  const idx = [];
  for (let i = i1; i <= i2; i += k) idx.push(i);
  return { idx, x: idx.map(i => (i - s.crpix1) * s.cdelt1), step: k * s.cdelt1 };
}

function raw(s, c, iv, idx) { return idx.map(i => value(s, c, iv, i)); }

// Stokes parameter of channel c. Convention I = (R + L) / 2, V = (R - L) / 2.
export function stokes(s, c, p, idx) {
  const I = raw(s, c, 0, idx), V = raw(s, c, 1, idx);
  if (p === 'I') return I;
  if (p === 'V') return V;
  if (p === 'R') return I.map((v, k) => v + V[k]);
  if (p === 'L') return I.map((v, k) => v - V[k]);
  if (p === 'p') {             // degree of circular polarisation, %, only where I is above 5% of its maximum
    const m = Math.max(...I);
    return I.map((v, k) => v > 0.05 * m ? 100 * V[k] / v : NaN);
  }
  throw new Error('unknown parameter ' + p);
}

export function beamArcsec(f) { return 0.85 * 300 / f; }       // theta_h(") = 0.85 * lambda(mm)

// ---------- quiet Sun ----------
function movingMin(y, w) {
  const n = y.length, out = new Array(n);
  for (let i = 0; i < n; i++) { let m = Infinity; for (let j = Math.max(0, i - w); j <= Math.min(n - 1, i + w); j++) if (y[j] < m) m = y[j]; out[i] = m; }
  return out;
}
function movingMean(y, w) {
  const n = y.length, out = new Array(n);
  for (let i = 0; i < n; i++) { let s = 0, c = 0; for (let j = Math.max(0, i - w); j <= Math.min(n - 1, i + w); j++) { s += y[j]; c++; } out[i] = s / c; }
  return out;
}
function movingMedian(y, w) {
  const n = y.length, out = new Array(n);
  for (let i = 0; i < n; i++) { const a = y.slice(Math.max(0, i - w), Math.min(n, i + w + 1)).sort((p, q) => p - q); out[i] = a[a.length >> 1]; }
  return out;
}
// uniform disk of temperature tq convolved with the horizontal beam
function diskTemplate(x, R, tq, theta) {
  const sg = theta / 2.3548, out = [];
  const st = 2, half = Math.ceil(3 * sg / st);
  for (const xx of x) {
    let s = 0, w = 0;
    for (let k = -half; k <= half; k++) {
      const u = xx + k * st, g = Math.exp(-0.5 * (k * st / sg) ** 2);
      s += g * (Math.abs(u) < R ? 1 : 0); w += g;
    }
    out.push(tq * s / w);
  }
  return out;
}

export const QUIET = {
  none: 'не вычитать',
  model: 'модель диска, подгонка по огибающей',
  touch: 'модель диска, касание снизу',
  modeltq: 'модель диска, уровень TQSUN',
  env: 'скользящая нижняя огибающая',
  median: 'медианный фильтр'
};

export function quietTemplate(s, c, x, step, method) {
  const y = raw(s, c, 0, x.idx);
  const w = Math.max(3, Math.round(220 / step));
  if (method === 'env') return movingMean(movingMin(y, w), w);
  if (method === 'median') return movingMedian(y, Math.max(5, Math.round(420 / step)));
  if (method === 'model') return qsTemplate(s, c, x.x, 'fit');
  if (method === 'modeltq') return qsTemplate(s, c, x.x, 'tq');
  if (method === 'touch') return qsTemplate(s, c, x.x, 'touch', y);
  if (method === 'tq') return diskTemplate(x.x, s.solarR, s.tqsun[c], beamArcsec(s.freq[c]));
  return y.map(() => 0);
}

// Parameter p of channel c with the quiet Sun removed (only I, R, L change; V and p are left as they are).
export function series(s, c, p, g, method) {
  const y = stokes(s, c, p, g.idx);
  if (method === 'none' || p === 'V' || p === 'p') return y;
  let q = quietTemplate(s, c, { x: g.x, idx: g.idx }, g.step, method);
  if (p === 'R' || p === 'L') q = q.map(v => v);
  return y.map((v, k) => v - q[k]);
}

// ---------- canvas helpers ----------
function axesCanvas(W, H, pad) {
  const cv = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = W * dpr; cv.height = H * dpr;
  cv.style.width = '100%'; cv.style.height = 'auto'; cv.style.display = 'block';
  const g = cv.getContext('2d');
  g.scale(dpr, dpr);
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  g.font = '12px "JetBrains Mono", monospace'; g.fillStyle = '#4A5668'; g.strokeStyle = '#C5CFDB';
  return { cv, g, pad, W, H };
}

function niceTicks(lo, hi, n) {
  const raw = (hi - lo) / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  let st = 10 * mag;
  for (const k of [1, 2, 2.5, 5, 10]) if (k * mag >= raw) { st = k * mag; break; }
  const out = [];
  for (let v = Math.ceil(lo / st) * st; v <= hi + 1e-9; v += st) out.push(+v.toFixed(10));
  return out;
}

function drawAxes(A, x0, x1, y0, y1, xl, yl, yLog = false) {
  const { g, pad, W, H } = A;
  g.strokeStyle = '#9AA6B5'; g.lineWidth = 1;
  g.strokeRect(pad.l, pad.t, W - pad.l - pad.r, H - pad.t - pad.b);
  g.fillStyle = '#4A5668'; g.textAlign = 'center';
  for (const v of niceTicks(x0, x1, 7)) { const X = pad.l + (v - x0) / (x1 - x0) * (W - pad.l - pad.r); g.fillText(String(v), X, H - pad.b + 16); }
  g.textAlign = 'right';
  for (const v of niceTicks(y0, y1, 6)) { const Y = H - pad.b - (v - y0) / (y1 - y0) * (H - pad.t - pad.b); g.fillText(yLog ? '1e' + v : String(v), pad.l - 6, Y + 4); }
  g.textAlign = 'center'; g.fillText(xl, (pad.l + W - pad.r) / 2, H - 6);
  g.save(); g.translate(14, (pad.t + H - pad.b) / 2); g.rotate(-Math.PI / 2); g.fillText(yl, 0, 0); g.restore();
}

function finiteRange(rows) {
  let lo = Infinity, hi = -Infinity;
  for (const r of rows) for (const v of r) if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (lo === hi) { lo -= 1; hi += 1; }
  return [lo, hi];
}

// ---------- 2D views ----------
// rows: channels (low freq at bottom), columns: x. kind: 'map' | 'contour'
export function map2d(x, freqs, rows, kind, label, onPick, yAxis = 'частота, ГГц') {
  const W = 900, H = 460, pad = { l: 64, r: 70, t: 14, b: 40 };
  const A = axesCanvas(W, H, pad), g = A.g;
  const [lo, hi] = finiteRange(rows);
  const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b, nr = rows.length, nc = x.length;
  const f0 = freqs[0], f1 = freqs[nr - 1];
  const Yv = f => pad.t + (1 - (f - f0) / (f1 - f0)) * ph;          // value axis (GHz) -> pixel
  const fAt = r => { const i = Math.min(nr - 2, Math.max(0, Math.floor(r))), t = r - i; return freqs[i] + (freqs[i + 1] - freqs[i]) * t; };
  if (kind === 'map') {
    const tmp = document.createElement('canvas'); tmp.width = nc; tmp.height = 1;
    const tg = tmp.getContext('2d'), img = tg.createImageData(nc, 1);
    g.imageSmoothingEnabled = false;
    for (let r = 0; r < nr; r++) {
      for (let c = 0; c < nc; c++) {
        const v = rows[r][c], o = c * 4;
        const col = Number.isFinite(v) ? palette(255 * (v - lo) / (hi - lo)).match(/\d+/g).map(Number) : [255, 255, 255];
        img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
      }
      tg.putImageData(img, 0, 0);
      const fa = r ? (freqs[r - 1] + freqs[r]) / 2 : f0, fb = r < nr - 1 ? (freqs[r] + freqs[r + 1]) / 2 : f1;
      const ya = Yv(fb), yb = Yv(fa);
      g.drawImage(tmp, pad.l, ya, pw, Math.max(1, yb - ya + 0.5));
    }
  } else {
    // marching squares on 12 levels
    const X = c => pad.l + c / (nc - 1) * pw, Y = r => Yv(fAt(r));
    const levels = niceTicks(lo, hi, 12);
    levels.forEach((L, li) => {
      g.strokeStyle = palette(40 + 200 * li / levels.length); g.lineWidth = 1;
      g.beginPath();
      for (let r = 0; r < nr - 1; r++) for (let c = 0; c < nc - 1; c++) {
        const v = [rows[r][c], rows[r][c + 1], rows[r + 1][c + 1], rows[r + 1][c]];
        if (!v.every(Number.isFinite)) continue;
        const pts = [];
        const edge = (a, b, ra, ca, rb, cb) => { if ((v[a] - L) * (v[b] - L) < 0) { const t = (L - v[a]) / (v[b] - v[a]); pts.push([X(ca + (cb - ca) * t), Y(ra + (rb - ra) * t)]); } };
        edge(0, 1, r, c, r, c + 1); edge(1, 2, r, c + 1, r + 1, c + 1); edge(2, 3, r + 1, c + 1, r + 1, c); edge(3, 0, r + 1, c, r, c);
        if (pts.length >= 2) { g.moveTo(pts[0][0], pts[0][1]); g.lineTo(pts[1][0], pts[1][1]); }
        if (pts.length === 4) { g.moveTo(pts[2][0], pts[2][1]); g.lineTo(pts[3][0], pts[3][1]); }
      }
      g.stroke();
    });
  }
  drawAxes(A, x[0], x[nc - 1], freqs[0], freqs[nr - 1], 'угл. с от центра диска', yAxis);
  // colour bar
  for (let k = 0; k < ph; k++) { g.fillStyle = palette(255 * (1 - k / ph)); g.fillRect(W - pad.r + 14, pad.t + k, 14, 1); }
  g.strokeStyle = '#9AA6B5'; g.strokeRect(W - pad.r + 14, pad.t, 14, ph);
  g.fillStyle = '#4A5668'; g.textAlign = 'left'; g.font = '11px "JetBrains Mono", monospace';
  g.fillText(fmt(hi), W - pad.r + 32, pad.t + 10); g.fillText(fmt(lo), W - pad.r + 32, pad.t + ph);
  g.save(); g.translate(W - 8, pad.t + ph / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillText(label, 0, 0); g.restore();
  if (onPick) A.cv.addEventListener('click', e => {
    const b = A.cv.getBoundingClientRect(), px = (e.clientX - b.left) / b.width * W;
    if (px >= pad.l && px <= W - pad.r) onPick(x[0] + (px - pad.l) / pw * (x[nc - 1] - x[0]));
  });
  A.cv.style.cursor = onPick ? 'crosshair' : '';
  return A.cv;
}

function fmt(v) { return Math.abs(v) >= 1000 ? Math.round(v).toString() : v.toPrecision(3); }

// pseudo-3D "waterfall": curves from back (high freq) to front, each hiding what is behind it
export function waterfall(x, freqs, rows, label) {
  const W = 900, H = 520, pad = { l: 40, r: 30, t: 20, b: 40 };
  const A = axesCanvas(W, H, pad), g = A.g;
  const n = rows.length, [lo, hi] = finiteRange(rows);
  const dx = 180 / n, dy = 230 / n, pw = W - pad.l - pad.r - 180, ph = 230;
  for (let k = n - 1; k >= 0; k--) {
    const ox = pad.l + k * dx, oy = H - pad.b - k * dy;
    const X = i => ox + i / (x.length - 1) * pw, Y = v => oy - (Number.isFinite(v) ? (v - lo) / (hi - lo) : 0) * ph;
    g.beginPath(); g.moveTo(X(0), oy);
    rows[k].forEach((v, i) => g.lineTo(X(i), Y(v)));
    g.lineTo(X(x.length - 1), oy); g.closePath();
    g.fillStyle = 'rgba(255,255,255,0.92)'; g.fill();
    g.strokeStyle = palette(255 - 200 * k / n); g.lineWidth = 1.2; g.stroke();
  }
  g.fillStyle = '#4A5668'; g.font = '12px "JetBrains Mono", monospace';
  g.fillText(freqs[0].toFixed(2) + ' ГГц', pad.l + pw + 6, H - pad.b);
  g.fillText(freqs[n - 1].toFixed(2) + ' ГГц', pad.l + (n - 1) * dx + pw + 6, H - pad.b - (n - 1) * dy);
  g.textAlign = 'center'; g.fillText('угл. с: ' + Math.round(x[0]) + ' … ' + Math.round(x[x.length - 1]) + ' · по вертикали — ' + label, W / 2, H - 10);
  return A.cv;
}

// ---------- Gauss analysis ----------
// local sources on one curve (quiet Sun removed): peaks above threshold, FWHM from half-maximum crossings
export function gaussSources(x, y, v, theta, minFrac = 0.08) {
  const m = Math.max(...y.filter(Number.isFinite)), out = [];
  for (let i = 2; i < y.length - 2; i++) {
    const a = y[i];
    if (!(a > minFrac * m && a >= y[i - 1] && a > y[i + 1] && a >= y[i - 2] && a > y[i + 2])) continue;
    let l = i, r = i;
    while (l > 0 && y[l] > a / 2) l--;
    while (r < y.length - 1 && y[r] > a / 2) r++;
    const xl = x[l] + (a / 2 - y[l]) / (y[l + 1] - y[l]) * (x[l + 1] - x[l]);
    const xr = x[r - 1] + (a / 2 - y[r - 1]) / (y[r] - y[r - 1]) * (x[r] - x[r - 1]);
    const B = xr - xl;
    if (!(B > 0)) continue;
    // parabolic refinement of the peak position on log(y)
    let pos = x[i];
    if (y[i - 1] > 0 && y[i + 1] > 0) {
      const l1 = Math.log(y[i - 1]), l2 = Math.log(a), l3 = Math.log(y[i + 1]), d = l1 - 2 * l2 + l3;
      if (d < 0) pos = x[i] + 0.5 * (l1 - l3) / d * (x[i + 1] - x[i]);
    }
    const B0 = B > theta ? Math.sqrt(B * B - theta * theta) : NaN;
    out.push({ pos, A: a, B, B0, area: 1.064 * a * B, p: v ? 100 * v[i] / a : NaN });
    i = r;
  }
  return out.sort((p, q) => q.A - p.A).slice(0, 12).sort((p, q) => p.pos - q.pos);
}

// ---------- Fourier / wavelet ----------
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

// power spectrum vs spatial period ("), Hann window
export function powerSpectrum(y, step) {
  const v = y.map(t => Number.isFinite(t) ? t : 0), n0 = v.length;
  const mean = v.reduce((a, b) => a + b, 0) / n0;
  let n = 1; while (n < n0) n <<= 1;
  const re = new Array(n).fill(0), im = new Array(n).fill(0);
  for (let i = 0; i < n0; i++) re[i] = (v[i] - mean) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n0 - 1)));
  fft(re, im);
  const per = [], pw = [];
  for (let k = 1; k < n / 2; k++) { per.push(n * step / k); pw.push(Math.log10(re[k] * re[k] + im[k] * im[k] + 1e-30)); }
  return { period: per.reverse(), logPower: pw.reverse() };
}

// Morlet wavelet amplitude, rows = periods (log spaced), columns = x
export function wavelet(y, step, nScales = 40) {
  const v = y.map(t => Number.isFinite(t) ? t : 0), n = v.length;
  const mean = v.reduce((a, b) => a + b, 0) / n, d = v.map(t => t - mean);
  const pMin = 4 * step, pMax = n * step / 3, periods = [], rows = [];
  for (let s = 0; s < nScales; s++) periods.push(pMin * Math.pow(pMax / pMin, s / (nScales - 1)));
  const w0 = 6;
  for (const P of periods) {
    const sc = P * w0 / (2 * Math.PI) / step, half = Math.ceil(3 * sc), row = new Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0, im = 0;
      for (let k = -half; k <= half; k++) {
        const j = i + k; if (j < 0 || j >= n) continue;
        const t = k / sc, g = Math.exp(-0.5 * t * t);
        r += d[j] * g * Math.cos(w0 * t); im += d[j] * g * Math.sin(w0 * t);
      }
      row[i] = Math.hypot(r, im) / Math.sqrt(sc);
    }
    rows.push(row);
  }
  return { periods, rows };
}

// ---------- interactive SVG chart (drag = zoom, click = pick a point) ----------
const NS = 'http://www.w3.org/2000/svg';
function se(tag, a) { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); return e; }

export function percentileRange(arrs, lo = 0.5, hi = 99.5) {
  const all = [];
  for (const a of arrs) for (const v of a) if (Number.isFinite(v)) all.push(v);
  if (!all.length) return [0, 1];
  all.sort((p, q) => p - q);
  let a = all[Math.floor(lo / 100 * (all.length - 1))], b = all[Math.ceil(hi / 100 * (all.length - 1))];
  if (a === b) { a -= 1; b += 1; }
  const m = (b - a) * 0.05;
  return [a - m, b + m];
}

// series: [{x, y, color, dash, width, name}]; opts: {height, xLabel, yLabel, yr, guides:[{x,label}], labels:[{y,text,color}],
//   onClick(x), onZoom(x0,x1), mark: x, yTicks: true, logX}
export function chart(series, opts = {}) {
  const W = opts.width || 900, P = { l: 66, r: opts.y2 ? 62 : 16, t: 14, b: 40 };
  const xs = series.flatMap(s => s.x), x0 = opts.xr ? opts.xr[0] : Math.min(...xs), x1 = opts.xr ? opts.xr[1] : Math.max(...xs);
  // a background Sun image only makes the plot taller (to fit the disk); the data range of Y is not touched
  const kxBg = (W - P.l - P.r) / (x1 - x0);
  const H = opts.bg ? Math.max(opts.height || 380, Math.min(1400, 2.15 * opts.bg.R * kxBg + P.t + P.b)) : (opts.height || 380);
  const [y0, y1] = opts.yr || percentileRange(series.filter(s => s.axis !== 2).map(s => s.y), 0, 100);
  const [v0, v1] = opts.y2 ? (opts.y2.yr || percentileRange(series.filter(s => s.axis === 2).map(s => s.y), 0, 100)) : [0, 1];
  const tx = v => opts.logX ? Math.log10(v) : v;
  const X = v => P.l + (tx(v) - tx(x0)) / (tx(x1) - tx(x0)) * (W - P.l - P.r);
  const Y = v => H - P.b - (v - y0) / (y1 - y0) * (H - P.t - P.b);
  const Y2 = v => H - P.b - (v - v0) / (v1 - v0) * (H - P.t - P.b);
  const svg = se('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': (opts.yLabel || '') + ' от ' + (opts.xLabel || ''), style: 'width:100%;height:auto;display:block;touch-action:pan-y' });
  const clip = 'c' + Math.random().toString(36).slice(2);
  const d = se('defs', {}); const cp = se('clipPath', { id: clip }); cp.append(se('rect', { x: P.l, y: P.t, width: W - P.l - P.r, height: H - P.t - P.b })); d.append(cp); svg.append(d);
  const t = (x, y, s, a = {}) => { const e = se('text', { x, y, 'font-size': 12, fill: '#4A5668', 'font-family': 'JetBrains Mono, monospace', ...a }); e.textContent = s; svg.append(e); };
  const bgCanvas = opts.bg ? sunBackground(svg, opts.bg, X, kxBg, (P.t + H - P.b) / 2, clip, P.t, H - P.b, W, H, P.l, W - P.r) : null;
  for (const v of niceTicks(y0, y1, 6)) { svg.append(se('line', { x1: P.l, x2: W - P.r, y1: Y(v), y2: Y(v), stroke: '#E3E8EF' })); if (opts.yTicks !== false) t(P.l - 6, Y(v) + 4, fmt(v), { 'text-anchor': 'end' }); }
  const xt = opts.logX ? [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000].filter(v => v >= x0 && v <= x1) : niceTicks(x0, x1, 8);
  for (const v of xt) { svg.append(se('line', { x1: X(v), x2: X(v), y1: P.t, y2: H - P.b, stroke: '#F0F3F7' })); t(X(v), H - P.b + 16, String(v), { 'text-anchor': 'middle' }); }
  svg.append(se('rect', { x: P.l, y: P.t, width: W - P.l - P.r, height: H - P.t - P.b, fill: 'none', stroke: '#C5CFDB' }));
  if (y0 < 0 && y1 > 0) svg.append(se('line', { x1: P.l, x2: W - P.r, y1: Y(0), y2: Y(0), stroke: '#9AA6B5' }));
  for (const gd of opts.guides || []) if (gd.x >= x0 && gd.x <= x1) {
    svg.append(se('line', { x1: X(gd.x), x2: X(gd.x), y1: P.t, y2: H - P.b, stroke: '#8A5A00', 'stroke-dasharray': '4 4', 'stroke-opacity': 0.6 }));
    if (gd.label) t(X(gd.x) + 4, P.t + 12, gd.label, { fill: '#8A5A00', 'font-size': 11 });
  }
  if (opts.y2) {
    for (const v of niceTicks(v0, v1, 6)) t(W - P.r + 6, Y2(v) + 4, fmt(v), { 'text-anchor': 'start', fill: opts.y2.color || '#4A5668' });
    const yl2 = se('text', { x: W - 10, y: (P.t + H - P.b) / 2, 'font-size': 12, fill: opts.y2.color || '#4A5668', 'text-anchor': 'middle', transform: `rotate(-90 ${W - 10} ${(P.t + H - P.b) / 2})` }); yl2.textContent = opts.y2.label || ''; svg.append(yl2);
  }
  const g = se('g', { 'clip-path': `url(#${clip})` }); svg.append(g);
  for (const s of series) {
    let dstr = '', pen = false;
    const YY = s.axis === 2 ? Y2 : Y;
    s.x.forEach((xv, i) => { const yv = s.y[i]; if (!Number.isFinite(yv)) { pen = false; return; } dstr += (pen ? 'L' : 'M') + X(xv).toFixed(1) + ',' + YY(yv).toFixed(1); pen = true; });
    g.append(se('path', { d: dstr, fill: 'none', stroke: s.color, 'stroke-width': s.width || 1.5, 'stroke-linejoin': 'round', ...(s.dash ? { 'stroke-dasharray': s.dash } : {}) }));
  }
  for (const l of opts.labels || []) t(P.l + 4, Y(l.y) - 3, l.text, { fill: l.color || '#4A5668', 'font-size': 11 });
  if (opts.mark !== undefined && opts.mark !== null && opts.mark >= x0 && opts.mark <= x1) svg.append(se('line', { x1: X(opts.mark), x2: X(opts.mark), y1: P.t, y2: H - P.b, stroke: '#C2410C', 'stroke-width': 1.5 }));
  t((P.l + W - P.r) / 2, H - 6, opts.xLabel || '', { 'text-anchor': 'middle', 'font-family': 'Inter, sans-serif' });
  const yl = se('text', { x: 14, y: (P.t + H - P.b) / 2, 'font-size': 12, fill: '#4A5668', 'text-anchor': 'middle', transform: `rotate(-90 14 ${(P.t + H - P.b) / 2})` }); yl.textContent = opts.yLabel || ''; svg.append(yl);
  if (opts.onClick || opts.onZoom) {
    const inv = px => { const f = (px - P.l) / (W - P.l - P.r); return opts.logX ? Math.pow(10, tx(x0) + f * (tx(x1) - tx(x0))) : x0 + f * (x1 - x0); };
    const toSvg = e => { const b = svg.getBoundingClientRect(); return (e.clientX - b.left) / b.width * W; };
    let start = null; const sel = se('rect', { y: P.t, height: H - P.t - P.b, fill: '#1E4FB8', 'fill-opacity': 0.12, width: 0 }); svg.append(sel);
    svg.style.cursor = 'crosshair';
    svg.addEventListener('pointerdown', e => { if (e.button !== 0) return; start = toSvg(e); sel.setAttribute('x', start); sel.setAttribute('width', 0); });
    svg.addEventListener('pointermove', e => { if (start === null) return; const p = toSvg(e); sel.setAttribute('x', Math.min(start, p)); sel.setAttribute('width', Math.abs(p - start)); });
    svg.addEventListener('pointerup', e => {
      if (start === null) return; const p = toSvg(e), a = start; start = null; sel.setAttribute('width', 0);
      if (Math.abs(p - a) > 8 && opts.onZoom) opts.onZoom(inv(Math.min(a, p)), inv(Math.max(a, p)));
      else if (opts.onClick && p >= P.l && p <= W - P.r) opts.onClick(inv(p));
    });
  }
  if (bgCanvas) {
    svg.style.position = 'relative';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative';
    wrap.append(bgCanvas, svg);
    return wrap;
  }
  return svg;
}

// Sun image behind a chart: centre of the disk at x = 0, same arcsec scale as the x axis, turned by P + q
// (+ correction), optionally mirrored. The picture is loaded ONCE per URL set (plain Image, like the first
// version that worked) and cached; it is painted on a canvas under the SVG, so re-drawing the chart does not
// ask Helioviewer again. The limb, the beam strip and a light veil are drawn in the SVG on top.
// bg: {urls: [...], R, sizeArcsec, turn, q, flip, pos, beam, onStatus(state, url, log)}
const sunCache = new Map();
export function sunImage(urls) {
  const key = urls.join('|');
  if (sunCache.has(key)) return sunCache.get(key);
  const pr = new Promise((resolve, reject) => {
    const log = [];
    const tryNext = k => {
      if (k >= urls.length) { reject(Object.assign(new Error('снимок не загрузился'), { log, url: urls[0] })); return; }
      const img = new Image(), t0 = Date.now();
      img.onload = () => resolve({ img, url: urls[k], log });
      img.onerror = () => { log.push(urls[k] + ' — ошибка (' + Math.round((Date.now() - t0) / 1000) + ' с)'); tryNext(k + 1); };
      img.src = urls[k];
    };
    tryNext(0);
  });
  pr.catch(() => sunCache.delete(key));       // a failed load may be retried on the next draw
  sunCache.set(key, pr);
  return pr;
}

function sunBackground(svg, bg, X, k, cy, clip, yTop, yBot, W, H, xL, xR) {
  const cx = X(0), size = bg.sizeArcsec * k;
  // canvas under the svg
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cv = document.createElement('canvas');
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  cv.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none';
  const g2 = cv.getContext('2d'); g2.scale(dpr, dpr);
  const paint = img => {
    g2.clearRect(0, 0, W, H);
    g2.save(); g2.beginPath(); g2.rect(xL, yTop, xR - xL, yBot - yTop); g2.clip();
    g2.fillStyle = '#0B1220'; g2.fillRect(xL, yTop, xR - xL, yBot - yTop);
    if (img) {
      g2.translate(cx, cy); g2.rotate(-bg.turn * Math.PI / 180); if (bg.flip) g2.scale(-1, 1);
      g2.globalAlpha = 0.9; g2.drawImage(img, -size / 2, -size / 2, size, size);
    }
    g2.restore();
  };
  paint(null);
  // vector overlays in the svg
  const g = se('g', { 'clip-path': `url(#${clip})` });
  const limb = se('circle', { cx, cy, r: bg.R * k, fill: 'none', stroke: '#F5C451', 'stroke-opacity': 0.7, 'stroke-dasharray': '4 4' });
  g.append(limb);
  if (bg.pos !== null && bg.pos !== undefined) {
    const w = Math.max(1.5, (bg.beam || 30) * k), tq = Math.tan((bg.q || 0) * Math.PI / 180), L = 1.5 * bg.R * k, xp = X(bg.pos);
    g.append(se('polygon', { points: `${xp - w / 2 - L * tq},${cy - L} ${xp + w / 2 - L * tq},${cy - L} ${xp + w / 2 + L * tq},${cy + L} ${xp - w / 2 + L * tq},${cy + L}`, fill: '#F97316', 'fill-opacity': 0.35, stroke: '#F97316', 'stroke-width': 1 }));
  }
  g.append(se('rect', { x: 0, y: yTop, width: 4000, height: yBot - yTop, fill: '#FFFFFF', 'fill-opacity': 0.42 }));
  svg.append(g);
  if (bg.urls && bg.urls.length) {
    let t0 = Date.now(), done = false;
    bg.onStatus && bg.onStatus('loading', bg.urls[0], [], t0);
    sunImage(bg.urls).then(r => { done = true; paint(r.img); limb.setAttribute('stroke-opacity', 0.35); bg.onStatus && bg.onStatus('ok', r.url, r.log); })
      .catch(e => { done = true; bg.onStatus && bg.onStatus('error', e.url || bg.urls[0], e.log || []); });
  }
  return cv;
}

// colour by frequency on a white background: blue (low) -> orange (high), equal lightness steps
export function freqColor(f, fmin, fmax) {
  const t = fmax > fmin ? (f - fmin) / (fmax - fmin) : 0;
  const a = [30, 79, 184], b = [194, 65, 12], m = [15, 118, 110];
  const c = t < 0.5 ? a.map((v, i) => v + (m[i] - v) * t * 2) : m.map((v, i) => v + (b[i] - v) * (t - 0.5) * 2);
  return `rgb(${c.map(Math.round).join(',')})`;
}

// local maximum of a curve within +-half arcsec of x (for the point analysis), on a lightly smoothed curve
export function localPeak(x, y, xc, half) {
  let best = -1, bv = -Infinity;
  for (let i = 1; i < x.length - 1; i++) {
    if (Math.abs(x[i] - xc) > half) continue;
    const v = (y[i - 1] + 2 * y[i] + y[i + 1]) / 4;
    if (Number.isFinite(v) && v > bv && y[i] >= y[i - 1] && y[i] >= y[i + 1]) { bv = v; best = i; }
  }
  return best < 0 ? null : { dx: x[best] - xc, v: y[best] };
}

// ---------- 2D image of the Sun (Helioviewer) with the scan, as in sunview (solar_image.py) ----------
// Geometry: the Sun drifts through the fixed beam along its diurnal parallel, so in the equatorial frame the scan
// runs east-west; positive scan x is west. The beam strip is tilted to the hour circle by the transit angle
// q = arctan(sin(dec) * tan(t)); points of equal x lie on u - v*tan(q) = x (u west, v north). The Helioviewer image
// has solar north up, so it is turned by P + q to bring the scan axis horizontal.
export const SUN_LAYERS = {
  aia193: ['SDO AIA 193 Å (корона)', '[SDO,AIA,AIA,193,1,100]'],
  aia171: ['SDO AIA 171 Å', '[SDO,AIA,AIA,171,1,100]'],
  aia304: ['SDO AIA 304 Å (хромосфера)', '[SDO,AIA,AIA,304,1,100]'],
  aia1600: ['SDO AIA 1600 Å', '[SDO,AIA,AIA,1600,1,100]'],
  aia94: ['SDO AIA 94 Å (горячая плазма)', '[SDO,AIA,AIA,94,1,100]'],
  hmimag: ['SDO HMI магнитограмма', '[SDO,HMI,HMI,magnetogram,1,100]'],
  hmicont: ['SDO HMI континуум', '[SDO,HMI,HMI,continuum,1,100]']
};

export function transitAngle(s) {
  // hour angle of the observation from the azimuth (RATAN azimuth: 0 = meridian), small-angle-safe
  const d = (s.header.SOL_DEC || 0) * Math.PI / 180, h = (s.header.ALTITUDE || 45) * Math.PI / 180, A = (s.az || 0) * Math.PI / 180;
  const sint = -Math.sin(A) * Math.cos(h) / Math.cos(d);
  const t = Math.asin(Math.max(-1, Math.min(1, sint)));
  return Math.atan(Math.sin(d) * Math.tan(t)) * 180 / Math.PI;
}

export function helioviewerUrl(s, layer, events, size = 900, scale = 2.8) {
  // written like the examples of the Helioviewer API docs: brackets and commas left as they are
  let u = 'https://api.helioviewer.org/v2/takeScreenshot/?date=' + s.obs.date + 'T' + s.obs.time.slice(0, 8) + 'Z'
    + '&imageScale=' + scale + '&layers=' + SUN_LAYERS[layer][1]
    + '&x0=0&y0=0&width=' + size + '&height=' + size + '&display=true&watermark=false';
  if (events) u += '&events=[AR,all,1]&eventLabels=true';
  return u;
}

// opts: {layer, events, rot (extra degrees), flip, curves:[{y:[], color}], x, pos, beam, onPick}
export function sunOverlay(s, opts, done) {
  const S = 900, scale = 2.8, cx = S / 2, cy = S / 2, k = 1 / scale;      // px per arcsec
  const cv = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = S * dpr; cv.height = S * dpr; cv.style.width = '100%'; cv.style.height = 'auto'; cv.style.display = 'block'; cv.style.maxWidth = '600px'; cv.style.margin = '0 auto';
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const P = s.header.SOLAR_P || 0, q = transitAngle(s), turn = P + q + (opts.rot || 0);
  const sgn = opts.flip ? -1 : 1, R = s.solarR;
  const draw = img => {
    g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
    if (img) { g.save(); g.translate(cx, cy); g.rotate(-turn * Math.PI / 180); g.drawImage(img, -S / 2, -S / 2, S, S); g.restore(); }
    else { g.strokeStyle = '#F5C451'; g.beginPath(); g.arc(cx, cy, R * k, 0, 2 * Math.PI); g.stroke(); }
    const tq = Math.tan(q * Math.PI / 180);
    const X = (x, v = 0) => cx + sgn * (x + v * tq) * k;                     // celestial frame after the turn
    // limbs and centre along the scan
    g.setLineDash([5, 5]); g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = 1;
    for (const x of [-R, 0, R]) { g.beginPath(); g.moveTo(X(x, 1.3 * R), cy - 1.3 * R * k); g.lineTo(X(x, -1.3 * R), cy + 1.3 * R * k); g.stroke(); }
    g.setLineDash([]);
    // beam strip at the picked point
    if (opts.pos !== null && opts.pos !== undefined) {
      const w = (opts.beam || 30) / 2, L = 1.4 * R;
      g.fillStyle = 'rgba(249,115,22,0.30)'; g.strokeStyle = '#F97316'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(X(opts.pos - w, L), cy - L * k); g.lineTo(X(opts.pos + w, L), cy - L * k); g.lineTo(X(opts.pos + w, -L), cy + L * k); g.lineTo(X(opts.pos - w, -L), cy + L * k); g.closePath(); g.fill(); g.stroke();
    }
    // scans drawn along the scan axis, baseline under the disk
    const base = cy + 1.22 * R * k, hgt = 0.55 * R * k;
    let lo = Infinity, hi = -Infinity;
    for (const c of opts.curves) for (const v of c.y) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    g.strokeStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); g.moveTo(X(opts.x[0]), base); g.lineTo(X(opts.x[opts.x.length - 1]), base); g.stroke();
    for (const c of opts.curves) {
      g.strokeStyle = c.color; g.globalAlpha = 0.9; g.lineWidth = 1.4; g.beginPath(); let pen = false;
      opts.x.forEach((x, i) => { const v = c.y[i]; if (!Number.isFinite(v)) { pen = false; return; } const yy = base - (v - Math.min(0, lo)) / (hi - Math.min(0, lo)) * hgt; pen ? g.lineTo(X(x), yy) : g.moveTo(X(x), yy); pen = true; });
      g.stroke(); g.globalAlpha = 1;
    }
    // labels
    g.fillStyle = '#fff'; g.font = '13px Inter, sans-serif';
    g.fillText(sgn > 0 ? 'В ← скан → З' : 'З ← скан → В', 14, S - 14);
    g.fillText(`P = ${P.toFixed(1)}°, q = ${q.toFixed(1)}°${opts.rot ? ', поправка ' + opts.rot + '°' : ''}`, 14, 22);
    if (img) g.fillText(SUN_LAYERS[opts.layer][0] + ' · Helioviewer', 14, 40);
  };
  draw(null);
  if (opts.layer && opts.layer !== 'none') {
    // several ways to get the picture: with region labels, without them, and the two-step API (id -> download)
    const tries = [helioviewerUrl(s, opts.layer, opts.events, S, scale), helioviewerUrl(s, opts.layer, false, S, scale)];
    const log = [];
    const viaId = async () => {
      const u = helioviewerUrl(s, opts.layer, false, S, scale).replace('display=true', 'display=false');
      const r = await fetch(u, { signal: AbortSignal.timeout(60000) });
      const j = await r.json();
      if (!j || !j.id) throw new Error(j && (j.error || j.message) || 'нет id в ответе');
      return 'https://api.helioviewer.org/v2/downloadScreenshot/?id=' + j.id;
    };
    const next = k => {
      if (k < tries.length) {
        const img = new Image(), t0 = Date.now();
        img.onload = () => { draw(img); done && done(null, tries[k], log); };
        img.onerror = () => { log.push(tries[k] + ' — ошибка (' + Math.round((Date.now() - t0) / 1000) + ' с)'); next(k + 1); };
        img.src = tries[k];
        done && done('loading', tries[k], log);
      } else if (k === tries.length) {
        viaId().then(u => { tries.push(u); next(k + 1); })
          .catch(e => { log.push('двухшаговый запрос: ' + (e.message || e)); done && done(new Error('снимок Helioviewer не загрузился'), tries[0], log); });
      } else done && done(new Error('снимок Helioviewer не загрузился'), tries[0], log);
    };
    next(0);
  } else done && done(null);
  if (opts.onPick) {
    cv.style.cursor = 'crosshair';
    cv.addEventListener('click', e => {
      const b = cv.getBoundingClientRect(), px = (e.clientX - b.left) / b.width * S, py = (e.clientY - b.top) / b.height * S;
      const v = -(py - cy) / k, x = sgn * (px - cx) / k - v * Math.tan(q * Math.PI / 180);
      opts.onPick(x);
    });
  }
  return cv;
}
