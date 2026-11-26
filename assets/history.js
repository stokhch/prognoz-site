// Archive data: daily forecasts (data/history/<year>.json), whole-disk fluxes of RATAN, NoRP and Penticton
// (data/indices/<year>.json), the observation journal (data/journal/<year>.json). Formats: README, «Архив и сводки».
import { getJSON } from './app.js';

const cache = new Map();
function load(path) {
  if (!cache.has(path)) {
    const p = getJSON(path);
    cache.set(path, p);
    p.catch(() => cache.delete(path));
  }
  return cache.get(path);
}

export const historyIndex = () => load('data/history/index.json');
export const historyYear = y => load('data/history/' + y + '.json');
export const indicesYear = y => load('data/indices/' + y + '.json');
export const journalYear = y => load('data/journal/' + y + '.json');

export function yearsBetween(from, to) {
  const out = [];
  for (let y = +from.slice(0, 4); y <= +to.slice(0, 4); y++) out.push(y);
  return out;
}

// records of all years in [from, to] (YYYY-MM-DD, inclusive); a missing year file is skipped
export async function range(kind, from, to) {
  const get = { history: historyYear, indices: indicesYear, journal: journalYear }[kind];
  const key = kind === 'history' ? 'days' : kind === 'indices' ? 'days' : 'entries';
  const field = kind === 'history' ? 'day' : 'date';
  const parts = await Promise.all(yearsBetween(from, to).map(y => get(y).then(j => j[key] || [], () => [])));
  return parts.flat().filter(r => r[field] >= from && r[field] <= to);
}

// NOAA numbers of a table row: "14268_14269" -> ["14268", "14269"]
export const noaaList = s => String(s || '').split(/[_,\s]+/).filter(Boolean);

// every region seen in the day records: Map noaa -> {noaa, first, last, days, maxF3, flares: [..]}
export function regionIndex(days) {
  const m = new Map();
  for (const d of days) {
    for (const r of d.rows || []) for (const n of noaaList(r.noaa)) {
      let e = m.get(n);
      if (!e) m.set(n, e = { noaa: n, first: d.day, last: d.day, days: 0, maxF3: 0, positive: 0, flares: new Map() });
      e.last = d.day; e.days++;
      e.maxF3 = Math.max(e.maxF3, r.flux3_corr ?? r.flux3 ?? 0);
      if (r.label === 'positive') e.positive++;
    }
    for (const f of d.flares || []) {
      const e = m.get(String(f.noaa));
      if (e) e.flares.set(f.peak + f.class, f);
    }
  }
  for (const e of m.values()) e.flares = [...e.flares.values()].sort((a, b) => a.peak < b.peak ? -1 : 1);
  return m;
}

// day-by-day rows of one region (a merged source "a_b" counts for both numbers)
export function regionDays(days, noaa) {
  const out = [];
  for (const d of days) {
    if (!d.observed) continue;
    const r = (d.rows || []).find(w => noaaList(w.noaa).includes(String(noaa)));
    if (r) out.push({ day: d.day, ...r, merged: noaaList(r.noaa).length > 1 });
  }
  return out;
}

export const dayMs = s => Date.parse(s + 'T00:00:00Z');
export const isoDay = t => new Date(t).toISOString().slice(0, 10);
export const addDays = (s, n) => isoDay(dayMs(s) + n * 864e5);

// save text as a file (CSV, JSON) without a server
export function download(name, text, type = 'text/csv;charset=utf-8') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + text], { type }));
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function csv(header, rows, sep = ';') {
  const q = v => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [header, ...rows].map(r => r.map(q).join(sep)).join('\n') + '\n';
}

export const LABEL_COLOR = {
  'positive': '#C2410C', 'positive?': '#D99A00', 'negative': '#1E4FB8', 'negative?': '#6B8FD6', 'no data': '#9AA6B5',
};

export const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
export const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
