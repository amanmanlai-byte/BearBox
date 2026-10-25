'use strict';
// The eight pages. Each PAGES.x() returns { el, tick?, log?, resize?, destroy? }.
// Live data flows in through tick/log; state changes trigger a full re-render from app.js.
const PAGES = {};

function lastDays(daily, n) {
  const out = []; const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const k = dayKeyOf(d);
    const v = (daily && daily[k]) || { up: 0, down: 0 };
    out.push({ key: k, label: `${d.getMonth() + 1}/${d.getDate()}`, up: v.up || 0, down: v.down || 0 });
  }
  return out;
}

function segMode() {
  const S = X.S;
  return h('div', { class: 'seg', role: 'group', 'aria-label': '路由模式' },
    ['rule', 'global'].map((m) => h('button', { class: S.settings.mode === m ? 'on' : '', onclick: () => S.settings.mode !== m && act(() => api('setSettings', { mode: m }), `已切换为${modeName(m)}模式`) }, modeName(m))));
}
function sysProxySwitch() {
  const S = X.S;
  if (!S.sysproxySupported) return h('span', { class: 'note', title: '当前系统不是 Windows' }, '系统代理：仅 Windows 支持');
  const cb = h('input', { type: 'checkbox', checked: S.proxyApplied, disabled: !isRunning(), onchange: (e) => act(() => api('toggleSysProxy', { on: e.target.checked }), e.target.checked ? '系统代理已开启' : '系统代理已还原') });
  return h('label', { class: 'switch' }, cb, '系统代理');
}

// ================================================================ home
PAGES.home = () => {
  const S = X.S;
  const running = isRunning();
  const busy = S.core.state === 'starting' || S.core.state === 'stopping';
  const stLabel = { stopped: '未连接', starting: '正在启动…', running: '已连接，代理运行中', stopping: '正在停止…' }[S.core.state];
  const sel = S.nodes.find((n) => n.id === S.selectedId);

  const power = h('button', { class: 'power' + (running ? ' on' : '') + (busy ? ' busy' : ''), 'aria-label': running ? '停止内核' : '启动内核',
    disabled: busy || (!running && S.nodes.length === 0),
    onclick: () => act(() => api(running ? 'stop' : 'start'), running ? '内核已停止' : '内核已启动') }, svgIcon(ICONS.power));

  const nodeSel = h('select', { 'aria-label': '当前节点', disabled: S.nodes.length === 0, onchange: (e) => act(() => api('selectNode', { id: e.target.value }), '已切换节点') },
    S.nodes.map((n) => h('option', { value: n.id }, n.tag)));
  nodeSel.value = S.selectedId || '';

  let subLine;
  if (S.core.error) subLine = h('div', { class: 'err' }, S.core.error);
  else if (S.nodes.length === 0) subLine = h('div', {}, h('span', { class: 'mut2' }, '还没有节点，'), h('a', { href: '#', onclick: (e) => { e.preventDefault(); goto('subs'); } }, '去添加订阅或导入分享链接'), h('span', { class: 'mut2' }, '。'));
  else if (running) subLine = `${'本地代理 127.0.0.1:' + S.settings.mixedPort + ' · ' + modeName(S.settings.mode) + '模式 · 系统代理' + (S.proxyApplied ? '已开启' : '未开启') + (S.settings.tun ? ' · TUN' : '')}`;
  else subLine = `${S.nodes.length} 个节点就绪，当前选择：${sel ? sel.tag : '-'}`;

  const hero = h('div', { class: 'card hero' },
    power,
    h('div', {}, h('div', { class: 'st-big' }, h('span', { class: 'dot ' + (running ? 'run' : busy ? 'wait' : '') }), stLabel), h('div', { class: 'sub' }, subLine)),
    h('div', { class: 'right' }, nodeSel, sysProxySwitch(), segMode()));

  // live speed chart
  const downV = h('div', { class: 'v down-c' }, '-'); const upV = h('div', { class: 'v up-c' }, '-');
  const peakV = h('div', { class: 'peak' }, '');
  const chartCanvas = h('canvas', { class: 'chart', 'aria-label': '实时上传下载速度曲线' });
  const chart = new SpeedChart(chartCanvas);
  const chartCard = h('div', { class: 'card chart-card' },
    h('div', { class: 'live-strip' },
      h('div', { class: 'item' }, h('div', { class: 'k' }, h('i', { style: { background: 'var(--down)' } }), '下载'), downV),
      h('div', { class: 'item' }, h('div', { class: 'k' }, h('i', { style: { background: 'var(--up)' } }), '上传'), upV),
      peakV),
    chartCanvas,
    h('div', { class: 'note', style: { marginTop: '8px' } }, '数据来自内核 Clash API 每秒轮询的真实字节计数器'));

  // stat tiles
  const mkTile = (label, main, extra, spark, sparkColor) => {
    const c = spark ? h('canvas', { class: 'spark' }) : null;
    return { el: h('div', { class: 'card tile' }, h('div', { class: 'k' }, label), main, extra, c), canvas: c, color: sparkColor };
  };
  const connTile = mkTile('活动连接', h('div', { class: 'v' }, running ? '0' : '-'), null, true, '--down');
  const sessTile = mkTile('本次运行流量', h('div', { class: 'duo' }, h('div', {}, h('div', { class: 'v down-c', ref: 'sd' }, running ? '↓ ' + fmtBytes(S.session.downTotal) : '-')), h('div', {}, h('div', { class: 'v up-c', ref: 'su' }, running ? '↑ ' + fmtBytes(S.session.upTotal) : '-'))), null);
  const tdV = h('div', { class: 'v down-c' }, '↓ ' + fmtBytes(S.today.down));
  const tuV = h('div', { class: 'v up-c' }, '↑ ' + fmtBytes(S.today.up));
  const todayTile = mkTile('今日流量', h('div', { class: 'duo' }, h('div', {}, tdV), h('div', {}, tuV)), null);
  const memTile = mkTile('内核内存占用', h('div', { class: 'v' }, running ? fmtBytes(S.session.memory) : '-'), null, true, '--up');
  const tiles = h('div', { class: 'grid cols-4', style: { margin: '14px 0' } }, connTile.el, sessTile.el, todayTile.el, memTile.el);

  // 7-day bars + latency rank
  const days7 = lastDays(S.daily, 7);
  const dCanvas = h('canvas', { style: { height: '180px', width: '100%', display: 'block' }, 'aria-label': '近7天流量' });
  const dailyChart = new DailyBars(dCanvas);
  const dailyCard = h('div', { class: 'card' }, h('h2', {}, '近 7 天流量', h('span', { class: 'hint' }, '下载蓝 · 上传红')), dCanvas,
    h('div', { class: 'note', style: { marginTop: '8px' } }, '仅统计本客户端启动内核期间的流量'));

  const ranked = S.nodes.filter((n) => n.latency != null).sort((a, b) => a.latency - b.latency).slice(0, 6);
  const maxLat = Math.max(500, ...ranked.map((n) => n.latency));
  const rankBody = ranked.length
    ? h('div', { class: 'rank' }, ranked.map((n, i) => h('div', { class: 'it' },
      h('span', { class: 'idx' }, i + 1), h('span', { class: 'nm', title: n.tag }, n.tag),
      h('div', { class: 'bar' }, h('b', { style: { width: Math.max(4, (n.latency / maxLat) * 100) + '%', background: LAT_COLOR[latClass(n)] } })),
      h('span', { class: 'ms' }, n.latency + ' ms'))))
    : h('div', { class: 'unavail' }, '还没有测速结果。到节点页点击“测速全部”。');
  const rankCard = h('div', { class: 'card' }, h('h2', {}, '节点延迟排行', h('span', { class: 'hint' }, '最快前 6')), rankBody);

  const el = h('div', { class: 'page' },
    pageHead('概览', '内核状态与实时流量总览'),
    hero, h('div', { style: { height: '14px' } }), chartCard, tiles,
    S.nodes.length === 0
      ? emptyState('subs', '从添加第一个节点开始', '添加订阅链接或粘贴分享链接后，这里会显示实时流量与统计。', h('button', { class: 'btn primary', onclick: () => goto('subs') }, '去添加订阅'))
      : h('div', { class: 'row-2' }, dailyCard, rankCard));

  const connV = connTile.el.querySelector('.v'); const memV = memTile.el.querySelector('.v');
  const sdV = sessTile.el.querySelector('[ref=sd]'); const suV = sessTile.el.querySelector('[ref=su]');
  const redrawSparks = () => {
    const ss = X.samples.slice(-60);
    if (connTile.canvas) drawSpark(connTile.canvas, ss.map((s) => s.conn || 0), { color: '--down' });
    if (memTile.canvas) drawSpark(memTile.canvas, ss.map((s) => s.mem || 0), { color: '--up' });
  };
  const paint = (tk) => {
    const last = X.samples[X.samples.length - 1];
    downV.textContent = running && last ? fmtSpeed(last.down) : '-';
    upV.textContent = running && last ? fmtSpeed(last.up) : '-';
    const win = X.samples.slice(-120);
    peakV.textContent = running && win.length ? `峰值 ↓ ${fmtSpeed(Math.max(0, ...win.map((s) => s.down || 0)))}\n峰值 ↑ ${fmtSpeed(Math.max(0, ...win.map((s) => s.up || 0)))}` : '';
    peakV.style.whiteSpace = 'pre-line';
    const today = (tk && tk.today) || X.S.today;
    if (today) { tdV.textContent = '↓ ' + fmtBytes(today.down || 0); tuV.textContent = '↑ ' + fmtBytes(today.up || 0); }
    if (running) {
      if (tk) { connV.textContent = String(tk.connections); memV.textContent = fmtBytes(tk.memory); sdV.textContent = '↓ ' + fmtBytes(tk.downTotal); suV.textContent = '↑ ' + fmtBytes(tk.upTotal); }
      else { connV.textContent = String(last ? last.conn || 0 : 0); }
    }
    chart.update(X.samples.slice(-120), running);
    redrawSparks();
  };
  const mount = () => { paint(null); dailyChart.update(days7); };
  mount();
  return {
    el,
    mount,
    tick: (tk) => paint(tk),
    state(S2) { // structural change happened elsewhere (e.g. daily history) - refresh today numbers in place
      tdV.textContent = '↓ ' + fmtBytes(S2.today.down || 0);
      tuV.textContent = '↑ ' + fmtBytes(S2.today.up || 0);
    },
    resize: () => { paint(null); dailyChart.update(lastDays(X.S.daily, 7)); },
  };
};

