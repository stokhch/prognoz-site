// GOES X-ray flux of a day (1-minute, both channels: long 0.1-0.8 nm and short 0.05-0.4 nm).
// Sources, in order: data/goes/<YYYY-MM-DD>.json written by tools/make_site_data.py --goes
// ({source, long: [[minute, flux], ...], short: [...]}), then the SWPC 7-day list
// https://services.swpc.noaa.gov/json/goes/primary/xrays-7-day.json (keeps only the last week).

const cache = new Map();

async function fromLocal(date) {
  const r = await fetch('data/goes/' + date + '.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error('no file');
  const j = await r.json();
  return { long: j.long, short: j.short, source: j.source || 'GOES (local copy)' };
}

async function fromSwpc(date) {
  const r = await fetch('https://services.swpc.noaa.gov/json/goes/primary/xrays-7-day.json', { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const all = await r.json(), long = [], short = [];
  let sat = '';
  for (const x of all) {
    const t = String(x.time_tag || '');
    if (t.slice(0, 10) !== date || !(x.flux > 0)) continue;
    const m = +t.slice(11, 13) * 60 + +t.slice(14, 16);
    (String(x.energy).startsWith('0.1') ? long : short).push([m, x.flux]);
    sat = x.satellite || sat;
  }
  if (!long.length) throw new Error('SWPC keeps the last 7 days only');
  return { long, short, source: 'NOAA SWPC, GOES-' + sat };
}

// -> {long, short: [[minute of day UT, W/m^2]], source}
export function goesFor(date) {
  if (cache.has(date)) return cache.get(date);
  const pr = (async () => {
    const errs = [];
    for (const f of [fromLocal, fromSwpc]) {
      try { return await f(date); } catch (e) { errs.push(e.message || String(e)); }
    }
    throw new Error('no GOES data: ' + errs.join('; '));
  })();
  cache.set(date, pr);
  pr.catch(() => cache.delete(date));
  return pr;
}

// flare class of a flux, e.g. 3.2e-6 -> "C3.2"
export function flareClass(f) {
  const k = ['A', 'B', 'C', 'M', 'X'], e = Math.floor(Math.log10(f)), i = Math.max(0, Math.min(4, e + 8));
  return k[i] + (f / Math.pow(10, i - 8)).toFixed(1);
}
