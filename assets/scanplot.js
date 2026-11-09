// Canvas port of ratan_forecast/scanplot.py (sunsao1.jpg 663x450, sunsao0.jpg 221x150): the forecast picture of
// a RATAN-600 scan, drawn in the browser from a level2 FITS. Same window, scales, colours, line styles and layout;
// the labels use a browser font instead of the Hershey vector font of the Python version.
import { value } from './fits.js';

const KNOTS = [[7, 4, 8], [0, 0, 29], [1, 0, 47], [1, 0, 69], [2, 2, 90], [2, 1, 111], [1, 1, 128], [1, 0, 151], [1, 0, 171], [1, 0, 193], [9, 9, 210], [0, 1, 237], [7, 1, 248], [27, 1, 237], [46, 0, 212], [66, 1, 188], [79, 2, 171], [82, 1, 146], [80, 1, 127], [81, 0, 105], [90, 0, 83], [111, 8, 68], [128, 1, 43], [148, 1, 18], [170, 0, 4], [190, 1, 1], [209, 2, 2], [234, 1, 2], [251, 3, 1], [253, 20, 1], [252, 40, 2], [251, 62, 4], [251, 87, 12], [254, 103, 24], [254, 120, 40], [253, 141, 59], [253, 158, 76], [251, 165, 62], [251, 163, 36], [252, 163, 19], [251, 164, 4], [239, 162, 2], [210, 162, 4], [175, 162, 6], [172, 166, 2], [196, 189, 13], [213, 210, 24], [235, 236, 39], [251, 253, 51], [254, 254, 64], [255, 254, 78], [255, 255, 89], [254, 254, 100], [254, 254, 118], [254, 254, 127], [255, 254, 141], [255, 254, 152], [255, 255, 165], [255, 254, 179], [255, 254, 193], [255, 255, 203], [255, 255, 216], [255, 254, 230], [254, 254, 243], [253, 253, 249]];

export function palette(i) {
  i = Math.min(Math.max(i, 0), 255);
  const k = Math.min(Math.floor(i / 4), 63), t = Math.min((i - k * 4) / 4, 1);
  const a = KNOTS[k], b = KNOTS[Math.min(k + 1, 64)];
  return 'rgb(' + [0, 1, 2].map(c => Math.round(a[c] + (b[c] - a[c]) * t)).join(',') + ')';
}

export function channelIndex(f) { return ((256 - (f - 3) * 16) % 256 + 256) % 256; }

// matplotlib MaxNLocator(nbins), steps [1, 2, 2.5, 5, 10]
function ticks(lo, hi, nbins) {
  const raw = (hi - lo) / nbins, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  let step = 10 * mag;
  for (const s of [1, 2, 2.5, 5, 10]) if (s * mag >= raw) { step = s * mag; break; }
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9 * step; v += step) out.push(v);
  return out;
}

const PT = 100 / 72;      // matplotlib points -> pixels at dpi 100

