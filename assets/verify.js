// Forecast verification: contingency table and skill scores (pure functions, no DOM; tested in tests/).
//
// A day is a forecast of "a flare of at least the threshold class within the window after the day"
// (window_h in data/history/<year>.json, 12..84 h). Days labelled "no data" are not forecasts and are skipped.
// "yes" means the label is positive; with withUnsure also positive?.

// GOES class -> peak flux, W/m^2: "M1.2" -> 1.2e-5
export function classFlux(c) {
  const m = /^([ABCMX])\s*(\d+(?:\.\d+)?)?/i.exec(String(c || '').trim());
  if (!m) return NaN;
  const base = { A: 1e-8, B: 1e-7, C: 1e-6, M: 1e-5, X: 1e-4 }[m[1].toUpperCase()];
  return base * (m[2] ? parseFloat(m[2]) : 1);
}

export function isYes(label, withUnsure = false) {
  return label === 'positive' || (withUnsure && label === 'positive?');
}

// strongest flare of a day record (its "flares" list), or null
export function maxFlare(day) {
  let best = null;
  for (const f of day.flares || []) if (!best || classFlux(f.class) > classFlux(best.class)) best = f;
  return best;
}

export function hadEvent(day, threshold = 'M1') {
  const t = classFlux(threshold);
  return (day.flares || []).some(f => classFlux(f.class) >= t);
}

// -> {a: hits, b: false alarms, c: misses, d: correct negatives, n, skipped}
export function contingency(days, { threshold = 'M1', withUnsure = false } = {}) {
  const t = { a: 0, b: 0, c: 0, d: 0, n: 0, skipped: 0 };
  for (const day of days) {
    if (!day || day.label === 'no data' || !day.label) { t.skipped++; continue; }
    const yes = isYes(day.label, withUnsure), ev = hadEvent(day, threshold);
    if (yes && ev) t.a++; else if (yes) t.b++; else if (ev) t.c++; else t.d++;
    t.n++;
  }
  return t;
}

const div = (p, q) => (q > 0 ? p / q : NaN);

// POD (probability of detection), FAR (false alarm ratio), POFD, TSS (Hanssen-Kuipers), HSS (Heidke),
// accuracy, base rate; NaN where a denominator is zero.
export function scores({ a, b, c, d }) {
  const n = a + b + c + d;
  const pod = div(a, a + c), pofd = div(b, b + d);
  const exp = div((a + c) * (a + b) + (b + d) * (c + d), n);
  return {
    pod, far: div(b, a + b), pofd,
    tss: pod - pofd,
    hss: div(a + d - exp, n - exp),
    acc: div(a + d, n),
    base: div(a + c, n),
    // relative frequency of the event after "yes" and after "no" forecasts
    pYes: div(a, a + b), pNo: div(c, c + d),
  };
}

// standard error of TSS (Hanssen & Kuipers 1965, as used for flare forecasts by Bloomfield et al. 2012)
export function tssError({ a, b, c, d }) {
  const h = div(a, a + c), f = div(b, b + d);
  return Math.sqrt(div(h * (1 - h), a + c) + div(f * (1 - f), b + d));
}

// group day records by month: {"YYYY-MM": [days]}
export function byMonth(days) {
  const m = {};
  for (const d of days) (m[d.day.slice(0, 7)] ||= []).push(d);
  return m;
}
