// Minimal FITS reader for RATAN-600 level2 scans (*_out.fits): primary float array (n_chan, 2, n_x)
// and the binary table extension 'Scan_params' (FREQ, TQSUN, ...). Mirrors ratan_forecast.level2.read_level2.

const BLOCK = 2880;

function readHeader(buf, pos) {
  const dec = new TextDecoder('ascii');
  const h = {};
  for (;;) {
    if (pos + BLOCK > buf.byteLength) throw new Error('FITS: header is cut');
    const block = dec.decode(new Uint8Array(buf, pos, BLOCK));
    pos += BLOCK;
    for (let i = 0; i < 36; i++) {
      const card = block.slice(i * 80, i * 80 + 80);
      const key = card.slice(0, 8).trim();
      if (key === 'END') return { h, pos };
      if (card[8] !== '=') continue;
      let v = card.slice(10).trim();
      if (v.startsWith("'")) {
        const m = v.match(/^'((?:[^']|'')*)'/);
        h[key] = m ? m[1].replace(/''/g, "'").trim() : '';
      } else {
        v = v.split('/')[0].trim();
        if (v === 'T' || v === 'F') h[key] = v === 'T';
        else if (v !== '' && !isNaN(Number(v.replace(/D/i, 'E')))) h[key] = Number(v.replace(/D/i, 'E'));
        else h[key] = v;
      }
    }
  }
}

function dataBytes(h) {
  const n = h.NAXIS || 0;
  if (!n) return 0;
  let size = Math.abs(h.BITPIX) / 8;
  for (let i = 1; i <= n; i++) size *= h['NAXIS' + i];
  return size * (h.GCOUNT || 1) + (h.PCOUNT || 0);
}

function pad(n) { return Math.ceil(n / BLOCK) * BLOCK; }

const TFORM = { L: 1, B: 1, I: 2, J: 4, K: 8, A: 1, E: 4, D: 8 };

function readTable(buf, pos, h) {
  const view = new DataView(buf, pos);
  const rowLen = h.NAXIS1, nRows = h.NAXIS2, cols = {};
  let off = 0;
  for (let c = 1; c <= h.TFIELDS; c++) {
    const name = String(h['TTYPE' + c] || 'COL' + c).trim().toLowerCase();
    const m = String(h['TFORM' + c]).trim().match(/^(\d*)([LBIJKAED])/i);
    if (!m) throw new Error('FITS: unknown TFORM ' + h['TFORM' + c]);
    const rep = m[1] === '' ? 1 : +m[1], t = m[2].toUpperCase(), w = TFORM[t];
    const out = [];
    for (let r = 0; r < nRows; r++) {
      const p = r * rowLen + off;
      if (t === 'A') { out.push(new TextDecoder('ascii').decode(new Uint8Array(buf, pos + p, rep)).trim()); continue; }
      const get = k => {
        const q = p + k * w;
        return t === 'E' ? view.getFloat32(q) : t === 'D' ? view.getFloat64(q) : t === 'I' ? view.getInt16(q)
          : t === 'J' ? view.getInt32(q) : t === 'K' ? Number(view.getBigInt64(q)) : view.getUint8(q);
      };
      out.push(rep === 1 ? get(0) : Array.from({ length: rep }, (_, k) => get(k)));
    }
    cols[name] = out;
    off += rep * w;
  }
  return cols;
}

function readImage(buf, pos, h) {
  const n = dataBytes(h) / (Math.abs(h.BITPIX) / 8), view = new DataView(buf, pos);
  const out = new Float32Array(n), bz = h.BZERO || 0, bs = h.BSCALE || 1;
  for (let i = 0; i < n; i++) {
    let v;
    switch (h.BITPIX) {
      case -32: v = view.getFloat32(i * 4); break;
      case -64: v = view.getFloat64(i * 8); break;
      case 16: v = view.getInt16(i * 2); break;
      case 32: v = view.getInt32(i * 4); break;
      default: throw new Error('FITS: BITPIX ' + h.BITPIX);
    }
    out[i] = v * bs + bz;
  }
  return out;
}

