'use strict';
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const net = require('net');

function resolveCoreBinary(appRoot, resourcesPath) {
  if (process.env.JIAJIA_CORE) return process.env.JIAJIA_CORE;
  const name = process.platform === 'win32' ? 'sing-box-windows-amd64.exe' : `sing-box-${process.platform}-${process.arch === 'x64' ? 'amd64' : process.arch}`;
  const candidates = [
    resourcesPath && path.join(resourcesPath, 'core', name),
    path.join(appRoot, 'core', name),
    path.join(appRoot, 'core', process.platform === 'win32' ? 'sing-box.exe' : 'sing-box'),
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || candidates[candidates.length - 1];
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function portFree(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, host);
  });
}

class Core extends EventEmitter {
  constructor({ binary, workDir }) {
    super();
    this.binary = binary; this.workDir = workDir;
    this.proc = null; this.state = 'stopped'; // stopped | starting | running | stopping
    this.api = null; this.secret = ''; this.timer = null;
    this.last = null; this.samples = []; this.apiOk = false;
    this.connections = []; this.upTotal = 0; this.downTotal = 0; this.memory = 0;
    this.logs = [];
  }

  version() {
    return new Promise((resolve) => {
      const p = spawn(this.binary, ['version']); let out = '';
      p.stdout.on('data', (d) => (out += d)); p.on('error', () => resolve(null)); p.on('close', () => resolve(out.split('\n')[0].trim() || null));
    });
  }

  check(configPath) {
    return new Promise((resolve) => {
      const p = spawn(this.binary, ['check', '-c', configPath]); let out = '';
      p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
      p.on('error', (e) => resolve({ ok: false, output: e.message }));
      p.on('close', (code) => resolve({ ok: code === 0, output: out.replace(/\x1b\[[0-9;]*m/g, '').trim() }));
    });
  }

  pushLog(line) {
    const clean = line.replace(/\x1b\[[0-9;]*m/g, '').trimEnd(); if (!clean) return;
    const m = /\b(TRACE|DEBUG|INFO|WARN|ERROR|FATAL|PANIC)\b/.exec(clean);
    const entry = { t: Date.now(), level: m ? m[1].toLowerCase() : 'info', text: clean };
    this.logs.push(entry); if (this.logs.length > 2000) this.logs.splice(0, this.logs.length - 2000);
    this.emit('log', entry);
  }

  async start({ config, apiPort, secret }) {
    if (this.state !== 'stopped') throw new Error(`core is ${this.state}`);
    fs.mkdirSync(this.workDir, { recursive: true });
    const cfgPath = path.join(this.workDir, 'config.json');
    fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2));
    if (!fs.existsSync(this.binary)) throw new Error(`Core binary not found: ${this.binary}`);
    const mixed = config.inbounds.find((i) => i.type === 'mixed');
    if (mixed && !(await portFree(mixed.listen_port, mixed.listen === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1'))) throw new Error(`Port ${mixed.listen_port} is already in use`);
    const chk = await this.check(cfgPath);
    if (!chk.ok) throw new Error('Config check failed: ' + chk.output);

    this.state = 'starting'; this.emit('status', this.status());
    this.api = `http://127.0.0.1:${apiPort}`; this.secret = secret;
    this.last = null; this.samples = []; this.connections = []; this.apiOk = false;
    this.proc = spawn(this.binary, ['run', '-c', cfgPath, '-D', this.workDir], { windowsHide: true });
    const onData = (buf) => buf.toString().split(/\r?\n/).forEach((l) => this.pushLog(l));
    this.proc.stdout.on('data', onData); this.proc.stderr.on('data', onData);
    this.proc.on('error', (e) => { this.pushLog(`ERROR process: ${e.message}`); });
    this.proc.on('close', (code) => {
      this.pushLog(`INFO core exited with code ${code}`);
      clearInterval(this.timer); this.timer = null; this.proc = null;
      const wasStopping = this.state === 'stopping';
      this.state = 'stopped'; this.apiOk = false; this.emit('status', this.status());
      if (!wasStopping && code !== 0) this.emit('crashed', code);
    });

    // wait for API
    for (let i = 0; i < 60; i++) {
      if (!this.proc) throw new Error('Core exited during startup, see logs');
      try { await this.get('/version'); this.apiOk = true; break; } catch { await wait(250); }
    }
    if (!this.apiOk) { await this.stop(); throw new Error('Core API did not become ready'); }
    // counters of a fresh core process start at zero, so the baseline is zero (not the first poll)
    this.last = { t: Date.now(), up: 0, down: 0 };
    this.state = 'running'; this.emit('status', this.status());
    this.timer = setInterval(() => this.poll().catch(() => {}), 1000);
    return true;
  }

  async stop() {
    if (!this.proc) { this.state = 'stopped'; return; }
    this.state = 'stopping'; this.emit('status', this.status());
    const p = this.proc;
    await new Promise((resolve) => {
      const kill = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* gone */ } }, 4000);
      p.once('close', () => { clearTimeout(kill); resolve(); });
      try { p.kill(process.platform === 'win32' ? undefined : 'SIGTERM'); } catch { resolve(); }
    });
  }

