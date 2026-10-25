'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { GeoService, resolveHost, assessPurity, lookupPurity } = require('../src/backend/geo');

const GEO = { ip: '1.2.3.4', country: 'Japan', country_code: 'JP', region: 'Tokyo', city: 'Tokyo', isp: 'Amazon', asn: 16509, latitude: 35.6, longitude: 139.7 };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jj-geo-'));
const mkT = () => {
  const calls = { proxy: [], direct: [] };
  return {
    calls,
    transports: {
      viaProxy: async (host, p, ph, pp) => { calls.proxy.push([host, p, ph, pp]); if (calls.failProxy) throw new Error('proxy down'); return JSON.stringify(GEO); },
      direct: async (host, p) => { calls.direct.push([host, p]); return JSON.stringify(GEO); },
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

test('assessPurity classifies datacenter vs residential ISPs (ip.sb derived)', () => {
  const dc = assessPurity({ isp: 'Amazon.com', organization: 'AWS', asn_organization: 'Amazon.com, Inc.', latitude: 1, longitude: 2 });
  assert.equal(dc.level, '机房'); assert.ok(dc.score <= 45); assert.match(dc.basis, /机房|云网|云商|命中/);
  const res = assessPurity({ isp: 'Henan Mobile Communications', asn_organization: 'China Mobile', latitude: 1, longitude: 2 });
  assert.equal(res.level, '住宅'); assert.ok(res.score >= 90);
  const mid = assessPurity({ isp: 'Example Net Ltd', latitude: 1, longitude: 2 });
  assert.equal(mid.level, '一般'); assert.ok(mid.score >= 60 && mid.score < 90);
  assert.equal(assessPurity(null), null);
  assert.equal(assessPurity({ error: 'x' }), null);
  // disclosure note must be present (it is a heuristic, not a risk database)
  assert.match(res.note, /ip\.sb/);
});

test('self() carries the purity assessment', async () => {
  const t = mkT();
  const svc = new GeoService({ userData: tmp(), getProxy: () => null, transports: t.transports });
  const g = await svc.self();
  assert.ok(g.purity && Number.isFinite(g.purity.score));
});

test('lookupPurity fetches from ip.net.coffee and maps risk flags', async () => {
  const calls = { direct: [], proxy: [] };
  const mockResp = {
    ip: '8.8.8.8', trust_score: 63, is_datacenter: true, isResidential: false,
    is_vpn: false, is_proxy: false, is_tor: false, is_abuser: false, is_crawler: false,
    is_mobile: false, company_type: 'hosting', company_name: 'Google LLC',
    asn: 15169, asOrganization: 'Google LLC', reddit_blocked: false,
    ai_verdict: { label: '公共 DNS 任播', confidence: 100, reasoning: 'test' },
  };
  const t = {
    viaProxy: async (h, p) => { calls.proxy.push([h, p]); throw new Error('no proxy'); },
    direct: async (h, p) => { calls.direct.push([h, p]); return JSON.stringify(mockResp); },
  };
  const r = await lookupPurity('8.8.8.8', { transports: t });
  assert.equal(calls.direct[0][0], 'ip.net.coffee');
  assert.equal(calls.direct[0][1], '/api/ip/lookup/8.8.8.8');
  assert.equal(r.score, 63); // trust_score used directly
  assert.equal(r.level, '机房');
  assert.equal(r.type, '机房/云商');
  assert.equal(r.company, 'Google LLC');
  assert.equal(r.source, 'ip.net.coffee');
  assert.ok(r.aiVerdict);
  assert.equal(r.aiVerdict.confidence, 100);
});

test('lookupPurity maps VPN/Tor/abuser flags to 风险 level', async () => {
  const mockResp = {
    ip: 'x', trust_score: 25, is_vpn: true, is_proxy: true, is_tor: false,
    is_abuser: true, is_datacenter: true, isResidential: false, is_crawler: false,
    is_mobile: false, company_type: 'hosting', company_name: 'Some VPN Provider',
  };
  const t = { viaProxy: async () => { throw new Error('no'); }, direct: async () => JSON.stringify(mockResp) };
  const r = await lookupPurity('1.2.3.4', { transports: t });
  assert.equal(r.level, '风险');
  assert.ok(r.flags.includes('VPN'));
  assert.ok(r.flags.includes('代理'));
  assert.ok(r.flags.includes('历史滥用记录'));
});

test('lookupPurity falls back to direct when proxy fails', async () => {
  const mockResp = { ip: 'x', trust_score: 90, isResidential: true, is_vpn: false, is_proxy: false, is_tor: false, is_abuser: false, is_crawler: false, is_datacenter: false, is_mobile: false, company_type: 'isp' };
  const calls = { d: 0 };
  const t = {
    viaProxy: async () => { throw new Error('proxy down'); },
    direct: async () => { calls.d++; return JSON.stringify(mockResp); },
  };
  const r = await lookupPurity('5.6.7.8', { proxy: { host: 'x', port: 1 }, transports: t });
  assert.equal(calls.d, 1);
  assert.equal(r.score, 90);
  assert.equal(r.level, '纯净');
});
