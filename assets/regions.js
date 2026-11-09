// NOAA active regions for a scan: positions from the SRS of the day (valid 00 UT), turned by differential rotation
// to the observation time, and projected onto the disk and onto the scan axis.
// Sources, in order: data/regions/<YYYY-MM-DD>.json written by tools/make_site_data.py (array of
// {noaa, location, area, mag}), then the SWPC list https://services.swpc.noaa.gov/json/solar_regions.json.

const cache = new Map();

export function parseLocation(loc) {
  const m = String(loc || '').toUpperCase().match(/([NS])(\d{1,2})([EW])(\d{1,3})/);
  if (!m) return null;
  return { lat: (m[1] === 'N' ? 1 : -1) * +m[2], lon: (m[3] === 'W' ? 1 : -1) * +m[4] };
}

async function fromLocal(date) {
  const r = await fetch('data/regions/' + date + '.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error('нет файла');
  return { list: await r.json(), source: 'сводка NOAA (копия на сайте)' };
}

async function fromSwpc(date) {
  const r = await fetch('https://services.swpc.noaa.gov/json/solar_regions.json', { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const all = await r.json();
  // the day of the scan, else the closest earlier day within 2 days
  const days = [...new Set(all.map(x => String(x.observed_date || '').slice(0, 10)))].filter(d => d && d <= date).sort();
  const day = days.reverse().find(d => (new Date(date) - new Date(d)) / 864e5 <= 2);
  if (!day) throw new Error('в списке SWPC нет сводки за ' + date);
  const list = all.filter(x => String(x.observed_date || '').slice(0, 10) === day)
    .map(x => ({ noaa: x.region, location: x.location, area: x.area, mag: x.mag_class, day }));
  return { list, source: 'NOAA SWPC, сводка ' + day };
}

// -> {regions: [{noaa, lat, lon, area, mag}], source} with longitudes rotated to the observation time
export function regionsFor(date, timeUT) {
  const key = date + ' ' + timeUT;
  if (cache.has(key)) return cache.get(key);
  const pr = (async () => {
    let got = null, errs = [];
    for (const f of [fromLocal, fromSwpc]) {
      try { got = await f(date); break; } catch (e) { errs.push(e.message || String(e)); }
    }
    if (!got) throw new Error('активные области не найдены: ' + errs.join('; '));
    const [h, m] = timeUT.split(':').map(Number);
    return {
      source: got.source,
      regions: got.list.map(r => {
        const p = parseLocation(r.location);
        if (!p) return null;
        const day0 = r.day || date;
        const dt = (new Date(date + 'T00:00:00Z') - new Date(day0 + 'T00:00:00Z')) / 864e5 + (h + m / 60) / 24;
        const s2 = Math.sin(p.lat * Math.PI / 180) ** 2;
        const rate = 13.45 - 2.3 * s2;                           // synodic differential rotation, deg/day
        return { noaa: r.noaa, lat: p.lat, lon: p.lon + rate * dt, area: r.area, mag: r.mag };
      }).filter(Boolean)
    };
  })();
  pr.catch(() => cache.delete(key));
  cache.set(key, pr);
  return pr;
}

// heliographic (lat, lon from the central meridian, deg) -> {x, y, z} on the disk of radius R, solar north up,
// west to the right (y up); z < 0 is the far side
export function projectHelio(lat, lon, B0deg, R) {
  const d = Math.PI / 180, la = lat * d, lo = lon * d, B0 = B0deg * d;
  return {
    x: R * Math.cos(la) * Math.sin(lo),
    y: R * (Math.sin(la) * Math.cos(B0) - Math.cos(la) * Math.sin(B0) * Math.cos(lo)),
    z: Math.sin(la) * Math.sin(B0) + Math.cos(la) * Math.cos(B0) * Math.cos(lo)
  };
}

// position on the scan (arcsec, + west) of a point (x west, y north, arcsec, solar frame): turn by P + q into the
// celestial frame, then x_scan = u - v*tan(q) (sunview geometry); flip mirrors the scan
export function scanX(p, turnDeg, qDeg, flip) {
  const t = turnDeg * Math.PI / 180;
  const u = p.x * Math.cos(t) - p.y * Math.sin(t);          // west
  const v = p.x * Math.sin(t) + p.y * Math.cos(t);          // north
  return (flip ? -1 : 1) * u - v * Math.tan(qDeg * Math.PI / 180);   // same mapping as sunOverlay in views.js
}
