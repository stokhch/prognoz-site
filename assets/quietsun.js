// Quiet-Sun template fit for RATAN-600 level2 scans, after WorkScanJ (calib/QuietSunTemplateFit, docs/QUIET_SUN_AUTO.md).
//
// Model of one channel: a disk of radius rho*R_sun with limb brightening 1 + L*(r/rho R)^3, projected through the
// vertical beam (gaussian, theta_v) and smoothed by the horizontal beam (gaussian, theta_h):
//     T(x) = A * S(x - dx) + sky(x),      S(0) = 1  (A is the level at the disk centre, comparable with TQSUN)
// The sky is a straight lower-envelope line through the points beyond 1.4 R (step "sky -> 0" of WorkScanJ).
// The fit follows the lower envelope: points above the model (active regions) are rejected iteratively.
// Laws across frequency (nu in GHz, lambda in mm): rho = a + k/nu (k >= 0), theta_h = beta + gamma*lambda;
// theta_v = sqrt((kv*0.63*lambda' * sin50 / sin h)^2 + floor^2) with the WorkScanJ physical template of the new
// 3-18 GHz spectrometer (scan 2026-03-22): kv = 1.36, floor = 15.4', limb 4 %; it is the starting point.
import { value } from './fits.js';

export const START = { a: 1.016, k: 0.444, beta: 0.12, gamma: 0.946, kv: 1.36, floor: 15.4, limb: 0.04 };
const FINE = 4;            // arcsec, step of the fine profile grid

export function thetaV(f, altDeg, p = START) {            // arcsec
  const lam = 300 / f, h = Math.max(5, altDeg || 47) * Math.PI / 180;
  const g = p.kv * 0.63 * lam * Math.sin(50 * Math.PI / 180) / Math.sin(h);
  return 60 * Math.hypot(g, p.floor);
}
export const thetaH0 = (f, p = START) => p.beta + p.gamma * 300 / f;   // arcsec
export const rho0 = (f, p = START) => p.a + p.k / f;

// normalised profile S on the fine grid u = -U..U, for disk radius Rr, beams th (horizontal) and tv (vertical), arcsec
function profile(Rr, th, tv, limb, U) {
  const n = Math.round(2 * U / FINE) + 1, P = new Float64Array(n);
  const ny = 80, dy = 2 * Rr / ny, c = 4 * Math.LN2 / (tv * tv);
  for (let i = 0; i < n; i++) {
    const u = -U + i * FINE;
    if (Math.abs(u) >= Rr) continue;
    const ymax = Math.sqrt(Rr * Rr - u * u);
    let s = 0;
    for (let j = 0; j < ny; j++) {
      const y = -Rr + (j + 0.5) * dy;
      if (Math.abs(y) > ymax) continue;
      const r = Math.sqrt(u * u + y * y) / Rr;
      s += (1 + limb * r * r * r) * Math.exp(-c * y * y);
    }
    P[i] = s * dy;
  }
  const sg = th / 2.3548 / FINE, half = Math.ceil(3 * sg), K = [];
  let ks = 0;
  for (let k = -half; k <= half; k++) { const w = Math.exp(-0.5 * (k / sg) ** 2); K.push(w); ks += w; }
  const S = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = -half; k <= half; k++) { const j = i + k; if (j >= 0 && j < n) s += P[j] * K[k + half]; }
    S[i] = s / ks;
  }
  const mid = S[(n - 1) >> 1] || 1;
  for (let i = 0; i < n; i++) S[i] /= mid;
  return { S, U };
}

function sample(prof, x) {          // linear interpolation of the fine profile at x (arcsec from the centre)
  const t = (x + prof.U) / FINE, i = Math.floor(t);
  if (i < 0 || i >= prof.S.length - 1) return 0;
  return prof.S[i] + (prof.S[i + 1] - prof.S[i]) * (t - i);
}

// Lower-envelope linear fit y ~ A*m + c by asymmetric least squares (Eilers' baseline weighting): a point above
// the model (an active region) gets weight P, a point below it weight 1 - P, so the model is pushed under the scan
// but must follow the quiet parts, above all the steep limbs. Returns {A, c, rms, kept, loss}.
const P = 0.01;

