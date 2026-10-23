import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,runCycle} from '../scripts/core.mjs';
import {settings} from '../scripts/settings.mjs';

const now=new Date('2026-10-23T00:25:30.789Z');
const config=settings({enabled:true});
const message=(uid,subject='Verification code')=>({
  uid,gmailId:String(100000+uid),threadId:String(200000+uid),subject,
  from:'notices@synthetic.example',date:uid>16569?'2026-10-22T12:00:00Z':'2025-01-01T00:00:00Z',
  labels:[],inInbox:true,protectionComplete:true,starred:false,important:false,
  replied:false,threadParticipated:false,everWritten:false
});

function setup(fresh=[message(16570,'Invoice receipt')]){
  const state=emptyState();
  state.digest={items:Array.from({length:500},(_,i)=>message(16070+i)),lastUid:16569,total_classified:1161};
  state.runtime={scanAfter:1008,lastProposalAt:'2026-10-21T19:11:00Z',uidValidity:'1'};
  const old=Array.from({length:121},(_,i)=>message(1009+i));
  const data=[...old,...fresh],scans=[],labels=[],saved=[];
  const mailbox={
    scan:async options=>{
      scans.push(options);
      const rows=data.filter(m=>m.uid>options.after).sort((a,b)=>a.uid-b.uid);
      return {messages:rows.slice(0,options.limit),done:rows.length<=options.limit,uidValidity:'1',reset:false};
    },
    get:async id=>data.find(m=>m.gmailId===id)||null,
    addLabel:async(id,label)=>{labels.push({id,label});},
    archive:async()=>assert.fail('No archive without approval'),
    trash:async()=>assert.fail('No trash without approval'),
    restore:async()=>assert.fail('No undo without request'),
    readBody:async()=>assert.fail('Bodies are disabled')
  };
  const persist=async s=>saved.push(structuredClone(s));
  const run=options=>runCycle({config,state,mailbox,persist,now,...options});
  return {state,old,data,scans,labels,saved,mailbox,run};
}

test('legacy digest ingests a new arrival while the oldest-first cleanup sweep stays behind',async()=>{
  const {state,scans,labels,saved,run}=setup();
  await run();
  assert.equal(state.digest.lastUid,16570);
  assert.equal(state.digest.items[0].uid,16570);
  assert.equal(state.digest.items[0].category,'finance');
  assert.equal(state.digest.items.length,500);
  assert.equal(state.digest.total_classified,1162);
  assert.equal(state.runtime.scanAfter,1128);
  assert.equal(state.proposal.items.length,120);
  assert.ok(state.proposal.items.every(m=>m.uid>=1009&&m.uid<=1128));
  assert.deepEqual(scans.map(s=>s.after),[1008,16569]);
  assert.ok(scans.every(s=>s.limit===120&&s.expectedUidValidity==='1'&&!s.primaryOnly));
  assert.deepEqual(labels,[{id:'116570',label:'AI/Money'}]);
  assert.equal(saved.at(-1).digest.lastUid,16570);
  assert.deepEqual(state.journal,{runs:[],reviews:[]});
});

test('new-mail overflow is bounded and resumes without resetting the cleanup cursor',async()=>{
  const fresh=Array.from({length:121},(_,i)=>message(16570+i,'Invoice receipt'));
  const {state,scans,data,run}=setup(fresh);
  await run();
  assert.equal(state.digest.lastUid,16689);
  assert.equal(state.runtime.scanAfter,1128);
  // Keep a historical backlog for the next cycle as well.
  data.push(...Array.from({length:121},(_,i)=>message(1130+i)));
  await run({now:new Date(now.getTime()+86401000)});
  assert.equal(state.digest.lastUid,16690);
  assert.equal(state.runtime.scanAfter,1248);
  assert.deepEqual(scans.map(s=>s.after),[1008,16569,1128,16689]);
  assert.equal(state.digest.total_classified,1282);
});

test('a failed keep-label operation does not skip newer UIDs and retries on the next cycle',async()=>{
  const {state,data,mailbox,run}=setup([message(16570,'Invoice receipt'),message(16571,'Invoice receipt')]);
  const addLabel=mailbox.addLabel;let fail=true;
  mailbox.addLabel=async(id,label)=>{if(fail&&id==='116570')throw Error('Synthetic label failure');return addLabel(id,label);};
  await run();
  assert.equal(state.digest.lastUid,16569);
  assert.equal(state.runtime.scanAfter,1128);
  data.push(...Array.from({length:121},(_,i)=>message(1130+i)));
  fail=false;
  await run({now:new Date(now.getTime()+86401000)});
  assert.equal(state.digest.lastUid,16571);
  assert.ok(state.digest.items.some(m=>m.uid===16570));
});

test('cadence still prevents scans and digest updates until the next due cycle',async()=>{
  const {state,scans,run}=setup();
  state.runtime.lastProposalAt=now.toISOString();
  assert.deepEqual(await run(),{skipped:'cadence'});
  assert.equal(scans.length,0);
  assert.equal(state.digest.lastUid,16569);
});

test('UIDVALIDITY reset discards the old digest cursor before any incremental scan',async()=>{
  const {state,scans,mailbox,run}=setup();
  mailbox.scan=async options=>{scans.push(options);return {messages:[message(1)],done:false,reset:true,uidValidity:'2'};};
  await run();
  assert.equal(state.digest.lastUid,1);
  assert.equal(state.runtime.scanAfter,1);
  assert.equal(state.runtime.uidValidity,'2');
  assert.equal(state.digest.total_is_floor,true);
  assert.equal(scans.length,1);
});

test('a UIDVALIDITY change between sweep and incremental scan fails before saving mixed cursors',async()=>{
  const {state,scans,saved,mailbox,run}=setup();
  const scan=mailbox.scan;
  mailbox.scan=async options=>scans.length?{messages:[message(1)],done:false,reset:true,uidValidity:'2'}:scan(options);
  await assert.rejects(run(),/UID validity/);
  assert.equal(saved.length,0);
  assert.equal(state.digest.lastUid,16569);
});
