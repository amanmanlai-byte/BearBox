'use strict';
// Shared mutable context filled by app.js
const X = { S: null, samples: [], logs: [], nodeFilter: '', logLevel: 'all' };
const PAGES = {};
const isRunning = () => X.S && X.S.core.state === 'running';
const modeName = (m) => (m === 'global' ? '全局' : '规则');

function head(title, ...right) { return h('div', { class: 'head' }, h('h1', {}, title), h('div', { class: 'sp' }), right); }
function empty(title, text, ...actions) { return h('div', { class: 'card empty' }, h('b', {}, title), h('div', {}, text), actions.length ? h('div', { style: { marginTop: '14px' } }, actions) : null); }
const goto = (p) => window.__go(p);

// ---------------------------------------------------------------- home
PAGES.home = () => {
  const S = X.S; const running = isRunning(); const starting = S.core.state === 'starting' || S.core.state === 'stopping';
  const stLabel = { stopped: '未连接', starting: '正在启动…', running: '运行中', stopping: '正在停止…' }[S.core.state];
  const sel = S.nodes.find((n) => n.id === S.selectedId);

  const startBtn = h('button', { class: 'btn ' + (running ? 'stop' : 'primary'), style: { minWidth: '96px', padding: '9px 22px' }, disabled: starting || (!running && S.nodes.length === 0),
    onclick: (e) => act(() => api(running ? 'stop' : 'start'), running ? '已停止' : '已启动', e.currentTarget) }, running ? '停止' : starting ? '请稍候' : '启动');

  const select = h('select', { 'aria-label': '当前节点', disabled: S.nodes.length === 0, onchange: (e) => act(() => api('selectNode', { id: e.target.value })) },
    S.nodes.map((n) => h('option', { value: n.id, selected: n.id === S.selectedId }, `${n.tag}`)));
  select.value = S.selectedId || '';

  let sub;
  if (S.core.error) sub = h('div', { class: 'err' }, S.core.error);
  else if (S.nodes.length === 0) sub = h('div', { class: 'sub' }, '还没有节点，先到订阅页导入订阅或分享链接');
  else if (running) sub = h('div', { class: 'sub' }, `本地代理 127.0.0.1:${S.settings.mixedPort} · ${modeName(S.settings.mode)}模式 · 系统代理${S.proxyApplied ? '已开启' : '未开启'}`);
  else sub = h('div', { class: 'sub' }, `${S.nodes.length} 个节点，当前选择：${sel ? sel.tag : '-'}`);

  const hero = h('div', { class: 'card hero' },
    h('span', { class: 'dot ' + (running ? 'run' : starting ? 'wait' : ''), style: { width: '12px', height: '12px' } }),
    h('div', {}, h('div', { class: 'st' }, stLabel), sub), h('div', { class: 'sp' }), select, startBtn);

  const dl = h('div', { class: 'v down' }, '-'); const ul = h('div', { class: 'v up' }, '-');
  const canvas = h('canvas', { 'aria-label': '实时上传下载速度曲线' });
  const chart = h('div', { class: 'card chart-card' },
    h('div', { class: 'live' },
      h('div', {}, h('div', { class: 'k' }, h('i', { style: { background: 'var(--down)' } }), '下载'), dl),
      h('div', {}, h('div', { class: 'k' }, h('i', { style: { background: 'var(--up)' } }), '上传'), ul)), canvas);

  const t = { conn: h('div', { class: 'v' }, '-'), sess: h('div', { class: 's' }, '-'), sessV: h('div', { class: 'v' }, '-'), tdy: h('div', { class: 's' }, '-'), tdyV: h('div', { class: 'v' }, '-'), mem: h('div', { class: 'v' }, '-') };
  const tile = (title, v, s, note) => h('div', { class: 'card tile' }, h('h2', {}, title), v, s, note ? h('div', { class: 'unavail' }, note) : null);
  const tiles = h('div', { class: 'grid cols-4', style: { margin: '14px 0' } },
    tile('当前连接数', t.conn, null, running ? null : '内核未运行'),
    tile('本次运行流量', t.sessV, t.sess, running ? null : '内核未运行'),
    tile('今日累计流量', t.tdyV, t.tdy),
    tile('内核内存占用', t.mem, null, running ? null : '内核未运行'));

  const dcanvas = h('canvas', { style: { height: '170px' }, 'aria-label': '近7天流量' });
  const days = lastDays(S.daily, 7);
  const daily = h('div', { class: 'card' }, h('h2', {}, '近 7 天流量（下载蓝 / 上传红）'), dcanvas, h('div', { class: 'note' }, '数据来自内核流量计数器，仅包含本客户端启动内核期间的流量'));

  const ranked = S.nodes.filter((n) => n.latency != null).sort((a, b) => a.latency - b.latency).slice(0, 6);
  const maxLat = Math.max(500, ...ranked.map((n) => n.latency));
  const rank = h('div', { class: 'card' }, h('h2', {}, '节点延迟排行'),
    ranked.length ? h('div', { class: 'rank' }, ranked.map((n) => h('div', { class: 'it' }, h('div', { class: 'nm', title: n.tag }, n.tag), h('div', { class: 'mono', style: { textAlign: 'right' } }, n.latency + ' ms'),
      h('div', { class: 'bar' }, h('b', { style: { width: Math.max(3, (n.latency / maxLat) * 100) + '%', background: LAT_COLOR[latClass(n)] } })))))
      : h('div', { class: 'unavail' }, '还没有测速结果。到节点页点击“测速全部”。'));

  const el = h('div', {}, head('概览', modeSeg(), sysProxySwitch()), hero, h('div', { style: { height: '14px' } }), chart, tiles, h('div', { class: 'grid cols-2' }, daily, rank));

  const redraw = () => drawSpeed(canvas, X.samples, { running });
  const paint = (tk) => {
    const last = X.samples[X.samples.length - 1];
    dl.textContent = running && last ? fmtSpeed(last.down) : '-'; ul.textContent = running && last ? fmtSpeed(last.up) : '-';
    if (running && tk) {
      t.conn.textContent = String(tk.connections); t.mem.textContent = fmtBytes(tk.memory);
      t.sessV.textContent = '↓ ' + fmtBytes(tk.downTotal); t.sess.textContent = '↑ ' + fmtBytes(tk.upTotal);
    }
    const td = (tk && tk.today) || S.today; t.tdyV.textContent = '↓ ' + fmtBytes(td.down); t.tdy.textContent = '↑ ' + fmtBytes(td.up);
    redraw();
  };
  setTimeout(() => { paint(null); drawDaily(dcanvas, days); if (running) { t.conn.textContent = String(0); } }, 0);
  return { el, tick: paint, resize: () => { redraw(); drawDaily(dcanvas, days); } };
};

