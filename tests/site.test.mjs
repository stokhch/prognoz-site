// Unit tests for the pure parts of the site code: geometry of active regions, scan colour scale,
// the quiet-Sun beam laws and the stale-forecast warning. Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseLocation, projectHelio, scanX } from '../assets/regions.js';
import { palette, channelIndex } from '../assets/scanplot.js';
import { START, thetaH0, rho0, thetaV } from '../assets/quietsun.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test('parseLocation reads NOAA heliographic positions', () => {
  assert.deepEqual(parseLocation('S12E35'), { lat: -12, lon: -35 });
  assert.deepEqual(parseLocation('n08w12'), { lat: 8, lon: 12 });
  assert.deepEqual(parseLocation('N5E102'), { lat: 5, lon: -102 });
  assert.equal(parseLocation(''), null);
  assert.equal(parseLocation('---'), null);
});

test('projectHelio: disk centre, limb and far side', () => {
  const c = projectHelio(0, 0, 0, 100);
  near(c.x, 0); near(c.y, 0); near(c.z, 1);
  const west = projectHelio(0, 90, 0, 100);
  near(west.x, 100); near(west.z, 0, 1e-9);
  const north = projectHelio(90, 0, 0, 100);
  near(north.y, 100);
  assert.ok(projectHelio(0, 120, 0, 100).z < 0);
});

test('scanX: position on the scan axis', () => {
  near(scanX({ x: 100, y: 0 }, 0, 0, false), 100);
  near(scanX({ x: 100, y: 0 }, 0, 0, true), -100);
  near(scanX({ x: 100, y: 0 }, 90, 0, false), 0, 1e-9);   // a 90 degree turn puts the point on the north axis
  assert.ok(scanX({ x: 0, y: 100 }, 0, 10, false) < 0);   // parallactic angle shifts northern points
});

test('palette and channel index', () => {
  assert.equal(palette(0), 'rgb(7,4,8)');
  assert.equal(palette(-5), palette(0));
  assert.equal(palette(1000), palette(255));
  assert.equal(channelIndex(3), 0);
  assert.equal(channelIndex(18), 16);
});

test('quiet-Sun laws', () => {
  near(rho0(3), START.a + START.k / 3);
  near(thetaH0(3), START.beta + START.gamma * 100);
  // radius of the radio disk decreases with frequency, the vertical beam too
  assert.ok(rho0(3) > rho0(18));
  assert.ok(thetaV(3, 47) > thetaV(18, 47));
  assert.ok(thetaV(10, 47) >= 60 * START.floor);
});

test('stale forecast warning', async () => {
  const nodes = [];
  const mkNode = (tag) => ({
    tag, kids: [], attrs: {}, classList: new Set(),
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener() {},
    append(...k) { this.kids.push(...k); },
    after(n) { nodes.push(n); },
    set textContent(v) { this.kids = [v]; }
  });
  globalThis.document = {
    createElement: mkNode,
    querySelector: (sel) => (sel === 'header.site-header' ? mkNode('header') : null),
    body: Object.assign(mkNode('body'), { after(n) { nodes.push(n); } })
  };
  const { warnIfStale, STALE_HOURS } = await import('../assets/app.js');
  const t0 = Date.parse('2026-11-20T12:00:00Z');
  const hour = 36e5;
  assert.equal(warnIfStale({ generated_at: new Date(t0 - 2 * hour).toISOString() }, t0), false);
  assert.equal(warnIfStale({ generated_at: new Date(t0 - (STALE_HOURS - 1) * hour).toISOString() }, t0), false);
  assert.equal(warnIfStale({ generated_at: 'not a date' }, t0), false);
  assert.equal(nodes.length, 0);
  assert.equal(warnIfStale({ generated_at: new Date(t0 - 3 * 24 * hour).toISOString() }, t0), true);
  assert.equal(nodes.length, 1);
});
