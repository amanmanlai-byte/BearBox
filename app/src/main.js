'use strict';
const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { AppService } = require('./backend/service');

if (process.env.JIAJIA_NOSANDBOX) app.commandLine.appendSwitch('no-sandbox');
if (process.env.JIAJIA_USERDATA) app.setPath('userData', process.env.JIAJIA_USERDATA);
if (!app.requestSingleInstanceLock()) { app.quit(); }

let win; let svc; let quitting = false;

function send(ch, data) { if (win && !win.isDestroyed()) win.webContents.send(ch, data); }

function createWindow() {
  win = new BrowserWindow({
    width: 1200, height: 780, minWidth: 980, minHeight: 640, backgroundColor: '#eef1f6', title: 'JiajiaBox',
    autoHideMenuBar: true, show: !process.env.JIAJIA_SHOT_DIR,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  Menu.setApplicationMenu(null);
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
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
  start: () => svc.start(),
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
  if (svc.d.settings.autoStartCore && svc.d.nodes.length) svc.start().catch(() => {});
  if (process.env.JIAJIA_SHOT_DIR) runShots(process.env.JIAJIA_SHOT_DIR);
});

// Test hook: render every page to PNG for visual verification (only when JIAJIA_SHOT_DIR is set).
async function runShots(dir) {
  fs.mkdirSync(dir, { recursive: true });
  await new Promise((r) => win.webContents.once('did-finish-load', r));
  await new Promise((r) => setTimeout(r, Number(process.env.JIAJIA_SHOT_PRE || 1500)));
  for (const page of ['home', 'nodes', 'subs', 'rules', 'conns', 'stats', 'logs', 'settings']) {
    await win.webContents.executeJavaScript(`window.__go && window.__go(${JSON.stringify(page)})`);
    await new Promise((r) => setTimeout(r, Number(process.env.JIAJIA_SHOT_WAIT || 700)));
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(dir, `${page}.png`), img.toPNG());
  }
  quitting = true; app.quit();
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', (e) => {
  if (quitting || !svc) return;
  e.preventDefault(); quitting = true;
  svc.shutdown().catch(() => {}).finally(() => app.quit());
});
