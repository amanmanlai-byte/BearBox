(async () => {
  const checks = []; const check = (v,m) => { if (!v) throw Error(m); checks.push(m); };
  const pause = (ms=200) => new Promise(r => setTimeout(r,ms));
  const until = async fn => { for (let i=0;i<60;i++) { if(fn()) return; await pause(100); } throw Error('restore timeout'); };
  const s = X.S.settings;
  check(s.appearanceMode==='light' && s.fontSize==='large' && s.uiDensity==='compact', 'display options persist after restart');
  check(s.sidebarWidth===250 && s.sidebarCollapsed===false && s.windowOpacity===.85 && !('windowBlur' in s), 'layout and window settings persist after restart');
  check(s.accentColor==='#7654b7' && s.fontColor==='#ffffff', 'custom color settings persist after restart');
  check(document.documentElement.dataset.fontAdjusted==='true', 'readable font fallback persists after restart');
  window.__go('appearance');
  [...document.querySelectorAll('button')].find(b=>b.textContent==='恢复默认').click();
  await until(()=>X.S.settings.appearanceMode==='system' && X.S.settings.fontSize==='standard' && X.S.settings.accentColor==='');
  const d=await api('state');
  check(d.settings.sidebarWidth===218 && d.settings.windowOpacity===1 && d.settings.fontColor==='' && d.settings.wallpaper==='', 'one-click reset clears appearance settings');
  check(!document.documentElement.hasAttribute('data-custom-ui') && document.documentElement.dataset.fontAdjusted==='false', 'reset removes custom colors');
  return { passed: checks.length, checks };
})()
