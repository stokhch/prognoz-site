// Global multiplier for scan line widths (chosen by the user).
let lineScale = 1;
export function setLineScale(k) { lineScale = +k > 0 ? +k : 1; }
export function getLineScale() { return lineScale; }

// View modes of the analysis page (port of the old ION "Type" / "Stokes" / "SubQuietSun" options and analysis
// buttons). Everything is computed in the browser from one level2 scan (see fits.js).
import { value } from './fits.js';
import { palette } from './scanplot.js';

// ---------- colour maps ----------
// Std Gamma-II is the table of the forecast picture; the others are the usual perceptual maps (9 stops each).
export const PALETTES = {
  gamma: { name: 'Std Gamma-II (forecast)', f: t => palette(255 * t) },
  viridis: { name: 'viridis', stops: ['#440154', '#472d7b', '#3b528b', '#2c728e', '#21918c', '#28ae80', '#5ec962', '#addc30', '#fde725'] },
  inferno: { name: 'inferno', stops: ['#000004', '#1b0c41', '#4a0c6b', '#781c6d', '#a52c60', '#cf4446', '#ed6925', '#fb9b06', '#fcffa4'] },
  plasma: { name: 'plasma', stops: ['#0d0887', '#4c02a1', '#7e03a8', '#a92395', '#cc4778', '#e66c5c', '#f89540', '#fdc527', '#f0f921'] },
  cividis: { name: 'cividis (colour-blind safe)', stops: ['#00224e', '#123570', '#3b496c', '#575d6d', '#707173', '#8a8678', '#a59c74', '#c3b369', '#fee838'] },
  turbo: { name: 'turbo (rainbow)', stops: ['#30123b', '#4662d7', '#36aaf9', '#1ae4b6', '#72fe5e', '#c8ef34', '#faba39', '#f66b19', '#7a0403'] },
  coolwarm: { name: 'cool–warm (for V)', stops: ['#3b4cc0', '#6788ee', '#9abbff', '#c9d7f0', '#edd1c2', '#f7a889', '#e26952', '#b40426'] },
  gray: { name: 'gray', stops: ['#000000', '#ffffff'] }
};
let currentPal = 'gamma';
export function setPalette(name) { if (PALETTES[name]) currentPal = name; }
export function paletteName() { return currentPal; }
function hexRgb(h) { return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); }
// colour at t in [0, 1] of the chosen (or given) map
export function cmap(t, name = currentPal) {
  const p = PALETTES[name] || PALETTES.gamma;
  t = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  if (p.f) return p.f(t);
  const n = p.stops.length - 1, i = Math.min(n - 1, Math.floor(t * n)), u = t * n - i;
  const a = hexRgb(p.stops[i]), b = hexRgb(p.stops[i + 1]);
  return 'rgb(' + a.map((v, k) => Math.round(v + (b[k] - v) * u)).join(',') + ')';
}
export function gradientCss(name) { return 'linear-gradient(90deg,' + Array.from({ length: 12 }, (_, k) => cmap(k / 11, name)).join(',') + ')'; }

