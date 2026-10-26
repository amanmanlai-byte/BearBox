'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { SystemProxy, KEY } = require('../src/backend/sysproxy');

function fake(initial) {
  const reg = { ...initial }; const calls = [];
  const exec = async (file, args) => {
    calls.push([file, ...args]);
    if (file === 'reg' && args[0] === 'query') { const v = reg[args[3]]; if (!v) throw new Error('not found'); return { stdout: `\n${KEY}\n    ${args[3]}    ${v.type}    ${v.data}\n` }; }
    if (file === 'reg' && args[0] === 'add') reg[args[3]] = { type: args[5], data: args[7] };
    if (file === 'reg' && args[0] === 'delete') delete reg[args[3]];
    return { stdout: '' };
  };
  return { exec, reg, calls };
}

test('enable writes server/override/enable and refreshes WinINet', async () => {
  const f = fake({}); const sp = new SystemProxy({ exec: f.exec, platform: 'win32' });
  const r = await sp.enable('127.0.0.1', 2080);
  assert.ok(r.ok); assert.equal(f.reg.ProxyServer.data, '127.0.0.1:2080'); assert.equal(f.reg.ProxyEnable.data, '1');
  assert.match(f.reg.ProxyOverride.data, /<local>/);
  assert.ok(f.calls.some((c) => c[0] === 'powershell' && c.join(' ').includes('InternetSetOption')));
});

test('disable restores the user\'s previous settings exactly', async () => {
  const f = fake({ ProxyEnable: { type: 'REG_DWORD', data: '0x1' }, ProxyServer: { type: 'REG_SZ', data: '10.0.0.9:3128' }, ProxyOverride: { type: 'REG_SZ', data: 'corp.local' } });
  const sp = new SystemProxy({ exec: f.exec, platform: 'win32' });
  const { backup } = await sp.enable('127.0.0.1', 2080);
  await sp.disable(backup);
  assert.equal(f.reg.ProxyEnable.data, '1'); assert.equal(f.reg.ProxyServer.data, '10.0.0.9:3128'); assert.equal(f.reg.ProxyOverride.data, 'corp.local');
});

test('disable with no previous values turns the proxy off and removes ours', async () => {
  const f = fake({}); const sp = new SystemProxy({ exec: f.exec, platform: 'win32' });
  const { backup } = await sp.enable('127.0.0.1', 2080); await sp.disable(backup);
  assert.equal(f.reg.ProxyEnable.data, '0'); assert.equal(f.reg.ProxyServer, undefined);
});

test('non-Windows platforms are reported as unsupported and touch nothing', async () => {
  const f = fake({}); const sp = new SystemProxy({ exec: f.exec, platform: 'linux' });
  assert.equal(sp.supported, false); assert.equal((await sp.enable('127.0.0.1', 1)).ok, false); assert.equal(f.calls.length, 0);
});

test('enable saves recovery snapshot before changing any registry values', async () => {
  const f = fake({ ProxyServer: { type: 'REG_SZ', data: 'corp:3128' } });
  const sp = new SystemProxy({ exec: f.exec, platform: 'win32' });
  await sp.enable('127.0.0.1', 2080, async (backup) => {
    assert.equal(backup.ProxyServer.data, 'corp:3128');
    assert.ok(!f.calls.some((c) => c[1] === 'add'));
    throw new Error('disk full');
  }).then(() => assert.fail('must reject'), (e) => assert.match(e.message, /disk full/));
  assert.equal(f.reg.ProxyServer.data, 'corp:3128');
  assert.ok(!f.calls.some((c) => c[1] === 'add'));
});