// sky baseline: straight line under all points farther than 1.4 R from the centre (asymmetric LS as well)
function skyLine(x, y, R) {
  const idx = x.map((v, i) => Math.abs(v) > 1.4 * R && Number.isFinite(y[i]) ? i : -1).filter(i => i >= 0);
  if (idx.length < 10) return x.map(() => 0);
  let w = idx.map(() => 1), p0 = 0, p1 = 0;
  for (let it = 0; it < 10; it++) {
    let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    idx.forEach((i, k) => { const ww = w[k]; sw += ww; sx += ww * x[i]; sy += ww * y[i]; sxx += ww * x[i] * x[i]; sxy += ww * x[i] * y[i]; });
    const det = sw * sxx - sx * sx;
    if (Math.abs(det) < 1e-9) break;
    p1 = (sw * sxy - sx * sy) / det; p0 = (sy - p1 * sx) / sw;
    w = idx.map(i => (y[i] - p0 - p1 * x[i]) > 0 ? P : 1 - P);
  }
  return x.map(v => p0 + p1 * v);
}

// amplitude only, over a fixed sky line
function amplitudeFit(y, m, sky) {
  const n = y.length;
  let w = y.map(v => Number.isFinite(v) ? 1 : 0), A = 1;
  for (let it = 0; it < 12; it++) {
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) if (w[i]) { num += w[i] * m[i] * (y[i] - sky[i]); den += w[i] * m[i] * m[i]; }
    if (den <= 0) break;
    const A2 = num / den, done = Math.abs(A2 - A) < 1e-4 * Math.abs(A2) && it > 2;
    A = A2;
    w = y.map((v, i) => !Number.isFinite(v) ? 0 : (v - A * m[i] - sky[i]) > 0 ? P : 1 - P);
    if (done) break;
  }
  let loss = 0, ss = 0, k = 0, cnt = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(y[i])) continue;
    const r = y[i] - A * m[i] - sky[i]; cnt++;
    loss += (r > 0 ? P : 1 - P) * r * r;
    if (r < 0.05 * Math.abs(A)) { ss += r * r; k++; }
  }
  return { A, rms: Math.sqrt(ss / Math.max(1, k)), kept: k / Math.max(1, cnt), loss: loss / Math.max(1, cnt) };
}

function envelopeFit(y, m) {
  const n = y.length;
  let w = y.map(v => Number.isFinite(v) ? 1 : 0), A = 1, c = 0;
  for (let it = 0; it < 12; it++) {
    let sw = 0, sm = 0, sy = 0, smm = 0, smy = 0;
    for (let i = 0; i < n; i++) if (w[i]) { sw += w[i]; sm += w[i] * m[i]; sy += w[i] * y[i]; smm += w[i] * m[i] * m[i]; smy += w[i] * m[i] * y[i]; }
    const det = sw * smm - sm * sm;
    if (Math.abs(det) < 1e-12) break;
    const A2 = (sw * smy - sm * sy) / det, c2 = (sy - A2 * sm) / sw;
    const done = Math.abs(A2 - A) < 1e-4 * Math.abs(A2) && it > 2;
    A = A2; c = c2;
    w = y.map((v, i) => !Number.isFinite(v) ? 0 : (v - A * m[i] - c) > 0 ? P : 1 - P);
    if (done) break;
  }
  let loss = 0, ss = 0, k = 0, cnt = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(y[i])) continue;
    const r = y[i] - A * m[i] - c; cnt++;
    loss += (r > 0 ? P : 1 - P) * r * r;
    if (r < 0.05 * Math.abs(A)) { ss += r * r; k++; }
  }
  return { A, c, rms: Math.sqrt(ss / Math.max(1, k)), kept: k / Math.max(1, cnt), loss: loss / Math.max(1, cnt) };
}

function data(s, ch, maxN = 500) {
  const R = s.solarR, rx = R / s.cdelt1;
  const i1 = Math.max(0, Math.round(s.crpix1 - 2 * rx)), i2 = Math.min(s.nX - 1, Math.round(s.crpix1 + 2 * rx));
  const k = Math.max(1, Math.ceil((i2 - i1 + 1) / maxN)), x = [], y = [];
  for (let i = i1; i <= i2; i += k) { x.push((i - s.crpix1) * s.cdelt1); y.push(value(s, ch, 0, i)); }
  return { x, y };
}

function fitChannel(s, ch, rho, th, dxList) {
  const f = s.freq[ch], R = s.solarR, d = data(s, ch);
  const prof = profile(rho * R, th, thetaV(f, s.header.ALTITUDE), START.limb, 2.4 * R);
  const sky = skyLine(d.x, d.y, R);
  let best = null;
  for (const dx of dxList) {
    const m = d.x.map(x => sample(prof, x - dx));
    const r = amplitudeFit(d.y, m, sky);
    const score = Math.sqrt(r.loss) / Math.max(1e-6, Math.abs(r.A));
    if (!best || score < best.score) best = { ...r, dx, score, rho, th, prof, sky: lineOf(d.x, sky) };
  }
  return best;
}

