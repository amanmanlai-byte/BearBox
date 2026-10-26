'use strict';
const { app, BrowserWindow, ipcMain, shell, Menu, Tray, nativeImage, dialog } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { AppService } = require('./backend/service');
const { isWindowsAdmin } = require('./backend/core');
const { assessPurity, lookupPurity } = require('./backend/geo');

if (process.env.JIAJIA_NOSANDBOX) app.commandLine.appendSwitch('no-sandbox');
if (process.env.JIAJIA_USERDATA) app.setPath('userData', process.env.JIAJIA_USERDATA);
if (!app.requestSingleInstanceLock()) { app.quit(); }

let win; let svc; let tray; let quitting = false; let balloonShown = false;

function psQuote(s) { return String(s).replace(/'/g, "''"); }
function requestElevation() {
  const args = [...process.argv.slice(1).filter((a) => a !== '--jj-elevated'), '--jj-elevated'];
  const argList = args.map((a) => `'${psQuote(a)}'`).join(',');
  const script = `$ErrorActionPreference='Stop'; Start-Process -FilePath '${psQuote(process.execPath)}' -ArgumentList @(${argList}) -Verb RunAs`;
  return new Promise((resolve, reject) => execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true }, (e) => (e ? reject(e) : resolve())));
}
async function startCore() {
  if (process.platform === 'win32' && svc.d.settings.tun && !(await isWindowsAdmin())) {
    try { await requestElevation(); } catch { throw new Error('未获得管理员权限，无法启动 TUN 模式。请接受 UAC 提示后重试。'); }
    quitting = true; app.quit();
    return { elevationRequested: true };
  }
  await svc.start(); return { elevationRequested: false };
}

function send(ch, data) { if (win && !win.isDestroyed()) win.webContents.send(ch, data); }

// ---------- tray ----------
function trayIcon() {
  const p = path.join(__dirname, '..', 'assets', 'tray.png');
  if (fs.existsSync(p)) { const img = nativeImage.createFromPath(p); if (!img.isEmpty()) return img; }
  return undefined;
}
function buildTray() {
  const icon = trayIcon();
  if (!icon) return;
  tray = new Tray(icon);
  tray.setToolTip('Bear Box');
  const refresh = () => {
    const st = svc ? svc.core.state : 'stopped';
    const running = st === 'running';
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: running ? '内核运行中' : st === 'starting' ? '内核启动中…' : '内核已停止', enabled: false },
      { type: 'separator' },
      { label: '显示主窗口', click: () => { showWin(); } },
      { label: running ? '停止内核' : '启动内核', click: () => { (running ? svc.stop() : startCore()).catch(() => {}); } },
      { type: 'separator' },
      { label: '退出', click: () => { quitting = true; app.quit(); } },
    ]));
    tray.setToolTip(`Bear Box - ${running ? '内核运行中' : '内核已停止'}`);
  };
  tray.on('click', () => { if (win && !win.isDestroyed() && win.isVisible()) win.hide(); else showWin(); });
  svc.on('state', refresh);
  refresh();
}
function showWin() {
  if (!win || win.isDestroyed()) return;
  try {
    if (win.isMinimized()) win.restore();
    win.show(); win.focus();
  } catch { /* window in a transient state */ }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1220, height: 800, minWidth: 1000, minHeight: 660, backgroundColor: '#f3f5f9', title: 'Bear Box',
    autoHideMenuBar: true, show: !process.env.JIAJIA_SHOT_DIR,
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  Menu.setApplicationMenu(null);
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('close', (e) => {
    // close-to-tray: hide instead of quitting unless we are really quitting
    if (!quitting && svc && svc.d.settings.closeToTray && tray) {
      e.preventDefault(); win.hide();
      if (!balloonShown) {
        balloonShown = true;
        try { tray.displayBalloon({ title: 'Bear Box 仍在运行', content: '窗口已最小化到系统托盘（屏幕右下角，可能藏在向上的小箭头里）。右键托盘图标可选择退出。' }); } catch { /* older shell */ }
      }
    }
  });
}