function lastDays(daily, n) {
  const out = []; const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const v = daily[k] || { up: 0, down: 0 }; out.push({ key: k, label: `${d.getMonth() + 1}/${d.getDate()}`, up: v.up, down: v.down });
  }
  return out;
}
function modeSeg() {
  const S = X.S;
  return h('div', { class: 'seg', role: 'group', 'aria-label': '路由模式' }, ['rule', 'global'].map((m) => h('button', { class: S.settings.mode === m ? 'on' : '', onclick: () => S.settings.mode !== m && act(() => api('setSettings', { mode: m }), `已切换为${modeName(m)}模式`) }, modeName(m))));
}
function sysProxySwitch() {
  const S = X.S;
  if (!S.sysproxySupported) return h('span', { class: 'note', title: '当前系统不是 Windows' }, '系统代理：仅 Windows 支持');
  const cb = h('input', { type: 'checkbox', checked: S.proxyApplied, disabled: !isRunning(), onchange: (e) => act(() => api('toggleSysProxy', { on: e.target.checked })) });
  return h('label', { class: 'switch' }, cb, '系统代理');
}

// ---------------------------------------------------------------- nodes
PAGES.nodes = () => {
  const S = X.S; const filter = X.nodeFilter.toLowerCase();
  const list = S.nodes.filter((n) => !filter || (n.tag + n.server + n.type).toLowerCase().includes(filter));
  const counts = { good: 0, mid: 0, slow: 0, bad: 0, none: 0 }; S.nodes.forEach((n) => counts[latClass(n)]++);
  const total = Math.max(1, S.nodes.length);
  const names = { good: '良好 ≤200ms', mid: '一般 ≤500ms', slow: '较慢 >500ms', bad: '超时/失败', none: '未测试' };
  const dist = h('div', { class: 'card', style: { marginBottom: '14px' } }, h('h2', {}, `节点状态分布（共 ${S.nodes.length} 个）`),
    h('div', { class: 'dist' }, Object.keys(counts).map((k) => counts[k] ? h('div', { style: { width: (counts[k] / total) * 100 + '%', background: LAT_COLOR[k] } }) : null)),
    h('div', { class: 'legend' }, Object.keys(counts).map((k) => h('span', {}, h('i', { class: 'c-' + k }), `${names[k]}：${counts[k]}`))),
    h('div', { class: 'note', style: { marginTop: '8px' } }, isRunning() ? '内核运行中：点击测速会让内核通过各节点发起真实的 HTTPS 请求，结果标注为“HTTPS 测试”。标注“TCP 连接”的是内核未运行时测的旧结果。' : '内核未运行：测速只能测到节点服务器的 TCP 连接耗时，仅供参考；启动内核后再测才是真实的代理延迟。'));

  const maxLat = Math.max(600, ...S.nodes.map((n) => n.latency || 0));
  const rows = list.map((n) => {
    const cls = latClass(n);
    const lat = h('div', { class: 'lat' }, h('div', { class: 'bar' }, n.latency != null ? h('b', { style: { width: Math.max(4, (n.latency / maxLat) * 100) + '%', background: LAT_COLOR[cls] } }) : null),
      h('span', { class: cls === 'bad' ? 'err' : 'mut2' }, n.latency != null ? n.latency + ' ms' : cls === 'bad' ? '超时' : '未测试'));
    return h('tr', { class: 'pick' + (n.id === S.selectedId ? ' sel' : ''), onclick: () => act(() => api('selectNode', { id: n.id })) },
      h('td', {}, h('span', { class: 'radio' + (n.id === S.selectedId ? ' on' : ''), role: 'img', 'aria-label': n.id === S.selectedId ? '当前节点' : '' })),
      h('td', { title: n.tag }, n.tag), h('td', {}, h('span', { class: 'tag' }, n.type)), h('td', { class: 'mono mut2' }, `${n.server}:${n.port}`),
      h('td', {}, lat, n.latencyKind ? h('div', { class: 'note' }, n.latencyKind === 'url' ? 'HTTPS 测试' : 'TCP 连接') : null),
      h('td', { class: 'r' }, h('button', { class: 'btn small', onclick: (e) => { e.stopPropagation(); act(() => api('testNodes', { ids: [n.id] })); } }, '测速'), ' ',
        h('button', { class: 'btn small danger', onclick: (e) => { e.stopPropagation(); if (confirm(`删除节点“${n.tag}”？`)) act(() => api('removeNode', { id: n.id })); } }, '删除')));
  });

  const search = h('input', { type: 'text', placeholder: '搜索名称、地址、协议', value: X.nodeFilter, style: { width: '240px' }, 'aria-label': '搜索节点',
    oninput: (e) => { X.nodeFilter = e.target.value; const pos = e.target.selectionStart; window.__render(); const i = document.querySelector('input[aria-label="搜索节点"]'); i.focus(); i.setSelectionRange(pos, pos); } });
  const body = S.nodes.length === 0
    ? empty('还没有节点', '到订阅页添加订阅链接，或粘贴分享链接导入', h('button', { class: 'btn primary', onclick: () => goto('subs') }, '去添加'))
    : h('div', { class: 'scroll' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', { style: { width: '34px' } }, ''), h('th', {}, '名称'), h('th', {}, '协议'), h('th', {}, '地址'), h('th', {}, '延迟'), h('th', {}, ''))), h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: 6, class: 'mut', style: { textAlign: 'center', padding: '24px' } }, '没有匹配的节点')))));
  const btn = h('button', { class: 'btn primary', disabled: S.nodes.length === 0, onclick: (e) => act(() => api('testNodes', {}), '测速完成', e.currentTarget) }, '测速全部');
  return { el: h('div', {}, head('节点', search, btn), dist, body) };
};

// ---------------------------------------------------------------- subscriptions
PAGES.subs = () => {
  const S = X.S;
  const name = h('input', { type: 'text', placeholder: '名称（可留空）', 'aria-label': '订阅名称' }); const url = h('input', { type: 'url', placeholder: 'https://example.com/sub?token=…', 'aria-label': '订阅链接' });
  const add = h('button', { class: 'btn primary', onclick: (e) => act(async () => { const r = await api('addSub', { name: name.value.trim(), url: url.value.trim() }); name.value = ''; url.value = ''; return r; }, (r) => `已导入 ${r.count} 个节点` + (r.errors.length ? `，${r.errors.length} 条无法识别` : ''), e.currentTarget) }, '添加订阅');
  const links = h('textarea', { placeholder: '每行一个分享链接：vmess:// vless:// trojan:// ss:// hysteria2:// tuic:// socks:// http://', 'aria-label': '分享链接' });
  const imp = h('button', { class: 'btn', onclick: (e) => act(async () => { const r = await api('importLinks', { text: links.value }); links.value = ''; return r; }, (r) => `已导入 ${r.count} 个节点` + (r.errors.length ? `，${r.errors.length} 条无法识别` : ''), e.currentTarget) }, '导入分享链接');

  const addCard = h('div', { class: 'card', style: { marginBottom: '14px' } }, h('h2', {}, '添加订阅'),
    h('div', { class: 'row' }, h('div', { style: { width: '200px' } }, name), h('div', { class: 'sp' }, url), add),
    h('div', { class: 'note', style: { marginTop: '8px' } }, '支持 base64 / 明文链接列表、Clash YAML、sing-box JSON 三种订阅格式'));
  const linkCard = h('div', { class: 'card', style: { marginBottom: '14px' } }, h('h2', {}, '导入分享链接'), links, h('div', { class: 'row', style: { marginTop: '10px' } }, imp));

  const cards = S.subscriptions.map((s) => {
    const info = s.info; const used = info ? info.upload + info.download : 0;
    return h('div', { class: 'card', style: { marginBottom: '10px' } }, h('div', { class: 'sub' },
      h('div', {}, h('div', { class: 'row' }, h('b', {}, s.name), h('span', { class: 'tag' }, `${s.count || 0} 个节点`), s.format ? h('span', { class: 'tag' }, s.format) : null),
        h('div', { class: 'meta' }, s.url ? s.url.replace(/([?&](token|key|sub)[^=]*=)[^&]+/gi, '$1***') : '手动导入', ` · 更新于 ${fmtTime(s.updatedAt)}`),
        info && info.total ? h('div', {}, h('div', { class: 'prog' }, h('b', { style: { width: Math.min(100, (used / info.total) * 100) + '%' } })),
          h('div', { class: 'meta' }, `已用 ${fmtBytes(used)} / ${fmtBytes(info.total)}` + (info.expire ? ` · 到期 ${new Date(info.expire * 1000).toLocaleDateString()}` : ''))) : null,
        s.error ? h('div', { class: 'err' }, '更新失败：' + s.error) : null,
        s.errors && s.errors.length ? h('div', { class: 'note' }, `${s.errors.length} 条未能识别（例如：${s.errors[0].error}）`) : null),
      h('div', { class: 'row' },
        s.url ? h('button', { class: 'btn small', onclick: (e) => act(() => api('updateSub', { id: s.id }), (r) => `已更新，共 ${r.count} 个节点`, e.currentTarget) }, '更新') : null,
        h('button', { class: 'btn small danger', onclick: () => confirm(`删除订阅“${s.name}”及其全部节点？`) && act(() => api('removeSub', { id: s.id })) }, '删除'))));
  });
  const updAll = h('button', { class: 'btn', disabled: !S.subscriptions.some((s) => s.url), onclick: (e) => act(() => api('updateAllSubs'), '全部订阅已更新', e.currentTarget) }, '更新全部');
  return { el: h('div', {}, head('订阅', updAll), addCard, linkCard, cards.length ? cards : empty('还没有订阅', '添加订阅链接或导入分享链接后，节点会出现在节点页')) };
};

// ---------------------------------------------------------------- rules
PAGES.rules = () => {
  const S = X.S;
  const outName = { proxy: '代理', direct: '直连', block: '拦截' };
  const rows = S.rules.map((r) => h('tr', {},
    h('td', {}, h('input', { type: 'checkbox', checked: r.enabled !== false, 'aria-label': '启用', onchange: (e) => act(() => api('saveRule', { ...r, enabled: e.target.checked })) })),
    h('td', {}, r.name || '(未命名)'),
    h('td', { class: 'mono mut2' }, [r.domain && 'D: ' + r.domain.split(/[\n,]/)[0] + (r.domain.split(/[\n,]/).length > 1 ? ' …' : ''), r.ip && 'IP: ' + r.ip, r.port && '端口: ' + r.port, r.network && r.network !== 'any' && r.network, r.protocol && '协议: ' + r.protocol].filter(Boolean).join('  ')),
    h('td', {}, h('span', { class: 'tag' }, outName[r.outbound] || r.outbound)),
    h('td', { class: 'r' }, h('button', { class: 'btn small', onclick: () => ruleForm(r) }, '编辑'), ' ', h('button', { class: 'btn small danger', onclick: () => confirm('删除这条规则？') && act(() => api('removeRule', { id: r.id })) }, '删除'))));
  const body = S.rules.length ? h('div', { class: 'scroll' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', { style: { width: '40px' } }, ''), h('th', {}, '名称'), h('th', {}, '匹配条件'), h('th', {}, '出站'), h('th', {}, ''))), h('tbody', {}, rows)))
    : empty('没有自定义规则', '自定义规则优先于“绕过局域网”之后的内置规则生效', h('button', { class: 'btn primary', onclick: () => ruleForm() }, '新建规则'));
  const info = h('div', { class: 'card', style: { marginBottom: '14px' } }, h('h2', {}, '当前路由'),
    h('div', { class: 'row wrap' }, h('span', {}, '模式：'), modeSeg(), h('span', { class: 'mut2' }, S.settings.mode === 'rule' ? '中国大陆域名与 IP 直连，其余走代理（规则集首次需要联网下载）' : '所有流量走代理（局域网除外，若已开启绕过）')),
    h('div', { class: 'note', style: { marginTop: '8px' } }, '规则修改后内核会自动重启生效。domain 支持：普通域名（后缀匹配）、full:、keyword:、regexp:。geosite:/geoip: 前缀暂不支持，会被跳过并在日志里提示。'));
  return { el: h('div', {}, head('代理规则', h('button', { class: 'btn primary', onclick: () => ruleForm() }, '新建规则')), info, body) };
};
function ruleForm(r = {}) {
  const f = {
    name: h('input', { type: 'text', value: r.name || '' }), domain: h('textarea', { placeholder: 'example.com\nfull:www.example.com\nkeyword:ads\nregexp:^ad\\d+\\.', value: r.domain || '' }),
    ip: h('input', { type: 'text', placeholder: '10.0.0.0/8, 8.8.8.8/32', value: r.ip || '' }), port: h('input', { type: 'text', placeholder: '80, 443, 1000-2000', value: r.port || '' }),
    network: h('select', { value: r.network || 'any' }, ['any', 'tcp', 'udp'].map((v) => h('option', { value: v }, v === 'any' ? '全部' : v.toUpperCase()))),
    protocol: h('input', { type: 'text', placeholder: 'http, tls, quic, dns', value: r.protocol || '' }),
    outbound: h('select', { value: r.outbound || 'proxy' }, [['proxy', '代理'], ['direct', '直连'], ['block', '拦截']].map(([v, l]) => h('option', { value: v }, l))),
  };
  f.network.value = r.network || 'any'; f.outbound.value = r.outbound || 'proxy';
  const fld = (l, el, span) => h('div', { class: 'field' + (span ? ' span2' : '') }, h('label', {}, l), el);
  const body = h('div', { class: 'form-grid' }, fld('名称', f.name, 1), fld('域名（每行一条）', f.domain, 1), fld('目标 IP / CIDR', f.ip), fld('端口', f.port), fld('网络', f.network), fld('协议（探测结果）', f.protocol), fld('出站', f.outbound, 1));
  modal(r.id ? '编辑规则' : '新建规则', body, (close) => [h('button', { class: 'btn', onclick: close }, '取消'),
    h('button', { class: 'btn primary', onclick: (e) => act(async () => { await api('saveRule', { id: r.id, enabled: r.enabled, name: f.name.value, domain: f.domain.value, ip: f.ip.value, port: f.port.value, network: f.network.value, protocol: f.protocol.value, outbound: f.outbound.value }); close(); }, '规则已保存', e.currentTarget) }, '保存')]);
}

// ---------------------------------------------------------------- connections
PAGES.conns = () => {
  const running = isRunning(); const wrap = h('div', {}); let timer = null; let alive = true;
  const closeAll = h('button', { class: 'btn danger', disabled: !running, onclick: () => act(() => api('closeAll'), '已关闭全部连接') }, '关闭全部');
  const count = h('span', { class: 'mut2' }, '');
  const draw = async () => {
    if (!alive) return; let list = [];
    if (running) { try { list = await api('connections'); } catch { /* core may be stopping */ } }
    if (!alive) return; wrap.replaceChildren();
    count.textContent = running ? `${list.length} 条活动连接` : '';
    if (!running) { wrap.append(empty('内核未运行', '启动后这里会实时列出所有经过代理内核的连接', h('button', { class: 'btn primary', onclick: () => goto('home') }, '去启动'))); return; }
    if (!list.length) { wrap.append(empty('暂无活动连接', '有程序通过代理访问网络时会显示在这里')); return; }
    const now = Date.now();
    const rows = list.slice().sort((a, b) => new Date(b.start) - new Date(a.start)).slice(0, 300).map((c) => h('tr', {},
      h('td', { title: c.host }, `${c.host}:${c.port}`), h('td', {}, h('span', { class: 'tag' }, (c.network || '').toUpperCase())), h('td', { class: 'mut2' }, c.rule ? (c.rule === 'final' ? '默认规则' : c.rule) + (c.rulePayload ? ' ' + c.rulePayload : '') : '-'),
      h('td', { class: 'mut2' }, (c.chains || []).slice().reverse().join(' → ')), h('td', { class: 'r' }, fmtBytes(c.upload)), h('td', { class: 'r' }, fmtBytes(c.download)),
      h('td', { class: 'r mut2' }, fmtDur(now - new Date(c.start).getTime())), h('td', { class: 'r' }, h('button', { class: 'btn small', onclick: () => act(() => api('closeConn', { id: c.id })) }, '关闭'))));
    wrap.append(h('div', { class: 'scroll' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['目标', '网络', '规则', '出站链路', '上传', '下载', '时长', ''].map((t, i) => h('th', { class: i > 3 ? 'r' : '' }, t)))), h('tbody', {}, rows))));
  };
  draw(); timer = setInterval(draw, 1000);
  return { el: h('div', {}, head('连接', count, closeAll), wrap), destroy: () => { alive = false; clearInterval(timer); } };
};

// ---------------------------------------------------------------- stats
PAGES.stats = () => {
  const S = X.S; const days = lastDays(S.daily, 30); const canvas = h('canvas', { style: { height: '230px' }, 'aria-label': '近30天流量' });
  const sum = days.reduce((a, d) => ({ up: a.up + d.up, down: a.down + d.down }), { up: 0, down: 0 });
  const tile = (t, v, s) => h('div', { class: 'card tile' }, h('h2', {}, t), h('div', { class: 'v' }, v), h('div', { class: 's' }, s));
  const list = days.slice().reverse().filter((d) => d.up || d.down);
  const table = list.length ? h('div', { class: 'scroll', style: { maxHeight: '300px' } }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['日期', '下载', '上传', '合计'].map((t, i) => h('th', { class: i ? 'r' : '' }, t)))),
    h('tbody', {}, list.map((d) => h('tr', {}, h('td', {}, d.key), h('td', { class: 'r' }, fmtBytes(d.down)), h('td', { class: 'r' }, fmtBytes(d.up)), h('td', { class: 'r' }, fmtBytes(d.up + d.down)))))))
    : h('div', { class: 'card unavail' }, '还没有流量记录。启动内核并产生流量后，这里会按天累计。');
  const el = h('div', {}, head('流量统计', h('button', { class: 'btn danger', onclick: () => confirm('清空全部流量历史？') && act(() => api('clearStats'), '已清空') }, '清空历史')),
    h('div', { class: 'grid cols-4', style: { marginBottom: '14px' } },
      tile('今日', '↓ ' + fmtBytes(S.today.down), '↑ ' + fmtBytes(S.today.up)), tile('近 30 天', '↓ ' + fmtBytes(sum.down), '↑ ' + fmtBytes(sum.up)),
      tile('本次运行', isRunning() ? '↓ ' + fmtBytes(S.session.downTotal) : '-', isRunning() ? '↑ ' + fmtBytes(S.session.upTotal) : '内核未运行'), tile('活动天数', String(days.filter((d) => d.up || d.down).length), '近 30 天内有流量的天数')),
    h('div', { class: 'card', style: { marginBottom: '14px' } }, h('h2', {}, '近 30 天每日流量（下载蓝 / 上传红）'), canvas, h('div', { class: 'note' }, '统计的是内核流量计数器的增量，只包含本客户端启动内核期间的流量，不包含系统其他网络流量')), table);
  setTimeout(() => drawDaily(canvas, days), 0);
  return { el, resize: () => drawDaily(canvas, days) };
};

