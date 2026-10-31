import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,runCycle,makeProposal,applyApproval,undoRun} from '../mail/scripts/core.mjs';
import {settings} from '../mail/scripts/settings.mjs';
import * as copy from '../board/cleanup-copy.mjs';
const now=new Date('2026-10-31T12:00:00Z');
const msg=(id,date,seen=false)=>({gmailId:String(id),uid:id,date,seen,inInbox:true,labels:[]});
const evaluate=async()=>({rule:'O1',category:'other'});
test('sorting precedes continuation and runs even inside review cadence',async()=>{
 const config=settings({enabled:true}),state=emptyState(),events=[];
 const old=msg(1,'2023-01-01'),fresh=msg(9,'2026-10-30');
 await makeProposal({messages:[old],config,state,now,evaluate});
 const approval={proposal_id:state.proposal.id,revision:state.proposal.revision,selected:['1']};
 const mailbox={scan:async()=>{events.push('sort');return {messages:[fresh],done:true,uidValidity:'1'};},get:async()=>old,addLabel:async()=>{},archive:async()=>events.push('archive'),markRead:async()=>{}};
 await runCycle({config,state,approval,mailbox,persist:async()=>{},evaluate,now});
 assert(events.indexOf('sort')<events.indexOf('archive'));assert.equal(state.digest.updated_at,now.toISOString());
 events.length=0;await runCycle({config,state,mailbox,persist:async()=>{},evaluate,now});assert(events.includes('sort'));
});
test('proposal unread inbox newest first and bounded; read/non-inbox excluded',async()=>{
 const state=emptyState(),config=settings({enabled:true,max_per_run:2});
 const p=await makeProposal({config,state,now,evaluate,messages:[msg(1,'2020-01-01'),msg(2,'2026-01-01'),msg(3,'2026-02-01',true),{...msg(4,'2026-03-01'),inInbox:false},msg(5,'2026-04-01')]});
 assert.deepEqual(p.items.map(x=>x.gmailId),['5','2']);assert(p.items.every(x=>x.unread===true));
});
test('archive marks read despite dealt preference off and Undo restores unread',async()=>{
 const state=emptyState(),config=settings({enabled:true,mark_dealt_read:false}),m=msg(1,'2020-01-01');
 await makeProposal({config,state,now,evaluate,messages:[m]});
 const p=state.proposal,mailbox={get:async()=>structuredClone(m),addLabel:async()=>{},removeLabel:async()=>{},archive:async()=>{m.inInbox=false;},markRead:async()=>{m.seen=true;},markUnread:async()=>{m.seen=false;},restore:async()=>{m.inInbox=true;}};
 await applyApproval({config,state,now,evaluate,mailbox,persist:async()=>{},approval:{proposal_id:p.id,revision:p.revision,selected:['1']}});assert(m.seen);
 await undoRun({state,runId:state.journal.runs[0].id,mailbox,persist:async()=>{}});assert(!m.seen&&m.inInbox);
});
test('selected pending impact is bilingual and old proposals do not invent unread counts',()=>{
 const items=[{gmailId:'1',unread:true},{gmailId:'2',unread:false},{gmailId:'3'}],selected=new Set(['1','2','3']);
 assert.match(copy.pendingImpact(items,selected,'en'),/1 unread/);assert.match(copy.pendingImpact(items,selected,'zh'),/1 封未读/);assert.match(copy.pendingImpact(items,selected,'en'),/unknown/i);
});
