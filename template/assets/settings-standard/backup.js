/* Private, staged backup adapter. Never reads browser credentials into an export. */
(() => {
  'use strict';
  const C=window.HubSettingsContract;
  const forbidden=new Set(['token','apikey','aikey','githubtoken','sitetoken','authorization','keydigest','phaconfig','phasettingsprovenancev1']);
  const isObject=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  const fail=code=>{throw new C.SettingsError(code);};
  function clean(value){
    if(Array.isArray(value))return value.map(clean);
    if(isObject(value))return Object.fromEntries(Object.entries(value).filter(([k])=>!forbidden.has(k.toLowerCase().replace(/[-_]/g,''))).map(([k,v])=>[k,clean(v)]));
    return value;
  }
  function pathOK(path){return typeof path==='string'&&!/[%\\\x00-\x1f?#]/.test(path)&&!path.startsWith('/')&&path.split('/').every(s=>s&&s!=='.'&&s!=='..'&&!s.startsWith('.'));}
  const encode=bytes=>{let out='';for(let i=0;i<bytes.length;i+=32768)out+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(out);};
  const decode=base64=>{if(typeof base64!=='string'||base64.length>150*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)||base64.length%4)fail('invalid');return Uint8Array.from(atob(base64),c=>c.charCodeAt(0));};
  async function hash(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');}
  window.SuiteBackup={clean,pathOK,async jsonPackage(app,documents,scope,sanitize=true){
    const files=[];
    for(const [path,value]of Object.entries(documents)){if(!pathOK(path))fail('invalid');const bytes=new TextEncoder().encode(JSON.stringify(sanitize?clean(value):value));files.push({path,encoding:'base64',bytes:bytes.length,sha256:await hash(bytes),content:encode(bytes)});}
    return {format:'hub-private-backup',version:1,app,createdAt:new Date().toISOString(),scope,files};
  },async localJSON(A){
    const identity=()=>String(A.identity());
    const snapshotHash=async()=>hash(new TextEncoder().encode(JSON.stringify(A.snapshot())));
    async function backup(){return window.SuiteBackup.jsonPackage(A.app,{[A.path]:A.snapshot()},A.scope);}
    async function stage(pkg){
      if(!isObject(pkg)||pkg.format!=='hub-private-backup'||pkg.version!==1||pkg.app!==A.app||!Array.isArray(pkg.files)||pkg.files.length!==1||(pkg.absentPaths?.length||0))fail('invalid');
      const file=pkg.files[0];
      if(!isObject(file)||file.path!==A.path||!pathOK(file.path)||file.encoding!=='base64')fail('invalid');
      const bytes=decode(file.content);
      if(bytes.length>100*1024*1024||file.bytes!==bytes.length||file.sha256!==await hash(bytes))fail('invalid');
      const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));A.validate(A.path,value);
      if(JSON.stringify(clean(value))!==JSON.stringify(value))fail('invalid');
      return {mode:'browser',files:[{...file,expectedSha:null}],value,identity:identity(),baseline:await snapshotHash(),summary:A.summary(value,bytes.length),describe:()=>A.summary(value,bytes.length)};
    }
    async function restore(staged){
      if(!staged||staged.identity!==identity()||staged.baseline!==await snapshotHash())fail('conflict');
      const checked=await stage({format:'hub-private-backup',version:1,app:A.app,files:staged.files});
      if(checked.identity!==staged.identity||checked.baseline!==staged.baseline)fail('conflict');
      await A.replace(checked.value);
    }
    return {backup,stage,restore};
  },async create(A){
    const readBefore=new Set();
    const target=()=>({...A.connection()});
    const identity=c=>JSON.stringify([c.owner,c.repo,c.token,c.branch||'']);
    const url=(c,path)=>'https://api.github.com/repos/'+encodeURIComponent(c.owner)+'/'+encodeURIComponent(c.repo)+'/contents/'+path.split('/').map(encodeURIComponent).join('/')+(c.branch?'?ref='+encodeURIComponent(c.branch):'');
    const headers=c=>({Authorization:'Bearer '+c.token,Accept:'application/vnd.github+json'});
    async function read(c,path,allowMissing=false){
      if(!C.complete(c))fail('required');
      if(!pathOK(path)||(!A.allowed(path)&&!A.directory?.(path)))fail('invalid');
      const actual=A.mapConnection?A.mapConnection(c,path):c;
      const key=identity(actual)+'/'+path,r=await fetch(url(actual,path),{headers:headers(actual),cache:'no-store'});
      window.HubSettingsRuntime?.fileRead(actual,path,r.status,c.branch||'');
      if(r.status===404){if(readBefore.has(key))fail('missing-after-read');if(allowMissing)return null;fail('required');}
      if(!r.ok)fail('storage');const entry=await r.json();
      if(Array.isArray(entry)){if(!A.directory?.(path))fail('invalid');return entry;}
      if(!A.allowed(path))fail('invalid');
      if(entry.type&&entry.type!=='file')fail('invalid');
      let content=entry.content;
      if(!content&&entry.sha){const blob=await fetch('https://api.github.com/repos/'+encodeURIComponent(c.owner)+'/'+encodeURIComponent(actual.repo)+'/git/blobs/'+encodeURIComponent(entry.sha),{headers:headers(actual),cache:'no-store'});if(!blob.ok)fail('storage');content=(await blob.json()).content;}
      if(typeof content!=='string'||!entry.sha)fail('invalid');
      const bytes=decode(content.replace(/\s/g,''));if(entry.size!==undefined&&entry.size!==bytes.length)fail('invalid');
      readBefore.add(key);return {bytes,sha:entry.sha};
    }
    async function pack(path,bytes){
      A.validateBytes?.(path,bytes);
      if(path.endsWith('.json')){const original=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));A.validate(path,original);bytes=new TextEncoder().encode(JSON.stringify(clean(original)));}
      return {path,encoding:'base64',bytes:bytes.length,sha256:await hash(bytes),content:encode(bytes)};
    }
    async function backup(){
      const c=target(),files=[],seen=new Set(),absentPaths=[];
      async function add(path,allowMissing=false){if(seen.has(path))return;seen.add(path);const got=await read(c,path,allowMissing);if(got===null){absentPaths.push(path);return;}if(Array.isArray(got)){for(const item of got){if(!item||!pathOK(item.path)||!item.path.startsWith(path+'/')||!['file','dir'].includes(item.type))fail('invalid');await add(item.path);}return;}files.push(await pack(path,got.bytes));if(A.children)for(const child of A.children(path,path.endsWith('.json')?JSON.parse(new TextDecoder().decode(got.bytes)):null))await add(child);}
      for(const path of A.roots)await add(path,true);if(!files.length)fail('required');if(files.length>2000||files.reduce((n,file)=>n+file.bytes,0)>100*1024*1024)fail('invalid');A.complete(files,absentPaths);
      return {format:'hub-private-backup',version:1,app:A.app,createdAt:new Date().toISOString(),scope:A.scope,files,absentPaths};
    }
    async function stage(pkg){
      if(!isObject(pkg)||pkg.format!=='hub-private-backup'||pkg.version!==1||pkg.app!==A.app||!Array.isArray(pkg.files)||!pkg.files.length||pkg.files.length>2000)fail('invalid');
      const absentPaths=pkg.absentPaths||[];if(!Array.isArray(absentPaths)||new Set(absentPaths).size!==absentPaths.length||absentPaths.some(p=>!A.roots.includes(p)))fail('invalid');
      const c=target(),files=[],seen=new Set();let total=0;
      for(const file of pkg.files){
        if(!isObject(file)||!pathOK(file.path)||!A.allowed(file.path)||seen.has(file.path)||file.encoding!=='base64')fail('invalid');seen.add(file.path);
        const bytes=decode(file.content);total+=bytes.length;if(total>100*1024*1024||file.bytes!==bytes.length||file.sha256!==await hash(bytes))fail('invalid');
        A.validateBytes?.(file.path,bytes);
        if(file.path.endsWith('.json')){const json=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));A.validate(file.path,json);if(JSON.stringify(clean(json))!==JSON.stringify(json))fail('invalid');}
        const old=await read(c,file.path,true);if(Array.isArray(old))fail('invalid');files.push({...file,expectedSha:old?.sha||null});
      }
      if(absentPaths.some(p=>seen.has(p)))fail('invalid');A.complete(files,absentPaths);
      const restorePaths=A.restorePaths?A.restorePaths(files):files.map(f=>f.path);if(!Array.isArray(restorePaths)||!restorePaths.length||new Set(restorePaths).size!==restorePaths.length||restorePaths.some(p=>!seen.has(p)))fail('invalid');
      return {files,absentPaths,restorePaths,target:c,identity:identity(c),summary:A.summary(restorePaths.length,total),describe:()=>A.summary(restorePaths.length,total)};
    }
    async function restore(staged){
      if(!staged||staged.identity!==identity(target()))fail('conflict');
      // Validate the complete package again and check every target SHA before the first write.
      const checked=await stage({format:'hub-private-backup',version:1,app:A.app,files:staged.files,absentPaths:staged.absentPaths});
      if(checked.files.some((f,i)=>f.expectedSha!==staged.files[i].expectedSha)||JSON.stringify(checked.restorePaths)!==JSON.stringify(staged.restorePaths))fail('conflict');
      const completed=[];
      try{
        for(const file of checked.files.filter(f=>checked.restorePaths.includes(f.path)).sort((a,b)=>Number(a.path.endsWith('.json'))-Number(b.path.endsWith('.json')))){
          if(staged.identity!==identity(target()))fail('conflict');
          const fresh=await read(staged.target,file.path,true);if((fresh?.sha||null)!==file.expectedSha)fail('conflict');
          const actual=A.mapConnection?A.mapConnection(staged.target,file.path):staged.target;
          let content=file.content;if(A.restoreValue){const desired=JSON.parse(new TextDecoder().decode(decode(content))),current=fresh?JSON.parse(new TextDecoder().decode(fresh.bytes)):null;const value=await A.restoreValue(file.path,desired,current);content=encode(new TextEncoder().encode(JSON.stringify(value)));}
          const body={message:'Restore reviewed private '+A.app+' backup',content,...(file.expectedSha?{sha:file.expectedSha}:{}),...(staged.target.branch?{branch:staged.target.branch}:{})};
          const response=await fetch(url(actual,file.path).split('?')[0],{method:'PUT',headers:{...headers(actual),'Content-Type':'application/json'},body:JSON.stringify(body)});
          if(!response.ok)fail(response.status===409?'conflict':'storage');completed.push(file.path);
        }
      }catch(error){const remaining=checked.files.filter(f=>checked.restorePaths.includes(f.path)&&!completed.includes(f.path)).map(f=>f.path);staged.summary=A.partial(completed,remaining);staged.describe=()=>A.partial(completed,remaining);error.completed=completed;error.code=completed.length?'partial':error.code;throw error;}
      window.HubSettingsRuntime?.endRestore();
      try{await A.reload();}catch(error){staged.summary=A.partial(completed,[]);staged.describe=()=>A.partial(completed,[]);error.code='reload';throw error;}return completed;
    }
    return {backup,stage,restore};
  }};
})();
