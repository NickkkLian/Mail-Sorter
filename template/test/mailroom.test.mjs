import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {nextSort,localTime,groupSenders,selectedImpact,projectedDrop,meterData,safetyCopy} from '../board/report.mjs';
import {ReviewController} from '../board/review.mjs';
import {DealtController} from '../board/dealt.mjs';
import {createDemoRunner} from '../board/demo-runner.mjs';
import {settings} from '../mail/scripts/settings.mjs';
import {emptyState,makeProposal,runCycle} from '../mail/scripts/core.mjs';
import {message} from '../eval/synthetic.mjs';
import {browserPolicyHash} from '../board/browser-policy.mjs';
import {policyHash} from '../mail/scripts/rules.mjs';
import browserRules from '../mail/scripts/rule-data.mjs';

function demoMail(){
  const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'),start=source.indexOf('function makeDemo(){'),end=source.indexOf('const DEMO=',start);
  return vm.runInNewContext(source.slice(start,end)+';makeDemo()',{Date});
}

test('next sort uses explicit UTC schedule, local display, midnight rollover and absent metadata',()=>{
  const schedule=['15:00','22:00'];
  assert.equal(nextSort(schedule,new Date('2026-11-05T17:00:00Z')).toISOString(),'2026-11-05T22:00:00.000Z');
  assert.equal(nextSort(schedule,new Date('2026-11-05T22:00:00Z')).toISOString(),'2026-11-06T15:00:00.000Z');
  assert.equal(nextSort([],new Date()),null);assert.equal(nextSort(['bad'],new Date()),null);
  assert.equal(localTime('2026-11-05T22:00:00Z','en','America/Vancouver'),'3:00 p.m.');
  assert.equal(localTime('2026-11-05T22:00:00Z','zh','Asia/Shanghai'),'6:00');
  assert.throws(()=>settings({sort_schedule_utc:['25:00']}));
  assert.deepEqual(settings({sort_schedule_utc:schedule}).sort_schedule_utc,schedule);
});

test('impact counts only known unread Primary conversations and keeps unknown values unknown',()=>{
  const items=[{gmailId:'1',threadId:'a',unread:true,primary:true,action:'archive',from:'Store <a@store.example>'},{gmailId:'2',threadId:'a',unread:true,primary:true,action:'archive',from:'Store <a@store.example>'},{gmailId:'3',unread:true,primary:false,action:'trash',from:'other@store.example'}];
  const selected=new Set(['1','2','3']);assert.equal(selectedImpact(items,selected).primary,1);assert.equal(selectedImpact(items,selected).trash,1);
  assert.equal(selectedImpact([...items,{gmailId:'4'}],new Set([...selected,'4'])).primary,null);
  assert.equal(groupSenders(items)[0].items.length,2);
  const review={queued:true,consumed:false,data:{proposal:{items},approval:{selected:[...selected]},journal:{runs:[]}}},dealt={status:()=>null};
  assert.equal(projectedDrop({mail:{items:[]},mailbox:'primary',review,dealt}),1);
  assert.equal(projectedDrop({mail:{items:[items[0]]},mailbox:'primary',review,dealt,mode:'digest'}),1);
  assert.equal(projectedDrop({mail:{items:[]},mailbox:'primary',review,dealt,mode:'digest'}),0);
});

test('unverified counts use the sorted-list fallback and destination copy states exact recovery limits',()=>{
  const mail={items:[{gmailId:'1',unread:true}],inbox_history:[{at:'2026-11-05',inbox_unread_primary:99}]};
  assert.equal(meterData(mail,'primary').value,1);assert.equal(meterData(mail,'primary').available,false);
  mail.inbox_count_verified=true;assert.equal(meterData(mail,'primary').value,99);
  for(const language of ['en','zh']){
    const text=safetyCopy([{action:'archive'},{action:'trash'}],language);
    assert.match(text,language==='en'?/All Mail/:/所有邮件/);assert.match(text,/30/);
    assert.doesNotMatch(text,/not deleted/);
  }
});

test('full demo applies and reverses approved cleanup twice through the real board controllers',async()=>{
  const mail=demoMail();let config=settings({enabled:true,second_mailbox_enabled:true});
  const bridge={getConfig:()=>config,saveConfig:async value=>{config=value;}},runner=createDemoRunner(bridge,mail),review=new ReviewController(runner.io),dealt=new DealtController(runner.io);
  await review.load();await dealt.load();
  assert.equal(mail.items.length,300);assert.equal(mail.items.filter(item=>item.action).length,5);
  assert.equal(mail.inbox_history.length,28);assert.equal(new Set(mail.inbox_history.map(row=>row.at)).size,14);
  assert.equal(review.data.proposal.items.length,64);assert.equal(groupSenders(review.data.proposal.items).length,23);
  assert.equal(new Set(review.data.proposal.items.map(item=>item.rule)).size,3);assert.equal(review.data.journal.runs.length,8);
  for(let cycle=0;cycle<2;cycle++){
    await review.approve();assert(review.queued);await runner.run();await review.load();
    const run=review.data.journal.runs.findLast(run=>run.id.startsWith('demo-sort-'));
    assert.equal(run.entries.length,62);assert.equal(run.skipped_count,2);
    assert.equal(meterData(mail,'secondary',{demo:true}).value,110);
    await review.undo(run.id);await runner.run();await review.load();
    assert.equal(meterData(mail,'secondary',{demo:true}).value,131);
    assert.equal(run.entries[0].status,'done');
    assert.equal(review.data.journal.runs.find(row=>row.id===run.id).entries[0].status,'undone');
    assert(!review.queued);assert(!review.consumed);
  }
});

test('demo Done removes a request immediately and Undo restores its read count',async()=>{
  const mail=demoMail(),runner=createDemoRunner({getConfig:()=>settings({enabled:true})},mail),dealt=new DealtController(runner.io),item=mail.items[0];
  await dealt.mark([item]);assert.equal(dealt.status(item.gmailId),'queued');
  const request=dealt.requests.at(-1);await dealt.undo(request);assert.equal(dealt.status(item.gmailId),null);
  await runner.run();assert.equal(mail.items[0].unread,true);
});

test('approval Undo cancels work before execution and restores work that already started',async()=>{
  const config=settings({enabled:true}),state=emptyState(),now=new Date('2026-11-05T17:00:00Z'),m=message({gmailId:'1',subject:'Verification code'});
  const evaluate=async()=>({rule:'O1',category:'other'}),persist=async()=>{};let archived=0,restored=0;
  const mailbox={scan:async()=>({messages:[],done:true}),get:async()=>({...m,inInbox:true,seen:false}),addLabel:async()=>{},archive:async()=>{archived++;},markRead:async()=>{},markUnread:async()=>{},restore:async()=>{restored++;},removeLabel:async()=>{}};
  await makeProposal({config,state,messages:[m],now,evaluate});
  const approval={proposal_id:state.proposal.id,revision:state.proposal.revision,selected:['1'],reviewed_at:'first'},undo={proposal_id:state.proposal.id,reviewed_at:'first'};
  await runCycle({config,state,now,mailbox,persist,evaluate,approval,undoRequests:[undo]});assert.equal(archived,0);
  const active={...approval,proposal_id:state.proposal.id,revision:state.proposal.revision,reviewed_at:'second'};
  await runCycle({config,state,now,mailbox,persist,evaluate,approval:active});assert.equal(archived,1);
  await runCycle({config,state,now,mailbox,persist,evaluate,approval:active,undoRequests:[{proposal_id:active.proposal_id,reviewed_at:'second'}]});assert.equal(restored,1);
});

test('Trash projections move the Inbox number even when marking mail read is off',()=>{
  const item={gmailId:'1',unread:true,primary:true,action:'trash'};
  const review={queued:true,consumed:false,data:{proposal:{items:[item]},approval:{selected:['1']},journal:{runs:[]}}};
  assert.equal(projectedDrop({mail:{items:[]},mailbox:'primary',review,dealt:{status:()=>null},markRead:false}),1);
});

test('meter trends cover days instead of truncating at fourteen twice-daily runs',()=>{
  const history=Array.from({length:28},(_,i)=>({at:new Date(Date.UTC(2026,9,22+Math.floor(i/2),i%2?22:15)).toISOString(),inbox_unread_primary:300-i,inbox_unread_all:400-i}));
  const meter=meterData({items:[],updated_at:history.at(-1).at,inbox_count_verified:true,inbox_history:history},'primary');
  assert.equal(meter.history.length,14);assert.equal(meter.history[0].inbox_unread_primary,299);
  assert.equal(meter.value,273);
});

test('a new approval after Undo has a different identity and can run',async()=>{
  const mail=demoMail(),runner=createDemoRunner({getConfig:()=>settings({enabled:true})},mail),review=new ReviewController(runner.io);
  await review.load();await review.approve();const first=review.data.approval.id;
  await review.undoApproval();assert(!review.queued);
  await review.load();
  await review.approve();assert.notEqual(review.data.approval.id,first);assert(review.queued);
  await runner.run();await review.load();assert(review.consumed);
});

test('browser and scheduled task use the same safety policy fingerprint',async()=>{
  assert.deepEqual(browserRules,JSON.parse(fs.readFileSync(new URL('../mail/rules.json',import.meta.url),'utf8')));
  for(const config of [{enabled:true},{enabled:true,sort_schedule_utc:['15:00','22:00'],protected:{senders:['safe@inbox.example']}},{enabled:true,rules:{O4:{action:'trash'}}}])assert.equal(await browserPolicyHash(config),policyHash(config));
});

test('Protect sender blocks approval until the simulated sort prepares a fresh policy list',async()=>{
  const mail=demoMail();let config=settings({enabled:true,second_mailbox_enabled:true});
  const runner=createDemoRunner({getConfig:()=>config,saveConfig:async value=>{config=value;}},mail);await runner.ready;
  const review=new ReviewController(runner.io);await review.load();
  const address=review.data.proposal.items[0].from;await review.protect(address);await review.load();
  assert(review.policyChanged);await assert.rejects(review.approve(),/fresh list/);
  await runner.run();await review.load();assert(!review.policyChanged);
  assert.equal(review.data.proposal.items.length,50);assert(review.data.proposal.items.every(item=>item.from!==address));
  await review.approve();await runner.run();await review.load();assert(review.consumed);
});

test('approval Undo keeps its original identity when a later list arrives',async()=>{
  const mail=demoMail(),runner=createDemoRunner({getConfig:()=>settings({enabled:true})},mail);await runner.ready;
  const review=new ReviewController(runner.io);await review.load();const accepted=await review.approve();
  runner.files['mail/cleanup-proposal.json']={...runner.files['mail/cleanup-proposal.json'],id:'next-list',revision:'next-revision'};
  await review.load();await review.undoApproval(accepted);
  assert.equal(review.data.undo.requests[0].proposal_id,accepted.proposal.id);
  assert.equal(review.data.undo.requests[0].approval_id,accepted.approval.id);
});

test('an old Inbox count falls back to the sorted list after a later sort without a fresh count',()=>{
  const mail={updated_at:'2026-11-05T17:00:00Z',items:[{gmailId:'1',unread:true}],inbox_count_verified:true,inbox_history:[{at:'2026-11-04T17:00:00Z',inbox_unread_primary:99}]};
  const result=meterData(mail,'primary');assert(!result.available);assert.equal(result.value,1);assert.deepEqual(result.history,[]);
});
