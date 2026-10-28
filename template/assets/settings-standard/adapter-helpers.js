/* Preserve each app's existing CSS, including all its dark-mode rules. */
window.SuiteSettingsHelpers={
  kitPreferences(app){
    const R=HubSettingsRuntime,values=['plaster','paper','ink'];
    const legacyPalette=()=>{const v=localStorage.getItem(HubSettingsContract.preferenceKey("nl-theme"));return values.includes(v)?v:'plaster';};
    const legacyShortcuts=()=>localStorage.getItem(HubSettingsContract.preferenceKey("nl-shortcuts"))!=='off';
    Appearance.shortcutsOn=()=>{try{return R.read(app).shortcuts??legacyShortcuts();}catch{return legacyShortcuts();}};
    const shortcuts=SuiteFieldGroup({id:'suite-shortcuts',slot:HubSettingsContract.preferenceKey("pha-settings-v1:")+app,fields:[{key:'shortcuts',type:'checkbox',default:legacyShortcuts(),en:'Single-key page shortcuts',zh:'页面单键快捷键'}],afterSave(){document.dispatchEvent(new CustomEvent('shortcutschange',{detail:{on:Appearance.shortcutsOn()}}));}});
    return {
      defaultLanguage:'en',
      palette:{values,legacy:legacyPalette,labels:{plaster:{en:'Water lilies',zh:'睡莲'},paper:{en:'Morning light',zh:'晨光'},ink:{en:'Dusk',zh:'暮色'}}},
      setTheme(theme){const d=document.documentElement;d.dataset.scheme=theme;d.style.colorScheme=theme==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):theme;queueMicrotask(()=>{for(const meta of document.querySelectorAll('meta[name="theme-color"]'))meta.content=getComputedStyle(d).getPropertyValue('--bg').trim();});},
      setPalette(value){document.documentElement.dataset.theme=value||legacyPalette();},
      resetDescription:{en:', palette override and single-key shortcut override',zh:'、配色独立设置与单键快捷键独立设置'},
      resetPreferences(){R.write(app,{palette:undefined,shortcuts:undefined});shortcuts.discard();},
      settingsDirty:()=>shortcuts.dirty(),discardSettings(){shortcuts.discard();},
      shortcuts(container){let target=container.querySelector('#suite-shortcuts');if(!target){target=document.createElement('div');target.id='suite-shortcuts';container.append(target);}shortcuts.mount(target);shortcuts.refresh();},
    };
  },
  controls(container,noteText,buttons){
    let note=container.querySelector('p');if(!note){note=document.createElement('p');container.append(note);}note.textContent=noteText;
    buttons.forEach((item,index)=>{let button=container.querySelector('#suite-app-action-'+index);if(!button){button=document.createElement('button');button.id='suite-app-action-'+index;button.type='button';container.append(button);}button.textContent=item.text;button.onclick=item.action;});
  },
  connectionNotice(elements){
    const note=document.createElement('p');note.className='settings-connection-note';note.style.cssText='max-width:1040px;margin:20px auto;padding:16px;';
    const button=document.createElement('button');button.type='button';button.className='btn';button.style.minHeight='44px';note.append(button);(document.querySelector('header')||document.querySelector('#header')||elements[0])?.after(note);
    return paused=>{note.hidden=!paused;for(const el of elements)if(el)el.inert=paused;const zh=window.settingsAdapter.language()==='zh';button.textContent=zh?'连接已更改；打开设置并重新加载':'Connection changed; open Settings and reload';button.onclick=()=>window.SuiteSettings.open('connection');};
  },
  gear(button,label){
    button.innerHTML='<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m10 3-.7 2.3-2 .9-2.2-.5-1.5 2.6L5.2 10v2l-1.6 1.7 1.5 2.6 2.2-.5 2 .9L10 19h3l.7-2.3 2-.9 2.2.5 1.5-2.6-1.6-1.7v-2l1.6-1.7-1.5-2.6-2.2.5-2-.9L13 3z"/><circle cx="11.5" cy="11" r="3"/></svg>';
    SuiteHeaderEntry.mount(button);
  },
  themeEngine(){
    const converted=[];
    const scope=(rules,scheme)=>[...rules].map(rule=>{
      if(rule.type===CSSRule.STYLE_RULE){const selectors=rule.selectorText.split(',').map(s=>{s=s.trim();return /^(?:html|:root)(?=[\s.#[:]|$)/.test(s)?s.replace(/^(?:html|:root)/,':root[data-settings-scheme="'+scheme+'"]'):':root[data-settings-scheme="'+scheme+'"] '+s;});return selectors.join(',')+'{'+rule.style.cssText+'}';}
      if(rule.cssRules&&rule.conditionText)return '@media '+rule.conditionText+'{'+scope(rule.cssRules,scheme)+'}';return '';
    }).join('\n');
    function visit(rules){for(const rule of [...rules]){
      if(rule.type===CSSRule.MEDIA_RULE&&/prefers-color-scheme\s*:\s*(dark|light)/.test(rule.conditionText)){
        const scheme=rule.conditionText.match(/prefers-color-scheme\s*:\s*(dark|light)/)[1];converted.push(scope(rule.cssRules,scheme));rule.media.mediaText='not all';
      }else if(rule.cssRules)visit(rule.cssRules);
    }}
    for(const sheet of [...document.styleSheets])try{visit(sheet.cssRules);}catch{}
    const style=document.createElement('style');style.dataset.settingsThemes='';style.textContent=converted.join('\n');document.head.append(style);
    return theme=>{const scheme=theme==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):theme;document.documentElement.dataset.settingsScheme=scheme;document.documentElement.style.colorScheme=scheme;let meta=document.querySelector('meta[name="theme-color"]');if(!meta){meta=document.createElement('meta');meta.name='theme-color';document.head.append(meta);}meta.content=getComputedStyle(document.body).backgroundColor;};
  },
  partial(completed,remaining){const zh=window.settingsAdapter.language()==='zh';return (zh?'已完成：':'Completed: ')+(completed.join(', ')||'0')+(zh?'；待完成：':'; remaining: ')+remaining.join(', ');},
};
