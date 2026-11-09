// Reading the RATAN-600 archive tree over HTTP from Apache autoindex pages, the way sunview does it
// (remote_catalog.py): collect <a href>, drop the parent, sort links, other levels and other hosts; a name
// ending with '/' is a directory. Listings are cached in sessionStorage for a few minutes.

const TTL_MS = 5 * 60 * 1000;

export function normalizeHref(href, baseUrl, currentUrl) {
  const clean = href.split('?')[0].split('#')[0].trim();
  if (!clean || clean === './' || clean === '../' || clean === '/') return null;
  let absolute;
  try { absolute = new URL(clean, currentUrl).href; } catch (e) { return null; }
  if (!absolute.startsWith(baseUrl)) return null;
  if (!absolute.startsWith(currentUrl)) return null;
  const rel = absolute.slice(currentUrl.length);
  if (!rel || rel.replace(/\/$/, '').includes('/')) return null;
  return decodeURIComponent(rel);
}

export async function listLevel(baseUrl, url) {
  const key = 'ls:' + url;
  try {
    const c = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (c && Date.now() - c.t < TTL_MS) return c.v;
  } catch (e) { /* storage may be unavailable */ }
  const r = await fetch(url, { cache: 'no-cache', signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(url + ': HTTP ' + r.status);
  const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
  const dirs = new Set(), files = new Set();
  for (const a of doc.querySelectorAll('a[href]')) {
    const rel = normalizeHref(a.getAttribute('href'), baseUrl, url);
    if (rel === null) continue;
    (rel.endsWith('/') ? dirs : files).add(rel);
  }
  const v = { dirs: [...dirs].sort(), files: [...files].sort() };
  try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), v })); } catch (e) { /* ignore */ }
  return v;
}

// 20261106_115716_sun0_out.fits -> {day: '2026-11-06', time: '11:57:16', tag: 'sun0'} (time as in the name: local)
export function parseName(name) {
  const m = name.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_([^_]+)_out\.fits$/i);
  return m ? { day: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}:${m[6]}`, tag: m[7] } : null;
}

// Archive sources, tried in order: the server itself (when the site is served from it), the list in
// data/config.json ("archives": [{name, url}], e.g. an https address on solar.sao.ru), and the copy shipped
// with the site. A remote archive needs Apache autoindex and, for another site, https and CORS.
export async function sources() {
  const local = { name: 'site copy (real scan 06.11.2026)', url: new URL('data/ratan/', location.href).href };
  let cfg = {};
  try { const r = await fetch('data/config.json', { cache: 'no-cache' }); if (r.ok) cfg = await r.json(); } catch (e) { /* no config */ }
  const remote = [];
  if (location.hostname === 'spbf.sao.ru') remote.push({ name: 'spbf.sao.ru', url: location.origin + '/data/ratan/' });
  for (const a of cfg.archives || []) if (a && a.url) remote.push({ name: a.name || a.url, url: a.url.endsWith('/') ? a.url : a.url + '/' });
  // while the real archive is not reachable from the browser, the copy shipped with the site goes first
  return cfg.prefer === 'remote' ? [...remote, local] : [local, ...remote];
}

export async function openArchive() {
  const errors = [];
  for (const s of await sources()) {
    try {
      const top = await listLevel(s.url, s.url);
      if (top.dirs.length || top.files.length) return { ...s, top, errors };
      errors.push(s.url + ': empty listing');
    } catch (e) { errors.push(s.url + ': ' + (e.message || e)); }
  }
  throw new Error('archive unavailable — ' + errors.join('; '));
}