const handlers = {
  state: () => svc.state(),
  addSub: (a) => svc.addSubscription(a),
  importLinks: (a) => svc.importLinks(a),
  subFile: async () => {
    const r = await dialog.showOpenDialog(win, { title: '选择订阅文件', filters: [{ name: '订阅文件', extensions: ['txt', 'yaml', 'yml', 'json', 'conf', 'list'] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return { canceled: true };
    const content = fs.readFileSync(r.filePaths[0], 'utf8');
    return svc.importSubFile({ name: '文件：' + path.basename(r.filePaths[0]), content });
  },
  ruleFile: async () => {
    const r = await dialog.showOpenDialog(win, { title: '选择规则文件', filters: [{ name: '规则文件', extensions: ['txt', 'yaml', 'yml', 'json', 'list', 'conf'] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return { canceled: true };
    const content = fs.readFileSync(r.filePaths[0], 'utf8');
    return svc.importRuleFile(content);
  },
  // ---------- toolbox ----------
  exportBackup: async () => {
    const file = `BearBox-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const r = await dialog.showSaveDialog(win, { title: '导出配置备份', defaultPath: file, filters: [{ name: 'Bear Box 备份', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return { canceled: true };
    fs.writeFileSync(r.filePath, svc.exportBackup(), 'utf8');
    return { ok: true, path: r.filePath };
  },
  importBackup: async () => {
    const r = await dialog.showOpenDialog(win, { title: '导入配置备份', filters: [{ name: 'Bear Box 备份', extensions: ['json'] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return { canceled: true };
    const content = fs.readFileSync(r.filePaths[0], 'utf8');
    return svc.importBackup(content);
  },
  exportCoreConfig: async () => {
    const r = await dialog.showSaveDialog(win, { title: '导出当前内核配置', defaultPath: 'sing-box-config.json', filters: [{ name: 'sing-box 配置', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return { canceled: true };
    fs.writeFileSync(r.filePath, svc.exportCoreConfig(), 'utf8');
    return { ok: true, path: r.filePath };
  },
  openDataDir: () => { shell.openPath(app.getPath('userData')); return { ok: true }; },
  openExternal: (a) => { if (a && a.url && /^https?:\/\//.test(a.url)) shell.openExternal(a.url); return { ok: true }; },
  appInfo: () => ({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    userData: app.getPath('userData'),
  }),
  updateSub: (a) => svc.updateSubscription(a.id),
  renameSub: (a) => svc.renameSubscription(a.id, a.name),
  updateAllSubs: () => svc.updateAllSubscriptions(),
  removeSub: (a) => svc.removeSubscription(a.id),
  selectNode: (a) => svc.selectNode(a.id),
  testNodes: (a) => svc.testNodes(a && a.ids),
  stopTestNodes: () => svc.stopTestNodes(),
  removeNode: (a) => svc.removeNode(a.id),
  start: () => startCore(),
  stop: () => svc.stop(),
  restart: () => svc.restart(),
  toggleSysProxy: (a) => svc.toggleSystemProxy(a.on),
  setSettings: (a) => svc.setSettings(a),
  saveRule: (a) => svc.saveRule(a),
  removeRule: (a) => svc.removeRule(a.id),
  connections: () => svc.core.connections,
  closeConn: (a) => svc.core.closeConnection(a.id),
  closeAll: () => svc.core.closeAll(),
  logs: () => svc.core.logs.slice(-500),
  clearLogs: () => { svc.core.logs = []; },
  clearStats: () => svc.clearStats(),
  winAction: (a) => {
    if (!win) return;
    if (a && a.type === 'minimize') win.minimize();
  },
  // ---------- wallpaper ----------
  pickWallpaper: async () => {
    const r = await dialog.showOpenDialog(win, { title: '选择壁纸图片', filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'avif', 'ico', 'tif', 'tiff'] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return { canceled: true };
    const src = r.filePaths[0];
    // read as base64 data URI - bypasses all file:// path encoding issues on Windows
    const buf = fs.readFileSync(src);
    if (buf.length > 30 * 1024 * 1024) throw new Error('图片超过 30MB，请压缩后再试');
    const ext = (path.extname(src) || '.png').slice(1).toLowerCase();
    const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', bmp: 'image/bmp', gif: 'image/gif', avif: 'image/avif', ico: 'image/x-icon', tif: 'image/tiff', tiff: 'image/tiff' }[ext] || 'image/png';
    const dataUri = `data:${mime};base64,${buf.toString('base64')}`;
    await svc.setSettings({ wallpaper: dataUri });
    return { ok: true };
  },
  clearWallpaper: async () => {
    await svc.setSettings({ wallpaper: '' });
    return { ok: true };
  },
  // ---------- geo / map ----------
  geoSelf: (a) => svc.geo.self({ direct: !!(a && a.direct) }),
  geoPurity: async (a) => {
    const ip = a && a.ip;
    if (!ip || !/^[0-9a-fA-F:.]+$/.test(ip)) throw new Error('无效的 IP');
    const proxy = svc.core.state === 'running' ? { host: '127.0.0.1', port: Number(svc.d.settings.mixedPort) } : null;
    try { return await lookupPurity(ip, { proxy }); }
    catch (e) { const p = assessPurity({ isp: '' }); p.fallback = true; p.fallbackReason = e.message; return p; }
  },
  geoIps: async (a) => {
    const ips = [...new Set((a.ips || []).filter(Boolean))].slice(0, 8);
    const out = {};
    await Promise.all(ips.map(async (ip) => { try { out[ip] = await svc.geo.lookup(ip); } catch (e) { out[ip] = { error: e.message }; } }));
    return out;
  },
  geoNodes: async (a) => {
    // locations for node servers: DoH-backed resolve (system DNS often NXDOMAINs proxy
    // domains in CN) + cached ip.sb lookups. Only the requested servers when given.
    const wanted = (a && a.servers && a.servers.length) ? a.servers : [...new Set(svc.d.nodes.map((n) => n.outbound.server))];
    const servers = [...new Set(wanted)].slice(0, 12);
    const out = {};
    await Promise.all(servers.map(async (server) => {
      const g = await svc.geo.locate(server).catch((e) => ({ error: e.message }));
      if (!g.error && g.ip) {
        // real purity from ip.net.coffee; fall back to keyword heuristic if unreachable
        try {
          const proxy = svc.core.state === 'running' ? { host: '127.0.0.1', port: Number(svc.d.settings.mixedPort) } : null;
          g.purity = await lookupPurity(g.ip, { proxy });
        } catch (e) {
          g.purity = assessPurity(g);
          g.purity.fallback = true;
          g.purity.fallbackReason = e.message;
        }
      }
      out[server] = g;
    }));
    return out;
  },
  worldGeo: () => {
    if (worldGeoCache) return worldGeoCache;
    for (const p of [path.join(process.resourcesPath || '', 'geo', 'world.geo.json'), path.join(app.getAppPath(), 'geo', 'world.geo.json')]) {
      try { worldGeoCache = JSON.parse(fs.readFileSync(p, 'utf8')); return worldGeoCache; } catch { /* next */ }
    }
    throw new Error('找不到内置世界地图数据（geo/world.geo.json）');
  },
};
let worldGeoCache = null;

app.whenReady().then(async () => {
  // Running straight out of an archive preview (WinRAR/7-Zip temp extraction): warn once.
  if (/Rar\$EX|\.rartemp|\\Temp\\7z|\/Temp\/7z/i.test(process.execPath)) {
    dialog.showMessageBox({
      type: 'warning', title: '请先解压再运行', message: '正在从压缩包临时目录里直接运行',
      detail: 'Bear Box 需要旁边的 resources 等文件才能正常工作。请先把整个压缩包解压到一个文件夹（右键压缩包 - 全部解压），再运行解压出来的程序。',
      buttons: ['知道了'], noLink: true,
    }).catch(() => {});
  }
  svc = new AppService({ userData: app.getPath('userData'), appRoot: app.getAppPath(), resourcesPath: process.resourcesPath });
  await svc.init();
  let pending = null;
  svc.on('state', () => { if (pending) return; pending = setTimeout(() => { pending = null; send('state', svc.state()); }, 120); });
  svc.on('tick', (t) => send('tick', t));
  svc.on('log', (l) => send('log', l));
  ipcMain.handle('jj', async (_e, name, args) => {
    const fn = handlers[name]; if (!fn) return { error: `unknown call: ${name}` };
    try { return { data: await fn(args || {}) }; } catch (e) { return { error: e.message || String(e) }; }
  });
  createWindow();
  buildTray();
  if (svc.d.settings.autoStartCore && svc.d.nodes.length) svc.start().catch(() => {});
  if (process.env.JIAJIA_SHOT_DIR) runShots(process.env.JIAJIA_SHOT_DIR);
});

// Test hook: render every page to PNG for visual verification (only when JIAJIA_SHOT_DIR is set).
async function runShots(dir) {
  fs.mkdirSync(dir, { recursive: true });
  await new Promise((r) => win.webContents.once('did-finish-load', r));
  await new Promise((r) => setTimeout(r, Number(process.env.JIAJIA_SHOT_PRE || 1500)));
  // JIAJIA_PROBE: optional JS snippet executed in the renderer before screenshots (test/verification hook)
  if (process.env.JIAJIA_PROBE) {
    try { console.log('PROBE', JSON.stringify(await win.webContents.executeJavaScript(process.env.JIAJIA_PROBE))); } catch (e) { console.log('PROBE_ERR', e.message); }
  }
  // JIAJIA_INPUT_TEST: drive REAL trusted mouse input (sendInputEvent) into the 3D globe and
  // report whether the camera actually rotated - synthetic events proved insufficient for this.
  if (process.env.JIAJIA_INPUT_TEST) {
    try {
      const prep = await win.webContents.executeJavaScript(`(async()=>{ window.__go('geo'); await new Promise(r=>setTimeout(r,2000));
        const b=[...document.querySelectorAll('.page-head .seg button')].find(x=>x.textContent.includes('3D')); if(b)b.click();
        await new Promise(r=>setTimeout(r,3500));
        const cv=document.querySelector('.globe-view canvas#globe'); if(!cv) return null;
        const r=cv.getBoundingClientRect();
        return { yaw: window.__globe ? window.__globe.inspect().yaw : null, x: Math.round(r.left + r.width*0.4), y: Math.round(r.top + r.height*0.5) }; })()`);
      if (!prep) { console.log('INPUT_TEST_ERR', 'no globe canvas'); }
      else {
        const send = (type, x, y) => win.webContents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 });
        send('mouseDown', prep.x, prep.y);
        for (let i = 0; i < 14; i++) { send('mouseMove', prep.x + (i + 1) * 16, prep.y + (i + 1) * 5); await new Promise((r) => setTimeout(r, 20)); }
        send('mouseUp', prep.x + 15 * 16, prep.y + 15 * 5);
        await new Promise((r) => setTimeout(r, 1200));
        const after = await win.webContents.executeJavaScript(`window.__globe ? window.__globe.inspect().yaw : null`);
        console.log('INPUT_TEST', JSON.stringify({ before: prep.yaw, after, moved: after != null && prep.yaw != null && Math.abs(after - prep.yaw) > 0.05, at: [prep.x, prep.y] }));
      }
    } catch (e) { console.log('INPUT_TEST_ERR', e.message); }
  }
  for (const page of (process.env.JIAJIA_SHOT_PAGES || 'home,nodes,subs,rules,conns,geo,stats,logs,toolbox,settings,about').split(',')) {
    await win.webContents.executeJavaScript(`window.__go && window.__go(${JSON.stringify(page)})`);
    await new Promise((r) => setTimeout(r, Number(process.env.JIAJIA_SHOT_WAIT || 700)));
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(dir, `${page}.png`), img.toPNG());
  }
  quitting = true; app.quit();
}

app.on('second-instance', () => showWin());
app.on('window-all-closed', () => { if (quitting || !svc || !svc.d.settings.closeToTray || !tray) app.quit(); });
app.on('before-quit', (e) => {
  if (quitting || !svc) return;
  e.preventDefault(); quitting = true;
  svc.shutdown().catch(() => {}).finally(() => { if (tray) tray.destroy(); app.quit(); });
});
