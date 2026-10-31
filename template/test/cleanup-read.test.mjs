import {test} from 'node:test';
import assert from 'node:assert/strict';
import {settings} from '../mail/scripts/settings.mjs';
import {emptyState,makeProposal,applyApproval,undoRun} from '../mail/scripts/core.mjs';
const now=new Date('2026-10-30T12:00:00Z');
async function setup({seen=false,enabled=true,action='archive',count=1}={}){
 const config=settings({enabled:true,mark_dealt_read:enabled,rules:{O1:{action}}}),state=emptyState(),calls=[];
 const data=new Map(Array.from({length:count},(_,i)=>[String(i+1),{gmailId:String(i+1),uid:i+1,inInbox:true,seen,labels:['Original']}]));
 let durable;
 const persist=async s=>{durable=structuredClone(s);};
 const intent=(id,undo=false)=>assert.equal(durable.journal.runs[0].entries.find(e=>e.gmailId===id)[undo?'undo_status':'status'],'intent');
 const mutate=(verb,fn,undo=false)=>async(id,...args)=>{intent(id,undo);calls.push(verb+':'+id);fn(data.get(id),...args);};
 const mailbox={get:async id=>structuredClone(data.get(id)),
  addLabel:mutate('label',(m,l)=>m.labels.push(l)),
  archive:mutate('archive',m=>{m.inInbox=false;}),trash:mutate('trash',m=>{m.inInbox=false;}),
  markRead:mutate('read',m=>{m.seen=true;}),
  markUnread:mutate('unread',m=>{m.seen=false;},true),
  restore:mutate('restore',m=>{m.inInbox=true;},true),
  removeLabel:mutate('unlabel',(m,l)=>{m.labels=m.labels.filter(x=>x!==l);},true)};
 const evaluate=async()=>({rule:'O1'});
 await makeProposal({messages:[...data.values()],config,state,now,evaluate});
 const p=state.proposal,approval={proposal_id:p.id,revision:p.revision,selected:[...data.keys()]};
 return {config,state,mailbox,persist,now,evaluate,approval,data,calls,reload:()=>structuredClone(durable)};
}
for(const action of ['archive','trash'])for(const seen of [false,true])for(const enabled of [false,true])test(`cleanup ${action}, seen=${seen}, preference=${enabled}: durable intent and exact Undo`,async()=>{
 const x=await setup({action,seen,enabled});const result=await applyApproval(x);
 const e=x.state.journal.runs[0].entries[0];assert.equal(e.changeRead,enabled&&!seen);assert.equal(result.applied,1);
 assert.equal(x.data.get('1').seen,seen||enabled);assert(!x.data.get('1').inInbox);
 await undoRun({...x,runId:x.state.journal.runs[0].id});
 assert.deepEqual(x.data.get('1'),{gmailId:'1',uid:1,inInbox:true,seen,labels:['Original']});
 const n=x.calls.length;await undoRun({...x,runId:x.state.journal.runs[0].id});assert.equal(x.calls.length,n);
});
test('cleanup resumes in_progress without replay; Undo restores all continued work',async()=>{
 const x=await setup({count:3}),stop=new AbortController(),read=x.mailbox.markRead;
 x.mailbox.markRead=async id=>{await read(id);stop.abort();};
 await applyApproval({...x,signal:stop.signal,batch:{size:1,ms:120000}});
 x.state=x.reload();assert.equal(x.state.journal.runs[0].status,'in_progress');x.mailbox.markRead=read;
 await applyApproval({...x,resumeRun:x.state.journal.runs[0]});
 assert.equal(x.calls.filter(v=>v.startsWith('read:')).length,3);assert([...x.data.values()].every(m=>m.seen));
 await undoRun({...x,runId:x.state.journal.runs[0].id});assert([...x.data.values()].every(m=>!m.seen&&m.inInbox));
});
for(const crash of ['before intent save','after intent save','after read'])test('cleanup crash '+crash+' retains recoverable state and never replays intents',async()=>{
 const x=await setup();let saves=0,durable;
 const persist=async s=>{saves++;if(crash==='before intent save'&&saves===2)throw Error('disk');if(crash==='after read'&&saves>=3)throw Error('crash');durable=structuredClone(s);if(crash==='after intent save'&&saves===2)throw Error('crash');};
 await assert.rejects(applyApproval({...x,persist}));
 if(crash==='before intent save'){assert.equal(x.calls.length,0);assert.equal(durable.journal.runs[0].entries.length,0);return;}
 assert.equal(durable.journal.runs[0].entries[0].status,'intent');assert.equal(durable.journal.runs[0].entries[0].changeRead,true);
 x.state=durable;const n=x.calls.length;await applyApproval({...x,resumeRun:x.state.journal.runs[0]});assert.equal(x.calls.length,n);
 await undoRun({...x,runId:x.state.journal.runs[0].id});assert.equal(x.data.get('1').seen,false);assert(x.data.get('1').inInbox);
});
for(const changed of [false,true])test('markRead error (changed='+changed+') is uncertain, never done or replayed; Undo repairs',async()=>{
 const x=await setup(),read=x.mailbox.markRead;x.mailbox.markRead=async id=>{if(changed)await read(id);throw Error('connection lost');};
 assert.equal((await applyApproval(x)).applied,0);assert.equal(x.state.journal.runs[0].entries[0].status,'uncertain');assert.equal(x.state.journal.reviews[0].complete,false);
 const n=x.calls.length;await applyApproval(x);assert.equal(x.calls.length,n);
 await undoRun({...x,runId:x.state.journal.runs[0].id});assert.equal(x.data.get('1').seen,false);assert(x.data.get('1').inInbox);
});
for(const seen of [false,true])test('legacy cleanup Undo without changeRead preserves seen='+seen,async()=>{
 const x=await setup({seen});await applyApproval(x);delete x.state.journal.runs[0].entries[0].changeRead;x.data.get('1').seen=seen;
 await undoRun({...x,runId:x.state.journal.runs[0].id});assert.equal(x.data.get('1').seen,seen);assert(!x.calls.some(v=>v.startsWith('unread:')));
});
test('failed markUnread stays retryable until Undo succeeds',async()=>{
 const x=await setup();await applyApproval(x);const unread=x.mailbox.markUnread;x.mailbox.markUnread=async()=>{throw Error('offline');};
 const runId=x.state.journal.runs[0].id;assert.equal((await undoRun({...x,runId})).restored,0);assert.equal(x.state.journal.runs[0].entries[0].undo_status,'retry');
 x.mailbox.markUnread=unread;assert.equal((await undoRun({...x,runId})).restored,1);assert(!x.data.get('1').seen);
});
