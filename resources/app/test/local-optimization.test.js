'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const http = require('http');
const vm = require('vm');
const { EventEmitter } = require('events');
const { buildConfig, DEFAULT_SETTINGS } = require('../src/backend/config');
const { Core, validateTunPrerequisites, portFree, mapConnection } = require('../src/backend/core');
const { AppService } = require('../src/backend/service');
const { inspectTun } = require('../src/backend/tun');
const root = path.resolve(__dirname, '..');
const binary = path.join(root, 'core/sing-box-windows-amd64.exe');
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bearbox-test-'));
const config = (settings) => buildConfig({ nodes: [{ type: 'direct', tag: 'test-local' }], settings: { mode: 'global', ...settings }, rulesetDir: path.join(root, 'ruleset') }).config;
const availablePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
test('TUN defaults off, migrates old config once, and preserves later user choices', () => {
  const { Store } = require('../src/backend/store'); const dir = temp();
  try {
    const file = path.join(dir, 'data.json'); const store = new Store(file);
    assert.equal(DEFAULT_SETTINGS.tun, false); assert.equal(store.data.settings.tun, false);
    fs.writeFileSync(file, JSON.stringify({ settings: { tun: true } }));
    const migrated = new Store(file); assert.equal(migrated.data.settings.tun, false);
    migrated.data.settings.tun = true; migrated.flush(); assert.equal(new Store(file).data.settings.tun, true);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

function mainFixture(service, hasDriver = false) {
  const events = {}, order = [];
  const app = { requestSingleInstanceLock: () => true, releaseSingleInstanceLock: () => order.push('unlock'), whenReady: () => ({ then() {} }), on: (name, fn) => { events[name] = fn; }, quit: () => order.push('quit') };
  const context = vm.createContext({
    __dirname: path.join(root, 'src'), process: { env: {}, argv: ['BearBox.exe'], execPath: path.join(root, '../../BearBox.exe'), platform: 'win32' },
    setTimeout, clearTimeout, console,
    require: (id) => {
      if (id === 'electron') return { app };
      if (id === 'fs') return { existsSync: (p) => hasDriver && p.endsWith('wintun.dll') };
      if (id === 'child_process') return { execFile: (...args) => { order.push('uac'); args.at(-1)(new Error('cancelled')); } };
      if (id === './backend/core') return { isWindowsAdmin: async () => false };
      if (id.startsWith('./backend/')) return require(path.join(root, 'src', id));
      return require(id);
    }, service,
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'src/main.js'), 'utf8') + '\nsvc = service;', context);
  return { events, order, context };
}

test('tray quit waits for shutdown exactly once even when quitting was already set', async () => {
  let count = 0, release;
  const f = mainFixture({ shutdown: () => { count++; return new Promise((r) => { release = r; }); } });
  vm.runInContext('quitting = true', f.context);
  let prevented = 0; const event = { preventDefault: () => prevented++ };
  f.events['before-quit'](event); f.events['before-quit'](event);
  assert.equal(count, 1); assert.equal(prevented, 2); assert.deepEqual(f.order, []);
  release(); await new Promise((r) => setImmediate(r));
  assert.deepEqual(f.order, ['quit']);
  f.events['before-quit'](event); assert.equal(prevented, 2);
});

test('invalid elevation settings are rejected before stopping the live connection', async () => {
  let stopped = false;
  const f = mainFixture({ core: { state: 'running' }, _normalizeSettings: () => { throw new Error('invalid MTU'); }, stop: async () => { stopped = true; } });
  await assert.rejects(vm.runInContext('handlers.setSettings({tun: true, mtu: 1})', f.context), /invalid MTU/);
  assert.equal(stopped, false);
});

test('TUN elevation prerequisite failure restores original connection and settings', async () => {
  const service = { d: { settings: { tun: false } }, core: { state: 'running', binary }, _normalizeSettings() {}, stop: async () => { service.core.state = 'stopped'; }, setSettings: async (patch) => { service.d.settings = { ...patch }; }, start: async () => { service.core.state = 'running'; } };
  const f = mainFixture(service);
  await assert.rejects(vm.runInContext('handlers.setSettings({tun: true})', f.context), /wintun.dll.*原连接已恢复/);
  assert.equal(service.d.settings.tun, false); assert.equal(service.core.state, 'running');
});

test('cancelled UAC restores the original live connection without quitting', async () => {
  const service = { d: { settings: { tun: false } }, core: { state: 'running', binary }, store: { flush() {} }, _normalizeSettings() {}, stop: async () => { service.core.state = 'stopped'; }, setSettings: async (patch) => { service.d.settings = { ...patch }; }, start: async () => { service.core.state = 'running'; } };
  const f = mainFixture(service, true);
  await assert.rejects(vm.runInContext('handlers.setSettings({tun: true})', f.context), /未获得管理员权限.*原连接已恢复/);
  assert.equal(service.d.settings.tun, false); assert.equal(service.core.state, 'running');
  assert.deepEqual(f.order, ['unlock', 'uac']);
});
test('frameless window controls minimize, toggle maximize and close', () => {
  const f = mainFixture({}); let max = false; const actions = [];
  f.context.fakeWin = { minimize: () => actions.push('minimize'), isMaximized: () => max,
    maximize: () => { max = true; actions.push('maximize'); }, unmaximize: () => { max = false; actions.push('unmaximize'); }, close: () => actions.push('close') };
  vm.runInContext("win=fakeWin; handlers.winAction({type:'minimize'}); handlers.winAction({type:'maximize'}); handlers.winAction({type:'maximize'}); handlers.winAction({type:'close'});", f.context);
  assert.deepEqual(actions, ['minimize', 'maximize', 'unmaximize', 'close']);
});

test('TUN DNS capture precedes LAN bypass with sniffing disabled', () => {
  const c = config({ tun: true, trafficSniffing: false });
  assert.deepEqual(c.route.rules[0], { inbound: ['tun-in'], port: [53], action: 'hijack-dns' });
  assert.equal(c.inbounds[1].interface_name, 'BearBox-TUN');
  assert.equal(c.inbounds[1].mtu, 1500);
  assert.equal(config({ tun: false }).inbounds.length, 1);
});

test('original bundled kernel accepts every TUN stack, MTU and strict-route combination', async () => {
  const dir = temp();
  try {
    const core = new Core({ binary, workDir: dir });
    for (const stack of ['mixed', 'system', 'gvisor']) for (const mtu of [1280, 1500, 9000]) for (const strict of [false, true]) {
      const p = path.join(dir, 'config.json');
      fs.writeFileSync(p, JSON.stringify(config({ tun: true, tunStack: stack, mtu, tunStrictRoute: strict, trafficSniffing: false, mode: 'rule' })));
      const result = await core.check(p);
      assert.equal(result.ok, true, `${stack}/${mtu}/${strict}: ${result.output}`);
    }
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('TUN prerequisites distinguish missing driver, missing privilege and readiness', async () => {
  const base = { enabled: true, binary, platform: 'win32', fsApi: { existsSync: () => true }, isElevated: async () => true };
  assert.equal((await validateTunPrerequisites(base)).ok, true);
  assert.match((await validateTunPrerequisites({ ...base, fsApi: { existsSync: () => false } })).error, /wintun/);
  assert.match((await validateTunPrerequisites({ ...base, isElevated: async () => false })).error, /管理员/);
  assert.equal((await validateTunPrerequisites({ ...base, enabled: false, fsApi: { existsSync: () => false } })).ok, true);
});

test('diagnostics report observed adapter/ports without changing network state', async () => {
  let probes = 0;
  const deps = { platform: 'win32', exists: () => true, isElevated: async () => false, portFree: async () => { probes++; return false; }, readAdapter: async () => ({ adapters: [{ Name: 'BearBox-TUN', Status: 'Down' }] }) };
  const result = await inspectTun({ binary, settings: DEFAULT_SETTINGS, coreState: 'stopped' }, deps);
  assert.equal(probes, 2);
  assert.equal(result.rows.filter((r) => r.state === 'error').length, 2);
  assert.equal(result.rows.find((r) => r.label === '管理员权限').state, 'warn');
  assert.equal(result.rows.find((r) => r.label === '虚拟网卡').state, 'info');
  probes = 0;
  await inspectTun({ binary, settings: DEFAULT_SETTINGS, coreState: 'running' }, deps);
  assert.equal(probes, 0);
});

function fixture() {
  const dir = temp(); const core = new EventEmitter();
  Object.assign(core, { state: 'running', samples: [], binary, stop: async () => { core.state = 'stopped'; }, pushLog() {} });
  const svc = new AppService({ userData: dir, appRoot: root, core, sysproxy: { supported: false } });
  return { svc, core, finish() { clearTimeout(svc.store._t); fs.rmSync(dir, { recursive: true }); } };
}
test('settings reject invalid TUN values before changing the connection', async () => {
  const f = fixture();
  try {
    for (const patch of [{ mtu: 1279 }, { mtu: 9001 }, { mtu: 1500.1 }, { tunStack: 'unknown' }, { tun: 'yes' }, { tunStrictRoute: 1 }]) await assert.rejects(f.svc.setSettings(patch));
    assert.equal(f.core.state, 'running'); assert.equal(f.svc.d.settings.mtu, 1500);
  } finally { f.finish(); }
});
test('failed network change restores previous settings and reconnects', async () => {
  const f = fixture(); let restarts = 0;
  f.svc.restart = async () => { restarts++; throw new Error('simulated TUN failure'); };
  f.svc.start = async () => { f.core.state = 'running'; };
  try {
    await assert.rejects(f.svc.setSettings({ tun: true }), /已恢复原设置与连接/);
    assert.equal(f.svc.d.settings.tun, false); assert.equal(f.core.state, 'running'); assert.equal(restarts, 1);
    assert.equal(JSON.parse(fs.readFileSync(f.svc.store.file)).settings.tun, false);
  } finally { f.finish(); }
});
test('settings changes are serialized and UI-only updates do not restart the core', async () => {
  const f = fixture(); let active = 0, peak = 0;
  f.svc.restart = async () => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 15)); active--; };
  try {
    await Promise.all([f.svc.setSettings({ mtu: 1280 }), f.svc.setSettings({ tunStack: 'system' })]);
    assert.equal(peak, 1); assert.equal(f.svc.d.settings.mtu, 1280); assert.equal(f.svc.d.settings.tunStack, 'system');
    f.svc.restart = async () => assert.fail('UI changes restarted core');
    await f.svc.setSettings({ theme: 'dark' });
    await f.svc.setSettings({ uiColor: '#123456' });
    assert.equal(f.svc.d.settings.uiColor, '#123456');
    await assert.rejects(f.svc.setSettings({ uiColor: 'red' }), /界面颜色/);
    await f.svc.setSettings({ appearanceMode: 'system', accentColor: '#7654b7', fontSize: 'large', uiDensity: 'compact', sidebarWidth: 240, sidebarCollapsed: true, windowOpacity: .85 });
    f.svc.store.flush();
    const { Store } = require('../src/backend/store'); const saved = new Store(f.svc.store.file).data.settings;
    assert.equal(saved.sidebarCollapsed, true); assert.equal(saved.sidebarWidth, 240); assert.equal(saved.windowOpacity, .85); assert.equal(saved.appearanceMode, 'system');
    for (const patch of [{ appearanceMode: 'bad' }, { accentColor: 'red' }, { fontSize: 'huge' }, { uiDensity: 'wide' }, { sidebarWidth: 10 }, { sidebarCollapsed: 'yes' }, { windowOpacity: 0 }]) await assert.rejects(f.svc.setSettings(patch));
    f.svc.d.settings.tun = true;
    await assert.rejects(f.svc.toggleSystemProxy(true), /无需重复/);
  } finally { f.finish(); }
});
test('forest theme retains but cannot change simple theme colors', async () => {
  const f = fixture(); f.core.state = 'stopped';
  try {
    await f.svc.setSettings({ accentColor: '#123456', uiColor: '#234567', fontColor: '#345678' });
    await f.svc.setSettings({ theme: 'forest' });
    for (const patch of [{ accentColor: '#000000' }, { uiColor: '#000000' }, { fontColor: '#ffffff' }]) await assert.rejects(f.svc.setSettings(patch), /专属配色/);
    assert.equal(f.svc.d.settings.accentColor, '#123456');
    await f.svc.setSettings({ theme: 'light', accentColor: '' });
    assert.equal(f.svc.d.settings.accentColor, '');
    f.svc.d.settings.windowBlur = 0;
    await f.svc.setSettings({ fontSize: 'large' });
    assert.equal('windowBlur' in f.svc.d.settings, false);
  } finally { f.finish(); }
});
test('connection mapping preserves destination IP for real geographic counts', () => {
  const c = mapConnection({ id: '1', metadata: { host: 'example.test', destinationIP: '8.8.8.8' } });
  assert.equal(c.host, 'example.test'); assert.equal(c.destinationIP, '8.8.8.8');
});

test('API port collision is reported before spawning the proxy', async () => {
  const dir = temp(); const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const core = new Core({ binary, workDir: dir });
  try {
    const p = s.address().port;
    await assert.rejects(core.start({ config: config({ apiPort: p, mixedPort: await availablePort() }), apiPort: p, secret: '' }), /控制接口端口/);
    assert.equal(core.proc, null);
  } finally { await new Promise((r) => s.close(r)); fs.rmSync(dir, { recursive: true }); }
});

test('real kernel starts, forwards loopback HTTP, reports API and releases ports on stop', { timeout: 30000 }, async () => {
  const dir = temp(); const origin = http.createServer((req, res) => res.end('bearbox-local-ok'));
  await new Promise((r) => origin.listen(0, '127.0.0.1', r));
  const mixedPort = await availablePort(), apiPort = await availablePort();
  const core = new Core({ binary, workDir: dir });
  try {
    await core.start({ config: config({ mixedPort, apiPort }), apiPort, secret: '' });
    assert.equal(core.state, 'running'); assert.equal(core.apiOk, true); assert.equal(core.status().tun, false);
    const body = await new Promise((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port: mixedPort, path: `http://127.0.0.1:${origin.address().port}/`, timeout: 5000 }, (res) => { let b = ''; res.on('data', (d) => b += d); res.on('end', () => resolve(b)); });
      req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout')));
    });
    assert.equal(body, 'bearbox-local-ok');
    await core.stop(); assert.equal(core.state, 'stopped');
    assert.equal(await portFree(mixedPort), true); assert.equal(await portFree(apiPort), true);
  } finally { await core.stop(); await new Promise((r) => origin.close(r)); fs.rmSync(dir, { recursive: true }); }
});
