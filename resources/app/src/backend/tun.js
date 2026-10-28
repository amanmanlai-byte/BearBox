'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { isWindowsAdmin, portFree } = require('./core');

function readAdapter() {
  return new Promise((resolve) => {
    const script = "Get-NetAdapter -IncludeHidden -ErrorAction Stop | Where-Object { $_.Name -eq 'BearBox-TUN' } | Select-Object Name,Status,InterfaceDescription | ConvertTo-Json -Compress";
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 8000 }, (error, stdout) => {
      if (error) return resolve({ error: '无法读取网卡状态，请在 Windows 网络设置中检查' });
      try { resolve({ adapters: stdout.trim() ? [].concat(JSON.parse(stdout)) : [] }); }
      catch { resolve({ error: '网卡状态返回格式无效' }); }
    });
  });
}

async function inspectTun({ binary, settings, coreState }, deps = {}) {
  const exists = deps.exists || fs.existsSync;
  const elevated = deps.isElevated || isWindowsAdmin;
  const free = deps.portFree || portFree;
  const platform = deps.platform || process.platform;
  const rows = [];
  const add = (label, state, detail) => rows.push({ label, state, detail });
  const hasCore = exists(binary), hasDriver = exists(path.join(path.dirname(binary), 'wintun.dll'));
  add('代理内核', hasCore ? 'ok' : 'error', hasCore ? '已找到原版定制内核' : '内核文件缺失，请完整解压程序');
  if (platform === 'win32') {
    add('Wintun 驱动文件', hasDriver ? 'ok' : 'error', hasDriver ? 'wintun.dll 已就绪' : '缺少 wintun.dll，请完整解压程序');
    const admin = await elevated();
    add('管理员权限', admin ? 'ok' : 'warn', admin ? '当前进程已获得管理员权限' : '尚未提权；启动 TUN 时会请求 UAC 授权');
  }
  const active = coreState !== 'stopped';
  for (const [label, port, host] of [['本地代理端口', settings.mixedPort, settings.allowAccess ? '0.0.0.0' : '127.0.0.1'], ['控制接口端口', settings.apiPort, '127.0.0.1']]) {
    if (active) add(label, 'info', `${port} · 内核运行期间不进行占用探测`);
    else { const available = await free(Number(port), host); add(label, available ? 'ok' : 'error', `${port} · ${available ? '可用' : '已被占用，请在设置中更换'}`); }
  }
  if (platform === 'win32') {
    const result = await (deps.readAdapter || readAdapter)();
    const adapter = result.adapters?.find((a) => a.Name === 'BearBox-TUN');
    add('虚拟网卡', adapter?.Status === 'Up' ? 'ok' : 'info', result.error || (adapter ? `${adapter.Name} · ${adapter.Status}` : '未发现 BearBox-TUN 网卡；首次启动成功后创建'));
  }
  return { checkedAt: Date.now(), rows };
}
module.exports = { inspectTun };