// preset URL test endpoints (editable via 自定义)
const TEST_URL_PRESETS = [
  ['https://www.google.com/generate_204', 'Google'],
  ['https://cp.cloudflare.com/generate_204', 'Cloudflare'],
  ['https://www.gstatic.com/generate_204', 'gstatic'],
];
function testUrlSelect() {
  const S = X.S;
  const cur = S.settings.connectionTestURL;
  const preset = TEST_URL_PRESETS.find(([u]) => u === cur);
  const sel = h('select', { 'aria-label': '测速地址', 'data-keep': 'testUrl', style: { maxWidth: '170px' }, title: 'URL 测速地址（经各节点发起真实 HTTPS 请求）' },
    TEST_URL_PRESETS.map(([u, l]) => h('option', { value: u }, l + ' 204')),
    h('option', { value: '__custom' }, preset ? '自定义…' : '自定义：' + (cur ? new URL(cur).hostname : '')));
  sel.value = preset ? cur : '__custom';
  sel.addEventListener('change', () => {
    if (sel.value === '__custom') {
      const inp = h('input', { type: 'url', value: cur, placeholder: 'https://…/generate_204', style: { width: '100%' } });
      modal('自定义测速地址', h('div', { class: 'field' }, h('label', {}, '必须是 https:// 地址（这版内核会忽略 http://）'), inp),
        (close) => [h('button', { class: 'btn', onclick: close }, '取消'),
          h('button', { class: 'btn primary', onclick: (e) => act(async () => { const v = inp.value.trim(); await api('setSettings', { connectionTestURL: v }); close(); }, '测速地址已保存', e.currentTarget) }, '保存')]);
      return;
    }
    act(() => api('setSettings', { connectionTestURL: sel.value }), '测速地址已切换');
  });
  return sel;
}

