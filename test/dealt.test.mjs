import {test} from 'node:test';
import assert from 'node:assert/strict';
import {settings} from '../mail/scripts/settings.mjs';
import {emptyState,applyDealt,undoRun,runCycle,makeProposal,applyApproval} from '../mail/scripts/core.mjs';
import {connectMailbox} from '../mail/scripts/imap.mjs';
import {fake} from './helpers/fake-imap.mjs';
import {DealtController} from '../board/dealt.mjs';
const id='9007199254740993001',config=settings({enabled:true}),now=new Date('2026-10-20');
const request={id:'request-1',items:[{gmailId:id,category:'finance'}]};
async function setup(options={}){
 const f=fake({seen:false,...options}),mailbox=await connectMailbox(config,{GMAIL_USER:'synthetic',GMAIL_APP_PASSWORD:'synthetic'},f.Client),state=emptyState();
 state.digest.items=[{gmailId:id,uid:11,category:'finance'}];let durable;
 const persist=async s=>{durable=structuredClone(s);};
 const add=mailbox.addLabel,seen=mailbox.markRead;
 mailbox.addLabel=async(...args)=>{assert.equal(durable.journal.runs.at(-1).entries[0].status,'intent');return add(...args);};
 mailbox.markRead=async(...args)=>{assert.equal(durable.journal.runs.at(-1).entries[0].status,'intent');return seen(...args);};
 return {f,mailbox,state,persist,apply:cfg=>applyDealt({config:cfg||config,state,requests:[request],mailbox,persist,now})};
}
test('dealt defaults to read and category label in Inbox; Undo restores both and is inert twice',async()=>{
 const x=await setup();assert.equal(settings().mark_dealt_read,true);await x.apply();
 assert(x.f.flags.has('\\Seen'));assert(x.f.record.labels.has('AI/Money'));assert(!x.f.actions.some(v=>['All','Trash','restore'].includes(v)));
 await undoRun({...x,runId:x.state.journal.runs[0].id});assert(!x.f.flags.has('\\Seen'));assert(!x.f.record.labels.has('AI/Money'));assert(x.f.record.labels.has('Original'));
 const n=x.f.actions.length;await undoRun({...x,runId:x.state.journal.runs[0].id});assert.equal(n,x.f.actions.length);
});
for(const options of [{off:true},{seen:true},{label:true}])test('dealt preserves original state '+JSON.stringify(options),async()=>{
 const x=await setup(options);if(options.label)x.f.record.labels.add('AI/Money');await x.apply({...config,mark_dealt_read:!options.off});
 assert.equal(x.f.flags.has('\\Seen'),!options.off);await undoRun({...x,runId:x.state.journal.runs[0].id});
 assert.equal(x.f.flags.has('\\Seen'),!!options.seen);assert.equal(x.f.record.labels.has('AI/Money'),!!options.label);
});
test('failed intent save changes nothing; partial failure never replays and Undo repairs it',async()=>{
 const x=await setup();await assert.rejects(applyDealt({...x,config,requests:[request],persist:async()=>{throw Error('disk');}}));assert(!x.f.record.labels.has('AI/Money'));assert(!x.f.flags.has('\\Seen'));
 const y=await setup();y.mailbox.markRead=async()=>{throw Error('disconnected');};await y.apply();assert.equal(y.state.journal.runs[0].entries[0].status,'uncertain');const n=y.f.actions.length;await y.apply();assert.equal(n,y.f.actions.length);
 await undoRun({...y,runId:y.state.journal.runs[0].id});assert(!y.f.record.labels.has('AI/Money'));assert(!y.f.flags.has('\\Seen'));
});
test('batch failure continues safely and quarantines cleanup',async()=>{
 const state=emptyState(),data=new Map(['1','2','3'].map(gmailId=>[gmailId,{gmailId,seen:false,labels:[],inInbox:true}]));state.digest.items=[...data.values()].map(x=>({...x,category:'finance'}));let saved;
 const box={get:async id=>structuredClone(data.get(id)),addLabel:async(id,l)=>{assert(saved.runs.at(-1).entries.some(e=>e.gmailId===id&&e.status==='intent'));data.get(id).labels.push(l);},markRead:async id=>{if(id==='2')throw Error('offline');data.get(id).seen=true;},markUnread:async id=>{data.get(id).seen=false;},removeLabel:async(id,l)=>{data.get(id).labels=data.get(id).labels.filter(x=>x!==l);}};
 const requests=[{id:'batch',items:state.digest.items.map(({gmailId,category})=>({gmailId,category}))}],persist=async s=>{saved=structuredClone(s.journal);};
 await applyDealt({config,state,requests,mailbox:box,persist});assert.deepEqual(state.journal.runs[0].entries.map(e=>e.status),['done','uncertain','done']);
 await makeProposal({config,state,messages:[{...data.get('2')}],evaluate:async()=>({rule:'O1'})});assert.equal(state.proposal.items.length,0);
 await undoRun({state,runId:state.journal.runs[0].id,mailbox:box,persist});assert([...data.values()].every(x=>!x.seen&&!x.labels.length&&x.inInbox));
});
test('dealt queue executes before daily cadence; disabled cycles stay inert',async()=>{
 for(const disabled of [false,true]){const x=await setup();x.state.runtime.lastProposalAt=now.toISOString();await runCycle({...x,config:{...config,enabled:!disabled},dealtRequests:[request],now});assert.equal(x.f.flags.has('\\Seen'),!disabled);}
});
test('unknown flags, labels, missing digest and stale category fail closed',async()=>{
 for(const patch of [{seen:null},{labels:null},{inInbox:false}]){const x=await setup();const get=x.mailbox.get;x.mailbox.get=async id=>({...await get(id),...patch});await x.apply();assert(!x.f.flags.has('\\Seen'));assert(!x.f.record.labels.has('AI/Money'));}
 const x=await setup();x.state.digest.items[0].category='travel';await x.apply();assert(!x.f.flags.has('\\Seen'));
 assert.throws(()=>settings({mark_dealt_read:'yes'}));
});
test('crash after mailbox write leaves durable intents, blocks replay and permits Undo',async()=>{
 const x=await setup();let durable,calls=0;
 const persist=async s=>{if(++calls>=3)throw Error('power loss');durable=structuredClone(s);await x.persist(s);};
 await assert.rejects(applyDealt({...x,config,requests:[request],persist}));assert(x.f.flags.has('\\Seen'));assert.equal(durable.journal.runs[0].entries[0].status,'intent');
 const n=x.f.actions.length;await applyDealt({...x,state:durable,config,requests:[request]});assert.equal(n,x.f.actions.length);
 await undoRun({...x,state:durable,runId:durable.journal.runs[0].id});assert(!x.f.flags.has('\\Seen'));assert(!x.f.record.labels.has('AI/Money'));
});
test('dealt Undo cannot be immediately reversed by the normal classifier scan',async()=>{
 const x=await setup();await x.apply();x.mailbox.scan=async()=>({messages:[await x.mailbox.get(id)],done:true,uidValidity:'1'});
 await runCycle({...x,config,undoRequests:[{dealt_request_id:request.id}],dealtRequests:[request],evaluate:async()=>({category:'finance'}),now});
 assert(!x.f.flags.has('\\Seen'));assert(!x.f.record.labels.has('AI/Money'));
});
test('queued Undo cancels before execution; duplicate marking and stale queue writes are safe',async()=>{
 const x=await setup();x.state.runtime.lastProposalAt=now.toISOString();await runCycle({...x,config,dealtRequests:[request],undoRequests:[{dealt_request_id:request.id}],now});assert(!x.f.flags.has('\\Seen'));
 let serial=0;const files={};const io={get:async p=>({data:structuredClone(files[p]?.data||null),sha:files[p]?.sha||null}),put:async(p,data,sha)=>{assert.equal(sha,files[p]?.sha||null);files[p]={data:structuredClone(data),sha:String(++serial)};}};
 const control=new DealtController(io);await control.mark(request.items);await control.mark(request.items);assert.equal(control.requests.length,1);assert.equal(control.status(id),'queued');
 await control.undo(control.requests[0]);assert.equal(control.status(id),null);
 const before=serial;control.io.put=async()=>{throw Error('409');};await assert.rejects(control.mark(request.items));assert.equal(serial,before);
});
test('60 dealt messages persist in batches; cancellation keeps only attempted entries',async()=>{
 for(const cancel of [false,true]){
  const state=emptyState(),stop=new AbortController();state.digest.items=Array.from({length:60},(_,i)=>({gmailId:String(i+1),category:'people'}));let saves=0,acted=0,durable;
  const persist=async s=>{saves++;durable=structuredClone(s);};
  const mailbox={get:async gmailId=>({gmailId,seen:false,labels:[],inInbox:true}),addLabel:async gmailId=>{assert(durable.journal.runs[0].entries.some(e=>e.gmailId===gmailId&&e.status==='intent'));},markRead:async()=>{acted++;if(cancel&&acted===4)stop.abort();}};
  await applyDealt({config,state,mailbox,persist,requests:[{id:'many',items:state.digest.items}],signal:stop.signal});assert.equal(acted,cancel?4:60);assert.equal(state.journal.runs[0].entries.length,acted);assert(saves<=8);
 }
});
test('cleanup retention cannot discard dealt consumption records and replay old queue requests',async()=>{
 const state=emptyState(),cfg=settings({...config,log_runs:28});
 state.journal.runs=Array.from({length:35},(_,i)=>({id:'dealt-'+i,kind:'dealt',dealt_request_id:'request-'+i,status:'finished',entries:[{gmailId:String(i+1),action:'dealt',status:'done'}]}));
 for(let i=0;i<30;i++)state.journal.runs.push({id:'cleanup-'+i,status:'finished',entries:[]});
 await makeProposal({config:cfg,state,messages:[],now});const p=state.proposal;
 await applyApproval({config:cfg,state,approval:{proposal_id:p.id,revision:p.revision,selected:[]},mailbox:{},persist:async()=>{},now});
 assert.equal(state.journal.runs.filter(r=>r.kind==='dealt').length,35);assert.equal(state.journal.runs.filter(r=>r.kind!=='dealt').length,28);
});
test('CLI consumes the optional queue only through injected fake IMAP; proposal dry run is inert',async()=>{
 const fs=await import('node:fs'),{main}=await import('../mail/scripts/classify.mjs');const root=fs.mkdtempSync(new URL('../.tmp-dealt-',import.meta.url));
 try{
  for(const dry of [false,true]){
   for(const [name,data]of Object.entries({'config.json':config,'mail.json':{items:[{gmailId:id,category:'finance'}]},'runtime.json':{protection_seeded:true,lastProposalAt:new Date().toISOString()},'cleanup-log.json':{runs:[],reviews:[]},'dealt-queue.json':{requests:[request]}}))fs.writeFileSync(root+'/'+name,JSON.stringify(data));
   const f=fake({seen:false});const code=await main({root,env:{GMAIL_USER:'synthetic',GMAIL_APP_PASSWORD:'synthetic',ANTHROPIC_API_KEY:'synthetic-placeholder',...(dry?{DRY_RUN:'proposal'}:{})},connect:(c,e)=>connectMailbox(c,e,f.Client),output:()=>{}});
   assert.equal(code,0);assert.equal(f.flags.has('\\Seen'),!dry);assert.equal(f.record.labels.has('AI/Money'),!dry);
  }
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('released protected-mail classification and explicit Dealt cooperate without body reads or cleanup',async()=>{
 const {createEvaluator}=await import('../mail/scripts/intelligence.mjs');
 const x=await setup(),cfg=settings({...config,read_bodies:true,protected:{senders:['notices@service.example']}});let calls=0;
 x.f.record.envelope.subject='Your order has been filled';
 x.mailbox.readBody=async()=>assert.fail('Protected mail body must stay unread');
 const diagnostics={},evaluate=createEvaluator({config:cfg,mailbox:x.mailbox,diagnostics,classify:async input=>{calls++;assert.equal(input.body,undefined);return {category:'finance',action:false,cleanup:'agree'};}});
 const verdict=await evaluate(await x.mailbox.get(id));assert.equal(verdict.category,'finance');assert.equal(verdict.rule,null);assert.equal(calls,1);
 assert(!x.f.flags.has('\\Seen'));assert(!x.f.record.labels.has('AI/Money'));
 await x.apply(cfg);assert(x.f.flags.has('\\Seen'));assert(x.f.record.labels.has('AI/Money'));
 x.mailbox.scan=async()=>({messages:[await x.mailbox.get(id)],done:true,uidValidity:'1'});
 await runCycle({...x,config:cfg,evaluate,undoRequests:[{dealt_request_id:request.id}],dealtRequests:[request],force:true});
 assert(!x.f.flags.has('\\Seen'));assert(!x.f.record.labels.has('AI/Money'));assert(!x.f.actions.some(v=>['All','Trash','restore'].includes(v)));
 assert.equal(diagnostics.errors||0,0);
});
