import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {emptyState,makeProposal,applyApproval,runCycle,undoRun} from '../mail/scripts/core.mjs';
import {settings} from '../mail/scripts/settings.mjs';
import {connectMailbox} from '../mail/scripts/imap.mjs';
import {scopeState,mergeState,scopeApproval} from '../mail/scripts/mailboxes.mjs';
import {ReviewController} from '../board/review.mjs';
import {pendingImpact} from '../board/cleanup-copy.mjs';
import {decide} from '../mail/scripts/rules.mjs';
import {message} from '../eval/synthetic.mjs';
import {fake} from './helpers/fake-imap.mjs';
import {main} from '../mail/scripts/classify.mjs';
const now=new Date('2026-10-31T12:00:00Z'),config=settings({enabled:true}),evaluate=async()=>({rule:'O1',category:'other'});
const row=(id=1)=>message({gmailId:String(id),uid:id,seen:false,subject:'Verification code',date:'2026-09-01T00:00:00Z'});
async function setup(){
 const state=emptyState(),m=row(),events=[];let durable;
 const persist=async s=>{durable=structuredClone(s);};
 const mailbox={get:async()=>structuredClone(m),scan:async()=>({messages:[],done:true,uidValidity:'1'}),scanReview:async()=>({messages:[],done:true}),addLabel:async()=>{},removeLabel:async()=>{},archive:async()=>{events.push('archive');m.inInbox=false;return true;},markRead:async()=>{events.push('read');m.seen=true;return true;},markUnread:async()=>{m.seen=false;},restore:async()=>{events.push('restore');m.inInbox=true;}};
 await makeProposal({state,config,messages:[m],evaluate,now});const p=state.proposal;
 return {state,m,events,mailbox,persist,config,now,evaluate,approval:{proposal_id:p.id,revision:p.revision,selected:['1']},reload:()=>structuredClone(durable)};
}
for(const verb of ['archive','markRead'])for(const how of ['false','throw'])test(`R2.1 ${verb} ${how}: not done, persists retry, resumes once and Undo restores`,async()=>{
 const x=await setup(),op=x.mailbox[verb];x.mailbox[verb]=async()=>{if(how==='throw')throw Error('transient');return false;};
 await applyApproval(x);assert.equal(x.state.journal.runs[0].entries[0].status,'retry');assert.equal(x.state.journal.runs[0].status,'in_progress');
 if(verb==='archive'){assert(!x.m.seen);assert(!x.events.includes('read'));}
 x.state=x.reload();x.mailbox[verb]=op;await runCycle({...x,approval:null});assert.equal(x.state.journal.runs[0].entries[0].status,'done');assert(x.m.seen&&!x.m.inInbox);assert.equal(x.events.filter(v=>v==='archive').length,1);
 await undoRun({...x,runId:x.state.journal.runs[0].id});assert(!x.m.seen&&x.m.inInbox);
});
test('R2.1 real adapter rejects a false MOVE and Seen response',async()=>{
 for(const method of ['messageMove','messageFlagsAdd']){
  const f=fake({seen:false});class Client extends f.Client{async [method](...args){if(method==='messageFlagsAdd'&&args[2]?.useLabels)return super[method](...args);return false;}}
  const mb=await connectMailbox(config,{GMAIL_USER:'fake',GMAIL_APP_PASSWORD:'fake'},Client);
  await assert.rejects(method==='messageMove'?mb.archive('9007199254740993001'):mb.markRead('9007199254740993001'));await mb.close();
 }
});
test('R2.2 thrown lookup stays approved for next run; real adapter distinguishes failure from not found',async()=>{
 const x=await setup(),get=x.mailbox.get;x.mailbox.get=async()=>{throw Error('server');};await applyApproval(x);assert.deepEqual(x.state.journal.runs[0].skipped_ids,[]);assert.equal(x.state.journal.runs[0].status,'in_progress');
 x.mailbox.get=get;await runCycle({...x,approval:null});assert.equal(x.state.journal.runs[0].entries[0].status,'done');
 const f=fake();class Client extends f.Client{async search(q,...args){if(q.emailId)throw Error('server');return super.search(q,...args);}}
 const mb=await connectMailbox(config,{GMAIL_USER:'fake',GMAIL_APP_PASSWORD:'fake'},Client);await assert.rejects(mb.get('9007199254740993001'));await mb.close();
});
test('R2.3 sorting failure cannot block Undo or another approved item',async()=>{
 const x=await setup();await applyApproval(x);const runId=x.state.journal.runs[0].id;
 const m2=row(2);await makeProposal({...x,messages:[m2]});const p=x.state.proposal;const get=x.mailbox.get;x.mailbox.get=async id=>id==='2'?m2:get(id);x.mailbox.scan=async()=>{throw Error('sort failed');};
 await runCycle({...x,undoRequests:[{run_id:runId}],approval:{proposal_id:p.id,revision:p.revision,selected:['2']}});assert(x.events.includes('restore'));assert.equal(x.state.journal.runs.at(-1).entries[0].status,'done');
});
test('R2.4 both mailboxes sort before long approved cleanup and share remaining time',async()=>{
 const root=fs.mkdtempSync(new URL('../.tmp-audit-fair-',import.meta.url));const events=[];let tick=0;
 try{
  const state=emptyState(),cfg=settings({enabled:true,second_mailbox_enabled:true});await makeProposal({state,config:cfg,messages:[row()],evaluate,now});
  for(const [name,value]of Object.entries({'config.json':cfg,'mail.json':state.digest,'runtime.json':state.runtime,'cleanup-proposal.json':state.proposal,'cleanup-log.json':state.journal,'cleanup-approval.json':{proposal_id:state.proposal.id,revision:state.proposal.revision,selected:['1']}}))fs.writeFileSync(root+'/'+name,JSON.stringify(value));
  const code=await main({root,clock:()=>tick,env:{RUN_BUDGET_MINUTES:'2',GMAIL_USER:'main@mail.example',GMAIL_APP_PASSWORD:'fake',GMAIL2_USER:'second@mail.example',GMAIL2_APP_PASSWORD:'fake',ANTHROPIC_API_KEY:'synthetic'},connect:async(c,e)=>{const key=e.GMAIL_USER.startsWith('main')?'primary':'secondary';return {scan:async()=>{events.push('sort:'+key);return {messages:[],done:true,uidValidity:'1'};},get:async()=>row(),addLabel:async()=>{},archive:async()=>{events.push('archive:'+key);tick+=120000;},markRead:async()=>{},close:async()=>{}};},output:()=>{}});
  assert.equal(code,0);assert(events.indexOf('sort:secondary')>=0);assert(events.indexOf('sort:secondary')<events.indexOf('archive:primary'));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('R2.5 backfill skips historical scan and preserves its cursor',async()=>{
 const x=await setup();x.state.runtime.scanAfter=17;let scans=0,reviewed=false;
 x.mailbox.scan=async()=>{if(++scans>1)throw Error('historical scan must not run');return {messages:[],done:true,uidValidity:'1'};};x.mailbox.scanReview=async()=>{reviewed=true;return {messages:[],done:true};};
 await runCycle({...x,approval:null,backfill:true});assert(reviewed);assert.equal(scans,1);assert.equal(x.state.runtime.scanAfter,17);
});
test('R2.6 failed pending lookup keeps that choice, while a confirmed read item may drop',async()=>{
 const x=await setup();await makeProposal({...x,messages:[row(1),row(2),row(3)]});x.mailbox.get=async id=>{if(id==='2')throw Error('server');return {...row(Number(id)),seen:id==='1'};};
 await runCycle({...x,approval:null,backfill:true});assert.deepEqual(x.state.proposal.items.map(x=>x.gmailId).sort(),['2','3']);
});
test('R2.6 empty second mailbox preserves backfill mode, identity and scope',async()=>{
 const shared=emptyState();const primary=emptyState();await makeProposal({state:primary,config,messages:[row(1),row(2),row(3)],evaluate,backfill:true,now});mergeState(shared,primary,'primary','main@mail.example',true);
 const id=shared.proposal.id;const second=scopeState(shared,'secondary');await makeProposal({state:second,config,messages:[],evaluate,now});mergeState(shared,second,'secondary','second@mail.example',true);
 assert.equal(shared.proposal.id,id);assert.equal(scopeState(shared,'primary').proposal.review_mode,'primary_backfill');assert.equal(shared.proposal.items.length,3);assert.equal(scopeApproval({proposal_id:'stale',revision:shared.proposal.revision,selected:['1']},shared.proposal,'primary'),null);
});
test('R2.7 finished proposal stays consumed across saves; reapproval of handled mail does no lookup',async()=>{
 const x=await setup();await applyApproval(x);const shared=emptyState();mergeState(shared,x.state,'primary','main@mail.example',false);const id=shared.proposal.id;
 const scoped=scopeState(shared,'primary');mergeState(shared,scoped,'primary','main@mail.example',false);assert.equal(shared.proposal.id,id);
 const controller=new ReviewController({get:async p=>({data:p.endsWith('cleanup-proposal.json')?shared.proposal:p.endsWith('cleanup-log.json')?shared.journal:null,sha:null})});await controller.load();assert(controller.consumed);
 // Legacy identity drift: a new ID attached to an already-finished list.
 x.state.proposal={...x.state.proposal,id:'changed-id'};let gets=0;x.mailbox.get=async()=>{gets++;throw Error('should never look up handled mail');};
 await applyApproval({...x,approval:{proposal_id:'changed-id',revision:x.state.proposal.revision,selected:['1']}});assert.equal(gets,0);
});
test('R2.8 unknown unread total never invents zero, in either language',()=>{
 for(const lang of ['en','zh']){const text=pendingImpact([{gmailId:'1'}],new Set(['1']),lang);assert(!text.includes('0'));assert.match(text,lang==='en'?/unknown/i:/未知|无法确定/);}
});
for(const subject of ['Your password was changed','New sign-in to your account: password changed','Your account email was changed','密码已更改'])test('R2.9 account change is kept: '+subject,()=>{const v=decide({...row(),subject},config,now);assert.equal(v.rule,null);assert.equal(v.category,'security');});
