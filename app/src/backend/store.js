'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DEFAULT_SETTINGS } = require('./config');

const EMPTY = () => ({
  version: 1,
  settings: { ...DEFAULT_SETTINGS },
  subscriptions: [],   // {id,name,url,updatedAt,info,error,format}
  nodes: [],           // {id,subId,outbound,latency,latencyKind,testedAt}
  selectedId: null,
  rules: [],           // {id,name,enabled,domain,ip,port,network,protocol,outbound}
  daily: {},           // 'YYYY-MM-DD' -> {up,down} bytes, measured from core counters
  sysproxyBackup: null,
  secret: crypto.randomBytes(12).toString('hex'),
});

class Store {
  constructor(file) {
    this.file = file; this.data = EMPTY(); this._t = null;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.data = { ...EMPTY(), ...raw, settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) } };
    } catch { /* first run or corrupt: start empty (corrupt file is kept as .bad) */
      if (fs.existsSync(file)) { try { fs.copyFileSync(file, file + '.bad'); } catch { /* ignore */ } }
    }
  }
  id() { return crypto.randomBytes(6).toString('hex'); }
  save() {
    clearTimeout(this._t);
    this._t = setTimeout(() => this.flush(), 300);
  }
  flush() {
    clearTimeout(this._t);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

module.exports = { Store, dayKey };
