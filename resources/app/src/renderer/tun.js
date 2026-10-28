'use strict';
function tunLabel() {
  if (!X.S.settings.tun) return '未启用';
  if (X.S.core.state === 'running' && !X.S.core.tun) return '待启动 TUN · 当前为普通代理';
  return ({ running: '内核已启动 TUN', starting: '启动中', stopping: '停止中', stopped: '已启用 · 待启动' })[X.S.core.state] || '状态未知';
}
function tunSummary() {
  const s = X.S.settings;
  return h('div', { class: 'tun-summary' },
    h('div', { class: 'tun-summary-icon' }, svgIcon(ICONS.bolt)),
    h('div', {}, h('b', {}, 'TUN 网络接管'), h('p', {}, s.tun ? tunLabel() : '让命令行、游戏与其他应用按规则连接')),
    h('span', { class: 'tun-pill' }, s.tun ? `${s.tunStack} · MTU ${s.mtu}` : '按需启用'),
    h('button', { class: 'btn small', onclick: () => goto('tun') }, '管理 TUN'));
}

PAGES.tun = () => {
  const S = X.S, s = S.settings;
  const busy = ['starting', 'stopping'].includes(S.core.state);
  const stack = h('select', { 'aria-label': 'TUN 协议栈' }, [['mixed', 'Mixed · 混合协议栈'], ['system', 'System · 系统协议栈'], ['gvisor', 'gVisor · 用户态协议栈']].map(([v, label]) => h('option', { value: v }, label)));
  stack.value = s.tunStack;
  const mtu = h('input', { type: 'number', min: 1280, max: 9000, step: 1, value: s.mtu, 'aria-label': 'TUN MTU' });
  const strict = h('input', { type: 'checkbox', checked: s.tunStrictRoute });
  const results = h('div', { class: 'tun-checks', 'aria-live': 'polite' }, h('p', { class: 'note' }, '点击「检查环境」，读取当前权限、驱动文件、端口和网卡状态。'));
  const checked = h('span', { class: 'note' }, '尚未检查');
  const diagnose = h('button', { class: 'btn', onclick: (e) => act(async () => {
    const result = await api('tunDiagnostics');
    results.replaceChildren(...result.rows.map((r) => h('div', { class: 'tun-check' },
      h('span', { class: 'tun-check-icon ' + r.state, 'aria-label': ({ ok: '通过', warn: '提示', error: '异常', info: '信息' })[r.state] }, ({ ok: '✓', warn: '!', error: '×', info: '·' })[r.state]),
      h('div', {}, h('b', {}, r.label), h('p', {}, r.detail)))));
    checked.textContent = '检查于 ' + new Date(result.checkedAt).toLocaleTimeString();
  }, null, e.currentTarget) }, svgIcon(ICONS.refresh), '检查环境');
  const save = h('button', { class: 'btn primary', disabled: busy, onclick: (e) => act(() => api('setSettings', { tunStack: stack.value, mtu: Number(mtu.value), tunStrictRoute: strict.checked }), (r) => r.restarted ? '参数已保存，内核已重启' : '参数已保存，下次启动生效', e.currentTarget) }, '保存参数');
  const field = (label, control, hint) => h('div', { class: 'field' }, h('label', {}, label), control, h('p', { class: 'note' }, hint));
  return { el: h('div', { class: 'page tun-page' },
    pageHead('TUN 网络', '统一接管应用流量，沿用当前代理规则', diagnose),
    h('section', { class: 'card tun-hero' },
      h('div', { class: 'tun-emblem' }, svgIcon(ICONS.bolt)),
      h('div', { class: 'tun-hero-copy' }, h('span', { class: 'tun-eyebrow' }, 'VIRTUAL NETWORK'), h('h2', {}, '全应用连接，由你掌控'),
        h('p', {}, '无需逐个设置应用代理。TUN 负责接管流量，规则模式决定直连或代理。'),
        h('span', { class: 'tun-pill' }, tunLabel())),
      h('button', { class: 'btn ' + (s.tun ? '' : 'primary'), disabled: busy, onclick: (e) => act(() => api('setSettings', { tun: !s.tun }), (r) => r.restarted ? '网络接管设置已生效' : '设置已保存，启动内核后生效', e.currentTarget) }, s.tun ? '关闭 TUN' : '启用 TUN')),
    h('div', { class: 'tun-metrics' },
      [['接管方式', s.tun ? '虚拟网卡 TUN' : '本地 HTTP / SOCKS'], ['路由策略', modeName(s.mode) + '模式'], ['TUN DNS 策略', '接管 53 端口']].map(([k, v]) => h('div', { class: 'card' }, h('span', { class: 'note' }, k), h('b', {}, v)))),
    h('div', { class: 'tun-columns' },
      h('section', { class: 'card' }, h('h2', {}, '连接参数'),
        h('div', { class: 'tun-presets' }, h('span', { class: 'note' }, '快速填入'),
          h('button', { class: 'btn small', onclick: () => { stack.value = 'mixed'; mtu.value = 1500; strict.checked = true; } }, '标准 · 1500'),
          h('button', { class: 'btn small', onclick: () => { stack.value = 'mixed'; mtu.value = 1280; strict.checked = true; } }, '小包 · 1280')),
        field('协议栈', stack, '默认 Mixed。遇到特定应用兼容问题时，可切换协议栈后重试。'),
        field('MTU · 最大传输单元', mtu, '范围 1280–9000。默认 1500；部分网络可尝试 1280。'),
        h('label', { class: 'switch tun-strict' }, strict, '严格路由'),
        h('p', { class: 'note' }, '启用可减少 Windows 多网卡 DNS 泄漏。与虚拟机网络冲突时可关闭后测试。'),
        h('div', { class: 'tun-save' }, save, h('span', { class: 'note' }, '运行中保存会短暂重连'))),
      h('section', { class: 'card' }, h('h2', {}, '环境诊断'), results, h('div', { class: 'tun-check-time' }, checked),
        h('p', { class: 'note' }, '诊断仅读取环境，不修改网络设置。网卡存在不代表代理出口可用，可前往节点页测速。'))),
    h('section', { class: 'card tun-guide' }, h('h2', {}, '连接步骤'),
      h('div', {}, [['01', '选择可用节点', '先在节点页导入或选择节点。'], ['02', '启用并启动', '启用 TUN 后在概览启动内核，按提示允许管理员权限。'], ['03', '检查实际连接', '查看连接与日志；失败时检查环境，必要时切换协议栈。']].map(([n, title, text]) => h('div', {}, h('span', {}, n), h('b', {}, title), h('p', {}, text)))))) };
};
