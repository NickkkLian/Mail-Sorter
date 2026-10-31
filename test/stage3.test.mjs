import {test} from 'node:test';
import fs from 'node:fs';
import {runInNewContext} from 'node:vm';
import {ReviewController,undoStatus} from '../board/review.mjs';
import {mountReview} from '../board/cleanup.mjs';
import {demoBridge} from '../board/demo.mjs';
import {githubStore} from '../mail/scripts/storage.mjs';
import {settings} from '../mail/scripts/settings.mjs';
import {main} from '../mail/scripts/classify.mjs';
import {emptyState,runCycle,makeProposal,applyApproval,ruleHash,seedProtection,autoEligible} from '../mail/scripts/core.mjs';
import {validateSet} from '../eval/score-cleanup.mjs';
import {synthetic} from '../eval/synthetic.mjs';
import {message,NOW} from '../eval/synthetic.mjs';
const check=x=>{if(!x)throw Error('Integration expectation failed (data suppressed)');};
const config=settings({enabled:true}),now=new Date(NOW);
function boardIO(){
  const bridge=demoBridge({subscribe:()=>{},language:()=> 'en'}),puts=[],oldPut=bridge.put;
  bridge.put=async(...args)=>{puts.push(args);await oldPut(...args);};return {bridge,puts};
}
test('review selection supports individual/rule toggles and sends only selected stable IDs',async()=>{
  const {bridge,puts}=boardIO(),control=new ReviewController(bridge);await control.load();const p=control.data.proposal;control.setRule('O1',false);control.setItem(p.items[1].gmailId,false);await control.approve();
  const saved=puts[0][1];check(saved.selected.length===1&&saved.proposal_id===p.id&&saved.revision===p.revision&&!JSON.stringify(saved).includes('subject')&&control.queued);
});
test('changed proposal, 409 save conflict and already consumed review cannot approve',async()=>{
  const {bridge}=boardIO(),control=new ReviewController(bridge);await control.load();await bridge.put('mail/cleanup-proposal.json',{...control.data.proposal,revision:'new'});let stopped=false;try{await control.approve();}catch{stopped=true;}check(stopped);
  await control.load();bridge.put=async()=>{throw Error('conflict');};stopped=false;try{await control.approve();}catch{stopped=true;}check(stopped&&!control.queued);
  control.data.journal.runs.push({proposal_id:control.data.proposal.id});stopped=false;try{await control.approve();}catch{stopped=true;}check(stopped);
});
test('protect sender changes only private settings; undo appends idempotent request',async()=>{
  const {bridge,puts}=boardIO(),control=new ReviewController(bridge);await control.load();await control.protect('Person <sender@service.example>');check(bridge.getConfig().protected.senders.includes('sender@service.example'));
  await control.undo('fictional-run');await control.undo('fictional-run');check(puts.at(-1)[1].requests.length===1);
  check(undoStatus({id:'r',entries:[{status:'undone'}]},[])==='Restored');check(undoStatus({id:'r',entries:[{status:'done',action:'trash',at:'2020-01-01'}]},[])==='Trash undo expired');
});
// Small DOM harness exercises the real renderer and native input handlers without opening a browser/server.
class Node {
  constructor(tag,doc){this.tagName=tag;this.doc=doc;this.children=[];this.attrs={};this.events={};this._text='';this.isConnected=true;}
  set textContent(v){this._text=String(v);this.children=[];}get textContent(){return this._text+this.children.map(x=>x.textContent).join('');}
  set innerHTML(v){throw Error('Unsafe rendering');}
  setAttribute(k,v){this.attrs[k]=v;if(k==='id')this.id=v;if(k==='value')this.value=v;}
  append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;this._text='';}
  addEventListener(k,fn){this.events[k]=fn;}focus(){this.doc.activeElement=this;}
  all(){return this.children.flatMap(n=>[n,...n.all()]);}
  querySelector(s){return this.all().find(n=>s==='[role=status]'?n.attrs.role==='status':n.tagName===s)||null;}
  fire(type){return this.events[type]?.({target:this});}
}
function documentStub(){const d={activeElement:null};d.createElement=tag=>new Node(tag,d);d.createTextNode=text=>{const n=new Node('#text',d);n.textContent=text;return n;};d.host=new Node('section',d);d.getElementById=id=>id==='cleanup-panel'?d.host:d.host.all().find(n=>n.id===id);return d;}
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
test('real review renderer exposes accessible grouped checkboxes, selection feedback and queued approval',async()=>{
  const {bridge,puts}=boardIO(),doc=documentStub(),mount=mountReview(bridge,doc);await mount.ready;
  const boxes=doc.host.all().filter(n=>n.tagName==='input'&&n.attrs['aria-label']?.startsWith('Select '));check(boxes.length===3);
  boxes[0].checked=false;boxes[0].fire('change');const approve=doc.host.all().find(n=>n.tagName==='button'&&n.textContent==='Approve cleanup of 2 emails');check(!!approve);
  approve.fire('click');await flush();check(puts[0][1].selected.length===2&&doc.host.textContent.includes('Approved.')&&doc.activeElement?.attrs.role==='status');
});
test('untrusted message text is rendered as text; failed saves restore controls',async()=>{
  const {bridge}=boardIO(),p=await bridge.get('mail/cleanup-proposal.json');p.data.items[0].subject='<img src=x onerror=evil()>';await bridge.put('mail/cleanup-proposal.json',p.data);const doc=documentStub(),mount=mountReview(bridge,doc);await mount.ready;check(doc.host.textContent.includes('<img')&&!doc.host.all().some(n=>n.tagName==='img'));
  mount.controller.io.put=async()=>{throw Error('unavailable');};const b=doc.host.all().find(n=>n.tagName==='button'&&n.textContent.startsWith('Approve cleanup'));b.fire('click');await flush();check(!b.disabled&&doc.host.textContent.includes('Could not save'));
});
test('no connection hides panel; missing review and read error remain recoverable',async()=>{
  const {bridge}=boardIO(),doc=documentStub();await mountReview({...bridge,available:()=>false},doc).ready;check(doc.host.hidden);
  const d2=documentStub();await mountReview({...bridge,get:async()=>({data:null,sha:null})},d2).ready;check(d2.host.textContent.includes('No review list yet'));
  const d3=documentStub();await mountReview({...bridge,get:async()=>{throw Error('offline');}},d3).ready;check(d3.host.textContent.includes('Could not load')&&d3.host.all().some(n=>n.textContent==='Load list again'));
});
test('hosted state persistence uses SHA CAS, skips unchanged writes, and refuses conflicts',async()=>{
  const calls=[],stored={};let conflict=false;
  const fetchImpl=async(url,init)=>{calls.push(init.method||'GET');const name=url.split('/').at(-1).split('?')[0];if(init.method!=='PUT')return {status:stored[name]?200:404,ok:!!stored[name],json:async()=>stored[name]};if(conflict)return {ok:false,status:409};const b=JSON.parse(init.body);stored[name]={content:b.content,encoding:'base64',sha:'sha'+calls.length};return {ok:true,json:async()=>({content:{sha:stored[name].sha}})};};
  const store=githubStore({repository:'owner/private-example',key:'synthetic-placeholder',fetchImpl});check(await store.read('cleanup-log.json',null)===null);await store.write('cleanup-log.json',{runs:[]});const n=calls.length;await store.write('cleanup-log.json',{runs:[]});check(calls.length===n);
  conflict=true;let failed=false;try{await store.write('cleanup-log.json',{runs:[{id:'r'}]});}catch{failed=true;}check(failed);
});
test('hosted large-file reads fall back to Git blob endpoint',async()=>{
  const store=githubStore({repository:'owner/private-example',key:'synthetic-placeholder',fetchImpl:async url=>({ok:true,json:async()=>url.includes('/git/blobs/')?{content:Buffer.from('{"runs":[]}').toString('base64')}:{sha:'blob',encoding:'none'}})});const x=await store.read('cleanup-log.json',null);check(x.runs.length===0);
});
test('CLI uses mail settings path and local journal, exposes no raw connection errors',async()=>{
  const root=fs.mkdtempSync(new URL('../.tmp-run-',import.meta.url));const lines=[];let calls=0;
  try{fs.writeFileSync(root+'/config.json',JSON.stringify(config));const result=await main({root,env:{GMAIL_USER:'synthetic',GMAIL_APP_PASSWORD:'synthetic'},connect:async()=>{calls++;throw Error('ERROR-CANARY');},output:x=>lines.push(x)});check(result===1&&calls===1&&!lines.join().includes('ERROR-CANARY')&&!fs.existsSync(root+'/.runner.lock'));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('automatic cleanup leaves ineligible rules pending and never creates human review evidence',async()=>{
  const cfg=settings({...config,approval_mode:'eligible_rules',rules:{O1:{auto:true}}}),state=emptyState(),mail=message({subject:'Verification code'}),promo=message({uid:2,gmailId:'1002',subject:'Sale',tab:'promotions'});let archived=0;
  state.journal.reviews=Array.from({length:29},(_,i)=>({rule:'O1',policy:ruleHash(cfg,'O1'),at:new Date(now-(28-i)*86400000).toISOString(),reviewed:1,rejected:0,complete:true}));
  const mailbox={scan:async()=>({messages:[mail,promo],done:true,uidValidity:'1'}),get:async id=>id===mail.gmailId?mail:promo,archive:async()=>{archived++;},addLabel:async()=>{}};
  await runCycle({config:cfg,state,mailbox,persist:async()=>{},now});check(archived===1&&state.proposal.items.length===1&&state.proposal.items[0].rule==='O4'&&state.journal.reviews.length===29);
});
test('a partial mailbox failure remains journalled and never replays cleanup',async()=>{
  const state=emptyState(),mail=message({subject:'Verification code'});await makeProposal({messages:[mail],config,state,now});const p=state.proposal,approval={proposal_id:p.id,revision:p.revision,selected:[mail.gmailId]};let attempts=0;const mailbox={markRead:async()=>{mail.seen=true;},markUnread:async()=>{mail.seen=false;},get:async()=>mail,addLabel:async()=>{},archive:async()=>{attempts++;throw Error('partial');}};
  await applyApproval({config,state,approval,mailbox,persist:async()=>{},now});await applyApproval({config,state,approval,mailbox,persist:async()=>{},now});check(attempts===1&&state.journal.runs[0].entries[0].status==='uncertain');
});
test('private bootstrap adds only finance/school/official/health correspondents to visible protection',()=>{
  const seeded=seedProtection(config,{items:[{from:'billing@bank.example',category:'finance'},{from:'prof@school.example',category:'school'},{from:'promo@shop.example',category:'promo'}]});check(seeded.protected.senders.length===2&&seeded.protected.senders.includes('billing@bank.example'));
});
test('incomplete human execution resets automatic eligibility',()=>{
  const cfg=settings({...config,approval_mode:'eligible_rules',rules:{O1:{auto:true}}}),reviews=Array.from({length:29},(_,i)=>({rule:'O1',policy:ruleHash(cfg,'O1'),at:new Date(now-(28-i)*86400000).toISOString(),reviewed:1,rejected:0,complete:true}));check(autoEligible(cfg,'O1',reviews,now));reviews.at(-1).complete=false;check(!autoEligible(cfg,'O1',reviews,now));
});
test('private evaluation requires Nick review and rejects unrecognized content fields',()=>{
  let blocked=0;try{validateSet({...synthetic(),synthetic:false},{privateSet:true});}catch{blocked++;}const spec=synthetic();spec.items[0].message.bodyHtml='FICTIONAL-CONTENT';try{validateSet(spec);}catch{blocked++;}check(blocked===2);
});
test('board approval through runner and queued undo completes an offline lifecycle',async()=>{
  const state=emptyState(),mail=message({subject:'Verification code'});await makeProposal({messages:[mail],config,state,now});const files={},bridge={getConfig:()=>config,saveConfig:async()=>{},get:async path=>({data:path.endsWith('cleanup-proposal.json')?state.proposal:path.endsWith('cleanup-log.json')?state.journal:files[path]||null,sha:null}),put:async(path,data)=>{files[path]=structuredClone(data);}};
  const control=new ReviewController(bridge);await control.load();await control.approve();let archived=0,restored=0;
  const box={markRead:async()=>{mail.seen=true;},markUnread:async()=>{mail.seen=false;},get:async()=>mail,addLabel:async()=>{},removeLabel:async()=>{},archive:async()=>{archived++;},restore:async()=>{restored++;}};
  await runCycle({config,state,mailbox:box,persist:async()=>{},approval:files['mail/cleanup-approval.json'],now});await control.load();check(control.consumed&&archived===1);await control.undo(state.journal.runs[0].id);
  await runCycle({config,state,mailbox:box,persist:async()=>{},undoRequests:files['mail/cleanup-undo.json'].requests,now});check(restored===1&&undoStatus(state.journal.runs[0],files['mail/cleanup-undo.json'].requests)==='Restored');
});
test('existing board data reader handles large journals without accepting an empty blob',async()=>{
  const page=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'),start=page.indexOf('async function ghGet(path,fresh)'),source=page.slice(start,page.indexOf('// One PUT',start));let calls=0,empty=false;
  const reads=[];const context={HubSettingsRuntime:{track:fn=>fn(),fileRead:(cfg,path,status)=>reads.push({path,status})},cfg:()=>({owner:'fictional',repo:'private',token:'synthetic-placeholder'}),T:(a,b)=>b,Object,Error,JSON,Date,b64decode:s=>Buffer.from(s,'base64').toString('utf8'),fetch:async()=>{calls++;return {ok:true,status:200,json:async()=>calls%2===1?{encoding:'none',size:2000000,sha:'blob'}:{content:empty?'':Buffer.from('{"runs":[]}').toString('base64')}};}};
  runInNewContext(source+';globalThis.read=ghGet;',context);const r=await context.read('mail/cleanup-log.json',true);check(r.data.runs.length===0&&calls===2&&reads.length===1&&reads[0].path==='mail/cleanup-log.json'&&reads[0].status===200);empty=true;let failed=false;try{await context.read('mail/cleanup-log.json',true);}catch{failed=true;}check(failed);
});
test('interrupted cleanup is quarantined across new proposals, not just approval replay',async()=>{
  const state=emptyState(),mail=message({subject:'Verification code'});state.journal.runs.push({id:'interrupted',entries:[{gmailId:mail.gmailId,status:'intent'}]});const p=await makeProposal({messages:[mail],config,state,now});check(p.items.length===0);
});
test('scan checkpoints never advance past a candidate before its proposal is saved',async()=>{
  const state=emptyState(),mail=message({uid:5,subject:'Verification code'}),box={scan:async()=>({messages:[mail],done:false,uidValidity:'1'})};await runCycle({config,state,mailbox:box,persist:async s=>{if(s.runtime.scanAfter===5)check(s.proposal?.items.some(x=>x.gmailId===mail.gmailId));},now});
});
test('partial cleanup history explains archived total and remaining emails in both languages',async()=>{
 for(const language of ['en','zh']){
  const {bridge}=boardIO(),doc=documentStub();
  await bridge.put('mail/cleanup-log.json',{runs:[{id:'partial',at:'2026-10-20T18:37:00Z',status:'in_progress',selected_count:932,not_reached_count:632,entries:Array.from({length:300},(_,i)=>({gmailId:String(i),status:'done',action:'archive'}))}]});
  await mountReview({...bridge,language:()=>language},doc).ready;
  const text=doc.host.textContent;
  if(language==='en'){check(text.includes('300 of 932 selected emails archived')&&text.includes('archived so far')&&text.includes('the rest continue at the next automatic check')&&text.includes('put up to 300 emails back in inbox'));}
  else check(text.includes('所选 932 封邮件中，300 封已归档')&&text.includes('其余邮件将在下次自动检查时继续处理')&&text.includes('最多 300 封邮件放回收件箱'));
  check(!/runner|queued|recorded intent|300\/932 completed/.test(text));
 }
});