// ================================================================ nodes
PAGES.nodes = () => {
  const S = X.S;
  const subName = (subId) => { const s = S.subscriptions.find((x) => x.id === subId); return s ? s.name : '-'; };
  const filter = X.nodeFilter.toLowerCase();
  let list = S.nodes.filter((n) => !filter || (n.tag + ' ' + n.server + ' ' + n.type + ' ' + subName(n.subId)).toLowerCase().includes(filter));
  if (X.nodeSubFilter !== 'all') list = list.filter((n) => n.subId === X.nodeSubFilter);
  if (X.nodeSort === 'latency') list = list.slice().sort((a, b) => (a.latency ?? 1e9) - (b.latency ?? 1e9));
  else if (X.nodeSort === 'name') list = list.slice().sort((a, b) => a.tag.localeCompare(b.tag, 'zh'));

  // distribution (legend/hint rebuilt in place on latency-only updates)
  const donut = h('canvas', { class: 'donut', 'aria-label': '节点状态分布' });
  const legendEl = h('div', { class: 'legend' });
  const hintEl = h('span', { class: 'hint' });
  const countNodes = (nodes) => { const c = { good: 0, mid: 0, slow: 0, bad: 0, none: 0 }; nodes.forEach((n) => c[latClass(n)]++); return c; };
  let counts = countNodes(S.nodes);
  const refreshDist = (nodes) => {
    counts = countNodes(nodes);
    const total = Math.max(1, nodes.length);
    hintEl.textContent = `共 ${nodes.length} 个节点 · 已测 ${nodes.filter((n) => n.latency != null).length} 个`;
    legendEl.replaceChildren(...Object.keys(counts).map((k) => h('div', { class: 'li' },
      h('i', { class: 'c-' + k, style: { width: '9px', height: '9px', borderRadius: '3px' } }), LAT_NAME[k],
      h('div', { class: 'bar-mini' }, h('i', { style: { width: (counts[k] / total) * 100 + '%', background: LAT_COLOR[k] } })),
      h('b', {}, String(counts[k])))));
    drawDist();
  };
  const drawDist = () => {
    const colors = { good: CVAR('--ok'), mid: '#84cc16', slow: CVAR('--warn'), bad: CVAR('--bad'), none: CVAR('--ink-3') };
    drawDonut(donut, Object.keys(counts).map((k) => ({ value: counts[k], color: colors[k] })), String(S.nodes.length), '个节点');
  };
  const distCard = h('div', { class: 'card', style: { marginBottom: '14px' } },
    h('h2', {}, '状态分布', hintEl),
    h('div', { class: 'dist-wrap' }, donut, legendEl),
    h('div', { class: 'note', style: { marginTop: '10px' } },
      '测速是 URL Test：内核经每个节点向测速地址发起真实 HTTPS 请求。内核未运行时会自动临时启动内核（不动系统代理），测完自动关闭；仅当内核无法启动时才降级为 TCP 连接测试，并在结果中标注。'));

  const maxLatOf = (nodes) => Math.max(600, ...nodes.map((n) => n.latency || 0));
  let maxLat = maxLatOf(S.nodes);
  const latCellFor = (n) => {
    const cls = latClass(n);
    return h('td', {}, h('div', { class: 'lat' },
      h('div', { class: 'bar' }, n.latency != null ? h('b', { style: { width: Math.max(4, (n.latency / maxLat) * 100) + '%', background: LAT_COLOR[cls] } }) : null),
      h('span', { style: { color: cls === 'bad' ? 'var(--bad)' : 'var(--ink-2)', fontSize: '11.5px', fontVariantNumeric: 'tabular-nums' } },
        n.latency != null ? n.latency + ' ms' : cls === 'bad' ? '超时' : '未测试'),
      n.latencyKind ? h('span', { class: 'tag', style: { marginLeft: '6px' } }, n.latencyKind === 'url' ? 'HTTPS' : 'TCP') : null));
  };
  const rows = list.map((n) => {
    const tr = h('tr', { class: 'pick' + (n.id === S.selectedId ? ' sel' : ''), 'data-nid': n.id, onclick: () => act(() => api('selectNode', { id: n.id }), `已切换到 ${n.tag}`) },
      h('td', { style: { width: '34px' } }, h('span', { class: 'radio' + (n.id === S.selectedId ? ' on' : '') })),
      h('td', { title: n.tag }, h('div', { style: { overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '260px', whiteSpace: 'nowrap' } }, n.tag),
        n.subId ? h('div', { class: 'mut2', style: { fontSize: '11px' } }, subName(n.subId)) : null),
      h('td', {}, h('span', { class: 'tag' }, n.type)),
      h('td', { class: 'mono mut2' }, `${n.server}:${n.port}`),
      latCellFor(n),
      h('td', { class: 'r', style: { whiteSpace: 'nowrap' } },
        h('button', { class: 'btn small', title: 'URL 测速', onclick: (e) => { e.stopPropagation(); act(() => api('testNodes', { ids: [n.id] }), (r) => r.mode === 'url' ? 'URL 测速完成' : '内核未能启动，已降级为 TCP 测试'); } }, '测速'), ' ',
        h('button', { class: 'btn small ghost', title: '详情', onclick: (e) => { e.stopPropagation(); nodeDetail(n); } }, 'JSON'), ' ',
        h('button', { class: 'btn small danger', onclick: (e) => { e.stopPropagation(); if (confirm(`删除节点“${n.tag}”？`)) act(() => api('removeNode', { id: n.id }), '已删除'); } }, '删除')));
    return tr;
  });

  const search = h('input', { type: 'text', placeholder: '搜索名称、地址、协议、订阅', value: X.nodeFilter, style: { width: '230px' }, 'aria-label': '搜索节点', 'data-keep': 'nodeFilter',
    oninput: (e) => { X.nodeFilter = e.target.value; window.__render(); } });
  const subSel = h('select', { 'aria-label': '按订阅筛选', 'data-keep': 'nodeSubFilter', onchange: (e) => { X.nodeSubFilter = e.target.value; window.__render(); } },
    h('option', { value: 'all' }, '全部订阅'),
    S.subscriptions.map((s) => h('option', { value: s.id }, s.name)));
  subSel.value = X.nodeSubFilter;
  const sortSel = h('select', { 'aria-label': '排序', 'data-keep': 'nodeSort', onchange: (e) => { X.nodeSort = e.target.value; window.__render(); } },
    [['default', '默认顺序'], ['latency', '按延迟'], ['name', '按名称']].map(([v, l]) => h('option', { value: v }, l)));
  sortSel.value = X.nodeSort;

  const body = S.nodes.length === 0
    ? emptyState('nodes', '还没有节点', '添加订阅或导入分享链接后，节点会出现在这里。', h('button', { class: 'btn primary', onclick: () => goto('subs') }, '去添加'))
    : h('div', { class: 'scroll', 'data-keep-scroll': 'nodes', style: { maxHeight: 'calc(100vh - 420px)', minHeight: '200px' } },
      h('table', { class: 'tbl' },
        h('thead', {}, h('tr', {}, h('th', { style: { width: '34px' } }, ''), h('th', {}, '名称'), h('th', {}, '协议'), h('th', {}, '地址'), h('th', {}, '延迟'), h('th', { class: 'r' }, '操作'))),
        h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: 6, class: 'mut2', style: { textAlign: 'center', padding: '26px' } }, '没有匹配的节点')))));

  const testAll = h('button', { class: 'btn primary', disabled: S.nodes.length === 0, onclick: (e) => act(() => api('testNodes', {}), (r) => r.mode === 'url' ? `URL 测速完成（${r.count} 个节点，并发 ${S.settings.testConcurrency}）` : `内核未能启动，已降级为 TCP 连接测试（${r.error || '未知原因'}）`, e.currentTarget) }, 'URL 测速全部');
  const tbody = body.querySelector ? body.querySelector('tbody') : null;
  return {
    el: h('div', { class: 'page' }, pageHead('节点', `${S.nodes.length} 个节点 · 点击行切换当前节点`, testUrlSelect(), search, subSel, sortSel, testAll), distCard, body),
    mount: () => refreshDist(S.nodes),
    resize: drawDist,
    /** latency-only state changes: patch cells in place instead of rebuilding the table (no flicker) */
    state(S2) {
      if (!tbody) return;
      maxLat = maxLatOf(S2.nodes);
      for (const n of S2.nodes) {
        const tr = tbody.querySelector(`tr[data-nid="${CSS.escape(n.id)}"]`);
        if (!tr) continue;
        tr.replaceChild(latCellFor(n), tr.children[4]);
      }
      if (X.nodeSort === 'latency') {
        const order = S2.nodes.slice().sort((a, b) => (a.latency ?? 1e9) - (b.latency ?? 1e9)).map((n) => n.id);
        for (const id of order) { const tr = tbody.querySelector(`tr[data-nid="${CSS.escape(id)}"]`); if (tr) tbody.appendChild(tr); }
      }
      refreshDist(S2.nodes);
    },
  };
};

function nodeDetail(n) {
  const raw = JSON.stringify({ id: n.id, tag: n.tag, type: n.type, server: n.server, port: n.port, latency: n.latency, latencyKind: n.latencyKind, testedAt: n.testedAt ? new Date(n.testedAt).toLocaleString() : null }, null, 2);
  modal('节点详情：' + n.tag,
    h('div', {}, h('div', { style: { display: 'flex', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' } },
      h('span', { class: 'tag accent' }, n.type), n.latency != null ? h('span', { class: 'tag ' + latClass(n) }, n.latency + ' ms') : h('span', { class: 'tag' }, '未测速')),
      h('pre', { class: 'code' }, raw)),
    (close) => [
      h('button', { class: 'btn', onclick: close }, '关闭'),
      h('button', { class: 'btn primary', onclick: () => { navigator.clipboard.writeText(raw).then(() => toast('已复制到剪贴板')); } }, '复制'),
    ]);
}

// ================================================================ subscriptions
PAGES.subs = () => {
  const S = X.S;
  const name = h('input', { type: 'text', placeholder: '名称（可留空，默认取域名）', 'aria-label': '订阅名称' });
  const url = h('input', { type: 'url', placeholder: 'https://example.com/sub?token=…', 'aria-label': '订阅链接', style: { flex: '1' } });
  const addBtn = h('button', { class: 'btn primary', onclick: (e) => act(async () => {
    const r = await api('addSub', { name: name.value.trim(), url: url.value.trim() }); name.value = ''; url.value = ''; return r;
  }, (r) => `已导入 ${r.count} 个节点` + (r.errors.length ? `，${r.errors.length} 条无法识别` : ''), e.currentTarget) }, '添加订阅');
  const addCard = h('div', { class: 'card' }, h('h2', {}, '添加订阅'),
    h('div', { class: 'toolbar' }, name, url, addBtn),
    h('div', { class: 'note', style: { marginTop: '10px' } }, '支持 base64 / 明文链接列表、Clash YAML、sing-box JSON 三种格式。流量与到期信息来自订阅头 subscription-userinfo。'));

  const links = h('textarea', { placeholder: '每行一个分享链接：vmess:// vless:// trojan:// ss:// hysteria2:// tuic:// socks:// http://', 'aria-label': '分享链接', style: { width: '100%', minHeight: '84px' } });
  const impBtn = h('button', { class: 'btn', onclick: (e) => act(async () => { const r = await api('importLinks', { text: links.value }); links.value = ''; return r; }, (r) => `已导入 ${r.count} 个节点` + (r.errors.length ? `，${r.errors.length} 条无法识别` : ''), e.currentTarget) }, '导入分享链接');
  const linkCard = h('div', { class: 'card' }, h('h2', {}, '导入分享链接'), links, h('div', { style: { marginTop: '10px' } }, impBtn));

  const cards = S.subscriptions.map((s) => {
    const info = s.info; const used = info ? info.upload + info.download : 0;
    const days = info && info.expire ? Math.ceil((info.expire * 1000 - Date.now()) / 86400000) : null;
    return h('div', { class: 'card', style: { marginBottom: '12px' } },
      h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: '12px' } },
        h('div', { style: { flex: '1', minWidth: '0' } },
          h('div', { class: 'toolbar' }, h('b', { style: { fontSize: '14px' } }, s.name),
            h('span', { class: 'tag' }, `${s.count || 0} 个节点`),
            s.format ? h('span', { class: 'tag accent' }, s.format) : null,
            days != null && days >= 0 ? h('span', { class: 'tag ' + (days < 7 ? 'bad' : days < 30 ? 'warn' : 'ok') }, `剩余 ${days} 天`) : null),
          h('div', { class: 'note', style: { marginTop: '6px' } }, s.url ? s.url.replace(/([?&](token|key|sub)[^=]*=)[^&]+/gi, '$1***') : '手动导入', ` · 更新于 ${fmtTime(s.updatedAt)}`),
          info && info.total ? h('div', { style: { marginTop: '10px' } },
            h('div', { class: 'progress' }, h('b', { style: { width: Math.min(100, (used / info.total) * 100) + '%' } })),
            h('div', { class: 'note', style: { marginTop: '5px' } }, `已用 ${fmtBytes(used)} / ${fmtBytes(info.total)}（${((used / info.total) * 100).toFixed(1)}%）` + (info.expire ? ` · 到期 ${fmtDate(info.expire * 1000)}` : ''))) : null,
          s.error ? h('div', { class: 'err', style: { marginTop: '8px' } }, '更新失败：' + s.error) : null,
          s.errors && s.errors.length ? h('div', { class: 'note', style: { marginTop: '6px' } }, `${s.errors.length} 条未能识别（例如：${s.errors[0].error}）`) : null),
        h('div', { style: { display: 'flex', gap: '8px', flex: 'none' } },
          s.url ? h('button', { class: 'btn small', onclick: (e) => act(() => api('updateSub', { id: s.id }), (r) => `已更新，共 ${r.count} 个节点`, e.currentTarget) }, '更新') : null,
          h('button', { class: 'btn small danger', onclick: () => confirm(`删除订阅“${s.name}”及其全部节点？`) && act(() => api('removeSub', { id: s.id }), '已删除') }, '删除'))));
  });

  const updAll = h('button', { class: 'btn', disabled: !S.subscriptions.some((s) => s.url), onclick: (e) => act(() => api('updateAllSubs'), '全部订阅已更新', e.currentTarget) }, '更新全部');
  const fileBtn = h('button', { class: 'btn', title: '从本地文件导入订阅内容（base64 / 链接列表 / Clash YAML / sing-box / SIP008 JSON）', onclick: (e) => act(() => api('subFile'), (r) => r && r.canceled ? '' : `已从文件导入 ${r.count} 个节点` + (r.errors.length ? `，${r.errors.length} 条无法识别` : ''), e.currentTarget) }, '导入订阅文件');
  const autoNote = h('div', { class: 'note', style: { marginTop: '10px' } }, S.settings.autoUpdateSubsMin > 0 ? `订阅每 ${S.settings.autoUpdateSubsMin} 分钟自动更新（可在设置中修改）。` : '订阅自动更新未开启，可在设置中配置间隔。');
  return {
    el: h('div', { class: 'page' },
      pageHead('订阅', `${S.subscriptions.length} 个订阅来源`, fileBtn, updAll),
      h('div', { class: 'grid cols-2', style: { marginBottom: '14px' } }, addCard, linkCard),
      autoNote, h('div', { style: { height: '10px' } }),
      cards.length ? h('div', {}, cards) : emptyState('subs', '还没有订阅', '添加订阅链接或导入分享链接后，节点会出现在节点页。')),
  };
};

