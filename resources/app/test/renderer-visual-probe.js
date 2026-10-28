(async () => {
  const checks = [], errors = [];
  window.addEventListener('error', e => errors.push(e.message));
  window.addEventListener('unhandledrejection', e => errors.push(String(e.reason)));
  const check = (v, m) => { if (!v) throw new Error(m); checks.push(m); };
  const pause = (ms = 300) => new Promise(r => setTimeout(r, ms));
  const until = async (fn) => { for (let i = 0; i < 100; i++) { if (fn()) return; await pause(100); } throw new Error('等待页面超时'); };
  const realApi = api;
  let actions = [], phase = 0;
  api = async (name, args) => {
    if (name === 'winAction') { actions.push(args.type); return {}; }
    if (name === 'connections' && phase === 1) return Array.from({ length: 10 }, (_, i) => ({ id: String(i), destinationIP: `9.9.9.${i + 1}` }));
    if (name === 'connections') return [
      { id: 'a', host: 'example.test', destinationIP: '8.8.8.8' },
      { id: 'b', host: 'example.test', destinationIP: '8.8.8.8' },
      { id: 'c', host: '1.1.1.1', destinationIP: '1.1.1.1' },
      { id: 'd', host: 'unresolved.test' },
      { id: 'e', host: '192.0.2.3', destinationIP: '192.0.2.3' },
    ];
    if (name === 'geoIps' && phase === 1) return Object.fromEntries(args.ips.map(ip => [ip, { country_code: 'FR', country: '法国', longitude: 2, latitude: 48 }]));
    if (name === 'geoIps') return { '8.8.8.8': { country_code: 'US', country: '美国', longitude: -100, latitude: 38 }, '1.1.1.1': { country_code: 'HK', country: '香港', longitude: 114, latitude: 22 }, '192.0.2.3': { error: 'unavailable' } };
    if (name === 'geoSelf') return { country_code: 'CN', country: '中国', longitude: 116, latitude: 40, ip: '192.0.2.1' };
    if (name === 'geoNodes') return {};
    return realApi(name, args);
  };
  [...document.querySelectorAll('[data-window-action]')].forEach(b => b.click()); await pause();
  check(actions.join(',') === 'minimize,maximize,close', 'window controls dispatch correct actions');
  await realApi('importLinks', { text: 'socks://127.0.0.1:23999#Local-1' });
  window.__applyState(await realApi('state')); await pause();
  window.__go('home');
  for (const theme of ['light', 'dark', 'forest', 'forest-dark']) {
    await realApi('setSettings', { theme, uiColor: '#b157a1', glassEnabled: true }); await pause(450);
    check(document.documentElement.dataset.theme === theme, theme + ' theme applies');
    check((document.documentElement.dataset.customUi === 'true') === !theme.startsWith('forest') && document.body.classList.contains('glass'), theme + ' tint and glass obey theme');
    const ds = document.querySelector('.legend-down'), us = document.querySelector('.legend-up');
    check(ds && us && getComputedStyle(ds).backgroundColor !== getComputedStyle(us).backgroundColor, theme + ' traffic legend uses distinct colors');
    const dummy = document.createElement('i'); dummy.style.color='var(--down)'; document.body.append(dummy);
    check(getComputedStyle(ds).backgroundColor === getComputedStyle(dummy).color, theme + ' legend matches download bars'); dummy.remove();
  }
  window.__go('appearance');
  const family = document.querySelector('[aria-label="主题风格"]'), mode = document.querySelector('[aria-label="显示模式"]');
  check(family.options.length === 2 && family.value === 'forest' && mode.value === 'dark', 'forest is one style with independent mode');
  mode.value = 'light'; mode.dispatchEvent(new Event('change')); await until(() => document.documentElement.dataset.theme === 'forest');
  check(family.value === 'forest' && mode.value === 'light', 'forest light mode preserves family');
  mode.value = 'dark'; mode.dispatchEvent(new Event('change')); await until(() => document.documentElement.dataset.theme === 'forest-dark');
  check(family.value === 'forest' && mode.value === 'dark', 'forest dark mode preserves family');
  await realApi('setSettings', { theme: 'light', appearanceMode: 'light' }); await pause(350);
  const uiField = [...document.querySelectorAll('.field')].find(x => x.textContent.includes('界面颜色（色轮'));
  const fontField = [...document.querySelectorAll('.field')].find(x => x.textContent.includes('字体颜色（色轮'));
  check(!!uiField && !!fontField && fontField.nextElementSibling === uiField, 'UI tint picker is beside font picker');
  uiField.querySelector('button[title="#5b9bd5"]').click(); await until(() => X.S.settings.uiColor === '#5b9bd5');
  check(getComputedStyle(document.documentElement).getPropertyValue('--ui-tint').trim() === '#5b9bd5', 'color wheel saves and previews UI tint');
  uiField.querySelector('button.btn').click(); await until(() => X.S.settings.uiColor === '');
  check(!document.documentElement.hasAttribute('data-custom-ui'), 'reset removes custom tint');
  window.__applyState({ ...X.S, core: { ...X.S.core, state: 'running' } });
  await pause(150); window.__go('geo');
  await until(() => document.querySelector('[data-v="globe"]')); document.querySelector('[data-v="globe"]').click();
  await until(() => document.querySelector('.geo-country-list')?.textContent.includes('美国'));
  const box = document.querySelector('.globe-view');
  check(getComputedStyle(box).backgroundColor === 'rgba(0, 0, 0, 0)', 'globe container is transparent');
  check(window.__globe && !window.__globe.inspect().failed, 'WebGL globe initializes');
  const lines = [...document.querySelectorAll('.geo-country-row')].map(e => e.textContent);
  check(lines.some(x => x.includes('美国') && x.includes('2 条')), 'two connections to one IP count twice');
  check(lines.some(x => x.includes('香港') && x.includes('1 条')), 'another country counts one connection');
  check(document.querySelector('.geo-country-total').textContent.includes('2 条'), 'unresolved connections remain unlocated');
  check(document.querySelector('.geo-country-list').textContent.includes('共 5 条'), 'total uses all active connections');
  check(!geoPublicIp('198.18.0.1') && !geoPublicIp('192.168.1.4') && !geoPublicIp('::1') && geoPublicIp('8.8.8.8') === '8.8.8.8', 'private and fake IPs remain unlocated');
  await pause(300); check(window.__globe.inspect().countries.find(c => c.code === 'US')?.count === 2, 'globe receives real counts');
  phase = 1;
  await until(() => document.querySelector('.geo-country-row')?.textContent.includes('10 条'));
  check(document.querySelector('.geo-country-total').textContent.includes('0 条'), 'additional batches locate connections beyond first eight');
  check(errors.length === 0, 'no renderer errors');
  api = realApi;
  return { passed: checks.length, checks };
})()
