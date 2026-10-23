'use strict';
const { execFile } = require('child_process');

const KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
const BYPASS = 'localhost;127.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;192.168.*;<local>';

const REFRESH_PS = [
  "$sig='[DllImport(\"wininet.dll\",SetLastError=true)] public static extern bool InternetSetOption(IntPtr h,int o,IntPtr b,int l);'",
  '$t=Add-Type -MemberDefinition $sig -Name WI -Namespace JJ -PassThru',
  '$null=$t::InternetSetOption([IntPtr]::Zero,39,[IntPtr]::Zero,0)', // INTERNET_OPTION_SETTINGS_CHANGED
  '$null=$t::InternetSetOption([IntPtr]::Zero,37,[IntPtr]::Zero,0)', // INTERNET_OPTION_REFRESH
].join(';');

const defaultExec = (file, args) => new Promise((resolve, reject) => {
  execFile(file, args, { windowsHide: true, timeout: 15000 }, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr })) : resolve({ stdout, stderr })));
});

class SystemProxy {
  constructor({ exec = defaultExec, platform = process.platform } = {}) { this.exec = exec; this.platform = platform; }
  get supported() { return this.platform === 'win32'; }

  async readValue(name) {
    try {
      const { stdout } = await this.exec('reg', ['query', KEY, '/v', name]);
      const m = new RegExp(`${name}\\s+(REG_\\w+)\\s+(.*)$`, 'm').exec(stdout);
      if (!m) return null;
      return { type: m[1], data: m[2].trim() };
    } catch { return null; }
  }

  /** Snapshot of the current user settings so they can be restored exactly. */
  async snapshot() {
    const out = {};
    for (const k of ['ProxyEnable', 'ProxyServer', 'ProxyOverride']) out[k] = await this.readValue(k);
    return out;
  }

  async write(name, type, data) { await this.exec('reg', ['add', KEY, '/v', name, '/t', type, '/d', String(data), '/f']); }
  async remove(name) { try { await this.exec('reg', ['delete', KEY, '/v', name, '/f']); } catch { /* absent */ } }
  async refresh() { await this.exec('powershell', ['-NoProfile', '-NonInteractive', '-Command', REFRESH_PS]); }

  async enable(host, port) {
    if (!this.supported) return { ok: false, reason: 'System proxy is only implemented for Windows' };
    const backup = await this.snapshot();
    await this.write('ProxyServer', 'REG_SZ', `${host}:${port}`);
    await this.write('ProxyOverride', 'REG_SZ', BYPASS);
    await this.write('ProxyEnable', 'REG_DWORD', 1);
    await this.refresh();
    return { ok: true, backup };
  }

  async disable(backup) {
    if (!this.supported) return { ok: false, reason: 'unsupported platform' };
    if (backup && backup.ProxyEnable) {
      const en = /^0x/i.test(backup.ProxyEnable.data) ? parseInt(backup.ProxyEnable.data, 16) : Number(backup.ProxyEnable.data);
      await this.write('ProxyEnable', 'REG_DWORD', en ? 1 : 0);
    } else await this.write('ProxyEnable', 'REG_DWORD', 0);
    if (backup && backup.ProxyServer) await this.write('ProxyServer', 'REG_SZ', backup.ProxyServer.data); else await this.remove('ProxyServer');
    if (backup && backup.ProxyOverride) await this.write('ProxyOverride', 'REG_SZ', backup.ProxyOverride.data); else await this.remove('ProxyOverride');
    await this.refresh();
    return { ok: true };
  }
}

module.exports = { SystemProxy, KEY, BYPASS, REFRESH_PS };