export function render(scan, { big = true, robust = false, guides = false, lineScale = 1 } = {}) {
  const [W, H] = big ? [663, 450] : [221, 150];
  const sel = scan.freq.map((f, i) => f >= 3.0 ? i : -1).filter(i => i >= 0);
  if (!sel.length) throw new Error('no channels ≥3 GHz');
  const freq = sel.map(i => scan.freq[i]), tq = sel.map(i => scan.tqsun[i]);
  const rx = Math.round(scan.solarR / scan.cdelt1);
  const x1 = Math.max(Math.round(scan.crpix1 - 2 * rx), 0);
  const x2 = Math.min(x1 + 4 * rx, scan.nX - 1);
  const cent = Math.min(scan.crpix1, 2 * rx);
  const n = x2 - x1 + 1;
  const x = Array.from({ length: n }, (_, k) => (k - cent) * scan.cdelt1);
  const I = sel.map(c => Array.from({ length: n }, (_, k) => value(scan, c, 0, x1 + k)));
  const V = sel.map(c => Array.from({ length: n }, (_, k) => value(scan, c, 1, x1 + k)));
  let m1 = Infinity, m2 = -Infinity, vmin = Infinity;
  for (const r of I) for (const v of r) { m1 = Math.min(m1, v); m2 = Math.max(m2, v); }
  for (const r of V) for (const v of r) vmin = Math.min(vmin, v);
  if (robust) {
    const all = I.flat().sort((a, b) => a - b);
    m2 = Math.max(1.25 * Math.max(...tq), all[Math.floor(0.999 * (all.length - 1))]);
    m1 = Math.min(0, m1);
  }
  const yv = [Math.min(-2000, vmin), m2 - 2000];

  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  const L = 2, R = big ? 659 : 218, T = big ? 2 : 1, B = big ? 448 : 148;
  const X = v => L + (v - x[0]) / (x[n - 1] - x[0]) * (R - L);
  const Yi = v => B - (v - m1) / (m2 - m1) * (B - T);
  const Yv = v => B - (v - yv[0]) / (yv[1] - yv[0]) * (B - T);
  const lw = (big ? 0.8 : 0.6) * PT * lineScale;

  g.save();
  g.beginPath(); g.rect(L, T, R - L, B - T); g.clip();
  const line = (ys, Y, color, dash, xs = x) => {
    g.strokeStyle = color; g.lineWidth = lw; g.lineJoin = 'round';
    g.setLineDash(dash ? dash.map(d => d * lw) : []);
    g.beginPath();
    xs.forEach((xx, k) => k ? g.lineTo(X(xx), Y(ys[k])) : g.moveTo(X(xx), Y(ys[k])));
    g.stroke();
  };
  I.forEach((r, i) => line(r, Yi, palette(channelIndex(freq[i]))));
  line(I[0], Yi, '#fff');
  const xh = x.slice(0, Math.floor(n / 2) + 1);
  for (const q of [tq[0], tq[tq.length - 1]]) line(xh.map(() => q), Yi, '#fff', [5, 3], xh);
  const dd = [6, 2, 1, 2, 1, 2, 1, 2];
  V.forEach((r, i) => line(r, Yv, palette(channelIndex(freq[i])), dd));
  line(V[0], Yv, '#fff', dd);
  g.restore();

  // optional: limbs and centre of the disk (not on the forecast picture itself)
  if (guides) {
    g.save(); g.lineWidth = 1.2;
    for (const [v, lab] of [[-scan.solarR, '−R☉'], [0, 'centre'], [scan.solarR, '+R☉']]) {
      if (v < x[0] || v > x[n - 1]) continue;
      g.setLineDash(v === 0 ? [7, 4] : [4, 4]); g.strokeStyle = 'rgba(125,211,252,0.85)';
      g.beginPath(); g.moveTo(X(v), T); g.lineTo(X(v), B); g.stroke();
      g.setLineDash([]); g.fillStyle = 'rgba(125,211,252,0.95)'; g.font = (big ? 12 : 9) + 'px Inter, sans-serif'; g.textAlign = 'center';
      g.fillText(lab, X(v), big ? B - 6 : B - 3);
    }
    g.restore();
  }
  // frame and inward ticks on all four sides
  g.setLineDash([]); g.strokeStyle = '#fff'; g.lineWidth = 1 * PT;
  g.strokeRect(L, T, R - L, B - T);
  const tl = (big ? 4 : 2) * PT;
  g.lineWidth = 0.8 * PT;
  g.beginPath();
  for (const v of ticks(x[0], x[n - 1], big ? 8 : 4)) { const p = X(v); g.moveTo(p, B); g.lineTo(p, B - tl); g.moveTo(p, T); g.lineTo(p, T + tl); }
  for (const v of ticks(m1, m2, big ? 10 : 5)) { const p = Yi(v); g.moveTo(L, p); g.lineTo(L + tl, p); g.moveTo(R, p); g.lineTo(R - tl, p); }
  g.stroke();

  // labels
  g.fillStyle = '#fff'; g.textBaseline = 'alphabetic';
  const big1 = big ? '25px "Helvetica Neue", Arial, sans-serif' : '16px "Helvetica Neue", Arial, sans-serif';
  g.font = big1;
  g.fillText('I', X(x[50]), Yi(tq[0] * 1.1));
  g.fillText('V', X(x[50]), Yv(300));
  if (big) {
    g.font = '12px "Helvetica Neue", Arial, sans-serif';
    const [y, mo, d] = scan.obs.date.split('-');
    g.fillText(`${y}/${mo}/${d} ${scan.obs.time.slice(0, 5)}UT`, 24, 22);
    g.fillText('RATAN-600 Stokes I&V', 24, 38);
    g.fillText(`${sel.length} channels`, 24, 54);
    g.fillText('Quiet Sun level', X(x[50]), Yi(tq[tq.length - 1] * 1.1));
    g.save(); g.translate(581, 229); g.rotate(-Math.PI / 2); g.textAlign = 'center';
    g.fillText(`Wavelength, ${(30 / freq[freq.length - 1]).toFixed(1).padStart(4)} cm  -\u200C-\u200C-\u200C-\u200C>  ${(30 / freq[0]).toFixed(1).padStart(4)} cm`, 0, 5);
    g.restore();
    const bx = 609, bw = 19, by = 406 - 355, bh = 355;
    for (let k = 0; k < bh; k++) { g.fillStyle = palette(255 - (k / bh) * 256); g.fillRect(bx, by + k, bw, 1); }
    g.strokeStyle = '#fff'; g.lineWidth = 1 * PT; g.strokeRect(bx, by, bw, bh);
  }
  return cv;
}
