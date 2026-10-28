/* Optional adapters for non-AI apps. Contains no credentials or app registry. */
window.SuiteAppSettings=(()=>{
 const C=HubSettingsContract,R=HubSettingsRuntime,H=SuiteSettingsHelpers,B=SuiteBackup;
 function nestedStore(slot,field){return {
  getItem(){const raw=C.rawRead(localStorage,slot);if(raw===null)return null;let outer;try{outer=C.object(raw);}catch{return raw;}const value=outer[field];return value==null?null:JSON.stringify(value);},
  setItem(key,raw){const outer=C.object(C.rawRead(localStorage,slot));outer[field]=C.object(raw);localStorage.setItem(slot,JSON.stringify(outer));},
  removeItem(){const outer=C.object(C.rawRead(localStorage,slot));delete outer[field];localStorage.setItem(slot,JSON.stringify(outer));}
 };}
 function initial(app,slot,defaults={},nested){
  try{const store=nested?nestedStore(slot,nested):localStorage;const local=C.object(C.rawRead(store,slot));return R.resolve(app,{...defaults,...local}).config;}
  catch(error){window.settingsInitialError=error.code||'invalid';return {...defaults,owner:'',repo:'',token:''};}
 }
 const nativeFetch=window.fetch;
 window.fetch=async function(url,options){
  const parsed=new URL(String(url),location.href),match=parsed.hostname==='api.github.com'&&parsed.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/);
  const method=options?.method||'GET';
  if(match&&method!=='GET'&&window.settingsAdapter?.sourcePaused&&!R.restoring)throw new C.SettingsError('pending');
  const response=await nativeFetch.call(this,url,options);
  if(match&&method==='GET')R.fileRead({owner:decodeURIComponent(match[1]),repo:decodeURIComponent(match[2])},decodeURIComponent(match[3]),response.status,parsed.searchParams.get('ref')||'');
  return response;
 };
 function install(o){
  let gear=document.querySelector(o.gear),backup,paused=false,firstAdoption=false;
  let knownSource=!!(o.connection().owner&&o.connection().repo)||!!o.knownSource?.();
  if(gear){const replacement=gear.cloneNode(false);replacement.removeAttribute('onclick');gear.replaceWith(replacement);gear=replacement;}
  else{gear=SuiteHeaderEntry.create();}
  gear.classList.add('suite-app-entry');
  function logo(){const target=document.querySelector(o.logoSelector||'header .ico')||document.querySelector('header .brand,.topbar .brand,header .logo,.display,header h1');if(!target)return;if(o.replaceMark){target.querySelector('svg.star')?.remove();for(const n of target.childNodes)if(n.nodeType===3)n.textContent=n.textContent.replace(/^[\s]*(?:🎮|🎓)[\s]*/u,'');}if(target.querySelector('.app-logo'))return;const image=document.createElement('img');image.className='app-logo';image.src='assets/app-logo/logo.svg';image.alt='';image.width=32;image.height=32;if(target.matches('.ico'))target.replaceChildren(image);else target.prepend(image);}
  const label=()=>{H.gear(gear,o.language()==='zh'?'设置':'Settings');logo();};
  const same=(a,b)=>R.sameConnection(a,b)&&(o.fields||[]).every(f=>(a[f.key]||f.default||'')===(b[f.key]||f.default||''));
  const sameTarget=(a,b)=>a.owner===b.owner&&a.repo===b.repo&&(o.fields||[]).every(f=>(a[f.key]||f.default||'')===(b[f.key]??a[f.key]??f.default??''));
  const note=document.createElement('div');note.className='suite-source-note';note.hidden=true;note.setAttribute('role','status');document.body.append(note);
  const pause=value=>{paused=value;A.sourcePaused=value;note.hidden=!value;note.textContent=o.language()==='zh'?'连接已更改。请在设置中重新加载，成功后再编辑。':'Connection changed. Reload in Settings before editing.';for(const e of document.querySelectorAll(o.work||'main'))if(!e.contains(gear))e.inert=value;};
  function protect(e){if(paused&&!e.target.closest('.suite-panel,.suite-confirm,.suite-merge-dialog,.suite-app-entry,.suite-source-note')){e.preventDefault();e.stopImmediatePropagation();}}
  document.addEventListener('click',protect,true);document.addEventListener('keydown',e=>{if(!C.isSettingsShortcut(e)&&e.key!=='Escape')protect(e);},true);
  async function reload(){pause(true);try{await o.reload();if(!o.loaded())throw new C.SettingsError('load');}catch(error){if(error.code==='missing-after-read')throw error;throw new C.SettingsError('load');}firstAdoption=false;knownSource=true;pause(false);}
  const tr=(en,zh)=>o.language()==='zh'?zh:en;
  const connection=()=>{const c=o.connection();return {owner:c.owner||'',repo:c.repo||'',token:c.token||'',...((o.fields||[]).some(f=>f.key==='branch')?{branch:c.branch||'main'}:{})};};
  async function remoteBackup(){if(o.backupFactory){backup||=await o.backupFactory({connection,reload,pause});return backup;}if(!backup){const root=o.path();backup=await B.create({app:o.app,connection,roots:[root],allowed:p=>p===root||!!o.photo?.allowed(p),children:(p,v)=>p===root&&o.photo?o.photo.children(v):[],validate:(p,v)=>{if(p===root)o.validate(v);},validateBytes:(p,b)=>{if(p!==root)o.photo?.validate(p,b);},complete(files){if(!files.some(f=>f.path===root))throw new C.SettingsError('invalid');o.photo?.complete(root,files);},scope:o.scope,summary:(n,bytes)=>tr(n+' files · '+bytes+' bytes',n+' 个文件 · '+bytes+' 字节'),partial:(done,left)=>{pause(true);return tr('Written: '+done.join(', ')+'; remaining: '+left.join(', '),'已写入：'+done.join('、')+'；剩余：'+left.join('、'));},reload:()=>reload()});}return backup;}
  const local=async()=>B.localJSON({app:o.app,path:o.path(),identity:()=>JSON.stringify(o.connection()),snapshot:o.snapshot,validate:(p,v)=>o.validate(v),scope:o.scope,summary:(v,n)=>tr('Browser data · '+n+' bytes','本机数据 · '+n+' 字节'),replace:async value=>{if(!o.localSlot||!o.localDocument)throw new C.SettingsError('required');const before=C.rawRead(localStorage,o.localSlot),next=JSON.stringify(o.localDocument(value));try{localStorage.setItem(o.localSlot,next);}catch{throw new C.SettingsError('storage');}if(C.rawRead(localStorage,o.localSlot)!==next)throw new C.SettingsError('readback');try{await o.replaceLocal(value);}catch(error){if(C.rawRead(localStorage,o.localSlot)===next){if(before===null)localStorage.removeItem(o.localSlot);else localStorage.setItem(o.localSlot,before);}throw error;}}});
  const A=window.settingsAdapter={
   app:o.app,connectionSlot:o.slot,connectionStore:o.nested?nestedStore(o.slot,o.nested):localStorage,connectionFields:o.fields||[],routing:o.routing||o.path(),
   dataControls:o.dataControls,appSection:o.appSection,
   aiNotice:{en:'This app does not use an AI key.',zh:'此应用不使用 AI 密钥。'},
   settingsBusy:o.settingsBusy,settingsDirty:o.settingsDirty,discardSettings:o.discardSettings,
   defaultLanguage:o.defaultLanguage||'zh',language:o.language,setLanguage(value){o.setLanguage(value);label();},setTheme:o.setTheme||H.themeEngine(),connection:o.connection,
   validateConnection(next){for(const f of o.fields||[])if(f.key==='path'&&(!B.pathOK(next.path)||(o.pathKind!=='directory'&&!next.path.endsWith('.json'))))throw new C.SettingsError('invalid');},
   preflightConnection:o.preflightConnection,
   get sourceLoaded(){return o.loaded();},snapshot:o.snapshot,
   unsaved:()=>o.unsaved(),canConnectDrafts:candidate=>!!(candidate&&sameTarget(o.connection(),candidate)&&C.complete({...candidate,token:candidate.token||o.connection().token}))||!o.loaded()&&o.allowFirst===true&&(firstAdoption||!knownSource&&!C.complete(o.connection()))&&!o.hasDraft?.(),
   adopt(next){if(same(o.connection(),next))return;if(sameTarget(o.connection(),next)&&C.complete(next)){Object.assign(o.connection(),next);backup=null;return;}const disconnected=!C.complete(next),first=!knownSource&&!o.loaded()&&!C.complete(o.connection());o.adopt(next,disconnected,first);firstAdoption=first;if(!first&&C.complete(next))knownSource=true;backup=null;pause(!(disconnected&&o.offline));},
   reload,refreshAI(){},applyAI(){},resetDescription:o.resetDescription,resetPreferences(){o.reset?.();},
   backupHelp:{en:o.scope.en,zh:o.scope.zh},
   canBackup:()=>C.complete(o.connection())||o.offline===true,canImport:()=>C.complete(o.connection())||o.offline===true,
   backup:async()=>{if(!A.canBackup())throw new C.SettingsError('required');return C.complete(o.connection())?(await remoteBackup()).backup():(await local()).backup();},
   stage:async pkg=>{if(!A.canImport())throw new C.SettingsError('required');return C.complete(o.connection())?(await remoteBackup()).stage(pkg):(await local()).stage(pkg);},
   restore:async staged=>{try{return C.complete(o.connection())?await(await remoteBackup()).restore(staged):await(await local()).restore(staged);}catch(error){if(error.completed?.length)pause(true);throw error;}},
   restorePrompt:staged=>({en:staged.target?'Replace the reviewed repository files? Unsaved work is excluded. Photos are written first; partial writes remain visible.':'Replace this app’s current browser data with the reviewed backup? Original connection settings remain.',zh:staged.target?'替换已检查的仓库文件？不包含未保存工作。照片先写入；中途写入的结果会保留并列出。':'用已检查备份替换本应用当前本机数据？原连接设置保留。'}),
   appControls(el){if(o.appControls)o.appControls(el);else el.textContent=o.language()==='zh'?'原有业务编辑、导入与导出仍在各自工作区。':'Existing work editors, imports and exports remain in their work areas.';},
   install(settings){gear.onclick=()=>settings.open();label();SuiteHeaderEntry.mount(gear);const mount=()=>logo();new MutationObserver(mount).observe(document.body,{childList:true,subtree:true});o.install?.(settings);},
  };
  if(o.readOnly){A.dataMode="repository";A.dataControls=o.dataControls;}
  return A;
 }
 function serial(fn){const queue=SafeMerge.serial(fn);return (...args)=>R.track(()=>queue(...args));}
 return {initial,nestedStore,install,serial};
})();
