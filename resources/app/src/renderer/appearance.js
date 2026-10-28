'use strict';
// Visual preferences are saved independently and applied immediately.
const appearancePending = new Set();
PAGES.appearance = () => {
  const s = X.S.settings;
  const save = (patch) => api('setSettings', patch).catch((e) => toast(e.message, true));
  const schedule = (fn, ms) => { const timer = setTimeout(() => { appearancePending.delete(timer); fn(); }, ms); appearancePending.add(timer); return timer; };
  const clearScheduled = () => { appearancePending.forEach(clearTimeout); appearancePending.clear(); };
  const fld = (label, el, span, hint) => h('div', { class: 'field' + (span ? ' span2' : '') }, h('label', {}, label), el, hint ? h('div', { class: 'note' }, hint) : null);
  const sect = (title, ...kids) => h('div', { class: 'card sect' }, h('h2', {}, title), h('div', { class: 'form-grid' }, kids));
  const select = (key, label, options) => {
    const el = h('select', { 'aria-label': label, onchange: () => save({ [key]: el.value }) }, options.map(([v, t]) => h('option', { value: v }, t)));
    el.value = s[key]; return el;
  };
  const family = h('select', { 'aria-label': '主题风格' }, h('option', { value: 'standard' }, '简约'), h('option', { value: 'forest' }, '熊出没 · 森林'));
  const mode = h('select', { 'aria-label': '显示模式' }, h('option', { value: 'light' }, '浅色'), h('option', { value: 'dark' }, '深色'), h('option', { value: 'system' }, '跟随系统'));
  const syncTheme = (settings) => { family.value = settings.theme.startsWith('forest') ? 'forest' : 'standard'; mode.value = settings.appearanceMode || (['dark', 'forest-dark'].includes(settings.theme) ? 'dark' : 'light'); };
  syncTheme(s);
  family.addEventListener('change', () => { const dark = ['dark', 'forest-dark'].includes(document.documentElement.dataset.theme); save({ theme: family.value === 'forest' ? (dark ? 'forest-dark' : 'forest') : (dark ? 'dark' : 'light') }); });
  mode.addEventListener('change', () => save({ appearanceMode: mode.value }));
  const presets = [['森林绿','#367748'],['海洋蓝','#2f6bff'],['青绿','#127d78'],['琥珀','#b16514'],['玫红','#b83e65'],['紫色','#7654b7']];
  const lockColorControl = (el) => { el.classList.add('appearance-color-control'); el.inert = ['forest', 'forest-dark'].includes(document.documentElement.dataset.theme); return el; };
  const accentSection = lockColorControl(h('div', { class: 'field span2' }, h('label', {}, '主题主色'), h('div', { class: 'accent-presets' }, presets.map(([name, color]) => h('button', { class: 'accent-swatch', title: name, 'aria-label': name, 'data-accent': color, 'aria-pressed': String(s.accentColor === color), style: { backgroundColor: color }, onclick: () => { applyAccent(color); save({ accentColor: color }); } }))),
    h('details', { class: 'accent-custom' }, h('summary', {}, '自定义取色'), colorWheelPicker(s.accentColor || '', (c) => { applyAccent(c); save({ accentColor: c }); }, () => { applyAccent(''); save({ accentColor: '' }); }))));
  const slider = (key, label, min, max, step, suffix, initial) => {
    const value = h('span', { class: 'note', 'data-value': key }, String(initial) + suffix);
    const input = h('input', { type: 'range', min, max, step, value: initial, 'aria-label': label,
      oninput: (e) => { const v = Number(e.target.value); value.textContent = v + suffix; save({ [key]: key === 'windowOpacity' ? v / 100 : v }); } });
    return h('div', { class: 'field' }, h('label', {}, label), h('div', { class: 'toolbar' }, input, value));
  };
  const collapsed = h('input', { type: 'checkbox', checked: s.sidebarCollapsed, onchange: (e) => save({ sidebarCollapsed: e.target.checked }) });
  const layoutSection = h('div', { class: 'span2 appearance-layout' },
    fld('字体大小', select('fontSize', '字体大小', [['small','小'], ['standard','标准'], ['large','大']])),
    fld('界面密度', select('uiDensity', '界面密度', [['compact','紧凑'], ['standard','标准'], ['spacious','宽松']])),
    slider('sidebarWidth', '侧边栏宽度', 180, 280, 5, ' px', s.sidebarWidth),
    h('div', { class: 'field' }, h('label', {}, '侧边栏'), h('label', { class: 'switch' }, collapsed, '默认折叠')),
    slider('windowOpacity', '窗口不透明度', 70, 100, 5, '%', Math.round(s.windowOpacity * 100)),
    h('div', { class: 'note span2' }, '窗口不透明度影响整个窗口。毛玻璃效果可在下方开关和调整不透明度。'));
  const reset = h('button', { class: 'btn', onclick: async () => {
    const defaults = { theme:'light', appearanceMode:'system', accentColor:'', fontSize:'standard', uiDensity:'standard', sidebarWidth:218, sidebarCollapsed:false, windowOpacity:1, closeToTray:true, wallpaper:'', wallpaperOpacity:.35, wallpaperBlur:0, glassEnabled:true, glassOpacity:.6, fontColor:'', uiColor:'' };
    try { clearScheduled(); await api('setSettings', defaults); window.__applyState(await api('state')); window.__render(); toast('界面设置已恢复默认'); } catch (e) { toast(e.message, true); }
  } }, '恢复默认');
  const el = h('div', { class: 'page appearance-page' }, pageHead('界面自定义', '选择后实时预览并自动保存', reset),
    sect('外观',
        fld('主题风格', family, 0, '选择后立即生效'),
        fld('显示模式', mode, 0, '可跟随系统自动切换'),
        h('div', { class: 'note span2 forest-color-note' }, '森林风格采用专属配色；切换到简约风格可调整字体、界面颜色和主题主色。'),
        accentSection,
        layoutSection,
        h('div', {}, h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!s.closeToTray, onchange: (e) => save({ closeToTray: e.target.checked }) }), '关闭窗口时最小化到系统托盘')),
        fld('背景壁纸', h('div', { class: 'toolbar' },
          h('button', { class: 'btn small', onclick: (e) => act(() => api('pickWallpaper'), undefined, e.currentTarget) }, s.wallpaper ? '更换图片' : '选择图片'),
          h('button', { 'data-wallpaper-clear': '', disabled: !s.wallpaper, class: 'btn small danger', onclick: (e) => act(() => api('clearWallpaper'), '已恢复纯色背景', e.currentTarget) }, '清除壁纸'),
          h('span', { 'data-wallpaper-status': '', class: 'mut2' }, s.wallpaper ? '已启用' : '未设置')), 1, '图片会拷贝到程序数据目录，图片保存在本地配置中，随配置备份保留'),
        (() => {
          const debounce = { t: null, patch: {} };
          // sliders run on percent scales (10-100 / 0-95); convert to the stored fraction.
          // The raw value used to be persisted as-is (e.g. 55), which clamped opacity to 1 -
          // that was the "wallpaper opacity does nothing" bug.
          const toStored = (key, raw) => (key === 'wallpaperBlur' ? Number(raw) : Number(raw) / 100);
          const cssVar = (key) => (key === 'wallpaperOpacity' ? '--wp-o' : '--wp-blur');
          const initial = (key) => (key === 'wallpaperBlur' ? (Number(s[key]) || 0) : Math.round((Number(s[key]) || 0) * 100));
          const live = (key, raw) => { // instant preview, persisted shortly after
            const stored = toStored(key, raw);
            document.documentElement.style.setProperty(cssVar(key), key === 'wallpaperBlur' ? stored + 'px' : stored);
            clearTimeout(debounce.t);
            debounce.patch[key] = stored;
            debounce.t = schedule(() => { const patch = debounce.patch; debounce.patch = {}; api('setSettings', patch).catch((e) => toast(e.message, true)); }, 350);
          };
          const slider = (key, label, min, max, step, fmt) => {
            const val = h('span', { class: 'mut2', style: { fontSize: '11.5px', minWidth: '38px', textAlign: 'right' } }, fmt(initial(key)));
            const r = h('input', { type: 'range', min, max, step, value: initial(key), 'aria-label': label, oninput: (e) => { val.textContent = fmt(Number(e.target.value)); live(key, e.target.value); } });
            return h('div', { class: 'field' }, h('label', {}, label), h('div', { class: 'toolbar' }, r, val));
          };
          const pct = (v) => Math.round(v * 100) + '%';
          const px = (v) => v + 'px';
          return h('div', { class: 'span2', style: { display: 'grid', gap: '10px' } },
            slider('wallpaperOpacity', '壁纸不透明度（图片显示强度）', 10, 100, 5, (v) => pct(v / 100)),
            slider('wallpaperBlur', '壁纸模糊', 0, 40, 2, px));
        })(),
        (() => { // font color picker (color wheel)
          let deb;
          const picker = colorWheelPicker(s.fontColor || '',
            (c) => { applyFontColor(c); clearTimeout(deb); deb = schedule(() => api('setSettings', { fontColor: c }).catch((e) => toast(e.message, true)), 400); },
            () => { applyFontColor(''); clearTimeout(deb); deb = schedule(() => api('setSettings', { fontColor: '' }).catch((e) => toast(e.message, true)), 400); });
          return lockColorControl(h('div', { class: 'field span2' }, h('label', {}, '字体颜色（色轮选择，影响全应用文字）'), picker, h('p', { class: 'note font-contrast-hint' }, '所选字体颜色与当前背景对比不足，暂时使用主题文字色；切换主题时会重新检查。')));
        })(),
        (() => {
          let deb;
          const saveColor = (c) => { applyUiColor(c); clearTimeout(deb); deb = schedule(() => api('setSettings', { uiColor: c }).catch((e) => toast(e.message, true)), 400); };
          return lockColorControl(h('div', { class: 'field span2' }, h('label', {}, '界面颜色（色轮选择，柔和融入当前主题）'), colorWheelPicker(s.uiColor || '', saveColor, () => saveColor(''))));
        })(),
        (() => { // frosted glass: independent opacity, text stays solid
          const live = (v) => { document.documentElement.style.setProperty('--glass-pct', Math.round(v * 100) + '%'); };
          const deb = { t: null };
          const r = h('input', { type: 'range', min: 15, max: 100, step: 5, value: Math.round((s.glassOpacity ?? 0.6) * 100), 'aria-label': '毛玻璃不透明度',
            oninput: (e) => { live(Number(e.target.value) / 100); clearTimeout(deb.t); const value = Number(e.target.value) / 100; deb.t = schedule(() => api('setSettings', { glassOpacity: value }).catch((err) => toast(err.message, true)), 350); } });
          const sw = h('input', { type: 'checkbox', checked: !!s.glassEnabled, onchange: (e) => act(() => api('setSettings', { glassEnabled: e.target.checked }), e.target.checked ? '毛玻璃已开启' : '毛玻璃已关闭') });
          return h('div', { class: 'field span2' }, h('label', {}, '毛玻璃效果（卡片磨砂，文字不透明度不受影响）'),
            h('div', { class: 'toolbar', style: { marginTop: '4px' } }, h('label', { class: 'switch' }, sw, '启用'), h('span', { class: 'sp' }), r));
        })())
  );
  return { el, state(S2) { syncTheme(S2.settings); el.querySelectorAll('.appearance-color-control').forEach((item) => { item.inert = ['forest', 'forest-dark'].includes(document.documentElement.dataset.theme); }); collapsed.checked = !!S2.settings.sidebarCollapsed; el.querySelectorAll('[data-accent]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.accent === S2.settings.accentColor))); const clear = el.querySelector('[data-wallpaper-clear]'); if (clear) clear.disabled = !S2.settings.wallpaper; const status = el.querySelector('[data-wallpaper-status]'); if (status) status.textContent = S2.settings.wallpaper ? '已启用' : '未设置'; } };
};