function obsTime(h) {
  const d = String(h['DATE-OBS'] || '').replace(/\//g, '-');
  const t = String(h['TIME-OBS'] || '00:00:00');
  return { date: d.slice(0, 10), time: t.slice(0, 8) };
}

// -> {obs:{date,time}, header, nChan, nX, data:Float32Array (chan, 2, x), freq[], tqsun[], crpix1, cdelt1, solarR, az}
export function readLevel2(buf) {
  let { h, pos } = readHeader(buf, 0);
  if (h.NAXIS !== 3 || h.NAXIS2 !== 2) throw new Error('FITS: это не скан level2 (ожидается массив каналы × 2 × точки)');
  const data = readImage(buf, pos, h);
  const head = h;
  pos += pad(dataBytes(h));
  let table = null;
  while (pos < buf.byteLength) {
    const x = readHeader(buf, pos);
    if (String(x.h.EXTNAME || '').trim().toLowerCase() === 'scan_params') { table = readTable(buf, x.pos, x.h); break; }
    pos = x.pos + pad(dataBytes(x.h));
  }
  if (!table || !table.freq) throw new Error('FITS: нет таблицы Scan_params');
  const nChan = head.NAXIS3, nX = head.NAXIS1;
  if (table.freq.length !== nChan) throw new Error('FITS: строк в Scan_params ' + table.freq.length + ', каналов ' + nChan);
  return {
    obs: obsTime(head), header: head, nChan, nX, data,
    freq: table.freq.map(Number), tqsun: (table.tqsun || table.freq.map(() => 0)).map(Number),
    crpix1: head.CRPIX1, cdelt1: head.CDELT1, solarR: head.SOLAR_R, az: head.AZIMUTH || 0
  };
}

export function value(s, ch, iv, x) {
  const v = s.data[(ch * 2 + iv) * s.nX + x];
  return Number.isFinite(v) ? v : 0;
}

// Channels whose I maximum is far above the others (spikes the level1 -> level2 cleaning missed).
export function badChannels(s, factor = 10) {
  const mx = [];
  for (let c = 0; c < s.nChan; c++) { let m = -Infinity; for (let x = 0; x < s.nX; x++) m = Math.max(m, value(s, c, 0, x)); mx.push(m); }
  const sorted = [...mx].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const med = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return mx.map((m, i) => m > factor * med ? i : -1).filter(i => i >= 0);
}

// The scan without the channels in `excluded` (indices of the full scan); `dropped` lists their frequencies.
export function subset(s, excluded) {
  const ex = new Set(excluded);
  const idx = [];
  for (let c = 0; c < s.nChan; c++) if (!ex.has(c)) idx.push(c);
  const data = new Float32Array(idx.length * 2 * s.nX);
  idx.forEach((c, j) => data.set(s.data.subarray(c * 2 * s.nX, (c + 1) * 2 * s.nX), j * 2 * s.nX));
  return {
    ...s, nChan: idx.length, data, freq: idx.map(i => s.freq[i]), tqsun: idx.map(i => s.tqsun[i]),
    dropped: s.freq.filter((_, i) => ex.has(i)), keep: idx, _qs: undefined
  };
}

export function clean(s, factor = 10) { return subset(s, badChannels(s, factor)); }

// Scan in the site's JSON shape (window +-2 solar radii, thinned), for the interactive plots.
export function toScan(s, id, stepArcsec = 8) {
  const rx = Math.round(s.solarR / s.cdelt1);
  const x1 = Math.max(Math.round(s.crpix1 - 2 * rx), 0);
  const x2 = Math.min(x1 + 4 * rx, s.nX - 1);
  const k = Math.max(1, Math.round(stepArcsec / s.cdelt1));
  const idx = [];
  for (let i = x1; i <= x2; i += k) idx.push(i);
  return {
    id, date: s.obs.date, time_ut: s.obs.time, az: Math.round(s.az), units: 'K', dropped: s.dropped || [],
    x_arcsec: { start: (idx[0] - s.crpix1) * s.cdelt1, step: k * s.cdelt1, n: idx.length },
    channels: s.freq.map((f, c) => ({
      freq_ghz: f, tqsun: s.tqsun[c],
      I: idx.map(i => value(s, c, 0, i)), V: idx.map(i => value(s, c, 1, i))
    }))
  };
}