// ---------------------------------------------------------------- logs
PAGES.logs = () => {
  const box = h('div', { class: 'logs', role: 'log' });
  const levelOk = (l) => X.logLevel === 'all' || (X.logLevel === 'warn' ? ['warn', 'error', 'fatal', 'panic'].includes(l.level) : X.logLevel === 'error' ? ['error', 'fatal', 'panic'].includes(l.level) : true);
  const line = (l) => h('div', { class: 'l-' + l.level }, `${new Date(l.t).toLocaleTimeString()}  ${l.text}`);
  const fill = () => { box.replaceChildren(...X.logs.filter(levelOk).slice(-500).map(line)); if (!X.logs.length) box.textContent = '暂无日志。启动内核后，运行日志会显示在这里。'; box.scrollTop = box.scrollHeight; };
  const sel = h('select', { style: { width: '120px' }, 'aria-label': '日志级别', onchange: (e) => { X.logLevel = e.target.value; fill(); } }, [['all', '全部'], ['warn', '警告及以上'], ['error', '仅错误']].map(([v, l]) => h('option', { value: v }, l)));
  sel.value = X.logLevel;
  fill();
  return { el: h('div', {}, head('运行日志', sel, h('button', { class: 'btn', onclick: () => act(async () => { await api('clearLogs'); X.logs = []; fill(); }) }, '清空')), box),
    log: (l) => { if (!levelOk(l)) return; const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 30; if (!X.logs.length || box.firstChild && box.childElementCount === 0) box.replaceChildren(); box.append(line(l)); while (box.childElementCount > 500) box.firstChild.remove(); if (stick) box.scrollTop = box.scrollHeight; } };
};

