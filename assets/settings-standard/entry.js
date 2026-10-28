/* Header ownership only. No preferences, source routing or app registry. */
window.SuiteHeaderEntry=(()=>{
 const script=document.currentScript;
 const rowSelector=script?.dataset.settingsRow;
 const overlaySelector=(script?.dataset.settingsOverlays||'dialog[open]')+',[role="dialog"][aria-modal="true"]';
 const secondarySelector=script?.dataset.settingsSecondary;
 let gear,slot,queued=false,panelWasOpen=false,panelInert=false,openedFromGear=false;
 // Active layers own the corner from the start of a fade, including its zero-opacity first frame.
 const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
 function place(){
  queued=false;if(!gear)return;
  const row=document.querySelector(rowSelector);
  if(!row)return; // A replaced full-page detail owns its header until the main row returns.
  slot=row.querySelector(':scope > [data-settings-slot]');
  if(!slot){slot=document.createElement('span');slot.dataset.settingsSlot='';row.append(slot);}
  if(gear.parentElement!==slot)slot.append(gear);
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
  if(slot.hidden!==covered)slot.hidden=covered;
  // Native close restores its opener before the observer reveals the slot. Finish that focus restoration.
  if(closed&&!covered){const restore=openedFromGear;openedFromGear=false;queueMicrotask(()=>{if(gear.isConnected&&!slot.hidden&&(restore||document.activeElement===document.body))gear.focus({preventScroll:true});});}
 }
 function schedule(){if(!queued){queued=true;queueMicrotask(place);}}
 const observer=new MutationObserver(schedule);
 window.addEventListener('resize',schedule);
 document.addEventListener('click',e=>{if(!document.querySelector('.suite-panel[open]'))openedFromGear=!!gear?.contains(e.target);},true);
 document.addEventListener('keydown',e=>{if(window.HubSettingsContract?.isSettingsShortcut(e)&&!document.querySelector('.suite-panel[open]'))openedFromGear=!!gear?.contains(document.activeElement);},true);
 function mount(button){
  gear=button;
  if(!button.classList.contains('suite-gear'))button.classList.add('suite-gear');
  for(const name of ['data-i18n','data-i18n-aria','data-i18n-title'])button.removeAttribute(name);
  button.setAttribute('aria-label','Settings / 设置');button.title='Settings / 设置 (⌘,)';
  button.setAttribute('aria-keyshortcuts','Meta+, Control+,');
  place();
  observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style','hidden','open']});
 }
 function create(){const button=document.createElement('button');button.type='button';button.id='suite-entry';return button;}
 return {mount,create};
})();