import { template as qsTemplate } from './quietsun.js';
import { projectHelio } from './regions.js';

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
  none: 'none',
  model: 'disk model, envelope fit',
  touch: 'disk model, touch from below',
  modeltq: 'disk model, TQSUN level',
  env: 'running lower envelope',
  median: 'median filter'
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
export function map2d(x, freqs, rows, kind, label, onPick, yAxis = 'frequency, GHz', guides = [], size = 0) {
  const W = size || 900, H = size || 460, pad = { l: 64, r: 70, t: 20, b: 40 };
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
        const col = Number.isFinite(v) ? cmap((v - lo) / (hi - lo)).match(/\d+/g).map(Number) : [255, 255, 255];
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
      g.strokeStyle = cmap(0.12 + 0.76 * li / Math.max(1, levels.length - 1)); g.lineWidth = 1.1 * lineScale;
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
  drawAxes(A, x[0], x[nc - 1], freqs[0], freqs[nr - 1], 'arcsec from disk centre', yAxis);
  for (const gd of guides) {
    if (gd.x < x[0] || gd.x > x[nc - 1]) continue;
    const px = pad.l + (gd.x - x[0]) / (x[nc - 1] - x[0]) * pw;
    g.save(); g.setLineDash(gd.x === 0 ? [7, 4] : [4, 4]); g.lineWidth = 1.3;
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.beginPath(); g.moveTo(px, pad.t); g.lineTo(px, pad.t + ph); g.stroke();
    g.strokeStyle = 'rgba(15,27,45,0.55)'; g.lineDashOffset = 4; g.beginPath(); g.moveTo(px + 1, pad.t); g.lineTo(px + 1, pad.t + ph); g.stroke();
    g.restore();
    g.fillStyle = '#8A5A00'; g.font = '600 12px Inter, sans-serif'; g.textAlign = 'center'; g.fillText(gd.label, px, pad.t - 2 > 10 ? pad.t - 2 : 11);
  }
  // colour bar
  for (let k = 0; k < ph; k++) { g.fillStyle = cmap(1 - k / ph); g.fillRect(W - pad.r + 14, pad.t + k, 14, 1); }
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
export function waterfall(x, freqs, rows, label, guides = [], size = 0) {
  const W = size || 900, H = size || 520, pad = { l: 40, r: 30, t: 20, b: 40 };
  const A = axesCanvas(W, H, pad), g = A.g;
  const n = rows.length, [lo, hi] = finiteRange(rows);
  // depth offsets and curve height scale with the canvas (old fixed 900x520 layout kept for the default size)
  const avail = H - pad.t - pad.b, ox0 = size ? 0.2 * W : 180, dep = size ? 0.34 * avail : 230;
  const dx = ox0 / n, dy = dep / n, pw = W - pad.l - pad.r - ox0, ph = size ? 0.64 * avail : 230;
  for (let k = n - 1; k >= 0; k--) {
    const ox = pad.l + k * dx, oy = H - pad.b - k * dy;
    const X = i => ox + i / (x.length - 1) * pw, Y = v => oy - (Number.isFinite(v) ? (v - lo) / (hi - lo) : 0) * ph;
    g.beginPath(); g.moveTo(X(0), oy);
    rows[k].forEach((v, i) => g.lineTo(X(i), Y(v)));
    g.lineTo(X(x.length - 1), oy); g.closePath();
    g.fillStyle = 'rgba(255,255,255,0.92)'; g.fill();
    g.strokeStyle = cmap(0.1 + 0.75 * k / Math.max(1, n - 1)); g.lineWidth = 1.2 * lineScale; g.stroke();
  }
  for (const gd of guides) {
    if (gd.x < x[0] || gd.x > x[x.length - 1]) continue;
    const t = (gd.x - x[0]) / (x[x.length - 1] - x[0]), x0 = pad.l + t * pw, y0 = H - pad.b;
    g.save(); g.setLineDash(gd.x === 0 ? [7, 4] : [4, 4]); g.strokeStyle = 'rgba(138,90,0,0.8)'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + (n - 1) * dx, y0 - (n - 1) * dy); g.stroke(); g.restore();
    g.fillStyle = '#8A5A00'; g.font = '600 12px Inter, sans-serif'; g.textAlign = 'center'; g.fillText(gd.label, x0, y0 + 16); g.textAlign = 'start';
  }
  g.fillStyle = '#4A5668'; g.font = '12px "JetBrains Mono", monospace';
  g.fillText(freqs[0].toFixed(2) + ' GHz', pad.l + pw + 6, H - pad.b);
  g.fillText(freqs[n - 1].toFixed(2) + ' GHz', pad.l + (n - 1) * dx + pw + 6, H - pad.b - (n - 1) * dy);
  g.textAlign = 'center'; g.fillText('arcsec: ' + Math.round(x[0]) + ' … ' + Math.round(x[x.length - 1]) + ' · Y: ' + label, W / 2, H - 10);
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
  const svg = se('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': (opts.yLabel || '') + ' vs ' + (opts.xLabel || ''), style: 'width:100%;height:auto;display:block;touch-action:pan-y' });
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
    svg.append(se('line', { x1: X(gd.x), x2: X(gd.x), y1: P.t, y2: H - P.b, stroke: gd.x === 0 ? '#B45309' : '#8A5A00', 'stroke-width': gd.x === 0 ? 1.4 : 1.2, 'stroke-dasharray': gd.x === 0 ? '7 4' : '4 4', 'stroke-opacity': 0.85 }));
    if (gd.label) t(X(gd.x) + 4, P.t + 13, gd.label, { fill: '#8A5A00', 'font-size': 12, 'font-weight': 600, 'font-family': 'Inter, sans-serif' });
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
    g.append(se('path', { d: dstr, fill: 'none', stroke: s.color, 'stroke-width': (s.width || 1.5) * lineScale, 'stroke-linejoin': 'round', ...(s.dash ? { 'stroke-dasharray': s.dash } : {}) }));
  }
  for (const l of opts.labels || []) t(P.l + 4, Y(l.y) - 3, l.text, { fill: l.color || '#4A5668', 'font-size': 11 });
  for (const m of opts.marks || []) if (m.x >= x0 && m.x <= x1) {
    svg.append(se('line', { x1: X(m.x), x2: X(m.x), y1: P.t + 16, y2: H - P.b, stroke: '#A21CAF', 'stroke-width': 1, 'stroke-dasharray': '1 3', 'stroke-opacity': 0.8 }));
    t(X(m.x), P.t + 28, String(m.label), { 'text-anchor': 'middle', fill: '#86198F', 'font-size': 11, 'font-weight': 700, 'font-family': 'Inter, sans-serif' });
  }
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
      if (k >= urls.length) { reject(Object.assign(new Error('image failed'), { log, url: urls[0] })); return; }
      const img = new Image(), t0 = Date.now();
      img.onload = () => resolve({ img, url: urls[k], log });
      img.onerror = () => { log.push(urls[k] + ' — error (' + Math.round((Date.now() - t0) / 1000) + ' s)'); tryNext(k + 1); };
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
  if (currentPal === 'gray') return cmap(0.05 + 0.55 * t);
  if (currentPal === 'coolwarm') return cmap(t < 0.5 ? 0.0 + 0.4 * t / 0.5 : 0.6 + 0.4 * (t - 0.5) / 0.5);
  return cmap(0.06 + 0.72 * t);
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
  aia193: ['SDO AIA 193 Å (corona)', '[SDO,AIA,AIA,193,1,100]'],
  aia171: ['SDO AIA 171 Å', '[SDO,AIA,AIA,171,1,100]'],
  aia304: ['SDO AIA 304 Å (chromosphere)', '[SDO,AIA,AIA,304,1,100]'],
  aia1600: ['SDO AIA 1600 Å', '[SDO,AIA,AIA,1600,1,100]'],
  aia94: ['SDO AIA 94 Å (hot plasma)', '[SDO,AIA,AIA,94,1,100]'],
  hmimag: ['SDO HMI magnetogram', '[SDO,HMI,HMI,magnetogram,1,100]'],
  hmicont: ['SDO HMI continuum', '[SDO,HMI,HMI,continuum,1,100]']
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