// ================================================================ rules
PAGES.rules = () => {
  const S = X.S;
  const outName = { proxy: '代理', direct: '直连', block: '拦截' };
  const outTag = (o) => h('span', { class: 'tag ' + (o === 'proxy' ? 'accent' : o === 'direct' ? 'ok' : 'bad') }, outName[o] || o);

  const outTagFor = (outboundText) => {
    if (outboundText === '走代理' || /走代理/.test(outboundText)) return h('span', { class: 'tag accent' }, '代理');
    if (outboundText === '直连') return h('span', { class: 'tag ok' }, '直连');
    if (/^拦截/.test(outboundText)) return h('span', { class: 'tag bad' }, '拦截');
    return h('span', { class: 'tag' }, outboundText); // 嗅探 / DNS 劫持等动作
  };
  const chain = S.routePreview && S.routePreview.length
    ? h('div', { class: 'chain' }, S.routePreview.map((r, i) => h('div', { class: 'step' + (i === S.routePreview.length - 1 ? ' final' : '') },
      h('span', { class: 'n' }, i + 1), h('span', { class: 'm', title: r.match }, r.match), h('span', { class: 'mut2' }, '→'), outTagFor(r.outbound))))
    : h('div', { class: 'unavail' }, '添加节点后，这里会按顺序显示内核实际生效的完整规则链（来自真实生成的配置）。');

  const routeCard = h('div', { class: 'card', style: { marginBottom: '14px' } },
    h('h2', {}, '当前生效规则链', h('span', { class: 'hint' }, S.settings.mode === 'rule' ? '规则模式：大陆域名与 IP 直连' : '全局模式：全部走代理')),
    h('div', { class: 'toolbar', style: { marginBottom: '12px' } }, h('span', { class: 'mut2' }, '模式：'), segMode()),
    chain,
    h('div', { class: 'note', style: { marginTop: '10px' } }, '规则链来自启动内核时生成的真实 sing-box 配置，按顺序匹配，命中即停止。规则模式下 geosite-cn / geoip-cn 规则集首次使用需联网下载。'));

  const rows = S.rules.map((r) => h('tr', {},
    h('td', { style: { width: '44px' } }, h('input', { type: 'checkbox', checked: r.enabled !== false, 'aria-label': '启用', onchange: (e) => act(() => api('saveRule', { ...r, enabled: e.target.checked }), '已保存，内核已重启') })),
    h('td', {}, r.name || '(未命名)'),
    h('td', { class: 'mono mut2', style: { fontSize: '11.5px' } }, [r.domain && '域名: ' + r.domain.split(/[\n,]/)[0] + (r.domain.split(/[\n,]/).filter(Boolean).length > 1 ? ' …' : ''), r.ip && 'IP: ' + r.ip, r.port && '端口: ' + r.port, r.processName && '进程: ' + r.processName, r.network && r.network !== 'any' && r.network.toUpperCase(), r.protocol && '协议: ' + r.protocol].filter(Boolean).join('　')),
    h('td', {}, outTag(r.outbound)),
    h('td', { class: 'r', style: { whiteSpace: 'nowrap' } },
      h('button', { class: 'btn small', onclick: () => ruleForm(r) }, '编辑'), ' ',
      h('button', { class: 'btn small danger', onclick: () => confirm('删除这条规则？') && act(() => api('removeRule', { id: r.id }), '已删除') }, '删除'))));

  const body = S.rules.length
    ? h('div', { class: 'scroll', 'data-keep-scroll': 'rules' }, h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {}, h('th', {}, '启用'), h('th', {}, '名称'), h('th', {}, '匹配条件'), h('th', {}, '出站'), h('th', { class: 'r' }, '操作'))), h('tbody', {}, rows)))
    : emptyState('rules', '没有自定义规则', '自定义规则在内置规则之后、兜底规则之前生效，保存后内核自动重启。', h('button', { class: 'btn primary', onclick: () => ruleForm() }, '新建规则'));

  const importRuleBtn = h('button', { class: 'btn', title: '从本地文件导入规则（Clash 规则行 / JSON 规则数组）', onclick: (e) => act(() => api('ruleFile'), (r) => r && r.canceled ? '' : `已导入 ${r.imported} 条规则` + (r.skipped ? `，跳过 ${r.skipped} 条（${(r.warnings && r.warnings[0]) || '不支持'}）` : '') + '，内核已重启生效', e.currentTarget) }, '导入规则文件');
  return { el: h('div', { class: 'page' }, pageHead('代理规则', '自定义分流规则与实际生效顺序', importRuleBtn, h('button', { class: 'btn primary', onclick: () => ruleForm() }, '新建规则')), routeCard, body) };
};

