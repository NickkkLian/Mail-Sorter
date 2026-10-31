// Runner-owned files use compare-and-swap. No automatic merge can duplicate execution intent.
const stateError=(code,message)=>Object.assign(Error(message),{code});
const encode=x=>Buffer.from(JSON.stringify(x,null,2)+'\n').toString('base64');
export function githubStore({repository,key,fetchImpl=fetch,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
  if(!/^[\w.-]+\/[\w.-]+$/.test(repository||'')||!key)throw Error('State store unavailable');
  const cache=new Map(),base=`https://api.github.com/repos/${repository}`,headers={Authorization:`Bearer ${key}`,Accept:'application/vnd.github+json'};
  async function request(url,init={}){try{return await fetchImpl(url,{...init,headers:{...headers,...init.headers},signal:AbortSignal.timeout(30000)});}catch{throw stateError('STATE_READ_FAILED','State store unavailable');}}
  return {
    async read(name,fallback){
      try{
      if(!/^[a-z-]+\.json$/.test(name))throw Error('Invalid state path');const r=await request(`${base}/contents/mail/${name}?t=${Date.now()}`,{cache:'no-store'});
      if(r.status===404){cache.set(name,{sha:null,encoded:null});return fallback;}
      if(!r.ok)throw Error('State read unavailable');const j=await r.json();let content=j.content;
      if(j.encoding!=='base64'){const b=await request(`${base}/git/blobs/${j.sha}`);if(!b.ok)throw Error('State read unavailable');content=(await b.json()).content;}
      const data=JSON.parse(Buffer.from(content,'base64').toString('utf8'));cache.set(name,{sha:j.sha,encoded:encode(data)});return data;
      }catch{throw stateError('STATE_READ_FAILED','State read unavailable');}
    },
    async write(name,data){
      if(!cache.has(name))await this.read(name,null);const old=cache.get(name),content=encode(data);if(old.encoded===content)return;
      const fail=code=>stateError(code,'State write conflict or unavailable');
      for(let attempt=0;attempt<4;attempt++){
        let r;
        try{r=await request(`${base}/contents/mail/${name}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'mail: update runner state',content,...(old.sha?{sha:old.sha}:{})})});}
        catch{throw fail('STATE_WRITE_FAILED');}
        if(r.ok){const j=await r.json();cache.set(name,{sha:j.content.sha,encoded:content});return;}
        const code=r.status===409?'STATE_WRITE_CONFLICT':'STATE_WRITE_FAILED';
        if(attempt===3||!(r.status===409||(r.status>=500&&r.status<=599)))throw fail(code);
        await sleep(100*2**attempt);
        // A branch-head race may be retried, but never adopt a newer file SHA.
        // This includes absent files: creation by another writer is a conflict.
        const current=await request(`${base}/contents/mail/${name}?t=${Date.now()}`,{cache:'no-store'});
        if(current.status!==404&&!current.ok)throw stateError('STATE_READ_FAILED','State read unavailable');
        const sha=current.status===404?null:(await current.json()).sha;
        if(sha!==old.sha)throw fail('STATE_WRITE_CONFLICT');
      }
    }
  };
}
