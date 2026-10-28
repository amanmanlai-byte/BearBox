'use strict';
function groupedNodePicker(current, onPick) {
  const search = h('input', { type: 'search', placeholder: '搜索节点或订阅', 'aria-label': '搜索分流节点' });
  const groups = h('div', { class: 'node-picker-groups' });
  const draw = () => {
    const query = search.value.trim().toLowerCase();
    const subs = [...X.S.subscriptions];
    if (X.S.nodes.some((n) => !subs.some((s) => s.id === n.subId))) subs.push({ id: null, name: '其他节点' });
    const rows = [];
    for (const sub of subs) {
      const nodes = X.S.nodes.filter((n) => sub.id === null ? !X.S.subscriptions.some((s) => s.id === n.subId) : n.subId === sub.id)
        .filter((n) => !query || `${sub.name} ${n.tag} ${n.server}`.toLowerCase().includes(query));
      if (!nodes.length) continue;
      const contains = nodes.some((n) => current && current.subId === n.subId && current.tag === n.tag);
      rows.push(h('details', { class: 'node-group', open: !!query || contains },
        h('summary', {}, sub.name, h('span', { class: 'tag' }, nodes.length + ' 个节点')),
        nodes.map((n) => h('button', { class: 'node-choice' + (current && current.subId === n.subId && current.tag === n.tag ? ' on' : ''), onclick: () => onPick(n.id) },
          h('span', {}, nodeDisplayName(n.tag)), h('span', { class: 'mut2' }, n.type.toUpperCase(), n.latency != null ? ` · ${n.latency} ms` : '')))));
    }
    groups.replaceChildren(...(rows.length ? rows : [h('div', { class: 'note' }, '没有匹配的节点，请先导入订阅。')]));
  };
  search.addEventListener('input', draw); draw();
  return h('div', { class: 'node-picker' }, search, h('button', { class: 'btn', onclick: () => onPick(null) }, '跟随当前代理节点'), groups);
}
function quickRoutingCard() {
  const saved = X.S.quickRoutes || {};
  const profiles = [{ id: 'allAI', name: '全部 AI', detail: '为下面六项设置默认节点；单项开启后覆盖默认节点。' }, ...(X.S.routeCatalog || [])];
  const rows = profiles.map((p) => {
    const setting = saved[p.id] || { enabled: false };
    const target = setting.target;
    const exists = !target || X.S.nodes.some((n) => n.subId === target.subId && n.tag === target.tag);
    const inherited = p.id !== 'telegram' && p.id !== 'allAI' && !setting.enabled && saved.allAI?.enabled;
    const targetName = target ? `${X.S.subscriptions.find((s) => s.id === target.subId)?.name || '订阅已删除'} / ${target.tag}` : '跟随当前代理节点';
    const toggle = h('input', { type: 'checkbox', checked: setting.enabled, 'aria-label': p.name + '分流', onchange: (e) => act(async () => {
      try { return await api('setQuickRoute', { id: p.id, enabled: e.target.checked }); }
      catch (err) { toggle.checked = setting.enabled; throw err; }
    }, '分流设置已保存', e.currentTarget) });
    const choose = () => {
      let closeDialog;
      const body = groupedNodePicker(target, (nodeId) => act(async () => {
        const r = await api('setQuickRoute', { id: p.id, enabled: true, nodeId }); closeDialog(); return r;
      }, p.name + '分流已生效'));
      modal('选择 ' + p.name + ' 的出口节点', body, (close) => { closeDialog = close; return h('button', { class: 'btn', onclick: close }, '取消'); }, true);
    };
    const result = h('output', { class: 'route-test-result', 'aria-live': 'polite' });
    const testButton = h('button', { class: 'btn small', onclick: async (e) => {
      const button = e.currentTarget; button.disabled = true; result.textContent = '测试中…';
      try {
        const data = await api('testQuickRoute', { id: p.id });
        result.replaceChildren(...data.results.map((r) => h('div', {},
          (p.id === 'allAI' ? r.name + ' · ' : '') + (r.applied ? '已分流' : '未分流') + ' · ' + (r.country || '国家未知') + ' · ' + (r.node || '节点未知') + ' · ' + (r.latency == null ? '延迟未知' : r.latency + ' ms') + (r.error ? ' · ' + r.error : ''))));
      } catch (err) { result.textContent = '未确认分流 · 国家未知 · 节点未知 · ' + err.message; }
      finally { button.disabled = false; }
    } }, '测试分流');
    return h('div', { class: 'quick-route' , 'data-route-id': p.id },
      h('label', { class: 'switch' }, toggle, h('b', {}, p.name)),
      h('div', { class: 'quick-info' }, h('div', {}, inherited ? '继承全部 AI 的出口节点' : setting.enabled ? targetName : '未开启独立分流'),
        h('div', { class: 'note' }, !exists ? '原节点已失效，临时跟随当前代理；请重新选择。' : p.detail || (p.id === 'telegram' ? '域名＋官方 IPv4/IPv6 网段' : '内置域名规则')), result),
      testButton, h('button', { class: 'btn small', onclick: choose }, '选择节点'));
  });
  return h('section', { class: 'card quick-routing' }, h('h2', {}, '快捷分流', h('span', { class: 'hint' }, '独立出口 · 单项覆盖默认')),
    h('div', { class: 'note' }, '优先级：快捷分流 → 自定义规则 → 大陆直连 → 默认代理。关闭单项时会继承“全部 AI”，关闭全部 AI 后恢复普通规则。保存会重启运行中的内核，已有连接会断开。'), rows,
    h('details', { class: 'routing-help' }, h('summary', {}, '共享域名与生效范围'),
      h('p', {}, 'ChatGPT 与 Codex、Claude 与 Claude Code 共用登录和部分 API 域名。Codex／Claude Code 单项规则优先匹配专用 API 与原生进程；共用网页流量归 ChatGPT／Claude。基于 Node.js 运行的 CLI 无法仅凭域名完整区分，建议相关两项选同一节点。'),
      h('p', {}, '仅影响经过 Bear Box 的流量。CLI 不一定读取 Windows 系统代理，可启用 TUN，或在终端设置 HTTP_PROXY / HTTPS_PROXY 为 http://127.0.0.1:' + X.S.settings.mixedPort + '。第三方中转、自定义 API 地址、Google 登录及共享 CDN 未全部接管，可使用自定义规则补充。')));
}