  status() { return { state: this.state, apiOk: this.apiOk }; }

  async request(method, p, body) {
    const res = await fetch(this.api + p, { method, headers: { Authorization: `Bearer ${this.secret}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error(`API ${p} -> HTTP ${res.status}`);
    const t = await res.text(); return t ? JSON.parse(t) : {};
  }
  get(p) { return this.request('GET', p); }

  async poll() {
    const c = await this.get('/connections');
    const now = Date.now();
    const up = c.uploadTotal || 0; const down = c.downloadTotal || 0;
    let upSpeed = 0; let downSpeed = 0;
    if (this.last && now > this.last.t) {
      const dt = (now - this.last.t) / 1000;
      upSpeed = Math.max(0, (up - this.last.up) / dt); downSpeed = Math.max(0, (down - this.last.down) / dt);
    }
    const dUp = this.last ? Math.max(0, up - this.last.up) : 0; const dDown = this.last ? Math.max(0, down - this.last.down) : 0;
    this.last = { t: now, up, down };
    this.upTotal = up; this.downTotal = down; this.memory = c.memory || 0;
    this.connections = (c.connections || []).map((x) => ({
      id: x.id, host: x.metadata.host || x.metadata.destinationIP, port: x.metadata.destinationPort, network: x.metadata.network,
      type: x.metadata.type, source: x.metadata.sourceIP, upload: x.upload, download: x.download,
      start: x.start, chains: x.chains, rule: x.rule, rulePayload: x.rulePayload,
    }));
    const sample = { t: now, up: upSpeed, down: downSpeed };
    this.samples.push(sample); if (this.samples.length > 300) this.samples.shift();
    this.emit('tick', { ...sample, upTotal: up, downTotal: down, deltaUp: dUp, deltaDown: dDown, connections: this.connections.length, memory: this.memory });
  }

  async selectNode(tag) { await this.request('PUT', '/proxies/proxy', { name: tag }); }
  async currentNode() { const p = await this.get('/proxies/proxy'); return p.now; }
  async delay(tag, url, timeout = 5000) {
    const q = `?url=${encodeURIComponent(url)}&timeout=${timeout}`;
    const r = await this.get(`/proxies/${encodeURIComponent(tag)}/delay${q}`);
    return r.delay;
  }
  async closeConnection(id) { await this.request('DELETE', `/connections/${id}`); }
  async closeAll() { await this.request('DELETE', '/connections'); }
}

/** TCP connect latency; usable without the core running. Returns ms or null. */
function tcpPing(host, port, timeout = 3000) {
  return new Promise((resolve) => {
    const t0 = process.hrtime.bigint(); const s = net.connect({ host, port });
    const done = (v) => { s.destroy(); resolve(v); };
    s.setTimeout(timeout, () => done(null)); s.once('error', () => done(null));
    s.once('connect', () => done(Number((process.hrtime.bigint() - t0) / 1000000n)));
  });
}

module.exports = { Core, resolveCoreBinary, tcpPing, portFree };
