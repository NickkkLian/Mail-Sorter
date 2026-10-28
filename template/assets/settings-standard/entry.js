/* Header ownership only. Immediate preferences; no source routing or app registry. */
window.SuiteHeaderEntry=(()=>{
 const script=document.currentScript;
 const rowSelector=script?.dataset.settingsRow;
 const overlaySelector=(script?.dataset.settingsOverlays||'dialog[open]')+',[role="dialog"][aria-modal="true"]';
 const secondarySelector=script?.dataset.settingsSecondary;
 const inertSelector=script?.dataset.settingsInert,fullscreenSelector=script?.dataset.settingsFullscreens;
 let fullscreen=null,fullscreenOpener=null;
 let gear,slot,themeButton,languageButton,divider,announcement,queued=false,panelWasOpen=false,panelInert=false,openedFromGear=false;
 // Active layers own the corner from the start of a fade, including its zero-opacity first frame.
 const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
 function place(){
  queued=false;if(!gear)return;
  const row=document.querySelector(rowSelector);
  if(!row)return; // A replaced full-page detail owns its header until the main row returns.
  slot=row.querySelector(':scope > [data-settings-slot]');
  if(!slot){slot=document.createElement('span');slot.dataset.settingsSlot='';row.append(slot);}
  [themeButton,languageButton,divider,gear].forEach((control,index)=>{if(control&&slot.children[index]!==control)slot.insertBefore(control,slot.children[index]||null);});
  if(secondarySelector){
   let menu=row.querySelector(':scope > .suite-work-menu');
   const actions=[...row.querySelectorAll(secondarySelector)].filter(e=>!e.closest('.suite-work-menu'));
   if(actions.length){
    if(!menu){menu=document.createElement('details');menu.className='suite-work-menu';const summary=document.createElement('summary');summary.textContent='⋯';summary.title='More actions / 更多操作';summary.setAttribute('aria-label','More actions / 更多操作');menu.append(summary);const items=document.createElement('div');items.className='suite-work-items';menu.append(items);row.insertBefore(menu,slot);}
    for(const action of actions)menu.querySelector('.suite-work-items').append(action);
   }
   if(menu){const mode=innerWidth<640?'phone':'desktop';if(menu.dataset.mode!==mode){menu.dataset.mode=mode;menu.open=mode==='desktop';}}
  }
  const panel=document.querySelector('.suite-panel'),panelOpen=!!panel?.open,closed=panelWasOpen&&!panelOpen;
  if(panelOpen&&panel.inert){panelInert=true;panel.inert=false;panel.querySelector('#suite-settings-title')?.focus();}
  if(closed&&panelInert){panel.inert=true;panelInert=false;}
  panelWasOpen=panelOpen;
  const covered=!!overlaySelector&&[...document.querySelectorAll(overlaySelector)].some(visible);
  const active=fullscreenSelector?[...document.querySelectorAll(fullscreenSelector)].find(visible):null;
  const header=inertSelector&&document.querySelector(inertSelector);
  if(header)header.inert=!!active;
  if(active!==fullscreen){
   const previous=fullscreen;fullscreen=active;
   if(active){fullscreenOpener=document.activeElement;queueMicrotask(()=>{if(fullscreen===active&&!document.querySelector('dialog[open]')&&!active.contains(document.activeElement))(active.querySelector('.close-x')||active.querySelector('button,[tabindex="0"]'))?.focus({preventScroll:true});});}
   else if(previous){const opener=fullscreenOpener;fullscreenOpener=null;queueMicrotask(()=>{if(opener?.isConnected&&!opener.closest('[inert]'))opener.focus({preventScroll:true});});}
  }
  if(slot.hidden!==covered)slot.hidden=covered;
  // Native close restores its opener before the observer reveals the slot. Finish that focus restoration.
  if(closed&&!covered){const restore=openedFromGear;openedFromGear=false;queueMicrotask(()=>{if(gear.isConnected&&!slot.hidden&&(restore||document.activeElement===document.body))gear.focus({preventScroll:true});});}
 }
 function schedule(){if(!queued){queued=true;queueMicrotask(place);}}
 const observer=new MutationObserver(schedule);
 window.addEventListener('resize',schedule);
 document.addEventListener('click',e=>{if(!document.querySelector('.suite-panel[open]'))openedFromGear=!!gear?.contains(e.target);},true);
 document.addEventListener('keydown',e=>{if(window.HubSettingsContract?.isSettingsShortcut(e)&&!document.querySelector('.suite-panel[open]'))openedFromGear=!!gear?.contains(document.activeElement);},true);
 document.addEventListener('keydown',e=>{
  if(e.key!=='Tab'||!fullscreen||document.querySelector('dialog[open]'))return;
  const items=[...fullscreen.querySelectorAll('button,input,select,textarea,a[href],summary,[tabindex]')].filter(el=>!el.disabled&&el.tabIndex>=0&&el.checkVisibility());
  const first=items[0],last=items.at(-1);if(!first)return;
  if(!fullscreen.contains(document.activeElement)){e.preventDefault();first.focus();}
  else if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
 },true);
 function mount(button){
  // Adapters refresh the gear label after each language/data update.
  if(gear===button){place();return;}
  for(const control of [themeButton,languageButton,divider,announcement])control?.remove();
  gear=button;
  if(!document.querySelector(rowSelector))throw new Error('Missing app-owned Settings header row');
  const preferenceButton=(id,kind)=>{const b=document.createElement('button');b.type='button';b.id=id;b.className='suite-preference';b.onclick=()=>window.SuiteSettings.preferences.toggle(kind);return b;};
  themeButton=preferenceButton('suite-theme-toggle','theme');languageButton=preferenceButton('suite-language-toggle','language');
  divider=document.createElement('span');divider.className='suite-header-divider';divider.setAttribute('aria-hidden','true');
  announcement=document.createElement('span');announcement.className='suite-header-announcement';announcement.setAttribute('role','status');announcement.setAttribute('aria-live','polite');button.after(announcement);
  if(!button.classList.contains('suite-gear'))button.classList.add('suite-gear');
  for(const name of ['data-i18n','data-i18n-aria','data-i18n-title'])button.removeAttribute(name);
  button.setAttribute('aria-label','Settings / 设置');button.title='Settings / 设置 (⌘,)';
  button.setAttribute('aria-keyshortcuts','Meta+, Control+,');
  place();
  observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style','hidden','open']});
 }
 function create(){const button=document.createElement('button');button.type='button';button.id='suite-entry';return button;}
 function update({language,theme,error}){
  if(!themeButton)return;
  const dark=theme==='dark',zh=language==='zh';
  themeButton.setAttribute('aria-label',zh?(dark?'主题：深色；切换浅色':'主题：浅色；切换深色'):(dark?'Theme: dark; switch to light':'Theme: light; switch to dark'));
  themeButton.title=themeButton.getAttribute('aria-label');themeButton.dataset.scheme=theme;
  themeButton.innerHTML=dark?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z"/></svg>':'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg>';
  languageButton.textContent=zh?'中':'EN';languageButton.setAttribute('aria-label',zh?'语言：中文；切换英语':'Language: English; switch to Chinese');languageButton.title=languageButton.getAttribute('aria-label');
  themeButton.disabled=languageButton.disabled=!!error;
 }
 function announce(value){if(announcement)announcement.textContent=value;}
 return {mount,create,update,announce};
})();