function lineOf(x, sky) { const n = x.length - 1; const q = n > 0 ? (sky[n] - sky[0]) / (x[n] - x[0]) : 0; return { p0: sky[0] - q * x[0], p1: q }; }

function range(a, b, st) { const o = []; for (let v = a; v <= b + 1e-9; v += st) o.push(+v.toFixed(6)); return o; }

// weighted least squares y = p + q*t
function line(t, y) {
  const n = t.length, mt = t.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (t[i] - mt) * (y[i] - my); sxx += (t[i] - mt) ** 2; }
  const q = sxx > 0 ? sxy / sxx : 0;
  return { p: my - q * mt, q };
}

// Full fit: reference channels -> laws -> every channel. Result is cached on the scan object.
export function fitQuietSun(s) {
  if (s._qs) return s._qs;
  const n = s.nChan, nRef = Math.min(12, n);
  const ref = Array.from({ length: nRef }, (_, k) => Math.round(k * (n - 1) / Math.max(1, nRef - 1)));
  // 1) centre offset with the starting laws
  const dxs = ref.map(c => fitChannel(s, c, rho0(s.freq[c]), thetaH0(s.freq[c]), range(-30, 30, 3)).dx).sort((a, b) => a - b);
  const dx0 = dxs[dxs.length >> 1];
  // 2) free radius and horizontal beam on the reference channels
  const fr = [];
  for (const c of ref) {
    const f = s.freq[c], th0 = thetaH0(f);
    let best = null;
    for (const rho of range(0.97, 1.15, 0.01)) for (const kth of range(0.6, 1.6, 0.1)) {
      const r = fitChannel(s, c, rho, th0 * kth, [dx0]);
      if (!best || r.score < best.score) best = r;
    }
    fr.push({ c, f, rho: best.rho, th: best.th, score: best.score });
  }
  // 3) laws: rho = a + k/nu (k >= 0), theta_h = beta + gamma*lambda
  let L1 = line(fr.map(r => 1 / r.f), fr.map(r => r.rho));
  if (L1.q < 0) L1 = { p: fr.reduce((a, r) => a + r.rho, 0) / fr.length, q: 0 };
  // keep the radius law inside the searched range at the band edges
  const fmin = Math.min(...s.freq), fmax = Math.max(...s.freq);
  if (L1.p + L1.q / fmin > 1.2) { L1.q = Math.max(0, (1.2 - L1.p) * fmin); }
  const L2 = line(fr.map(r => 300 / r.f), fr.map(r => r.th));
  const law = { a: L1.p, k: L1.q, beta: L2.p, gamma: L2.q > 0 ? L2.q : START.gamma, dx: dx0 };
  if (L2.q <= 0) law.beta = fr.reduce((a, r) => a + r.th - START.gamma * 300 / r.f, 0) / fr.length;
  // 4) every channel with the laws; small per-channel refinement of the centre
  const ch = [];
  for (let c = 0; c < n; c++) {
    const f = s.freq[c];
    const r = fitChannel(s, c, law.a + law.k / f, law.beta + law.gamma * 300 / f, range(dx0 - 6, dx0 + 6, 2));
    ch.push({ f, A: r.A, sky: r.sky, dx: r.dx, rho: r.rho, th: r.th, tv: thetaV(f, s.header.ALTITUDE), kept: r.kept, rms: r.rms, prof: r.prof, tq: s.tqsun[c] });
  }
  s._qs = { law, ref: fr, ch };
  return s._qs;
}

// template of channel c on arcsec grid x. level: 'fit' (A, c of the fit), 'tq' (centre = TQSUN, sky 0),
// 'touch' (fitted shape and amplitude lowered until it touches the scan from below on the disk)
export function template(s, c, x, level = 'fit', y = null) {
  const q = fitQuietSun(s).ch[c];
  const m = x.map(xx => sample(q.prof, xx - q.dx));
  if (level === 'tq') return m.map(v => q.tq * v);
  const t = m.map((v, i) => q.A * v + q.sky.p0 + q.sky.p1 * x[i]);
  if (level === 'touch' && y) {
    let d = Infinity;
    x.forEach((xx, i) => { if (Math.abs(xx) < s.solarR && Number.isFinite(y[i])) d = Math.min(d, y[i] - t[i]); });
    if (Number.isFinite(d)) return t.map(v => v + d);
  }
  return t;
}
