// Tests for the archive pages: forecast verification, region history, chart helpers. Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';

import { classFlux, contingency, scores, tssError, maxFlare, hadEvent, byMonth } from '../assets/verify.js';
import { noaaList, regionIndex, regionDays, csv, addDays, yearsBetween } from '../assets/history.js';
import { niceTicks, logTicks, dateTicks, linearFit } from '../assets/charts.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test('classFlux reads GOES classes', () => {
  near(classFlux('M1.2'), 1.2e-5);
  near(classFlux('X10'), 1e-3);
  near(classFlux('c5.0'), 5e-6);
  near(classFlux('M'), 1e-5);
  assert.ok(Number.isNaN(classFlux('')));
});

const day = (label, ...flares) => ({ day: '2026-01-01', label, flares: flares.map(c => ({ class: c, peak: '2026-01-02T10:00', noaa: '1' })) });

test('contingency: hits, false alarms, misses, correct negatives; no data skipped', () => {
  const days = [day('positive', 'M2.0'), day('positive'), day('negative', 'X1.0'), day('negative', 'C9.9'), day('positive?', 'M1.0'), day('no data', 'M5')];
  assert.deepEqual(contingency(days), { a: 1, b: 1, c: 2, d: 1, n: 5, skipped: 1 });
  assert.deepEqual(contingency(days, { withUnsure: true }), { a: 2, b: 1, c: 1, d: 1, n: 5, skipped: 1 });
  assert.deepEqual(contingency(days, { threshold: 'M5' }), { a: 0, b: 2, c: 1, d: 2, n: 5, skipped: 1 });
});

test('scores: perfect, random and textbook values', () => {
  const p = scores({ a: 10, b: 0, c: 0, d: 30 });
  near(p.tss, 1); near(p.hss, 1); near(p.far, 0);
  const r = scores({ a: 5, b: 15, c: 5, d: 15 });
  near(r.tss, 0); near(r.hss, 0);
  // Finley tornado forecasts (Murphy 1996): a=28, b=72, c=23, d=2680
  const f = scores({ a: 28, b: 72, c: 23, d: 2680 });
  near(f.pod, 28 / 51); near(f.far, 0.72); near(f.tss, 28 / 51 - 72 / 2752); near(f.hss, 0.355, 1e-3);
  assert.ok(Number.isNaN(scores({ a: 0, b: 0, c: 0, d: 5 }).pod));
  assert.ok(tssError({ a: 28, b: 72, c: 23, d: 2680 }) > 0);
});

test('maxFlare, hadEvent, byMonth', () => {
  assert.equal(maxFlare(day('negative', 'M1.0', 'X1.1', 'M9.9')).class, 'X1.1');
  assert.equal(maxFlare(day('negative')), null);
  assert.equal(hadEvent(day('negative', 'M4.9'), 'M5'), false);
  assert.equal(hadEvent(day('negative', 'M5.0'), 'M5'), true);
  const m = byMonth([{ day: '2026-01-31' }, { day: '2026-02-01' }, { day: '2026-02-03' }]);
  assert.deepEqual(Object.keys(m), ['2026-01', '2026-02']);
  assert.equal(m['2026-02'].length, 2);
});

test('region history: merged sources count for every number', () => {
  assert.deepEqual(noaaList('14268_14269'), ['14268', '14269']);
  assert.deepEqual(noaaList(''), []);
  const days = [
    { day: '2026-01-01', observed: true, rows: [{ noaa: '100', flux3: 5, flux3_corr: 6, label: 'negative' }], flares: [] },
    { day: '2026-01-02', observed: true, rows: [{ noaa: '100_101', flux3: 20, flux3_corr: 22, label: 'positive?' }], flares: [{ class: 'M1.0', peak: '2026-01-03T01:00', noaa: '101' }] },
    { day: '2026-01-03', observed: false, rows: [], flares: [{ class: 'M1.0', peak: '2026-01-03T01:00', noaa: '101' }] },
  ];
  const ix = regionIndex(days);
  assert.equal(ix.get('100').days, 2);
  assert.equal(ix.get('100').maxF3, 22);
  assert.equal(ix.get('101').first, '2026-01-02');
  assert.equal(ix.get('101').flares.length, 1, 'the same flare in two windows is listed once');
  const r = regionDays(days, '100');
  assert.equal(r.length, 2);
  assert.equal(r[1].merged, true);
});

test('csv quoting and dates', () => {
  assert.equal(csv(['a', 'b'], [[1, 'x;y'], [null, 'q"']]), 'a;b\n1;"x;y"\n;"q"""\n');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.deepEqual(yearsBetween('2024-05-01', '2026-01-01'), [2024, 2025, 2026]);
});

test('chart ticks and fit', () => {
  assert.deepEqual(niceTicks(0, 10, 5), [0, 2, 4, 6, 8, 10]);
  assert.deepEqual(logTicks(1, 100), [1, 2, 5, 10, 20, 50, 100]);
  const m = dateTicks(Date.UTC(2026, 0, 15), Date.UTC(2026, 11, 15));
  assert.equal(m[0][1], 'фев');
  assert.equal(m.length, 11);
  const y = dateTicks(Date.UTC(2025, 0, 1), Date.UTC(2026, 11, 31));
  assert.ok(y.some(([, l]) => l === '2026'));
  const w = dateTicks(Date.UTC(2026, 10, 1), Date.UTC(2026, 10, 8));
  assert.equal(w[0][1], '1.11');
  const hh = dateTicks(Date.UTC(2026, 10, 1, 7, 0), Date.UTC(2026, 10, 1, 8, 40));
  assert.equal(hh[0][1], '07:00');
  assert.ok(hh.length >= 4 && hh.length <= 11);
  const f = linearFit([1, 2, 3, 4], [3, 5, 7, 9]);
  near(f.a, 1); near(f.b, 2); near(f.r, 1);
  assert.equal(linearFit([1, 2], [1, 2]), null);
});
