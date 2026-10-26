'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { validateTunPrerequisites } = require('../src/backend/core');

test('TUN preflight explains a missing wintun.dll', async () => {
  const r = await validateTunPrerequisites({ enabled: true, binary: 'C:\\app\\core\\sing-box.exe', platform: 'win32', fsApi: { existsSync: () => false }, isElevated: async () => true });
  assert.equal(r.ok, false); assert.match(r.error, /wintun\.dll/);
});

test('TUN preflight explains missing administrator rights', async () => {
  const r = await validateTunPrerequisites({ enabled: true, binary: 'C:\\app\\core\\sing-box.exe', platform: 'win32', fsApi: { existsSync: () => true }, isElevated: async () => false });
  assert.equal(r.ok, false); assert.match(r.error, /管理员权限/);
});

test('TUN preflight accepts Windows with wintun and elevation', async () => {
  const r = await validateTunPrerequisites({ enabled: true, binary: 'C:\\app\\core\\sing-box.exe', platform: 'win32', fsApi: { existsSync: () => true }, isElevated: async () => true });
  assert.equal(r.ok, true); assert.match(r.dll, /wintun\.dll$/i);
});