function ruleForm(r = {}) {
  const f = {
    name: h('input', { type: 'text', value: r.name || '', placeholder: '例如 广告拦截' }),
    domain: h('textarea', { placeholder: 'example.com（后缀匹配）\nfull:www.example.com（完整域名）\nkeyword:ads（关键字）\nregexp:^ad\\d+\\.', value: r.domain || '' }),
    ip: h('input', { type: 'text', placeholder: '10.0.0.0/8, 8.8.8.8/32', value: r.ip || '' }),
    port: h('input', { type: 'text', placeholder: '80, 443, 1000-2000', value: r.port || '' }),
    processName: h('input', { type: 'text', placeholder: '例如 chrome.exe, telegram.exe（Windows 按进程分流）', value: r.processName || '' }),
    network: h('select', {}, ['any', 'tcp', 'udp'].map((v) => h('option', { value: v }, v === 'any' ? '全部' : v.toUpperCase()))),
    protocol: h('input', { type: 'text', placeholder: 'http, tls, quic, dns（需开启流量探测）', value: r.protocol || '' }),
    outbound: h('select', {}, [['proxy', '走代理'], ['direct', '直连'], ['block', '拦截']].map(([v, l]) => h('option', { value: v }, l))),
  };
  f.network.value = r.network || 'any'; f.outbound.value = r.outbound || 'proxy';
  const fld = (l, el, span, hint) => h('div', { class: 'field' + (span ? ' span2' : '') }, h('label', {}, l), el, hint ? h('div', { class: 'note' }, hint) : null);
  const body = h('div', { class: 'form-grid' },
    fld('名称', f.name, 1), fld('出站', f.outbound),
    fld('域名（每行一条）', f.domain, 1), fld('目标 IP / CIDR', f.ip), fld('端口', f.port),
    fld('进程名', f.processName, 0, 'Windows 上按进程分流，相当于手机版的应用分代理'),
    fld('网络', f.network), fld('协议（探测结果）', f.protocol, 0, '需要开启流量探测'));
  modal(r.id ? '编辑规则' : '新建规则', body, (close) => [
    h('button', { class: 'btn', onclick: close }, '取消'),
    h('button', { class: 'btn primary', onclick: (e) => act(async () => {
      await api('saveRule', { id: r.id, enabled: r.enabled !== false, name: f.name.value, domain: f.domain.value, ip: f.ip.value, port: f.port.value, processName: f.processName.value, network: f.network.value, protocol: f.protocol.value, outbound: f.outbound.value });
      close();
    }, '规则已保存，内核已重启', e.currentTarget) }, '保存'),
  ]);
}

