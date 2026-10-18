// Runner-owned files use compare-and-swap. No automatic merge can duplicate execution intent.
import fs from 'node:fs';
const encode=x=>Buffer.from(JSON.stringify(x,null,2)+'\n').toString('base64');
export function githubStore({repository,key,fetchImpl=fetch}){
  if(!/^[\w.-]+\/[\w.-]+$/.test(repository||'')||!key)throw Error('State store unavailable');
  const cache=new Map(),base=`https://api.github.com/repos/${repository}`,headers={Authorization:`Bearer ${key}`,Accept:'application/vnd.github+json'};
  async function request(url,init={}){try{return await fetchImpl(url,{...init,headers:{...headers,...init.headers},signal:AbortSignal.timeout(30000)});}catch{throw Error('State store unavailable');}}
  return {
    async read(name,fallback){
      if(!/^[a-z-]+\.json$/.test(name))throw Error('Invalid state path');const r=await request(`${base}/contents/mail/${name}?t=${Date.now()}`,{cache:'no-store'});
      if(r.status===404){cache.set(name,{sha:null,encoded:null});return fallback;}
      if(!r.ok)throw Error('State read unavailable');const j=await r.json();let content=j.content;
      if(j.encoding!=='base64'){const b=await request(`${base}/git/blobs/${j.sha}`);if(!b.ok)throw Error('State read unavailable');content=(await b.json()).content;}
      const data=JSON.parse(Buffer.from(content,'base64').toString('utf8'));cache.set(name,{sha:j.sha,encoded:encode(data)});return data;
    },
    async write(name,data){
      if(!cache.has(name))await this.read(name,null);const old=cache.get(name),content=encode(data);if(old.encoded===content)return;
      const r=await request(`${base}/contents/mail/${name}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'mail: update runner state',content,...(old.sha?{sha:old.sha}:{})})});
      if(!r.ok)throw Error('State write conflict or unavailable');const j=await r.json();cache.set(name,{sha:j.content.sha,encoded:content});
    }
  };
}
