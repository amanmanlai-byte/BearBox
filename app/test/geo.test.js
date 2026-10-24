'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { GeoService, resolveHost } = require('../src/backend/geo');

const GEO = { ip: '1.2.3.4', country: 'Japan', country_code: 'JP', region: 'Tokyo', city: 'Tokyo', isp: 'Amazon', asn: 16509, latitude: 35.6, longitude: 139.7 };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jj-geo-'));
const mkT = () => {
  const calls = { proxy: [], direct: [] };
  return {
    calls,
    transports: {
      viaProxy: async (p, host, port) => { calls.proxy.push([p, host, port]); if (calls.failProxy) throw new Error('proxy down'); return JSON.stringify(GEO); },
      direct: async (p) => { calls.direct.push(p); return JSON.stringify(GEO); },
    },
  };
};

test('lookup uses the proxy when the core is running, caches to disk', async () => {
  const t = mkT();
  const svc = new GeoService({ userData: tmp(), getProxy: () => ({ host: '127.0.0.1', port: 2080 }), transports: t.transports });
  const g1 = await svc.lookup('8.8.8.8');
  assert.equal(g1.country, 'Japan');
  assert.equal(t.calls.proxy.length, 1); assert.equal(t.calls.direct.length, 0);
  const g2 = await svc.lookup('8.8.8.8'); // cache hit, no transport call
  assert.deepEqual(g2, g1);
  assert.equal(t.calls.proxy.length, 1);
});

test('lookup goes direct without a proxy and falls back when the proxy fails', async () => {
  const t = mkT();
  const svc = new GeoService({ userData: tmp(), getProxy: () => null, transports: t.transports });
  await svc.lookup('1.1.1.1');
  assert.equal(t.calls.direct.length, 1); assert.equal(t.calls.proxy.length, 0);

  const t2 = mkT(); t2.calls.failProxy = true;
  const svc2 = new GeoService({ userData: tmp(), getProxy: () => ({ host: 'x', port: 1 }), transports: t2.transports });
  const g = await svc2.lookup('9.9.9.9');
  assert.equal(g.ip, '1.2.3.4');
  assert.equal(t2.calls.proxy.length, 1); assert.equal(t2.calls.direct.length, 1);
});

test('expired cache entries are refetched', async () => {
  const t = mkT();
  let clock = 1e12;
  const svc = new GeoService({ userData: tmp(), getProxy: () => null, transports: t.transports, now: () => clock });
  await svc.lookup('2.2.2.2');
  await svc.lookup('2.2.2.2');
  assert.equal(t.calls.direct.length, 1);
  clock += 31 * 24 * 3600 * 1000; // past the 30 day TTL
  await svc.lookup('2.2.2.2');
  assert.equal(t.calls.direct.length, 2);
});

test('self forces the direct path when asked and reports viaProxy', async () => {
  const t = mkT();
  const svc = new GeoService({ userData: tmp(), getProxy: () => ({ host: 'x', port: 1 }), transports: t.transports });
  const via = await svc.self();
  assert.equal(via.viaProxy, true);
  const direct = await svc.self({ direct: true });
  assert.equal(direct.viaProxy, false);
  assert.equal(t.calls.direct.length, 1);
});

test('resolveHost passes IP literals through', async () => {
  assert.equal(await resolveHost('127.0.0.1'), '127.0.0.1');
  assert.equal(await resolveHost('::1'), '::1');
});

test('geo cache file survives a new service instance', async () => {
  const dir = tmp();
  const t = mkT();
  const a = new GeoService({ userData: dir, getProxy: () => null, transports: t.transports });
  await a.lookup('3.3.3.3');
  await new Promise((r) => setTimeout(r, 500)); // flush is debounced
  assert.ok(fs.existsSync(path.join(dir, 'geo-cache.json')));
  const b = new GeoService({ userData: dir, getProxy: () => null, transports: t.transports });
  const g = await b.lookup('3.3.3.3');
  assert.equal(g.ip, '1.2.3.4');
  assert.equal(t.calls.direct.length, 1); // still only the first fetch
});
