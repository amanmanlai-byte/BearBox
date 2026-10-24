'use strict';
const { app, BrowserWindow, ipcMain, shell, Menu, Tray, nativeImage } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { AppService } = require('./backend/service');
const { isWindowsAdmin } = require('./backend/core');

if (process.env.JIAJIA_NOSANDBOX) app.commandLine.appendSwitch('no-sandbox');
if (process.env.JIAJIA_USERDATA) app.setPath('userData', process.env.JIAJIA_USERDATA);
if (!app.requestSingleInstanceLock()) { app.quit(); }

let win; let svc; let tray; let quitting = false;

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
  tray.setToolTip('JiajiaBox');
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
    tray.setToolTip(`JiajiaBox - ${running ? '内核运行中' : '内核已停止'}`);
  };
  tray.on('click', () => { if (win && !win.isDestroyed() && win.isVisible()) win.hide(); else showWin(); });
  svc.on('state', refresh);
  refresh();
}
function showWin() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1220, height: 800, minWidth: 1000, minHeight: 660, backgroundColor: '#f3f5f9', title: 'JiajiaBox',
    autoHideMenuBar: true, show: !process.env.JIAJIA_SHOT_DIR,
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  Menu.setApplicationMenu(null);
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('close', (e) => {
    // close-to-tray: hide instead of quitting unless we are really quitting
    if (!quitting && svc && svc.d.settings.closeToTray && tray) { e.preventDefault(); win.hide(); }
  });
}

const handlers = {
  state: () => svc.state(),
  addSub: (a) => svc.addSubscription(a),
  importLinks: (a) => svc.importLinks(a),
  updateSub: (a) => svc.updateSubscription(a.id),
  updateAllSubs: () => svc.updateAllSubscriptions(),
  removeSub: (a) => svc.removeSubscription(a.id),
  selectNode: (a) => svc.selectNode(a.id),
  testNodes: (a) => svc.testNodes(a && a.ids),
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
};

app.whenReady().then(async () => {
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
  for (const page of (process.env.JIAJIA_SHOT_PAGES || 'home,nodes,subs,rules,conns,stats,logs,settings').split(',')) {
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