// ================================================================ connections
PAGES.conns = () => {
  const running = isRunning();
  const wrap = h('div', {});
  let alive = true; let lastList = [];
  const countEl = h('span', { class: 'mut2' }, running ? '' : '');
  const netChips = ['all', 'tcp', 'udp'].map((v) => h('button', { class: 'chip' + (X.connNet === v ? ' on' : ''), onclick: () => { X.connNet = v; draw(); } }, v === 'all' ? '全部' : v.toUpperCase()));
  const search = h('input', { type: 'text', placeholder: '搜索目标、进程、规则', value: X.connSearch, style: { width: '200px' }, 'data-keep': 'connSearch', oninput: (e) => { X.connSearch = e.target.value; draw(lastList); } });

  // stat tiles
  const connN = h('div', { class: 'v' }, running ? '0' : '-');
  const rateD = h('div', { class: 'v down-c' }, running ? '-': '-'); const rateU = h('div', { class: 'v up-c' }, running ? '-' : '-');
  const sumD = h('div', { class: 'v down-c' }, fmtBytes(X.S.session.downTotal)); const sumU = h('div', { class: 'v up-c' }, fmtBytes(X.S.session.upTotal));
  const spark = h('canvas', { class: 'spark' });
  const tiles = h('div', { class: 'grid cols-4', style: { margin: '0 0 14px' } },
    h('div', { class: 'card tile' }, h('div', { class: 'k' }, '活动连接'), connN, spark),
    h('div', { class: 'card tile' }, h('div', { class: 'k' }, h('i', { style: { background: 'var(--down)', width: '9px', height: '9px', borderRadius: '3px' } }), '实时下载'), rateD),
    h('div', { class: 'card tile' }, h('div', { class: 'k' }, h('i', { style: { background: 'var(--up)', width: '9px', height: '9px', borderRadius: '3px' } }), '实时上传'), rateU),
    h('div', { class: 'card tile' }, h('div', { class: 'k' }, '本次运行累计'), h('div', { class: 'duo' }, h('div', {}, sumD), h('div', {}, sumU))));

  // per-process ranking (real data: aggregated from the live connection list)
  const procBox = h('div', {});
  const procCard = h('div', { class: 'card', style: { marginBottom: '14px' } }, h('h2', {}, '进程流量排行', h('span', { class: 'hint' }, '按当前活动连接累计')), procBox);

  const procRow = (name, down, up, max) => h('div', { class: 'rank' },
    h('div', { class: 'it' }, h('span', { class: 'nm', title: name }, name),
      h('div', { class: 'bar' }, h('b', { style: { width: Math.max(3, ((down + up) / max) * 100) + '%', background: 'var(--down)' } })),
      h('span', { class: 'ms' }, fmtBytes(down + up))));

  const draw = async () => {
    if (!alive) return;
    let list = [];
    if (isRunning()) { try { list = await api('connections'); } catch { /* core stopping */ } }
    lastList = list;
    if (!alive) return;
    const running2 = isRunning();
    connN.textContent = running2 ? String(list.length) : '-';
    const last = X.samples[X.samples.length - 1];
    if (running2 && last) { rateD.textContent = fmtSpeed(last.down || 0); rateU.textContent = fmtSpeed(last.up || 0); }
    else { rateD.textContent = '-'; rateU.textContent = '-'; }
    drawSpark(spark, X.samples.slice(-60).map((s) => s.conn || 0), { color: '--down' });
    // process ranking
    const byProc = {};
    for (const c of list) { const k = c.process || ''; if (!k) continue; const o = (byProc[k] ||= { down: 0, up: 0 }); o.down += c.download || 0; o.up += c.upload || 0; }
    const procs = Object.entries(byProc).map(([name, v]) => ({ name, ...v })).sort((a, b) => (b.down + b.up) - (a.down + a.up)).slice(0, 6);
    procBox.replaceChildren();
    if (!running2) procBox.append(h('div', { class: 'unavail' }, '内核未运行。启动后这里显示按进程聚合的真实流量。'));
    else if (!procs.length) procBox.append(h('div', { class: 'note' }, list.length ? '当前连接没有可识别的进程信息（内核仅在能解析进程时提供，例如本机发起的连接）。' : '暂无活动连接。'));
    else {
      const max = Math.max(...procs.map((p) => p.down + p.up), 1);
      procs.forEach((p) => procBox.append(procRow(p.name, p.down, p.up, max)));
    }

    const keepTop = wrap.firstChild && wrap.firstChild.classList && wrap.firstChild.classList.contains('scroll') ? wrap.firstChild.scrollTop : 0;
    wrap.replaceChildren();
    countEl.textContent = running2 ? `${list.length} 条活动连接` : '内核未运行';
    if (!running2) { wrap.append(emptyState('conns', '内核未运行', '启动后这里会实时列出所有经过代理内核的连接。', h('button', { class: 'btn primary', onclick: () => goto('home') }, '去启动'))); return; }
    if (!list.length) { wrap.append(emptyState('conns', '暂无活动连接', '有程序通过代理访问网络时会显示在这里。')); return; }
    const now = Date.now();
    const q = X.connSearch.toLowerCase();
    const shown = list.filter((c) => X.connNet === 'all' || (c.network || '').toLowerCase() === X.connNet)
      .filter((c) => !q || (`${c.host} ${c.process} ${c.rule} ${(c.chains || []).join(' ')}`).toLowerCase().includes(q));
    const rows = shown.slice().sort((a, b) => new Date(b.start) - new Date(a.start)).slice(0, 300).map((c) => h('tr', {},
      h('td', { title: c.host }, h('div', { style: { maxWidth: '230px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, `${c.host}:${c.port}`)),
      h('td', {}, c.process ? h('span', { class: 'tag' }, c.process) : h('span', { class: 'mut2' }, '-')),
      h('td', {}, h('span', { class: 'tag' }, (c.network || '').toUpperCase())),
      h('td', { class: 'mut2', style: { fontSize: '11.5px' } }, c.rule ? (c.rule === 'final' ? '默认规则' : c.rule) + (c.rulePayload ? ' ' + c.rulePayload : '') : '-'),
      h('td', { class: 'mut2', style: { fontSize: '11.5px', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, (c.chains || []).slice().reverse().join(' → ')),
      h('td', { class: 'r mono' }, fmtBytes(c.upload)), h('td', { class: 'r mono' }, fmtBytes(c.download)),
      h('td', { class: 'r mut2', style: { fontVariantNumeric: 'tabular-nums' } }, fmtDur(now - new Date(c.start).getTime())),
      h('td', { class: 'r' }, h('button', { class: 'btn small', onclick: () => act(() => api('closeConn', { id: c.id }), '已关闭连接') }, '关闭'))));
    wrap.append(h('div', { class: 'scroll', style: { maxHeight: 'calc(100vh - 460px)', minHeight: '160px' } },
      h('table', { class: 'tbl' },
        h('thead', {}, h('tr', {}, ['目标', '进程', '网络', '规则', '出站链路', '上传', '下载', '时长', ''].map((t, i) => h('th', { class: i > 3 && i < 8 ? 'r' : '' }, t)))),
        h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: 9, class: 'mut2', style: { textAlign: 'center', padding: '26px' } }, '没有匹配的连接'))))));
    if (keepTop) wrap.firstChild.scrollTop = keepTop; // 1s rebuilds must not scroll the table back to the top
  };
  const timer = setInterval(draw, 1000);
  return {
    el: h('div', { class: 'page' },
      pageHead('连接', '实时活动连接（每秒刷新）', h('div', { class: 'toolbar' }, netChips), search, countEl,
        h('button', { class: 'btn danger', disabled: !running, onclick: () => act(() => api('closeAll'), '已关闭全部连接') }, '关闭全部')),
      tiles, procCard, wrap),
    mount: draw,
    destroy: () => { alive = false; clearInterval(timer); },
  };
};

// ================================================================ geo map
let WORLD_GEO = null; // world GeoJSON loaded once per app run
PAGES.geo = () => {
  const S = X.S;
  const running = isRunning();
  const selNode = S.nodes.find((n) => n.id === S.selectedId);

  // ---- info cards
  const mkInfoCard = (title) => {
    const main = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px', minHeight: '58px' } }, h('span', { class: 'mut2' }, '查询中…'));
    return { el: h('div', { class: 'card tile' }, h('div', { class: 'k' }, title), main), main };
  };
  const exitInfo = mkInfoCard(running ? '出口位置（经当前节点）' : '本机公网位置（直连）');
  const directInfo = mkInfoCard('直连公网位置');
  const nodeInfo = mkInfoCard('当前节点服务器');
  const fillInfo = (el, geo, extra) => {
    el.replaceChildren();
    if (!geo) { el.append(h('span', { class: 'mut2' }, '无数据')); return; }
    if (geo.error) { el.append(h('span', { class: 'err' }, '查询失败：' + geo.error)); return; }
    el.append(
      h('b', { style: { fontSize: '14px' } }, geo.ip || '-'),
      h('span', { class: 'mut' }, [geo.country, geo.region, geo.city].filter(Boolean).join(' · ') || '-'),
      h('span', { class: 'mut2', style: { fontSize: '11.5px' } }, [geo.isp, geo.asn ? 'AS' + geo.asn : null].filter(Boolean).join(' · ') || ''),
      extra || null);
  };

  // ---- map
  const canvas = h('canvas', { style: { width: '100%', height: '440px', display: 'block', borderRadius: '8px', touchAction: 'none' } });
  let map = null;
  const state = { exit: null, direct: null, node: null, targets: [] }; // markers {lon,lat,...}
  const draw = () => {
    if (!map) return;
    const markers = []; const arcs = [];
    const AC = CVAR('--accent'); const DC = CVAR('--down'); const UC = CVAR('--up');
    if (state.direct && !state.direct.error) markers.push({ lon: state.direct.longitude, lat: state.direct.latitude, color: UC, r: 3.5, label: '直连' });
    if (state.exit && !state.exit.error) markers.push({ lon: state.exit.longitude, lat: state.exit.latitude, color: AC, r: 5, label: running ? '出口' : '本机', pulse: true });
    if (state.node && !state.node.error) markers.push({ lon: state.node.longitude, lat: state.node.latitude, color: DC, r: 4.5, label: '节点' });
    if (state.exit && !state.exit.error && state.node && !state.node.error) arcs.push({ from: { lon: state.exit.longitude, lat: state.exit.latitude }, to: { lon: state.node.longitude, lat: state.node.latitude }, color: AC, width: 2, alpha: 0.85 });
    const shown = new Set();
    for (const t of state.targets) {
      const k = t.lon + ',' + t.lat; if (shown.has(k)) continue;
      shown.add(k);
      markers.push({ lon: t.lon, lat: t.lat, color: CVAR('--ink-3'), r: 2.5 });
      if (state.node && !state.node.error) arcs.push({ from: { lon: state.node.longitude, lat: state.node.latitude }, to: t, color: DC, width: 1, alpha: 0.35 });
    }
    map.setData({ markers, arcs, date: new Date() });
  };

  let alive = true; let targetTimer = null; let drawTimer = null; let selfTimer = null;
  const refreshSelf = async () => {
    try { const g = await api('geoSelf', {}); if (!alive) return; state.exit = g; fillInfo(exitInfo.main, g); } catch (e) { if (alive) { state.exit = { error: e.message }; fillInfo(exitInfo.main, { error: e.message }); } }
    try { const g = await api('geoSelf', { direct: true }); if (!alive) return; state.direct = g; fillInfo(directInfo.main, g, running ? null : h('span', { class: 'mut2', style: { fontSize: '11px' } }, '与出口相同：内核未运行')); } catch (e) { if (alive) fillInfo(directInfo.main, { error: e.message }); }
    draw();
  };
  const refreshNode = async () => {
    const sel = X.S.nodes.find((n) => n.id === X.S.selectedId);
    if (!sel) { fillInfo(nodeInfo.main, null); state.node = null; draw(); return; }
    fillInfo(nodeInfo.main, { ip: sel.server, country: '解析中…' });
    try {
      // only the selected server: fast (single DNS + cached lookup), no waiting on the rest
      const all = await api('geoNodes', { servers: [sel.server] });
      if (!alive) return;
      const g = all[sel.server];
      if (g && !g.error) { state.node = g; fillInfo(nodeInfo.main, g, h('span', { class: 'mut2', style: { fontSize: '11px' } }, sel.tag)); }
      else { state.node = null; fillInfo(nodeInfo.main, { error: (g && g.error) || '查询失败' }); }
    } catch (e) { if (alive) fillInfo(nodeInfo.main, { error: e.message }); }
    draw();
  };
  const refreshTargets = async () => {
    if (!isRunning()) { state.targets = []; draw(); return; }
    try {
      const conns = await api('connections', {});
      if (!alive) return;
      const top = conns.filter((c) => c.host && /^[\d.]+$/.test(c.host)).sort((a, b) => (b.download || 0) - (a.download || 0)).slice(0, 8);
      const ips = top.map((c) => c.host).filter(Boolean);
      const geo = ips.length ? await api('geoIps', { ips }) : {};
      if (!alive) return;
      state.targets = ips.map((ip) => geo[ip] && !geo[ip].error ? { lon: geo[ip].longitude, lat: geo[ip].latitude } : null).filter(Boolean).slice(0, 6);
      draw();
    } catch { /* core may be stopping */ }
  };

  (async () => {
    try { WORLD_GEO = WORLD_GEO || await api('worldGeo', {}); } catch (e) { if (alive) toast('世界地图数据加载失败：' + e.message, true); return; }
    if (!alive) return;
    map = new WorldMap(canvas, WORLD_GEO);
    draw();
    refreshSelf(); refreshNode(); refreshTargets();
    targetTimer = setInterval(refreshTargets, 5000);
    selfTimer = setInterval(refreshSelf, 5 * 60 * 1000);
  })();
  drawTimer = setInterval(draw, 1500); // pulse animation + terminator follows real time

  const legend = h('div', { class: 'toolbar', style: { marginTop: '10px' } },
    h('span', { class: 'chip' }, h('i', { style: { background: 'var(--accent)', width: '9px', height: '9px', borderRadius: '50%' } }), '本机/出口'),
    h('span', { class: 'chip' }, h('i', { style: { background: 'var(--down)', width: '9px', height: '9px', borderRadius: '50%' } }), '节点'),
    h('span', { class: 'chip' }, h('i', { style: { background: 'var(--ink-3)', width: '9px', height: '9px', borderRadius: '50%' } }), '连接目标'),
    h('span', { class: 'mut2', style: { fontSize: '11.5px' } }, '深色区域为当前真实时间的黑夜'),
    h('span', { class: 'sp' }),
    h('button', { class: 'btn small', onclick: () => map && map.zoomBy(1.4) }, '放大'),
    h('button', { class: 'btn small', onclick: () => map && map.zoomBy(1 / 1.4) }, '缩小'),
    h('button', { class: 'btn small ghost', onclick: () => map && map.resetView() }, '复位'));
  const el = h('div', { class: 'page' },
    pageHead('地图', '自身、节点与目标服务器的地理位置 · 昼夜随真实时间变化 · 滚轮缩放拖拽平移',
      h('button', { class: 'btn', onclick: (e) => act(() => (refreshSelf(), refreshNode(), refreshTargets()), undefined, e.currentTarget) }, '刷新位置')),
    h('div', { class: 'grid cols-3', style: { marginBottom: '14px' } }, exitInfo.el, directInfo.el, nodeInfo.el),
    h('div', { class: 'card' }, h('h2', {}, '世界地图', h('span', { class: 'hint' }, '地理位置来自 ip.sb 查询（本地缓存 30 天）；目标位置为服务器机房，仅供参考')), canvas, legend));

  return { el, resize: () => draw(), destroy: () => { alive = false; clearInterval(targetTimer); clearInterval(drawTimer); clearInterval(selfTimer); } };
};

// ================================================================ stats
PAGES.stats = () => {
  const S = X.S;
  const days = lastDays(S.daily, 30);
  const sum = (ds) => ds.reduce((a, d) => ({ up: a.up + d.up, down: a.down + d.down }), { up: 0, down: 0 });
  const s7 = sum(days.slice(-7)); const s30 = sum(days);
  const activeDays = days.filter((d) => d.up || d.down).length;

  const canvas = h('canvas', { style: { height: '230px', width: '100%', display: 'block' }, 'aria-label': '近30天流量' });
  const bars = new DailyBars(canvas);
  const donut = h('canvas', { class: 'donut' });
  const tile = (t, main, sub) => h('div', { class: 'card tile' }, h('div', { class: 'k' }, t), main, h('div', { class: 's' }, sub));

  const tdV = h('div', { class: 'v down-c' }, '↓ ' + fmtBytes(S.today.down));
  const tuV = h('div', { class: 'v up-c' }, '↑ ' + fmtBytes(S.today.up));
  const sdV = h('div', { class: 'v down-c' }, isRunning() ? '↓ ' + fmtBytes(S.session.downTotal) : '-');
  const suV = h('div', { class: 'v up-c' }, isRunning() ? '↑ ' + fmtBytes(S.session.upTotal) : '-');
  const todayTile = tile('今日', h('div', { class: 'duo' }, h('div', {}, tdV), h('div', {}, tuV)), '随内核流量实时累计');
  const sessTile = tile('本次运行', h('div', { class: 'duo' }, h('div', {}, sdV), h('div', {}, suV)), isRunning() ? '' : '内核未运行');

  const list = days.slice().reverse().filter((d) => d.up || d.down);
  const table = list.length ? h('div', { class: 'scroll', style: { maxHeight: '300px' } }, h('table', { class: 'tbl' },
    h('thead', {}, h('tr', {}, ['日期', '下载', '上传', '合计'].map((t, i) => h('th', { class: i ? 'r' : '' }, t)))),
    h('tbody', {}, list.map((d) => h('tr', {}, h('td', {}, d.key), h('td', { class: 'r mono' }, fmtBytes(d.down)), h('td', { class: 'r mono' }, fmtBytes(d.up)), h('td', { class: 'r mono' }, fmtBytes(d.up + d.down)))))))
    : h('div', { class: 'unavail' }, '还没有流量记录。启动内核并产生流量后，这里会按天累计。');

  const el = h('div', { class: 'page' },
    pageHead('流量统计', '按天累计的真实内核流量', h('button', { class: 'btn danger', onclick: () => confirm('清空全部流量历史？') && act(() => api('clearStats'), '已清空') }, '清空历史')),
    h('div', { class: 'grid cols-4', style: { marginBottom: '14px' } },
      todayTile,
      tile('近 7 天', h('div', { class: 'duo' }, h('div', { class: 'v down-c' }, '↓ ' + fmtBytes(s7.down)), h('div', { class: 'v up-c' }, '↑ ' + fmtBytes(s7.up))), ''),
      tile('近 30 天', h('div', { class: 'duo' }, h('div', { class: 'v down-c' }, '↓ ' + fmtBytes(s30.down)), h('div', { class: 'v up-c' }, '↑ ' + fmtBytes(s30.up))), ''),
      tile('活跃天数', h('div', { class: 'v' }, String(activeDays)), '近 30 天内有流量的天数')),
    h('div', { class: 'row-2', style: { marginBottom: '14px' } },
      h('div', { class: 'card' }, h('h2', {}, '近 30 天每日流量', h('span', { class: 'hint' }, '下载蓝 · 上传红')), canvas,
        h('div', { class: 'note', style: { marginTop: '8px' } }, '统计内核流量计数器的增量，仅包含本客户端启动内核期间的流量')),
      h('div', { class: 'card' }, h('h2', {}, '30 天上下行占比'), h('div', { class: 'dist-wrap', style: { justifyContent: 'center' } }, donut,
        h('div', { class: 'legend' },
          h('div', { class: 'li' }, h('i', { style: { width: '9px', height: '9px', borderRadius: '3px', background: 'var(--down)' } }), '下载', h('b', {}, fmtBytes(s30.down))),
          h('div', { class: 'li' }, h('i', { style: { width: '9px', height: '9px', borderRadius: '3px', background: 'var(--up)' } }), '上传', h('b', {}, fmtBytes(s30.up))))))),
    h('div', { class: 'card' }, h('h2', {}, '每日明细'), table));

  const redrawDonut = () => drawDonut(donut, [{ value: s30.down, color: CVAR('--down') }, { value: s30.up, color: CVAR('--up') }], fmtBytes(s30.down + s30.up), '30 天合计');
  const mount = () => { bars.update(days); redrawDonut(); };
  mount();
  return {
    el,
    mount,
    tick(t) { // keep the today/session tiles truly live while the page is open
      if (t.today) { tdV.textContent = '↓ ' + fmtBytes(t.today.down || 0); tuV.textContent = '↑ ' + fmtBytes(t.today.up || 0); }
      sdV.textContent = '↓ ' + fmtBytes(t.downTotal || 0); suV.textContent = '↑ ' + fmtBytes(t.upTotal || 0);
    },
    resize: () => { bars.update(days); redrawDonut(); },
  };
};

// ================================================================ logs
PAGES.logs = () => {
  const box = h('div', { class: 'logs', role: 'log' });
  const countEl = h('span', { class: 'mut2' }, '');
  const levelOk = (l) => {
    if (X.logLevel === 'warn') return ['warn', 'error', 'fatal', 'panic'].includes(l.level);
    if (X.logLevel === 'error') return ['error', 'fatal', 'panic'].includes(l.level);
    return true;
  };
  const textOk = (l) => !X.logSearch || l.text.toLowerCase().includes(X.logSearch.toLowerCase());
  const ok = (l) => levelOk(l) && textOk(l);
  const line = (l) => {
    const t = h('span', { class: 't' }, new Date(l.t).toLocaleTimeString() + '  ');
    return h('div', { class: 'l l-' + l.level }, t, l.text);
  };
  const fill = () => {
    const shown = X.logs.filter(ok);
    box.replaceChildren(...shown.slice(-800).map(line));
    countEl.textContent = `共 ${X.logs.length} 条，显示 ${Math.min(shown.length, 800)} 条`;
    if (!shown.length) box.textContent = X.logs.length ? '没有匹配当前过滤条件的日志。' : '暂无日志。启动内核后，运行日志会显示在这里。';
    if (X.logFollow) box.scrollTop = box.scrollHeight;
  };
  const levelSel = h('select', { 'aria-label': '日志级别', 'data-keep': 'logLevel', style: { width: '120px' }, onchange: (e) => { X.logLevel = e.target.value; fill(); } },
    [['all', '全部级别'], ['warn', '警告及以上'], ['error', '仅错误']].map(([v, l]) => h('option', { value: v }, l)));
  levelSel.value = X.logLevel;
  const search = h('input', { type: 'text', placeholder: '搜索日志内容', value: X.logSearch, style: { width: '180px' }, 'data-keep': 'logSearch', oninput: (e) => { X.logSearch = e.target.value; fill(); } });
  const follow = h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: X.logFollow, onchange: (e) => { X.logFollow = e.target.checked; if (e.target.checked) box.scrollTop = box.scrollHeight; } }), '自动滚动');
  fill();
  return {
    el: h('div', { class: 'page' },
      pageHead('运行日志', '内核与客户端的实时输出', levelSel, search, follow, countEl,
        h('button', { class: 'btn', onclick: () => act(async () => { await api('clearLogs'); X.logs = []; fill(); }) }, '清空')),
      box),
    log: (l) => { if (!ok(l)) return; const stick = X.logFollow || (box.scrollTop + box.clientHeight >= box.scrollHeight - 30); box.append(line(l)); while (box.childElementCount > 800) box.firstChild.remove(); if (stick) box.scrollTop = box.scrollHeight; },
  };
};