// The Sun image with the scans drawn OVER the disk, in the image's own frame (round Sun, the scan axis horizontal
// after turning the image by P + q). Curves: [{y, color, dash, band}] — curves without `band` share one scale
// from the bottom of the disk upwards; with band = [k, n] a curve gets its own strip k of n (vertical mode).
// opts: {urls, layer, rot, flip, curves, x, pos, beam, onPick}; done(state, url, log)
export function sunOverlay(s, opts, done) {
  const S = 900, scale = 2.8, cx = S / 2, cy = S / 2, k = 1 / scale;
  // margins around the S x S picture hold the axes: x in arcsec, left y for the shared scale, right y for own-scale V
  const hasOwn = opts.curves.some(c => c.own && !c.band), hasShared = opts.curves.some(c => !c.band && !c.own);
  const M = { l: hasShared ? 92 : 20, r: hasOwn ? 92 : 20, t: 12, b: 64 }, TW = S + M.l + M.r, TH = S + M.t + M.b;
  const cv = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = TW * dpr; cv.height = TH * dpr; cv.style.cssText = 'width:100%;height:auto;display:block;margin:0 auto';
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const P = s.header.SOLAR_P || 0, q = transitAngle(s), turn = P + q + (opts.rot || 0);
  const sgn = opts.flip ? -1 : 1, R = s.solarR, tq = Math.tan(q * Math.PI / 180);
  const X = (x, v = 0) => cx + sgn * (x + v * tq) * k;
  const draw = img => {
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, TW, TH);
    g.translate(M.l, M.t);
    g.save(); g.beginPath(); g.rect(0, 0, S, S); g.clip();
    g.fillStyle = '#05080F'; g.fillRect(0, 0, S, S);
    if (img) { g.save(); g.translate(cx, cy); g.rotate(-turn * Math.PI / 180); g.drawImage(img, -S / 2, -S / 2, S, S); g.restore(); }
    // heliographic grid (every 15 deg, B0 from the header) and the limb, in the solar frame turned like the image
    if (opts.grid) {
      const B0 = (s.header.SOLAR_B || 0) * Math.PI / 180, r = R * k;
      g.save(); g.translate(cx, cy); g.rotate(-turn * Math.PI / 180);
      const proj = (lat, lon) => {
        const z = Math.sin(lat) * Math.sin(B0) + Math.cos(lat) * Math.cos(B0) * Math.cos(lon);
        return { x: r * Math.cos(lat) * Math.sin(lon), y: -r * (Math.sin(lat) * Math.cos(B0) - Math.cos(lat) * Math.sin(B0) * Math.cos(lon)), z };
      };
      const line = pts => { g.beginPath(); let pen = false; for (const p of pts) { if (p.z < 0) { pen = false; continue; } pen ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); pen = true; } g.stroke(); };
      const d = Math.PI / 180;
      g.lineWidth = 0.8;
      for (let lat = -75; lat <= 75; lat += 15) {
        g.strokeStyle = lat === 0 ? 'rgba(125,211,252,0.85)' : 'rgba(125,211,252,0.45)';
        const pts = []; for (let lon = -90; lon <= 90; lon += 2) pts.push(proj(lat * d, lon * d)); line(pts);
      }
      for (let lon = -90; lon <= 90; lon += 15) {
        g.strokeStyle = lon === 0 ? 'rgba(125,211,252,0.85)' : 'rgba(125,211,252,0.45)';
        const pts = []; for (let lat = -90; lat <= 90; lat += 2) pts.push(proj(lat * d, lon * d)); line(pts);
      }
      const np = proj(Math.PI / 2, 0);
      g.fillStyle = 'rgba(125,211,252,0.95)'; g.font = 'bold 22px Inter, sans-serif'; g.textAlign = 'center';
      if (np.z >= 0) g.fillText('N', np.x, np.y - 6); else g.fillText('N', 0, -r - 8);
      g.textAlign = 'start';
      g.restore();
    }
    g.strokeStyle = '#F5C451'; g.lineWidth = 1.6; g.setLineDash([]);
    g.beginPath(); g.arc(cx, cy, R * k, 0, 2 * Math.PI); g.stroke();
    // NOAA active regions: marker and number at the heliographic position
    if (opts.regions && opts.regions.length) {
      const B0 = s.header.SOLAR_B || 0;
      g.save(); g.translate(cx, cy); g.rotate(-turn * Math.PI / 180);
      for (const r of opts.regions) {
        const p = projectHelio(r.lat, r.lon, B0, R * k);
        if (p.z < 0) continue;
        g.fillStyle = '#F0ABFC'; g.strokeStyle = '#2E1065'; g.lineWidth = 1.5;
        g.beginPath(); g.arc(p.x, -p.y, 5, 0, 2 * Math.PI); g.fill(); g.stroke();
        g.save(); g.translate(p.x, -p.y); g.rotate(turn * Math.PI / 180);
        g.font = 'bold 20px Inter, sans-serif'; g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,0.75)'; g.fillStyle = '#F5D0FE';
        g.strokeText(String(r.noaa), 8, -8); g.fillText(String(r.noaa), 8, -8);
        g.restore();
      }
      g.restore();
    }
    // beam strip at the picked point
    if (opts.pos !== null && opts.pos !== undefined) {
      const w = Math.max(1.5, (opts.beam || 30) * k) / 2, L = 1.25 * R;
      g.fillStyle = 'rgba(249,115,22,0.28)'; g.strokeStyle = 'rgba(249,115,22,0.9)';
      g.beginPath(); g.moveTo(X(opts.pos, L) - w, cy - L * k); g.lineTo(X(opts.pos, L) + w, cy - L * k); g.lineTo(X(opts.pos, -L) + w, cy + L * k); g.lineTo(X(opts.pos, -L) - w, cy + L * k); g.closePath(); g.fill(); g.stroke();
    }
    // scans over the disk
    // curves of the main scale share one range; curves with own: true (V of the I+V pair) get a symmetric scale
    // of their own with the zero line at a quarter of the height above the base
    const shared = opts.curves.filter(c => !c.band && !c.own);
    let lo = 0, hi = -Infinity, vmax = 0;
    for (const c of shared) for (const v of c.y) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    for (const c of opts.curves) if (c.own && !c.band) for (const v of c.y) if (Number.isFinite(v)) vmax = Math.max(vmax, Math.abs(v));
    const base = cy + 0.95 * R * k, top = cy - 0.9 * R * k, vzero = base - 0.25 * (base - top);
    if (vmax > 0) { g.strokeStyle = 'rgba(147,197,253,0.5)'; g.setLineDash([2, 4]); g.beginPath(); g.moveTo(X(opts.x[0]), vzero); g.lineTo(X(opts.x[opts.x.length - 1]), vzero); g.stroke(); g.setLineDash([]); }
    g.lineJoin = 'round';
    for (const c of opts.curves) {
      let Y;
      if (c.band) {
        const [b, n] = c.band, h = (base - top) / n, y0 = base - b * h;
        if (c.own) { let m = 0; for (const v of c.y) if (Number.isFinite(v)) m = Math.max(m, Math.abs(v)); Y = v => y0 - h * 0.45 - v / (m || 1) * h * 0.42; }
        else { let a = Infinity, z = -Infinity; for (const v of c.y) if (Number.isFinite(v)) { a = Math.min(a, v); z = Math.max(z, v); } Y = v => y0 - (v - a) / ((z - a) || 1) * h * 0.9; }
      } else if (c.own) Y = v => vzero - v / (vmax || 1) * 0.22 * (base - top);
      else Y = v => base - (v - lo) / ((hi - lo) || 1) * (base - top);
      g.strokeStyle = c.color; g.lineWidth = (c.width || 1.8) * lineScale; g.setLineDash(c.dash || []);
      g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 2;
      g.beginPath(); let pen = false;
      opts.x.forEach((x, i) => { const v = c.y[i]; if (!Number.isFinite(v)) { pen = false; return; } const px = X(x), py = Y(v); pen ? g.lineTo(px, py) : g.moveTo(px, py); pen = true; });
      g.stroke(); g.shadowBlur = 0; g.setLineDash([]);
    }
    if (shared.length) { g.strokeStyle = 'rgba(255,255,255,0.45)'; g.beginPath(); g.moveTo(X(opts.x[0]), base); g.lineTo(X(opts.x[opts.x.length - 1]), base); g.stroke(); }
    // limb and centre lines across the whole picture
    if (opts.guides) {
      g.lineWidth = 1.4; g.font = 'bold 18px Inter, sans-serif';
      for (const [x, lab] of [[-R, '−R☉'], [0, 'centre'], [R, '+R☉']]) {
        const px = X(x); g.strokeStyle = x === 0 ? 'rgba(251,146,60,0.95)' : 'rgba(253,186,116,0.85)'; g.setLineDash(x === 0 ? [9, 5] : [5, 5]);
        g.beginPath(); g.moveTo(px, 0); g.lineTo(px, S); g.stroke(); g.setLineDash([]);
        g.fillStyle = '#FDBA74'; g.fillText(lab, px + 5, 22);
      }
    }
    g.fillStyle = '#fff'; g.font = '20px Inter, sans-serif';
    g.fillText(sgn > 0 ? 'E ← scan → W' : 'W ← scan → E', 12, S - 14);
    g.fillText(`P = ${P.toFixed(1)}°, q = ${q.toFixed(1)}°${opts.rot ? ', corr. ' + opts.rot + '°' : ''}`, 12, 48);
    if (img) g.fillText(SUN_LAYERS[opts.layer][0], 12, 74);
    g.restore();
    // frame and axes
    g.strokeStyle = '#94A3B8'; g.lineWidth = 1; g.strokeRect(0.5, 0.5, S - 1, S - 1);
    g.fillStyle = '#334155'; g.strokeStyle = '#64748B'; g.font = '17px "JetBrains Mono", monospace'; g.textAlign = 'center';
    const half = S / 2 / k;
    for (const t of niceTicks(-half, half, 8)) {
      const px = cx + sgn * t * k; if (px < 1 || px > S - 1) continue;
      g.beginPath(); g.moveTo(px, S); g.lineTo(px, S + 6); g.stroke(); g.fillText(String(t), px, S + 24);
    }
    g.font = '18px Inter, sans-serif'; g.fillText(opts.xLabel || 'arcsec from disk centre', S / 2, S + 52);
    const yAxis = (lo0, hi0, y0, y1, side, label) => {
      g.font = '16px "JetBrains Mono", monospace'; g.textAlign = side < 0 ? 'right' : 'left';
      const xe = side < 0 ? 0 : S;
      for (const t of niceTicks(lo0, hi0, 6)) {
        const py = y0 - (t - lo0) / ((hi0 - lo0) || 1) * (y0 - y1); if (py < 1 || py > S - 1) continue;
        g.beginPath(); g.moveTo(xe, py); g.lineTo(xe + side * 6, py); g.stroke();
        g.fillText(Math.abs(t) >= 100 ? String(Math.round(t)) : String(+t.toPrecision(3)), xe + side * 9, py + 5);
      }
      g.save(); g.translate(side < 0 ? -M.l + 18 : S + M.r - 10, S / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.font = '17px Inter, sans-serif';
      g.fillText(label, 0, 0); g.restore();
    };
    if (shared.length) yAxis(lo, hi, base, top, -1, opts.yLabel || 'K');
    if (vmax > 0) { const h = 0.22 * (base - top); yAxis(-vmax, vmax, vzero + h, vzero - h, 1, opts.y2Label || 'V, K (dashed)'); }
    g.textAlign = 'start';
  };
  draw(null);
  if (!opts.urls || !opts.urls.length) done && done('none');
  if (opts.urls && opts.urls.length) {
    done && done('loading', opts.urls[0], []);
    sunImage(opts.urls).then(r => { draw(r.img); done && done('ok', r.url, r.log); })
      .catch(e => done && done('error', e.url || opts.urls[0], e.log || []));
  }
  if (opts.onPick) {
    cv.style.cursor = 'crosshair';
    cv.addEventListener('click', e => {
      const b = cv.getBoundingClientRect(), px = (e.clientX - b.left) / b.width * TW - M.l, py = (e.clientY - b.top) / b.height * TH - M.t;
      if (px < 0 || px > S || py < 0 || py > S) return;
      const v = -(py - cy) / k;
      opts.onPick(sgn * (px - cx) / k - v * tq);
    });
  }
  return cv;
}


