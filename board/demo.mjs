import {settings} from '../mail/scripts/settings.mjs';
export function demoBridge(bridge){
  const now=Date.now(),items=[['O1','Verification code','notices@account.example',2],['O4','Summer sale','offers@shop.example',40],['O5','Weekly digest','editor@news.example',80]].map(([rule,subject,from,days],i)=>({gmailId:String(9000+i),subject,from,date:new Date(now-days*86400000).toISOString(),rule,reason:'Matched '+rule,action:'archive'}));
  const files={'mail/cleanup-proposal.json':{id:'fictional-review',revision:'fictional-revision',created_at:new Date(now).toISOString(),items},'mail/cleanup-log.json':{runs:[{id:'fictional-run',proposal_id:'prior-review',at:new Date(now-86400000).toISOString(),entries:[{gmailId:'8999',rule:'O1',action:'archive',at:new Date(now-86400000).toISOString(),status:'done'}]}]},'mail/cleanup-undo.json':{requests:[]}};
  let config=settings({enabled:true});
  return {...bridge,demo:true,available:()=>true,getConfig:()=>config,saveConfig:async x=>{config=structuredClone(x);},get:async path=>({data:structuredClone(files[path]||null),sha:files[path]?'demo-sha':null}),put:async(path,data)=>{files[path]=structuredClone(data);}};
}
