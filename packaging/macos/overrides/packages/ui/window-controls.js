const glyph=path=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="${path}"/></svg>`;
const fullscreenGlyph=active=>glyph(active?'M3 8h5V3 M16 3v5h5 M21 16h-5v5 M8 21v-5H3':'M8 3H3v5 M16 3h5v5 M3 16v5h5 M21 16v5h-5');
const maximizeGlyph=maximized=>glyph(maximized?'M8 8V4h12v12h-4 M4 8h12v12H4z':'M5 5h14v14H5z');
export function createWindowControls({flush,toast}){
  const bridge=window.shensiWindow,popup=!!window.opener&&new URLSearchParams(window.location?.search||'').has('detached');let maximized=false,fullscreen=false;
  document.documentElement.classList.toggle('desktop-shell',!!bridge?.desktop);
  const update=state=>{maximized=!!state.maximized;fullscreen=!!state.fullscreen;document.documentElement.classList.toggle('shensi-fullscreen',fullscreen);const group=document.querySelector('.window-controls');if(group)group.hidden=fullscreen;const full=document.querySelector('[data-action="window-fullscreen"]');if(full){full.title=fullscreen?'退出全屏（F11）':'全屏模式（F11）';full.setAttribute('aria-label',fullscreen?'退出全屏':'全屏模式');full.setAttribute('aria-pressed',String(fullscreen));full.innerHTML=fullscreenGlyph(fullscreen);}const button=document.querySelector('[data-action="window-maximize"]');if(!button)return;const label=maximized?'向下还原':'最大化';button.title=bridge?.desktop?label:label+'（桌面版可用）';button.setAttribute('aria-label',label);button.setAttribute('aria-pressed',String(maximized));button.innerHTML=maximizeGlyph(maximized);};
  if(bridge?.desktop){bridge.onStateChange(update);bridge.getState().then(update).catch(error=>toast(error.message));}
  else document.addEventListener('fullscreenchange',()=>update({fullscreen:!!document.fullscreenElement}));
  return {
    fullscreenMarkup:()=>window.parent!==window?'':`<button data-action="window-fullscreen" aria-label="${fullscreen?'退出全屏':'全屏模式'}" title="${fullscreen?'退出全屏':'全屏模式'}（F11）" aria-pressed="${fullscreen}">${fullscreenGlyph(fullscreen)}</button>`,
    markup:()=>{const extra=bridge?.desktop?'':'disabled',hint=bridge?.desktop?'':'（桌面版可用）';return `<div class="window-controls" ${fullscreen?'hidden':''} role="group" aria-label="窗口操作"><button data-action="window-minimize" aria-label="最小化" title="最小化${hint}" ${extra}>${glyph('M5 12h14')}</button><button data-action="window-maximize" aria-label="${maximized?'向下还原':'最大化'}" title="${maximized?'向下还原':'最大化'}${hint}" aria-pressed="${maximized}" ${extra}>${maximizeGlyph(maximized)}</button><button data-action="window-close" class="window-close" aria-label="关闭窗口" title="关闭窗口${bridge?.desktop||popup?'':hint}" ${bridge?.desktop||popup?'':'disabled'}>${glyph('M6 6l12 12 M18 6 6 18')}</button></div>`;},
    command:async action=>{if(action==='window-fullscreen'){if(bridge?.desktop)update(await bridge.toggleFullscreen());else{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();update({fullscreen:!!document.fullscreenElement});}return;}if(action==='window-close'&&(bridge?.desktop||popup)){
      // Hiding keeps the resident editor and background work intact. Only an
      // actual window close uses the save/leave workflow (e.g. detached panes).
      if(bridge?.desktop&&(await bridge.getState()).closeBehavior==='hide-to-tray'){await bridge.close();return;}
      if(await flush()===false)return;if(bridge?.desktop)await bridge.close();else window.close();return;
    }if(!bridge?.desktop)return;if(action==='window-minimize')update(await bridge.minimize());else if(action==='window-maximize')update(await bridge.toggleMaximize());}
  };
}
