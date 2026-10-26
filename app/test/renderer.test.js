'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { DEFAULT_SETTINGS } = require('../src/backend/config');
const root = path.join(__dirname, '../src/renderer');
const pause = () => new Promise((r) => setTimeout(r, 60));
function fixture() {
  return { core: { state: 'stopped', error: null }, settings: { ...DEFAULT_SETTINGS }, subscriptions: [{ id: 'sub', name: '测试订阅', count: 1 }],
    nodes: [{ id: 'node', subId: 'sub', tag: '🇯🇵 日本', type: 'socks', server: 'example.test', port: 1080, testedAt: 1, latency: null }],
    selectedId: 'node', rules: [], daily: {}, today: { up: 0, down: 0 }, session: { upTotal: 0, downTotal: 0, memory: 0 }, samples: [], routePreview: [], testing: false };
}
async function setup(t, bridge = true) {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), { runScripts: 'outside-only', url: 'https://bearbox.test', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const w = dom.window; const state = fixture(); const errors = [];
  w.addEventListener('error', (e) => errors.push(e.message));
  w.CSS = { escape: (s) => String(s) };
  const context = new Proxy({}, { get: (obj, key) => obj[key] || (key === 'createImageData' ? (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }) : key === 'measureText' ? () => ({ width: 20 }) : key === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}), set: (o, k, v) => (o[k] = v, true) });
  w.HTMLCanvasElement.prototype.getContext = () => context;
  if (bridge) w.jj = { on() {}, async call(name) {
    const data = name === 'state' ? state : name === 'worldGeo' ? { type: 'FeatureCollection', features: [] } : ['logs', 'connections'].includes(name) ? [] : name === 'geoNodes' ? { 'example.test': { longitude: 139, latitude: 35, country: 'Japan', ip: '192.0.2.1' } } : {};
    return { data };
  } };
  w.eval(['util.js', 'charts.js', 'pages.js', 'app.js'].map((p) => fs.readFileSync(path.join(root, p), 'utf8')).join('\n') + '\nwindow.__probe = { X, GEO_CACHE, nodeDisplayName, nodeFlag };');
  await pause();
  return { w, state, errors };
}
test('all eleven pages mount in both themes with empty and populated fixtures', async (t) => {
  const { w, state, errors } = await setup(t);
  for (const populated of [true, false]) {
    if (!populated) { state.nodes = []; state.subscriptions = []; state.selectedId = null; }
    for (const theme of ['light', 'dark']) {
      state.settings.theme = theme; w.__applyState(state);
      for (const p of ['home','nodes','subs','rules','conns','geo','stats','logs','toolbox','settings','about']) {
        w.__go(p); await pause();
        assert.ok(w.document.querySelector('#main h1'), p);
      }
    }
  }
  assert.deepEqual(errors, []);
});
test('browser without preload displays the launch instruction', async (t) => {
  const { w, errors } = await setup(t, false);
  assert.match(w.document.querySelector('#main').textContent, /请用桌面程序打开/);
  assert.deepEqual(errors, []);
});
test('duplicate state updates keep subscription inputs mounted', async (t) => {
  const { w, state } = await setup(t); w.__go('subs');
  const input = w.document.querySelector('#main input'); input.value = 'unsaved';
  w.__applyState(state); await pause();
  assert.equal(w.document.querySelector('#main input'), input); assert.equal(input.value, 'unsaved');
});
test('settings draft survives a structural update after input blur', async (t) => {
  const { w, state } = await setup(t); w.__go('settings');
  const input = w.document.querySelector('#main input'); input.value = '3456'; input.focus(); input.blur();
  state.proxyApplied = true; w.__applyState(state); await pause();
  assert.equal(w.document.querySelector('#main input'), input); assert.equal(input.value, '3456');
});
test('node flags, failed test count and per-node test disabling are accurate', async (t) => {
  const { w, state } = await setup(t);
  assert.equal(w.__probe.nodeDisplayName('🇯🇵 日本'), '🇯🇵 日本');
  assert.equal(w.__probe.nodeFlag('🇯🇵 日本'), '');
  state.testing = true; w.__applyState(state); w.__go('nodes');
  assert.match(w.document.querySelector('#main').textContent, /已测 1 个/);
  assert.equal(w.document.querySelector('[title="URL 测速"]').disabled, true);
});
test('node geolocation response updates cache without a swallowed ReferenceError', async (t) => {
  const { w } = await setup(t); w.__go('geo'); await pause();
  assert.equal(w.__probe.GEO_CACHE.nodeSelId, 'node');
});

test('failed node switch restores the dropdown and reports the error', async (t) => {
  const { w, state } = await setup(t);
  state.nodes.push({ ...state.nodes[0], id: 'other', tag: '另一个节点' });
  w.__applyState(state); w.__go('home');
  w.jj.call = async () => ({ error: '切换失败' });
  const select = w.document.querySelector('[aria-label="当前节点"]');
  select.value = 'other'; select.dispatchEvent(new w.Event('change')); await pause();
  assert.equal(select.value, 'node');
  assert.match(w.document.querySelector('#toasts').textContent, /切换失败/);
});
test('connection network chips update their selected style on click', async (t) => {
  const { w } = await setup(t); w.__go('conns');
  const chips = [...w.document.querySelectorAll('#main button.chip')];
  chips[1].click();
  assert.equal(chips[0].classList.contains('on'), false);
  assert.equal(chips[1].classList.contains('on'), true);
});

test('clearing daily stats refreshes the statistics page', async (t) => {
  const { w, state } = await setup(t); w.__go('stats');
  const before = w.document.querySelector('#main').firstChild;
  state.daily = { '2026-10-26': { up: 1024, down: 2048 } };
  w.__applyState(state); await pause();
  assert.notEqual(w.document.querySelector('#main').firstChild, before);
  const populated = w.document.querySelector('#main').firstChild;
  state.daily = {}; w.__applyState(state); await pause();
  assert.notEqual(w.document.querySelector('#main').firstChild, populated);
});
