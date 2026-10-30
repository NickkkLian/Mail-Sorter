/* Opt-in document save status 1.0.0. App-owned persistence; no transport or storage. */
(() => {
  'use strict';
  function reason(error) {
    const code=error?.code, text=String(error?.message||'');
    if(code==='required'||/not configured/i.test(text))return 'connection';
    if(code==='conflict'||code==='missing-after-read'||/409|422|never read|keeps changing|没能读到|一直在变/.test(text))return 'changed';
    if(/401|403|credentials|permission|denied/i.test(text))return 'access';
    if(/404/.test(text))return 'missing';
    if(/fetch|network|offline/i.test(text))return 'network';
    if(code==='storage'||/50[0-9]|server|service/i.test(text))return 'service';
    return 'unknown';
  }
  function create() {
    const files=new Map(), drafts=new Map(), listeners=new Set();
    let generation=0, online=true, connected=false, lastSavedAt=null, retrying=false;
    const emit=()=>listeners.forEach(fn=>fn());
    function file(key){if(!files.has(key))files.set(key,{revision:0,done:0,active:new Set(),error:null,durable:false,retry:null});return files.get(key);}
    function live(token){return token?.generation===generation&&files.has(token.key)&&files.get(token.key).active.has(token);}
    const api={
      pending(key,retry,{durable=false}={}){const f=file(key);f.revision++;f.retry=retry;f.durable=durable;emit();return f.revision;},
      start(key,revision){const f=file(key);const token=Object.freeze({key,revision:revision??f.revision,generation});f.active.add(token);emit();return token;},
      succeed(token,date=new Date()){if(!live(token))return;const f=file(token.key);f.active.delete(token);f.done=Math.max(f.done,token.revision);if(f.done>=f.revision)f.error=null;
        if(date!==null){const at=new Date(date);if(Number.isFinite(+at)&&(!lastSavedAt||+at>+lastSavedAt))lastSavedAt=at;}emit();},
      fail(token,error){if(!live(token))return;const f=file(token.key);f.active.delete(token);if(token.revision>f.done)f.error=reason(error);emit();},
      draft(key,dirty,{durable=false}={}){if(dirty)drafts.set(key,{durable});else drafts.delete(key);emit();},
      retained(key,durable){const f=files.get(key);if(f){f.durable=Boolean(durable);emit();}},
      connection(value){online=value.online;connected=value.connected;emit();},
      reset(){generation++;files.clear();drafts.clear();lastSavedAt=null;emit();},
      snapshot(){
        const dirty=[...files.values()].filter(f=>f.revision>f.done), failed=dirty.filter(f=>f.error);
        const durable=[...dirty,...drafts.values()].length>0&&[...dirty,...drafts.values()].every(f=>f.durable);
        const state=!online?'offline':!connected?'local':failed.length?'error':dirty.length?'saving':drafts.size?'draft':lastSavedAt?'saved':'ready';
        return {state,lastSavedAt:lastSavedAt?new Date(lastSavedAt):null,durable,reason:failed[0]?.error||null,retrying,retryable:online&&connected&&failed.some(f=>typeof f.retry==='function')};
      },
      async retry(){
        if(retrying)return;const callbacks=[...new Set([...files.values()].filter(f=>f.error&&f.revision>f.done&&typeof f.retry==='function').map(f=>f.retry))];
        if(!online||!connected||!callbacks.length)return;retrying=true;emit();
        try{await Promise.allSettled(callbacks.map(fn=>Promise.resolve().then(fn)));}finally{retrying=false;emit();}
      },
      subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
    };
    return api;
  }
  const reasons={en:{connection:'connect to save',changed:'file changed; review and try again',access:'check connection access',missing:'file could not be found',network:'connection lost',service:'service unavailable',unknown:'could not save; try again'},zh:{connection:'请先连接',changed:'文件已更改，请检查后重试',access:'请检查连接权限',missing:'找不到文件',network:'连接中断',service:'服务暂不可用',unknown:'无法保存，请重试'}};
  function describe(s,language='en') {
    const zh=language==='zh', time=s.lastSavedAt?`${String(s.lastSavedAt.getHours()).padStart(2,'0')}:${String(s.lastSavedAt.getMinutes()).padStart(2,'0')}`:'';
    const saved=time?(zh?'已保存 ':'Saved ')+time:'';
    let text=s.state==='saving'?(zh?'正在保存…':'Saving…'):s.state==='error'?(zh?'未保存：':'Not saved: ')+reasons[zh?'zh':'en'][s.reason||'unknown']:s.state==='draft'?(zh?'未保存：请完成编辑':'Not saved: finish editing'):s.state==='saved'?saved:s.state==='ready'?(zh?'没有待保存更改':'No changes to save'):(s.state==='offline'?(zh?'离线':'Offline'):(zh?'仅在本机':'Local only'))+' · '+(s.durable?(zh?'更改已保存在此设备':'changes kept on this device'):(zh?'更改仅在此页面':'changes only in this page'));
    if(saved&&s.state!=='saved')text+=' · '+saved;
    return text;
  }
  function mount(element,store,{language=()=> 'en'}={}) {
    element.classList.add('suite-save-status');
    const status=element.ownerDocument.createElement('span'), button=element.ownerDocument.createElement('button');
    status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.setAttribute('aria-atomic','true');
    button.type='button';button.addEventListener('click',()=>store.retry());element.replaceChildren(status,button);
    function refresh(){const s=store.snapshot();element.dataset.saveState=s.state;const text=describe(s,language());if(status.textContent!==text)status.textContent=text;
      button.textContent=language()==='zh'?'重试':'Retry';button.hidden=!s.retryable;button.disabled=s.retrying;}
    const unsubscribe=store.subscribe(refresh);refresh();return {refresh,destroy(){unsubscribe();element.replaceChildren();}};
  }
  window.SuiteSaveStatus={create,describe,mount};
})();