// Render every canvas and svg inside `box` into one PNG (2x), keeping their on-page layout; white background.
export async function exportPng(box, name) {
  const items = [...box.querySelectorAll('canvas, svg')].filter(e => e.getBoundingClientRect().width > 0 && !e.closest('svg svg'));
  if (!items.length) throw new Error('nothing to export');
  const b0 = box.getBoundingClientRect(), K = 2;
  let x1 = 0, y1 = 0; const rects = items.map(e => { const r = e.getBoundingClientRect(); x1 = Math.max(x1, r.right - b0.left); y1 = Math.max(y1, r.bottom - b0.top); return r; });
  let x0 = Infinity, y0 = Infinity; for (const r of rects) { x0 = Math.min(x0, r.left - b0.left); y0 = Math.min(y0, r.top - b0.top); }
  const pad = 8, out = document.createElement('canvas');
  out.width = Math.ceil((x1 - x0 + 2 * pad) * K); out.height = Math.ceil((y1 - y0 + 2 * pad) * K);
  const g = out.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, out.width, out.height);
  for (let i = 0; i < items.length; i++) {
    const e = items[i], r = rects[i], dx = (r.left - b0.left - x0 + pad) * K, dy = (r.top - b0.top - y0 + pad) * K;
    if (e.tagName.toLowerCase() === 'canvas') { g.drawImage(e, dx, dy, r.width * K, r.height * K); continue; }
    const c = e.cloneNode(true);
    c.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); c.setAttribute('width', r.width); c.setAttribute('height', r.height);
    c.setAttribute('font-family', getComputedStyle(e).fontFamily || 'sans-serif');
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(c)], { type: 'image/svg+xml' }));
    await new Promise((ok, bad) => { const im = new Image(); im.onload = () => { g.drawImage(im, dx, dy, r.width * K, r.height * K); URL.revokeObjectURL(url); ok(); }; im.onerror = bad; im.src = url; });
  }
  const blob = await new Promise(ok => out.toBlob(ok, 'image/png'));
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
