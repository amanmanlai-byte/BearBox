(async () => {
  const checks = [], errors = []; const realApi = api;
  const pause = (ms = 400) => new Promise(r => setTimeout(r, ms));
  const check = (v, m) => { if (!v) throw Error(m); checks.push(m); };
  window.addEventListener('error', e => errors.push(e.message));
  window.addEventListener('unhandledrejection', e => errors.push(String(e.reason)));
  await api('setSettings', { theme: 'dark', appearanceMode: 'dark' });
  window.__applyState(await api('state')); window.__go('settings'); await pause();
  check(document.querySelector('.page').textContent.includes('FakeIP'), 'DNS settings expose FakeIP');
  check(document.querySelector('.page').textContent.includes('DNS 反向映射'), 'DNS settings expose reverse mapping');
  check(!document.getElementById('wpveil'), 'brightness overlay element is absent');
  window.__go('appearance');
  check(!document.querySelector('.page').textContent.includes('亮度遮罩'), 'brightness overlay control is absent');
  window.__go('nodes');
  const details = document.querySelector('.node-distribution');
  details.querySelector('summary').click();
  check(!!details._expanding, 'details collapse uses an animation');
  await pause(); check(!details.open, 'details collapses after animation');
  details.querySelector('summary').click(); await pause();
  check(details.open && !details.style.overflow, 'details expands and restores natural layout');
  const sample = document.createElement('button'); sample.className = 'btn'; sample.textContent = '主题检查'; document.body.append(sample);
  await pause(); document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).forEach(a => a.finish()); const st = getComputedStyle(sample);
  check(st.backgroundColor !== 'rgb(255, 255, 255)', 'dark mode ordinary buttons use dark theme surfaces');
  sample.remove();
  const active = document.querySelector('.nav button.on');
  check(active.textContent.includes('节点'), 'navigation marks the current page');
  const oldState = X.S; let queried = [], selfRequests = 0, nodeRequests = 0;
  api = async (name, args) => {
    if (name === 'connections') return [
      { destinationIP: '8.8.8.8' }, { destinationIP: '8.8.8.8' },
      { destinationIP: '2606:4700:4700::1111' }, { destinationIP: '198.18.0.1', host: 'example.org' }, { host: 'unresolved.test' }
    ];
    if (name === 'geoIps') { queried.push(...args.ips); return { '8.8.8.8': { ip: '8.8.8.8', country: '美国', country_code: 'US', longitude: null, latitude: null }, '2606:4700:4700::1111': { ip: '2606:4700:4700::1111', country: '澳大利亚', country_code: 'AU', longitude: 133, latitude: -25 } }; }
    if (name === 'geoSelf') { selfRequests++; return { ip: '2606:4700:4700::1111', country_code: 'AU', country: '澳大利亚', longitude: 133, latitude: -25 }; }
    if (name === 'geoNodes') { nodeRequests++; return { 'probe.example': { ip: '1.1.1.1', country_code: 'AU', longitude: 133, latitude: -25 } }; }
    return realApi(name, args);
  };
  X.S = { ...oldState, selectedId: 'v6-probe', nodes: [{ id: 'v6-probe', tag: 'probe', server: 'probe.example', type: 'socks', port: 1 }], core: { ...oldState.core, state: 'running' } };
  window.__go('geo'); await pause(1800);
  const countryRows = [...document.querySelectorAll('.geo-country-row')].map(x => x.textContent);
  check(countryRows.some(x => x.includes('美国') && x.includes('2 条')), 'known country without coordinates retains two real connection counts');
  check(countryRows.some(x => x.includes('澳大利亚') && x.includes('1 条')), 'IPv6 targets are included in country counts');
  check(!queried.includes('198.18.0.1'), 'synthetic FakeIP is not geolocated as a real destination');
  check(document.querySelector('.geo-country-total').textContent.includes('2 条'), 'missing and synthetic targets remain honestly unlocated');
  const previousSelfRequests = selfRequests;
  window.__applyState({ ...X.S, core: { ...X.S.core, state: 'stopped' } }); await pause(600);
  check(selfRequests > previousSelfRequests, 'core state changes immediately refresh public-IP detection');
  const previousNodeRequests = nodeRequests;
  window.__applyState({ ...X.S, settings: { ...X.S.settings, ipv6Mode: 'prefer_ipv6' } }); await pause(1000);
  check(nodeRequests > previousNodeRequests, 'IPv6 strategy changes invalidate cached node location');
  check(errors.length === 0, 'no renderer exceptions or unhandled rejections');
  api = realApi; window.__applyState(oldState); window.__go('nodes');
  return { passed: checks.length, checks };
})()
