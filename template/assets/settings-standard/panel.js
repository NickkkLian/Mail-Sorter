/* Shared HTML Settings controller. App data and visual tokens belong to settings-adapter.js. */
(() => {
  'use strict';
  const A=window.settingsAdapter, C=window.HubSettingsContract, R=window.HubSettingsRuntime;
  if(!A||!C||!R)throw new Error('Settings adapter unavailable');
  const cap=C.AI_CAPABILITIES.find(c=>c.app===A.app), slot=HubSettingsContract.preferenceKey("pha-settings-v1:")+A.app, modelField=A.modelField||'model';
  const connectionStore=A.connectionStore||localStorage;
  const routeFields=A.connectionFields||[];const sameSource=(a,b)=>R.sameConnection(a,b)&&routeFields.every(f=>(a[f.key]||f.default||'')===(b[f.key]||f.default||''));
  const $=s=>dialog.querySelector(/^#(connection|ai|appearance|data|app)$/.test(s)?s.replace("#","#suite-section-"):s), tr=(en,zh)=>A.language()==='zh'?zh:en;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const text={reviewed:['Backup validated; review before restoring.','备份已验证；请检查后再恢复。'],loading:['Loading the selected repository…','正在加载所选仓库…'],loaded:['Reload finished; check the app sync status.','重新加载已结束；请检查应用同步状态。'],partial:['Restore stopped partway. Review the completed and remaining file list before retrying.','恢复中途停止；重试前请检查已完成与待完成文件清单。'],reload:['Backup files were written, but the app could not reload. Review the completed list and reload before editing.','备份文件已写入，但应用无法重新加载；编辑前请检查已完成清单并重新加载。'],backup:['The backup could not be validated. Review the file; no restore was performed.','无法验证此备份；请检查文件，没有执行恢复。'],'missing-after-read':['A previously read file now returns 404. Check repository access before continuing.','以前读到过的文件现在返回 404；请检查仓库访问权限后再继续。'],load:['Could not load the repository. See the app sync status; Settings did not write a data file.','无法加载仓库；请查看应用同步状态。设置没有写入数据文件。'],saved:['Saved','已保存'],source:['Key saved; source unavailable','密钥已保存；来源暂不可用'],invalid:['Saved settings need repair. Nothing was overwritten.','已保存的设置需要修复；没有覆盖任何内容。'],storage:["Couldn't save in this browser. Your entry is still here.",'无法在此浏览器中保存；输入仍保留。'],readback:['Could not verify saved settings. Your entry is still here.','无法验证保存结果；输入仍保留。'],conflict:['Changed elsewhere. Review the saved value before saving.','已在其他页面更改；请先检查已保存的值。'],pending:['Finish or cancel unsaved work and pending operations first.','请先完成或取消尚未保存的工作与进行中的操作。'],required:['Complete the account, repository and token.','请填写完整的账号、仓库与令牌。'],origin:C.hosted?['Manage shared keys on the hub. This origin is isolated.','请在 Hub 管理共享密钥；此来源保持独立。']:['This action is unavailable here.','此处无法执行此操作。'],unknown:["Couldn't complete this action. No success was recorded.",'无法完成此操作；没有记录成功状态。']};
  const message=code=>(text[code]||text.unknown)[A.language()==='zh'?1:0];
  let keyBase, modelBase, key='', model='', keyDirty=false, modelDirty=false, keyConflict=false, keyInvalid=false, source='missing',sourceFailedRaw=null,sourceGeneration=0,keySet=false;
  let prefs;
  let connectionBase, connectionChoice, connectionDraft, connectionDirty=false, connectionConflict=false;
  let staged=null, busy=false, stopModal=null,connectionInvalid=false,appearanceInvalid=false,showKey=false,showToken=false;
  const feedback={};let inputMode='keyboard';
  document.addEventListener('pointerdown',()=>{inputMode='pointer';if(dialog.open)dialog.dataset.openInput=inputMode;},true);
  document.addEventListener('keydown',()=>{inputMode='keyboard';if(dialog.open)dialog.dataset.openInput=inputMode;},true);
  const dialog=document.createElement('dialog');dialog.className='suite-panel';dialog.id='suite-settings';dialog.setAttribute('aria-labelledby','suite-settings-title');document.body.append(dialog);
  const portalURL=C.hosted?C.settingsManager || (window.__SETTINGS_TEST__===true&&C.writesAllowed(location.origin,true)?location.origin+'/?app='+encodeURIComponent(A.app)+'#keys-and-connections':''):'';
  const button=(id,en,zh)=>`<button type="button" id="${id}" ${id==='suite-export'&&A.canBackup&&!A.canBackup()||id==='suite-import-backup'&&A.canImport&&!A.canImport()?'disabled':''}>${tr(en,zh)}</button>`;
  const actions=html=>`<div class="suite-actions">${html}</div>`;
  const status=id=>`<p id="suite-${id}-status" role="${feedback[id]&&feedback[id]!=='saved'&&feedback[id]!=='source'&&feedback[id]!=='loading'&&feedback[id]!=='loaded'&&feedback[id]!=='reviewed'?'alert':'status'}">${feedback[id]?esc(message(feedback[id])):''}</p>`;
  const input=(id,label,value='',type='text')=>`<label for="${id}">${label}</label><input id="${id}" type="${type}" value="${esc(value)}" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="suite-${id.includes('conn')?'connection':'ai'}-status">`;
  const labels={existing:['Existing key','已有密钥'],portal:C.hosted?['Set in portal','在门户设置']:['Set in this app','在此应用设置'],app:['Set in this app','在此应用设置'],elsewhere:['Changed elsewhere','已在其他页面更改'],unknown:['Source unavailable','来源暂不可用'],missing:['Missing','未设置']};
  async function ask(en,zh,acceptEn='Discard',acceptZh='放弃'){
    const child=document.createElement('dialog');child.className='suite-confirm';child.setAttribute('aria-labelledby','suite-confirm-title');
    child.innerHTML=`<h2 id="suite-confirm-title" tabindex="-1">${tr('Confirm','确认')}</h2><p>${esc(tr(en,zh))}</p>${actions(button('suite-cancel','Cancel','取消')+button('suite-accept',acceptEn,acceptZh))}`;
    document.body.append(child);
    return new Promise(resolve=>{const done=C.openModal(child,child.querySelector('h2'));const finish=v=>{done();child.remove();resolve(v);};child.querySelector('#suite-cancel').onclick=()=>finish(false);child.querySelector('#suite-accept').onclick=()=>finish(true);child.oncancel=e=>{e.preventDefault();finish(false);};});
  }
  function updateSource(){
    if(!cap||A.demo)return;
    const generation=++sourceGeneration;let raw;try{raw=C.rawRead(localStorage,cap.storage);}catch{return;}
    C.keySource(localStorage,cap).then(value=>{
      if(generation!==sourceGeneration||C.rawRead(localStorage,cap.storage)!==raw)return;
      source=sourceFailedRaw&&raw===sourceFailedRaw&&C.keyRead(localStorage,cap).key?'unknown':value;
      if(dialog.open)render();
    }).catch(()=>{});
  }
  function readAI(keep=false){
    if(!cap||A.demo){keyInvalid=false;keySet=false;return;}
    try{const current=C.keyRead(localStorage,cap);keySet=!!current.key;keyBase=current.raw;modelBase=current.config[modelField];keyInvalid=false;if(!keep){showKey=false;key='';keyDirty=false;modelDirty=false;model=String(A.effectiveModel?A.effectiveModel():current.config[modelField]||cap.defaults?.[modelField]||cap.fixedModel);}keyConflict=false;}
    catch(e){keyInvalid=true;feedback.ai=e.code||'invalid';}
    updateSource();
  }
  function readConnection(keep=false){
    if(A.connectionReadOnly){connectionInvalid=false;connectionChoice='shared';connectionDraft={};connectionBase={local:{},mode:'shared'};return;}
    if(A.demo||A.localOnly){connectionInvalid=false;connectionChoice='override';connectionDraft={owner:'',repo:'',token:''};connectionBase={local:{},mode:'override'};return;}
    connectionInvalid=true;
    const raw=C.rawRead(connectionStore,A.connectionSlot), local=C.object(raw), effective=R.resolve(A.app,local);
    connectionBase={raw,local,shared:C.hosted?C.rawRead(localStorage,C.CONNECTION):null,sidecar:C.rawRead(localStorage,slot),mode:R.read(A.app).connectionMode};
    if(!keep){showToken=false;connectionChoice=C.hosted?effective.mode:'override';connectionDraft={owner:String(local.owner||effective.config.owner||''),repo:String(local.repo||effective.config.repo||''),token:''};for(const f of routeFields)connectionDraft[f.key]=String(local[f.key]||f.default||'');connectionDirty=false;}
    connectionConflict=false;connectionInvalid=false;
  }
  function currentPreferences(){
    const value={lang:C.rawRead(localStorage,HubSettingsContract.preferenceKey("pha-lang"))===null&&A.defaultLanguage?A.defaultLanguage:C.preferencesRead(localStorage).lang,...C.migrateTheme(localStorage,A.app)};
    if(!C.hosted)value.themeMode='app';
    if(A.palette){value.palette=R.read(A.app).palette??A.palette.legacy();if(!A.palette.values.includes(value.palette))throw new C.SettingsError('invalid');}
    return value;
  }
  function readPreferences(){
    appearanceInvalid=true;
    prefs=currentPreferences();appearanceInvalid=false;
  }
  function setPreview(){
    A.setLanguage(prefs.lang);const hub=C.preferencesRead(localStorage).theme;
    const theme=C.resolveAppTheme(prefs,hub),resolved=theme==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):theme;
    A.setTheme(theme);A.setPalette?.(prefs.palette);
    window.SuiteHeaderEntry?.update({language:prefs.lang,theme:resolved,error:appearanceInvalid});
  }
  async function togglePreference(kind){
    try{
      readPreferences();
      if(kind==='language'){
        const next=prefs.lang==='en'?'zh':'en';
        try{localStorage.setItem(HubSettingsContract.preferenceKey("pha-lang"),next);}catch{throw new C.SettingsError('storage');}
        if(C.rawRead(localStorage,HubSettingsContract.preferenceKey("pha-lang"))!==next)throw new C.SettingsError('readback');
      }else{
        const theme=C.resolveAppTheme(prefs,C.preferencesRead(localStorage).theme);
        const dark=theme==='dark'||theme==='system'&&matchMedia('(prefers-color-scheme: dark)').matches;
        R.write(A.app,{themeMode:'app',theme:dark?'light':'dark'});
      }
      readPreferences();setPreview();
      window.SuiteHeaderEntry?.announce(kind==='language'?tr('Language: English','语言：中文'):tr('Theme: ','主题：')+(document.documentElement.dataset.settingsScheme==='dark'?tr('dark','深色'):tr('light','浅色')));
    }catch(error){window.SuiteHeaderEntry?.announce(message(error.code||'storage'));}
  }
  function syncAIDraft(){
    if(!cap||A.demo)return;
    $('#suite-ai-save').disabled=busy||keyInvalid||keyConflict||(!keyDirty&&!modelDirty);
    $('#suite-ai-remove').disabled=busy||keyInvalid||keyConflict||!keySet;
    $('#suite-ai-cancel').disabled=busy||(!keyDirty&&!modelDirty);
    $('#suite-ai-draft').textContent=keyDirty||modelDirty?tr('Unsaved','未保存'):'';
  }
  function reconcile(parent,fresh){
    const compatible=(a,b)=>a&&a.nodeType===b.nodeType&&(a.nodeType!==Node.ELEMENT_NODE||a.tagName===b.tagName&&(a.id||'')===(b.id||''));
    for(let index=0;index<fresh.childNodes.length;index++){
      const wanted=fresh.childNodes[index];let current=parent.childNodes[index];
      if(wanted.nodeType===Node.ELEMENT_NODE&&wanted.id)current=[...parent.childNodes].find(node=>node.nodeType===Node.ELEMENT_NODE&&node.id===wanted.id);
      if(!compatible(current,wanted)){parent.insertBefore(wanted.cloneNode(true),parent.childNodes[index]||null);continue;}
      if(parent.childNodes[index]!==current)parent.insertBefore(current,parent.childNodes[index]||null);
      if(current.nodeType===Node.TEXT_NODE){if(current.nodeValue!==wanted.nodeValue)current.nodeValue=wanted.nodeValue;continue;}
      if(current.nodeType!==Node.ELEMENT_NODE)continue;
      if(['suite-connection-extra','suite-ai-extra','suite-data-extra'].includes(current.id))continue;
      for(const attribute of [...current.attributes])if(!wanted.hasAttribute(attribute.name))current.removeAttribute(attribute.name);
      for(const attribute of [...wanted.attributes])if(current.getAttribute(attribute.name)!==attribute.value)current.setAttribute(attribute.name,attribute.value);
      if(current instanceof HTMLInputElement&&wanted.hasAttribute('value')&&current.value!==wanted.getAttribute('value'))current.value=wanted.getAttribute('value');
      if(current.id!=='suite-app-controls')reconcile(current,wanted);
    }
    while(parent.childNodes.length>fresh.childNodes.length)parent.lastChild.remove();
  }
  function render(){
    const openDetails=[...dialog.querySelectorAll('details[id][open]')].map(e=>e.id);
    const scroll=$('.suite-panel-body')?.scrollTop||0, focused=dialog.contains(document.activeElement)?document.activeElement:null, focusId=focused?.id, selection=[focused?.selectionStart,focused?.selectionEnd];
    const connectionDiagnostic=JSON.stringify({app:A.app,section:'connection',problem:feedback.connection||'invalid',storageSlot:A.connectionSlot,storedValues:'excluded'},null,2);
    const sourceLabel=keyInvalid?['Needs repair','需要修复']:labels[source]||labels.unknown;
    const markup=`<div class="suite-panel-header"><h1 id="suite-settings-title" tabindex="-1">${tr('Settings','设置')}</h1>${button('suite-close','Close','关闭')}</div><div class="suite-panel-body">
      <section id="suite-section-app" data-section="app"><h2>${tr(A.appSection?.en||'App-specific',A.appSection?.zh||'应用专属')}</h2><div id="suite-app-controls"></div></section>
      <section id="suite-section-data" data-section="data"><h2>${tr('Backup','备份')}</h2><details id="suite-backup-help"><summary>${tr('What’s included','备份范围')}</summary><p>${esc(tr(A.backupHelp.en,A.backupHelp.zh))}</p><p>${A.dataMode==='repository'||A.demo?'':tr('Keys and connection details are left out. A backup can hold up to 2,000 files and 100 MB.','不包含密钥与连接信息。备份最多可包含 2,000 个文件、100 MB。')}</p></details>${actions((A.dataMode==='repository'||A.demo?'':button('suite-export','Export backup','导出备份')+button('suite-import-backup','Restore from file','从文件恢复')))}<input id="suite-import-file" type="file" accept="application/json,.json" hidden>
      ${staged?`<p id="suite-import-preview">${esc(staged.describe?.()||staged.summary)}</p><details><summary>${tr('Reviewed files','已检查的文件')}</summary><ul>${staged.files.map(file=>`<li>${esc(file.path)} · ${staged.mode==='browser'?tr('browser replacement','替换浏览器副本'):file.expectedSha?tr('replace','替换'):tr('create','新建')} · ${file.bytes} ${tr('bytes','字节')}</li>`).join('')}</ul></details>${actions(button('suite-restore','Restore reviewed backup','恢复已检查的备份')+button('suite-import-cancel','Cancel preview','取消导入'))}`:''}${status('data')}<div id="suite-data-extra"></div></section><section id="suite-connections"><h2>${tr('Connections','连接')}</h2><details id="suite-connection-details"><summary id="suite-connection-toggle">GitHub · ${esc(A.connection()?.owner||'—')}/${esc(A.connection()?.repo||'—')} · ${tr(C.complete(A.connection())?'configured':'missing',C.complete(A.connection())?'已配置':'未配置')}</summary>
      ${A.connectionReadOnly?`<section id="suite-section-connection" data-section="connection"><h2>${tr('Connection','连接')}</h2><p>${tr('Read-only shared connection. Manage its account, repository, branch and token in the portal.','只读共享连接；请在门户管理账号、仓库、分支与令牌。')}</p><p id="suite-connection-summary"></p><p>${esc(tr(A.locationHelp?.en||'Choose where this app keeps its files.',A.locationHelp?.zh||'选择此应用保存文件的位置。'))}</p>${portalURL?`<a href="${esc(portalURL)}">${tr('Manage in portal','在门户管理')}</a>`:''}${status('connection')}</section>`:A.localOnly?`<section id="suite-section-connection" data-section="connection"><h2>${tr("Connection","连接")}</h2><p>${tr("This app stores data on this device. No GitHub connection is used.","此应用在本机保存数据，不使用 GitHub 连接。")}</p></section>`:`<section id="suite-section-connection" data-section="connection"><h2>${tr('Connection','连接')}</h2><p>${tr('Saved in this browser; sent to GitHub when this app connects.','保存在此浏览器；本应用连接时发送给 GitHub。')}</p>
      <p id="suite-connection-summary"></p>${portalURL?`<a href="${esc(portalURL)}">${tr('Manage in portal','在门户管理')}</a>`:''}
      ${C.hosted?`<label for="suite-connection-mode">${tr('Connection source','连接来源')}</label><select id="suite-connection-mode"><option value="shared" ${C.writesAllowed(location.origin,window.__SETTINGS_TEST__===true)?'':'disabled'}>${tr('Shared connection','共享连接')}</option><option value="override">${tr('Use a different connection for this app','为此应用使用其他连接')}</option></select>`:'<input id="suite-connection-mode" type="hidden" value="override">'}
      <div id="suite-override" ${connectionChoice==='shared'?'hidden':''}>${input('suite-conn-owner',tr('GitHub account','GitHub 账号'),connectionDraft?.owner)}${input('suite-conn-repo',tr('Data repository','数据仓库'),connectionDraft?.repo)}
      <label for="suite-conn-token">${tr('GitHub token','GitHub 令牌')}</label><div class="suite-secret"><input id="suite-conn-token" type="${showToken?'text':'password'}" value="${esc(connectionDraft?.token||'')}" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="suite-connection-status">${button('suite-show-token',showToken?'Hide':'Show',showToken?'隐藏':'显示')}</div><p>${tr('Leave blank to keep the saved token.','留空以保留已保存的令牌。')}</p></div>
      <details><summary>${tr('File location','文件位置')}</summary><p>${esc(tr(A.locationHelp?.en||'Choose where this app keeps its files.',A.locationHelp?.zh||'选择此应用保存文件的位置。'))}</p>${routeFields.map(f=>input('suite-route-'+f.key,tr(f.en,f.zh),connectionDraft?.[f.key]||f.default||'')).join('')}<div id="suite-connection-extra"></div></details>${actions(button('suite-connection-save','Save','保存')+button('suite-connect','Connect / reload','连接 / 重新加载')+button('suite-connection-remove','Remove app token','移除此应用令牌'))}
      ${connectionConflict?actions(button('suite-connection-review','Review saved connection','检查已保存的连接')):''}${status('connection')}${connectionInvalid?'<details><summary>'+tr('Settings diagnostic','设置诊断')+'</summary><p>'+tr('Share this diagnostic for repair. No stored values are included; nothing was replaced.','可提供此诊断以协助修复；其中不含已存值，也没有替换设置。')+'</p><pre id="suite-connection-diagnostic" style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(connectionDiagnostic)+'</pre></details>':''}</section>`}
</details>${cap&&!A.demo?`<details id="suite-ai-details"><summary>${tr('AI key','AI 密钥')} · ${tr(keySet?'Set':'Missing',keySet?'已设置':'未设置')}</summary>`:''}
      ${cap&&!A.demo?`<section id="suite-section-ai" data-section="ai"><h2>AI</h2><p id="suite-ai-draft" role="status"></p><p id="suite-ai-source">${tr(sourceLabel[0],sourceLabel[1])} · ${tr('Unverified','未验证')}</p><p>${C.hosted?tr('Use a different key for each app. This device and browser only; sent to Anthropic when you use AI.','每个应用使用不同的密钥。仅此设备和浏览器；使用 AI 时发送给 Anthropic。'):tr('Your key stays in this browser and is sent to Anthropic when you use AI.','密钥保留在此浏览器；使用 AI 时才会发送给 Anthropic。')}</p>
      <label for="suite-ai-key">${tr('Anthropic API key','Anthropic API 密钥')}</label><div class="suite-secret"><input id="suite-ai-key" type="${showKey?'text':'password'}" value="${esc(key)}" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="suite-ai-status">${button('suite-show-key',showKey?'Hide':'Show',showKey?'隐藏':'显示')}</div><p>${tr('Leave blank to keep the saved key. Removal does not revoke it at Anthropic.','留空以保留已保存的密钥。移除不会在 Anthropic 撤销密钥。')}</p>
      <label for="suite-ai-model">${tr('Model','模型')}</label><select id="suite-ai-model" ${cap.fixedModel?'disabled':''}>${(cap.fixedModel?[cap.fixedModel]:['claude-opus-5-5','claude-sonnet-5-5','claude-haiku-5-5']).map(m=>`<option value="${m}">${m}</option>`).join('')}</select><p>${cap.fixedModel?tr('Managed by this app; provider availability has not been tested.','由此应用指定；尚未测试提供方可用性。'):tr('Existing model choices; provider availability has not been tested.','保留现有模型选项；尚未测试提供方可用性。')}</p>${portalURL?`<a href="${esc(portalURL)}">${tr('Manage this app’s key in portal','在门户管理此应用的密钥')}</a>`:''}
      <div id="suite-ai-extra"></div>${actions(button('suite-ai-save','Save','保存')+button('suite-ai-cancel','Cancel','取消')+button('suite-ai-remove','Remove key','移除密钥'))}${keyConflict?actions(button('suite-ai-review','Review saved value / keep editing','检查已保存的值 / 继续编辑')+button('suite-ai-reload','Reload saved value','重新加载已保存的值')):''}${status('ai')}<p>${tr('Older pages may keep an old key. Reopen them; close their Settings without saving first.','旧页面可能保留旧密钥。请重新打开；先关闭旧页面的设置且不要保存。')}</p></section>`:''}
${cap&&!A.demo?'</details>':''}</section>
      <section id="suite-section-reset">${button('suite-reset',A.resetLabel?.en||(C.hosted?(A.resetDescription?'Use the hub’s theme and reset app choices':'Use the hub’s theme again'):'Use the system theme again'),A.resetLabel?.zh||(C.hosted?(A.resetDescription?'使用 Hub 主题并恢复应用选项':'重新使用 Hub 主题'):'重新跟随系统主题'))}</section></div>`;
    const on=(id,fn)=>{const el=$(id);if(el)el.onclick=fn;};
    const template=document.createElement('template');template.innerHTML=markup;reconcile(dialog,template.content);
    for(const id of openDetails)$('#'+id)?.setAttribute('open','');
    on('#suite-close',close);on('#suite-ai-save',()=>action('ai',saveAI));on('#suite-ai-remove',()=>action('ai',removeAI));on('#suite-ai-cancel',()=>{key='';keyDirty=false;modelDirty=false;readAI();render();});
    onIf('#suite-ai-review',()=>{readAI(true);render();});onIf('#suite-ai-reload',()=>{readAI();render();});
    syncAIDraft();
    if(cap&&!A.demo){$('#suite-ai-key').oninput=e=>{key=e.target.value;keyDirty=!!key;syncAIDraft();};$('#suite-ai-model').value=model;$('#suite-ai-model').onchange=e=>{if(cap.fixedModel)return;model=e.target.value;modelDirty=model!==modelBase;syncAIDraft();};}
    for(const [id,target]of [['#suite-show-key','#suite-ai-key'],['#suite-show-token','#suite-conn-token']])on(id,()=>{const input=$(target),show=input.type==='password';if(target==='#suite-ai-key')showKey=show;else showToken=show;input.type=show?'text':'password';$(id).textContent=show?tr('Hide','隐藏'):tr('Show','显示');});
    if(!A.localOnly&&!A.connectionReadOnly){
    $('#suite-connection-mode').value=connectionChoice||'override';$('#suite-connection-mode').onchange=e=>{connectionChoice=e.target.value;connectionDirty=true;render();};
    for(const f of ['owner','repo','token'])$('#suite-conn-'+f).oninput=e=>{connectionDraft[f]=e.target.value;connectionDirty=true;};
    for(const f of routeFields)$('#suite-route-'+f.key).oninput=e=>{connectionDraft[f.key]=e.target.value;connectionDirty=true;};
    A.connectionControls?.($('#suite-connection-extra'),{draft:()=>connectionChoice==='shared'?R.resolve(A.app,C.object(C.rawRead(connectionStore,A.connectionSlot))).config:{...connectionBase.local,...connectionDraft,token:connectionDraft.token.trim()||connectionBase.local.token||''}});if(cap&&!A.demo)A.aiControls?.($('#suite-ai-extra'));
    on('#suite-connection-save',()=>action('connection',saveConnection));on('#suite-connect',()=>action('connection',async()=>{ensureSafe('connection');A.adopt(R.resolve(A.app,C.object(C.rawRead(connectionStore,A.connectionSlot))).config);readConnection();await R.track(()=>A.reload());}));on('#suite-connection-remove',()=>action('connection',removeConnection));onIf('#suite-connection-review',()=>{readConnection(true);render();});
    try{const effective=A.demo?{mode:'override',config:{}}:R.resolve(A.app,C.object(C.rawRead(connectionStore,A.connectionSlot)));$('#suite-connection-summary').textContent=(effective.mode==='shared'?tr('Shared connection','共享连接'):C.hosted?tr('App connection override','此应用的独立连接'):tr('App connection','应用连接'))+' · '+(effective.config.owner&&effective.config.repo?effective.config.owner+'/'+effective.config.repo:tr('Missing','未设置'));}catch(e){feedback.connection=e.code||'invalid';$('#suite-connection-status').textContent=message(feedback.connection);}
    }
    if(A.connectionReadOnly)try{const c=A.connection();$('#suite-connection-summary').textContent=(c.owner&&c.repo?c.owner+'/'+c.repo:tr('Missing repository','未设置仓库'))+' · '+(c.branch||'main')+' · '+(c.token?tr('Token configured','已设置令牌'):tr('Missing token','未设置令牌'));}catch(e){connectionInvalid=true;feedback.connection=e.code||'invalid';$('#suite-connection-status').textContent=message(feedback.connection);}
    on('#suite-export',()=>action('data',async()=>{const value=await R.track(()=>A.backup());const blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=A.app+'-private-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}));
    on('#suite-import-backup',()=>$('#suite-import-file').click());$('#suite-import-file').onchange=e=>action('data',async()=>{const file=e.target.files[0];e.target.value='';if(!file)return false;if(file.size>150*1024*1024)throw new C.SettingsError('invalid');staged=await A.stage(JSON.parse(await file.text()));feedback.data='reviewed';});
    onIf('#suite-import-cancel',()=>{staged=null;render();});onIf('#suite-restore',()=>action('data',async()=>{ensureSafe('restore');const prompt=A.restorePrompt?.(staged)||{en:'Replace the reviewed private data files in the connected repository? No file is written if you cancel. Multi-file writes can stop partway; completed files will be listed.',zh:'替换连接仓库中已检查的私有数据文件？取消则不会写入。多文件写入可能中途停止；会列出已完成的文件。'};if(!await ask(prompt.en,prompt.zh,'Restore','恢复'))return false;ensureSafe('restore');R.beginRestore();try{await R.track(()=>A.restore(staged),true);staged=null;}finally{R.endRestore();}}));
    on('#suite-reset',()=>action('data',async()=>{if(!await ask(C.hosted?`Use the hub’s theme again${A.resetDescription?.en||''}? Your language, keys, connections and data stay as they are.`:`Use the system theme again${A.resetDescription?.en||''}? Your language, keys, connection and data stay as they are.`,C.hosted?`重新使用 Hub 主题${A.resetDescription?.zh||''}？语言、密钥、连接和数据均保留。`:`重新跟随系统主题${A.resetDescription?.zh||''}？语言、密钥、连接和数据均保留。`,C.hosted?'Use hub theme':'Use system theme',C.hosted?'使用 Hub 主题':'跟随系统主题'))return false;R.write(A.app,{themeMode:C.hosted?'hub':'app',theme:'system'});A.resetPreferences();readPreferences();setPreview();}));
    A.dataControls?.($('#suite-data-extra'),window.SuiteSettings);A.appControls($('#suite-app-controls'),window.SuiteSettings);
    $('.suite-panel-body').scrollTop=scroll;
    if(focusId){const next=$('#'+focusId);next?.focus({preventScroll:true});if(next&&typeof selection[0]==='number'&&next.setSelectionRange)try{next.setSelectionRange(...selection);}catch{}}
    if(busy)dialog.querySelectorAll('input,select').forEach(el=>el.disabled=true);
    if(busy)dialog.querySelectorAll('button').forEach(b=>{if(b.id!=='suite-close')b.disabled=true;});
    if(A.demo&&!A.localOnly){$('#connection').querySelectorAll('input,select,button').forEach(el=>el.disabled=true);$('#suite-connection-summary').textContent=tr('Demo: no repository is connected.','演示：没有连接仓库。');}
    if(connectionInvalid&&!A.localOnly)$('#connection').querySelectorAll('input,select,button').forEach(el=>el.disabled=true);
    if(appearanceInvalid){$('#suite-reset').disabled=true;const note=document.createElement('p');note.setAttribute('role','alert');note.textContent=message(feedback.appearance||'invalid');$('#suite-section-reset').append(note);}
    if(keyInvalid&&$('#ai'))$('#ai').querySelectorAll('input,select,button').forEach(el=>{if(el.id!=='suite-ai-cancel')el.disabled=true;});
    for(const [id,invalid,slots]of [['connection',connectionInvalid,[A.connectionSlot,C.CONNECTION]],['ai',keyInvalid,[cap?.storage]]])if(invalid){const details=document.createElement('details'),summary=document.createElement('summary'),code=document.createElement('code');summary.textContent=tr('Diagnostic (no credentials)','诊断（不含凭据）');code.textContent=JSON.stringify({app:A.app,slots,problem:'invalid-or-blocked',overwritten:false});details.append(summary,code);$('#'+id).append(details);}
  }
  function onIf(id,fn){const el=$(id);if(el)el.onclick=fn;}
  function ensureSafe(purpose='data'){if(A.demo)throw new C.SettingsError('origin');if(R.pending)throw new C.SettingsError('pending');if(A.unsaved()){const candidate=purpose==='connection'?(connectionChoice==='shared'?C.connectionRead(localStorage).tuple:{...connectionBase?.local,...connectionDraft}):null;if(!(purpose==='connection'&&A.canConnectDrafts?.(candidate))&&!(purpose==='restore'&&A.canRestoreDrafts?.(staged)))throw new C.SettingsError('pending');}}
  async function action(section,fn){if(busy)return;busy=true;feedback[section]=null;render();try{const result=await fn();if(result!==false&&!feedback[section])feedback[section]='saved';}catch(e){feedback[section]=section==='data'&&(e.code==='invalid'||e instanceof SyntaxError)?'backup':e.code||'unknown';if(e.code==='conflict'){if(section==='ai')keyConflict=true;if(section==='connection')connectionConflict=true;}}finally{busy=false;refresh();}}
  async function saveAI(){
    if(!cap||A.demo)throw new C.SettingsError('origin');
    if(keyConflict)throw new C.SettingsError('conflict');
    if(!C.writesAllowed(location.origin,window.__SETTINGS_TEST__===true)&&!A.isolatedCredentials)throw new C.SettingsError('origin');
    if(keyDirty){const current=C.keyRead(localStorage,cap),previous=C.keyRead({getItem:()=>keyBase},cap);if(current.key===previous.key)keyBase=current.raw;const result=await C.keyWrite(localStorage,cap,key,keyBase,{origin:location.origin,testMode:window.__SETTINGS_TEST__===true,source:'app',locks:navigator.locks,...(A.isolatedCredentials?{localApp:A.app}:{})});key='';keyDirty=false;keyBase=C.rawRead(localStorage,cap.storage);if(!result.sourceSaved)feedback.ai='source';else sourceFailedRaw=null;}
    if(modelDirty&&!cap.fixedModel){const update=async()=>{const current=C.keyRead(localStorage,cap);if(current.config[modelField]!==modelBase)throw new C.SettingsError('conflict');const next=JSON.stringify({...cap.defaults,...current.config,[modelField]:model});try{localStorage.setItem(cap.storage,next);}catch{throw new C.SettingsError('storage');}if(C.rawRead(localStorage,cap.storage)!==next)throw new C.SettingsError('readback');};if(navigator.locks)await navigator.locks.request('pha-settings:'+cap.storage,update);else await update();}
    if(feedback.ai==='source')sourceFailedRaw=C.rawRead(localStorage,cap.storage);readAI();A.refreshAI();
  }
  async function removeAI(){if(!cap||A.demo)throw new C.SettingsError('origin');if(!await ask('Remove the saved key for '+A.app+'? Older open pages may retain it. This does not revoke it at Anthropic.','移除 '+A.app+' 的已保存密钥？旧的已打开页面可能仍保留该密钥；这不会在 Anthropic 撤销密钥。','Remove','移除'))return false;const result=await C.keyWrite(localStorage,cap,'',keyBase,{origin:location.origin,testMode:window.__SETTINGS_TEST__===true,source:'app',locks:navigator.locks,...(A.isolatedCredentials?{localApp:A.app}:{})},true);readAI();if(!result.sourceSaved)feedback.ai='source';A.refreshAI();}
  async function saveConnection(){
    const operation=async()=>{
    ensureSafe('connection');const before=C.rawRead(connectionStore,A.connectionSlot),local=C.object(before);if(connectionConflict||!sameSource(local,connectionBase.local)||C.hosted&&C.rawRead(localStorage,C.CONNECTION)!==connectionBase.shared||R.read(A.app).connectionMode!==connectionBase.mode)throw new C.SettingsError('conflict');
    if(!C.hosted)connectionChoice='override';
    if(connectionChoice==='shared'&&R.origin()!==C.HUB_ORIGIN)throw new C.SettingsError('origin');
    const next={...local,...Object.fromEntries(routeFields.map(f=>[f.key,connectionDraft[f.key].trim()||f.default||'']))};if(connectionChoice==='override'){Object.assign(next,{owner:connectionDraft.owner.trim(),repo:connectionDraft.repo.trim(),token:connectionDraft.token.trim()||local.token||''});if(!C.complete(next))throw new C.SettingsError('required');}
    A.validateConnection?.(next);if(A.preflightConnection){await R.track(()=>A.preflightConnection(connectionChoice==='shared'?{...next,...C.connectionRead(localStorage).tuple}:next));if(C.rawRead(connectionStore,A.connectionSlot)!==before||C.rawRead(localStorage,C.CONNECTION)!==connectionBase.shared||R.read(A.app).connectionMode!==connectionBase.mode)throw new C.SettingsError('conflict');}
    const raw=JSON.stringify(next);try{connectionStore.setItem(A.connectionSlot,raw);}catch{throw new C.SettingsError('storage');}if(C.rawRead(connectionStore,A.connectionSlot)!==raw)throw new C.SettingsError('readback');
    try{R.write(A.app,{connectionMode:connectionChoice});}
    catch(error){
      if(C.rawRead(connectionStore,A.connectionSlot)===raw)try{if(before===null)connectionStore.removeItem(A.connectionSlot);else connectionStore.setItem(A.connectionSlot,before);}catch{}
      throw error;
    }
    A.adopt(R.resolve(A.app,C.object(C.rawRead(connectionStore,A.connectionSlot))).config);readConnection();
    };
    return navigator.locks?navigator.locks.request('pha-settings:'+A.connectionSlot,operation):operation();
  }
  async function removeConnection(){
    ensureSafe();if(!await ask(C.hosted?'Disconnect this app by removing its saved override token? It will use app override mode; the shared connection is unchanged.':'Remove this app’s saved token from this browser? Files in your repository are kept.',C.hosted?'移除此应用已保存的独立令牌以断开连接？此应用将使用独立连接模式，共享连接保持不变。':'从此浏览器移除本应用已保存的令牌？仓库中的文件会保留。','Remove','移除'))return false;
    const operation=()=>{
      ensureSafe();if(C.rawRead(connectionStore,A.connectionSlot)!==connectionBase.raw||R.read(A.app).connectionMode!==connectionBase.mode)throw new C.SettingsError('conflict');
      const local=C.object(connectionBase.raw),previousSidecar=C.rawRead(localStorage,slot),raw=JSON.stringify({...local,token:''});
      R.write(A.app,{connectionMode:'override'});const writtenSidecar=C.rawRead(localStorage,slot);
      try{connectionStore.setItem(A.connectionSlot,raw);if(C.rawRead(connectionStore,A.connectionSlot)!==raw)throw new C.SettingsError('readback');}
      catch(error){if(C.rawRead(localStorage,slot)===writtenSidecar)try{if(previousSidecar===null)localStorage.removeItem(slot);else localStorage.setItem(slot,previousSidecar);}catch{}throw error instanceof C.SettingsError?error:new C.SettingsError('storage');}
      A.adopt(R.resolve(A.app,{...local,token:''}).config);readConnection();
    };
    return navigator.locks?navigator.locks.request('pha-settings:'+A.connectionSlot,operation):operation();
  }
  async function close(){if(busy||A.settingsBusy?.())return;if((keyDirty||modelDirty||connectionDirty||staged||A.settingsDirty?.())&&!await ask('Discard unsaved Settings drafts? Your work underneath stays open.','放弃尚未保存的设置草稿？下方的工作仍保持打开。'))return;A.discardSettings?.();staged=null;key='';keyDirty=false;modelDirty=false;keyConflict=false;connectionDirty=false;showKey=false;showToken=false;if(connectionDraft)connectionDraft.token='';for(const field of [$('#suite-ai-key'),$('#suite-conn-token')])if(field){field.value='';field.setAttribute('value','');field.type='password';}if(stopModal){stopModal();stopModal=null;}}
  function refresh(){
    updateSource();
    if(cap&&!A.demo)try{
      A.refreshAI();const wasInvalid=keyInvalid,current=C.keyRead(localStorage,cap),raw=current.raw;keyInvalid=false;keySet=!!current.key;if(wasInvalid)feedback.ai=null;
      if(raw!==keyBase){if(keyDirty||modelDirty){const previous=C.keyRead({getItem:()=>keyBase},cap);if(keyDirty&&previous.key!==current.key||modelDirty&&modelBase!==current.config[modelField])keyConflict=true;else{keyBase=current.raw;if(!modelDirty){modelBase=current.config[modelField];model=String(A.effectiveModel?A.effectiveModel():current.config[modelField]||cap.defaults?.[modelField]||cap.fixedModel);}}}else readAI();}
    }catch(e){keyInvalid=true;feedback.ai=e.code||'invalid';}
    try{const wasInvalid=appearanceInvalid;readPreferences();setPreview();if(wasInvalid)feedback.appearance=null;}
    catch(e){appearanceInvalid=true;feedback.appearance=e.code||'invalid';}
    if(A.connectionReadOnly)A.refreshConnection?.();
    if(!A.demo&&!A.localOnly&&!A.connectionReadOnly)try{
      const wasInvalid=connectionInvalid,next=R.resolve(A.app,C.object(C.rawRead(connectionStore,A.connectionSlot))).config;connectionInvalid=false;if(wasInvalid)feedback.connection=null;const different=!sameSource(A.connection(),next);
      const changed=R.read(A.app).connectionMode!==connectionBase?.mode||C.hosted&&C.rawRead(localStorage,C.CONNECTION)!==connectionBase?.shared||!sameSource(C.object(C.rawRead(connectionStore,A.connectionSlot)),connectionBase?.local||{});
      if(changed||different){
        if(connectionDirty||busy||R.pending||A.unsaved()){connectionConflict=true;R.connectionDeferred=true;}
        else{
          R.connectionDeferred=false;A.adopt(next);readConnection();
          if(different&&C.complete(next)){
            feedback.connection='loading';
            void R.track(()=>A.reload()).then(()=>{feedback.connection='loaded';}).catch(()=>{feedback.connection='load';}).finally(()=>{if(!busy)refresh();});
          }
        }
      }else R.connectionDeferred=false;
    }catch(e){connectionInvalid=true;feedback.connection=e.code||'invalid';}
    if(dialog.open)render();
  }
  window.SuiteSettings={preferences:{toggle:togglePreference},async open(section='app'){
    if(dialog.open){if(section==='connection')$('#suite-connection-details').open=true;if(section==='ai')$('#suite-ai-details')?.setAttribute('open','');$('#'+section)?.scrollIntoView();return;}
    dialog.querySelectorAll('#suite-connection-details,#suite-ai-details').forEach(e=>e.open=false);
    readAI();try{readConnection();}catch(e){connectionChoice='override';connectionDraft={owner:'',repo:'',token:''};feedback.connection=e.code||'invalid';}
    try{readPreferences();}catch(e){prefs={lang:A.language(),themeMode:'hub',theme:'system'};feedback.appearance=e.code||'invalid';}
    dialog.dataset.openInput=inputMode;render();stopModal=C.openModal(dialog,$('#suite-settings-title'));if(section==='connection')$('#suite-connection-details').open=true;if(section==='ai')$('#suite-ai-details')?.setAttribute('open','');if(section!=='app')$('#'+section)?.scrollIntoView();
  },close,refresh,confirm:ask};
  dialog.oncancel=e=>{e.preventDefault();close();};
  dialog.addEventListener('keydown',e=>{
    if(e.key!=='Tab'||e.altKey||e.ctrlKey||e.metaKey)return;
    const items=[...dialog.querySelectorAll('button,input,select,textarea,a[href],summary,[tabindex]')].filter(el=>!el.disabled&&el.tabIndex>=0&&el.getClientRects().length);
    const first=items[0],last=items.at(-1);
    if(!first){e.preventDefault();$('#suite-settings-title').focus();return;}
    if(e.shiftKey&&(document.activeElement===first||document.activeElement===$('#suite-settings-title'))){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&dialog.open){if(document.querySelector('.suite-merge-dialog[open]'))e.preventDefault();e.stopImmediatePropagation();return;}if(C.isSettingsShortcut(e)){e.preventDefault();window.SuiteSettings.open();}},{capture:true});
  // Existing SafeMerge choices must remain operable when an autosave finishes under native Settings.
  // Preserve its mandatory explicit choice; do not turn Escape into an implicit mine/theirs decision.
  let mergeId=0;
  new MutationObserver(records=>{
    for(const record of records)for(const node of record.type==='attributes'?[record.target]:record.addedNodes){
      if(!(node instanceof HTMLElement)||!node.matches('[data-no-esc]')||node.closest('.suite-merge-dialog'))continue;
      if(node.classList.contains('overlay')&&!node.classList.contains('open'))continue;
      if(!document.querySelector('dialog[open]'))continue;
      const parent=node.parentElement,next=node.nextSibling,reused=node.classList.contains('overlay');
      const child=document.createElement('dialog');child.className='suite-merge-dialog';
      const heading=node.querySelector('h2,h3,.modal-title');if(heading){heading.id='suite-merge-title-'+(++mergeId);heading.tabIndex=-1;child.setAttribute('aria-labelledby',heading.id);}
      document.body.append(child);child.append(node);const done=C.openModal(child,heading);
      child.oncancel=e=>e.preventDefault();
      const cleanup=new MutationObserver(()=>{if(!node.isConnected||reused&&!node.classList.contains('open')){cleanup.disconnect();if(node.isConnected)parent.insertBefore(node,next?.parentElement===parent?next:null);done();child.remove();}});cleanup.observe(child,{childList:true,attributes:true,subtree:true,attributeFilter:['class']});
    }
  }).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
  C.observeSettings(refresh);matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(prefs)setPreview();});
  A.install(window.SuiteSettings);
  try{readPreferences();setPreview();readConnection();readAI();}catch(e){feedback.connection=e.code||'invalid';}
})();
