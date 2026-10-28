(async () => {
  const checks = []; const pause = ms => new Promise(r => setTimeout(r,ms));
  const check = (v,m) => { if (!v) throw Error(m); checks.push(m); };
  const lum = (rgb) => { const f=rgb.map(n=>{const v=n/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return .2126*f[0]+.7152*f[1]+.0722*f[2]; };
  const color = (value) => { const m=value.match(/[\d.]+/g); return m && m.slice(0,3).map(Number); };
  const ratio = (a,b) => { const x=lum(a), y=lum(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); };
  const button=document.createElement('button'); button.className='btn primary'; button.textContent='测试'; button.style.transition='none'; document.body.append(button);
  const presets=['#367748','#2f6bff','#127d78','#b16514','#b83e65','#7654b7','#ffffff','#000000'];
  for(const theme of ['light','dark']) {
    X.S.settings.theme=theme; X.S.settings.appearanceMode=['dark','forest-dark'].includes(theme)?'dark':'light'; applyTheme();
    for(const preset of presets) {
      applyAccent(preset); const st=getComputedStyle(button); const fg=color(st.color), bg=color(st.backgroundColor);
      check(fg && bg && ratio(fg,bg)>=4.45, `${theme} ${preset} accent text contrast`);
    }
  }
  button.remove();
  return { passed: checks.length, checks };
})()