// ================================================================ settings
PAGES.settings = () => {
  const S = X.S; const s = S.settings; const F = {};
  const text = (k, type = 'text') => (F[k] = h('input', { type, value: s[k] }));
  const check = (k, label, dis) => { F[k] = h('input', { type: 'checkbox', checked: !!s[k], disabled: dis }); return h('label', { class: 'switch' }, F[k], label); };
  // theme applies instantly: it is a pure UI preference, no save button needed
  const sel = (k, opts) => {
    F[k] = h('select', { onchange: k === 'theme' ? () => act(() => api('setSettings', { theme: F[k].value })) : null }, opts.map(([v, l]) => h('option', { value: v }, l)));
    F[k].value = s[k]; return F[k];
  };
  const fld = (l, el, span, hint) => h('div', { class: 'field' + (span ? ' span2' : '') }, h('label', {}, l), el, hint ? h('div', { class: 'note' }, hint) : null);
  const sect = (t, ...kids) => h('div', { class: 'card sect' }, h('h2', {}, t), h('div', { class: 'form-grid' }, kids));

  const save = h('button', { class: 'btn primary', onclick: (e) => act(async () => {
    const patch = {}; for (const [k, el] of Object.entries(F)) patch[k] = el.type === 'checkbox' ? el.checked : (el.type === 'number' ? Number(el.value) : el.value.trim());
    return api('setSettings', patch);
  }, (r) => (r && r.restarted ? '设置已保存，内核已重启生效' : '设置已保存'), e.currentTarget) }, '保存设置');

  const el = h('div', { class: 'page' },
    pageHead('设置', '修改后点击保存；影响内核的设置会自动重启内核', save),
    h('div', { class: 'settings-grid' },
      sect('代理',
        fld('本地代理端口（混合 HTTP/SOCKS）', text('mixedPort', 'number')),
        fld('路由模式', sel('mode', [['rule', '规则（大陆直连）'], ['global', '全局代理']])),
        h('div', {}, check('allowAccess', '允许来自局域网的连接')),
        h('div', {}, check('bypassLan', '绕过局域网地址')),
        h('div', {}, check('trafficSniffing', '启用流量探测（sniff）')),
        h('div', { class: 'span2' }, check('tun', 'TUN 模式（虚拟网卡，接管全局流量）'),
          h('div', { class: 'warnbox', style: { marginTop: '8px' } }, '开启时会请求管理员权限（UAC）。wintun.dll 必须位于内核文件同一目录；缺失或拒绝 UAC 时会显示明确错误。TUN 模式不会自动设置系统代理。'))),
      sect('DNS',
        fld('远程 DNS', text('remoteDns'), 0, '经代理查询，例如 https://dns.google/dns-query'),
        fld('直连 DNS', text('directDns'), 0, '例如 https://223.5.5.5/dns-query 或 local'),
        fld('IPv6 策略', sel('ipv6Mode', [['prefer_ipv4', '优先 IPv4'], ['prefer_ipv6', '优先 IPv6'], ['ipv4_only', '仅 IPv4'], ['ipv6_only', '仅 IPv6']]))),
      sect('订阅',
        fld('自动更新间隔（分钟）', text('autoUpdateSubsMin', 'number'), 0, '0 表示关闭自动更新；仅对有链接的订阅生效')),
      sect('内核',
        fld('Clash API 端口', text('apiPort', 'number'), 0, '仅监听 127.0.0.1，客户端用它读取实时数据'),
        fld('日志级别', sel('logLevel', [['trace', 'trace'], ['debug', 'debug'], ['info', 'info'], ['warn', 'warn'], ['error', 'error']])),
        fld('测速地址', text('connectionTestURL'), 1, '必须是 https:// 地址：这版内核会忽略 http:// 测速地址；节点页也可快速切换'),
        fld('测速并发数', text('testConcurrency', 'number'), 0, '同时测试的节点数，默认 5'),
        h('div', { class: 'span2 note' }, `内核：${S.core.version || '未找到'}`, h('br'), `路径：${S.core.binary}`)),
      sect('界面',
        fld('主题', sel('theme', [['light', '浅色'], ['dark', '深色']]), 0, '选择后立即生效'),
        h('div', {}, check('closeToTray', '关闭窗口时最小化到系统托盘')),
        fld('背景壁纸', h('div', { class: 'toolbar' },
          h('button', { class: 'btn small', onclick: (e) => act(() => api('pickWallpaper'), undefined, e.currentTarget) }, s.wallpaper ? '更换图片' : '选择图片'),
          s.wallpaper ? h('button', { class: 'btn small danger', onclick: (e) => act(() => api('clearWallpaper'), '已恢复纯色背景', e.currentTarget) }, '清除壁纸') : null,
          s.wallpaper ? h('span', { class: 'tag ok' }, '已启用') : h('span', { class: 'mut2', style: { fontSize: '11.5px' } }, '未设置')), 1, '图片会拷贝到程序数据目录，浅色/深色主题下自动叠加对应遮罩'),
        (() => {
          const debounce = { t: null };
          const live = (key, val) => { // instant preview, persisted shortly after
            document.documentElement.style.setProperty(key === 'wallpaperOpacity' ? '--wp-o' : key === 'wallpaperVeil' ? '--wp-veil' : '--wp-blur',
              key === 'wallpaperBlur' ? val + 'px' : val);
            clearTimeout(debounce.t);
            debounce.t = setTimeout(() => api('setSettings', { [key]: Number(val) }).catch(() => {}), 350);
          };
          const slider = (key, label, min, max, step, fmt) => {
            const val = h('span', { class: 'mut2', style: { fontSize: '11.5px', minWidth: '38px', textAlign: 'right' } }, fmt(s[key]));
            const r = h('input', { type: 'range', min, max, step, value: s[key], 'aria-label': label, oninput: (e) => { val.textContent = fmt(Number(e.target.value)); live(key, e.target.value); } });
            return h('div', { class: 'field' }, h('label', {}, label), h('div', { class: 'toolbar' }, r, val));
          };
          const pct = (v) => Math.round(v * 100) + '%';
          const px = (v) => v + 'px';
          return h('div', { class: 'span2', style: { display: 'grid', gap: '10px' } },
            slider('wallpaperOpacity', '壁纸不透明度（图片显示强度）', 10, 100, 5, (v) => pct(v / 100)),
            slider('wallpaperVeil', '亮度遮罩（越大越接近纯色主题）', 0, 95, 5, (v) => pct(v / 100)),
            slider('wallpaperBlur', '壁纸模糊', 0, 40, 2, px));
        })(),
        (() => { // frosted glass: independent opacity, text stays solid
          const live = (v) => { document.documentElement.style.setProperty('--glass-pct', Math.round(v * 100) + '%'); };
          const deb = { t: null };
          const r = h('input', { type: 'range', min: 15, max: 100, step: 5, value: Math.round((s.glassOpacity ?? 0.6) * 100), 'aria-label': '毛玻璃不透明度',
            oninput: (e) => { live(Number(e.target.value) / 100); clearTimeout(deb.t); deb.t = setTimeout(() => api('setSettings', { glassOpacity: Number(e.target.value) / 100 }).catch(() => {}), 350); } });
          const sw = h('input', { type: 'checkbox', checked: !!s.glassEnabled, onchange: (e) => act(() => api('setSettings', { glassEnabled: e.target.checked }), e.target.checked ? '毛玻璃已开启' : '毛玻璃已关闭') });
          return h('div', { class: 'field span2' }, h('label', {}, '毛玻璃效果（卡片磨砂，文字不透明度不受影响）'),
            h('div', { class: 'toolbar', style: { marginTop: '4px' } }, h('label', { class: 'switch' }, sw, '启用'), h('span', { class: 'sp' }), r));
        })()),
      sect('系统',
        h('div', {}, check('setSystemProxy', '启动内核时自动设置 Windows 系统代理', !S.sysproxySupported), !S.sysproxySupported ? h('div', { class: 'note' }, '当前系统不是 Windows，此项不可用') : null),
        h('div', {}, check('autoStartCore', '打开客户端时自动启动内核')))));
  return { el };
};