// ---------------------------------------------------------------- settings
PAGES.settings = () => {
  const S = X.S; const s = S.settings; const F = {};
  const text = (k, type = 'text') => (F[k] = h('input', { type, value: s[k] }));
  const check = (k, label, dis) => { F[k] = h('input', { type: 'checkbox', checked: !!s[k], disabled: dis }); return h('label', { class: 'switch' }, F[k], label); };
  const sel = (k, opts) => { F[k] = h('select', {}, opts.map(([v, l]) => h('option', { value: v }, l))); F[k].value = s[k]; return F[k]; };
  const fld = (l, el, span, hint) => h('div', { class: 'field' + (span ? ' span2' : '') }, h('label', {}, l), el, hint ? h('div', { class: 'note' }, hint) : null);
  const sect = (t, ...kids) => h('div', { class: 'card sect' }, h('h2', {}, t), h('div', { class: 'form-grid' }, kids));

  const save = h('button', { class: 'btn primary', onclick: (e) => act(async () => {
    const patch = {}; for (const [k, el] of Object.entries(F)) patch[k] = el.type === 'checkbox' ? el.checked : (el.type === 'number' ? Number(el.value) : el.value.trim());
    return api('setSettings', patch);
  }, (r) => (r && r.restarted ? '设置已保存，内核已重启生效' : '设置已保存'), e.currentTarget) }, '保存设置');

  const el = h('div', {}, head('设置', save),
    sect('代理', fld('本地代理端口（混合 HTTP/SOCKS）', text('mixedPort', 'number')), fld('路由模式', sel('mode', [['rule', '规则（大陆直连）'], ['global', '全局代理']])),
      h('div', {}, check('allowAccess', '允许来自局域网的连接')), h('div', {}, check('bypassLan', '绕过局域网地址')), h('div', {}, check('trafficSniffing', '启用流量探测（sniff）')),
      h('div', { class: 'span2' }, check('tun', 'TUN 模式（虚拟网卡，需要管理员权限与 wintun.dll）'),
        h('div', { class: 'warnbox', style: { marginTop: '8px' } }, '开启时会请求管理员权限。wintun.dll 必须位于内核文件同一目录；缺失或拒绝 UAC 时会显示明确错误。TUN 模式不会自动设置系统代理。'))),
    sect('DNS', fld('远程 DNS', text('remoteDns'), 0, '经代理查询，例如 https://dns.google/dns-query'), fld('直连 DNS', text('directDns'), 0, '例如 https://223.5.5.5/dns-query 或 local'),
      fld('IPv6 策略', sel('ipv6Mode', [['prefer_ipv4', '优先 IPv4'], ['prefer_ipv6', '优先 IPv6'], ['ipv4_only', '仅 IPv4'], ['ipv6_only', '仅 IPv6']]))),
    sect('内核', fld('Clash API 端口', text('apiPort', 'number'), 0, '仅监听 127.0.0.1，客户端用它读取实时数据'), fld('日志级别', sel('logLevel', [['trace', 'trace'], ['debug', 'debug'], ['info', 'info'], ['warn', 'warn'], ['error', 'error']])),
      fld('测速地址', text('connectionTestURL'), 1, '必须是 https:// 地址：这版内核会忽略 http:// 测速地址'),
      h('div', { class: 'span2 note' }, `内核：${S.core.version || '未找到'}`, h('br'), `路径：${S.core.binary}`)),
    sect('系统', h('div', {}, check('setSystemProxy', '启动时自动设置 Windows 系统代理', !S.sysproxySupported), !S.sysproxySupported ? h('div', { class: 'note' }, '当前系统不是 Windows，此项不可用') : null),
      h('div', {}, check('autoStartCore', '打开客户端时自动启动内核'))));
  return { el };
};
