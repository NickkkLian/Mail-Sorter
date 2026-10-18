import {test} from 'node:test';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {settings} from '../mail/scripts/settings.mjs';
import {decide,DAY,policyHash} from '../mail/scripts/rules.mjs';
import {emptyState,makeProposal,applyApproval,undoRun,runCycle,autoEligible,ruleHash} from '../mail/scripts/core.mjs';
import {main} from '../mail/scripts/classify.mjs';
import {message,synthetic,NOW} from '../eval/synthetic.mjs';
import {validateSet,score} from '../eval/score-cleanup.mjs';
const check=(x)=>{if(!x)throw Error('Safety expectation failed (data suppressed)');};
const c=settings({enabled:true}),now=new Date(NOW),m=(x={})=>message({subject:'Verification code',...x});
function mocks(messages=[m()]){
  const calls=[],data=new Map(messages.map(x=>[x.gmailId,structuredClone(x)]));
  const box=new Proxy({
    get:async id=>structuredClone(data.get(id)||null),
    scan:async({after,limit})=>({messages:[...data.values()].filter(x=>x.inInbox&&x.uid>after).sort((a,b)=>a.uid-b.uid).slice(0,limit),done:[...data.values()].filter(x=>x.inInbox&&x.uid>after).length<=limit,uidValidity:'1'}),
    addLabel:async(id,label)=>{calls.push('label');data.get(id).labels.push(label);},
    removeLabel:async(id,label)=>{calls.push('unlabel');data.get(id).labels=data.get(id).labels.filter(x=>x!==label);},
    archive:async id=>{calls.push('archive');data.get(id).inInbox=false;},
    trash:async id=>{calls.push('trash');data.get(id).inInbox=false;},
    restore:async id=>{calls.push('restore');data.get(id).inInbox=true;}
  },{get(t,p){if(p in t)return t[p];throw Error('Forbidden mailbox verb');}});
  return {box,calls,data};
}
const approve=p=>({proposal_id:p.id,revision:p.revision,selected:p.items.map(x=>x.gmailId)});
for(const id of ['O1','O2','O3','O4','O5','O6','O7'])test(id+' matches synthetic rule and honors disable switch',()=>{
  const row=synthetic().items.find(x=>x.expected.rule===id);check(decide(row.message,c,now).rule===id);check(!decide(row.message,{...c,rules:{[id]:{enabled:false}}},now).rule);
});
test('age thresholds are strict; future and invalid dates stay',()=>{
  for(const [sub,extra,days]of [['Verification code',{},1],['Package delivered',{shippingSender:true},7],['Package shipped',{shippingSender:true},30],['Sale',{tab:'promotions'},30],['Newsletter',{bulk:true},60],['Profile viewed',{tab:'social'},14],['Password changed',{},90]]){
    check(!decide(m({subject:sub,...extra,date:new Date(now-days*DAY).toISOString()}),c,now).rule);
    check(!!decide(m({subject:sub,...extra,date:new Date(now-days*DAY-1).toISOString()}),c,now).rule);
  }for(const date of ['invalid','2027-01-01'])check(!decide(m({date}),c,now).rule);
});
test('shipping receipts, incidents, renewals and undated invites stay',()=>{
  for(const x of [{subject:'Your shipped order confirmation receipt',shippingSender:true},{subject:'Suspicious new sign-in security incident'},{subject:'Subscription will renew'},{subject:'Invitation: annual conference'}])check(!decide(m(x),c,now).rule);
});
test('all eight keep categories and independent reply status',()=>{
  for(const row of synthetic().items.filter(x=>x.expected.kind==='keep'))check(decide(row.message,c,now).category===row.expected.category);
  const v=decide(m({needsReply:true}),c,now);check(v.action&&!v.rule);
});
test('protection covers sender/domain/subdomain/labels/starred/replied threads and missing metadata',()=>{
  for(const patch of [{starred:true},{threadParticipated:true},{everWritten:true},{labels:['AI/Money']},{labels:['AI/财务账单']},{protectionComplete:false},{threadId:null},{gmailId:1001},{labels:null}])check(!decide(m(patch),c,now).rule);
  check(!decide(m(),{...c,protected:{senders:['notices@service.example']}},now).rule);
  check(!decide(m(),{...c,protected:{domains:['example']}},now).rule);
  check(!decide(m({from:'notices@evil-example.org'}),{...c,protected:{domains:['example.org']}},now).reason.includes('Protected'));
});
test('safe public defaults and invalid permissions fail closed',()=>{
  const d=settings();check(!d.enabled&&!d.read_bodies&&d.approval_mode==='every_run'&&Object.values(d.rules).every(x=>x.action==='archive'&&!x.auto));
  for(const bad of [{enabled:'true'},{read_bodies:'yes'},{rules:{O1:{action:'delete'}}},{rules:{O1:{auto:true,clean_days:1}}},{archive_categories:['promo']},{frequency_hours:0},{protected:{domains:'example'}}]){let failed=false;try{settings(bad);}catch{failed=true;}check(failed);}
});
test('no mutations without explicit approval; stable IDs survive UID changes; approvals cannot replay',async()=>{
  const state=emptyState(),{box,calls,data}=mocks();const p=await makeProposal({messages:[m()],config:c,state,now});check(calls.length===0);
  const a=approve(p);await applyApproval({config:c,state,mailbox:box,persist:async()=>{},now});check(calls.length===0);
  data.get('1001').uid=999;await applyApproval({config:c,state,approval:a,mailbox:box,persist:async()=>{},now});check(calls.join() ==='label,archive');
  await applyApproval({config:c,state,approval:a,mailbox:box,persist:async()=>{},now});check(calls.length===2&&state.journal.runs[0].entries[0].gmailId==='1001');
});
test('stale revision, changed setting, protected fresh state and altered destination block approval',async()=>{
  for(const variant of ['revision','config','protected','destination']){const state=emptyState(),{box,calls,data}=mocks();const p=await makeProposal({messages:[m()],config:c,state,now}),a=approve(p);let cfg=c;
    if(variant==='revision')a.revision='stale';if(variant==='config')cfg={...c,read_bodies:true};if(variant==='protected')data.get('1001').starred=true;if(variant==='destination')p.items[0].action='trash';
    await applyApproval({config:cfg,state,approval:a,mailbox:box,persist:async()=>{},now});check(calls.length===0);
  }
});
test('durable intent precedes action and persistence failure prevents mailbox mutation',async()=>{
  const state=emptyState(),{box,calls}=mocks();const p=await makeProposal({messages:[m()],config:c,state,now});let saved=0,failed=false;
  try{await applyApproval({config:c,state,approval:approve(p),mailbox:box,persist:async s=>{saved++;if(s.journal.runs[0].entries.length)throw Error('disk');},now});}catch{failed=true;}
  check(failed&&saved===2&&calls.length===0);
});
test('archive and Trash undo restore Inbox and preserve original labels; repeated undo is inert',async()=>{
  for(const action of ['archive','trash']){const cfg=settings({...c,rules:{O1:{action}}}),state=emptyState(),mail=m({labels:['Original']}),{box,calls,data}=mocks([mail]);const p=await makeProposal({messages:[mail],config:cfg,state,now});await applyApproval({config:cfg,state,approval:approve(p),mailbox:box,persist:async()=>{},now});const runId=state.journal.runs[0].id;
    await undoRun({state,runId,mailbox:box,persist:async()=>{},now});const n=calls.length;await undoRun({state,runId,mailbox:box,persist:async()=>{},now});check(data.get('1001').inInbox&&data.get('1001').labels.join()==='Original'&&calls.length===n);
  }
});
test('Trash expires at 30 days; crash-uncertain intents remain recoverable by undo',async()=>{
  const state=emptyState(),{box,calls}=mocks();state.journal.runs=[{id:'r',entries:[{gmailId:'1001',rule:'O1',action:'trash',at:new Date(now-30*DAY).toISOString(),status:'done'}]}];await undoRun({state,runId:'r',mailbox:box,persist:async()=>{},now});check(calls.length===0);
  state.journal.runs[0].entries[0]={gmailId:'1001',rule:'O1',action:'archive',at:NOW,status:'intent',label:'AI/Cleaned/O1'};await undoRun({state,runId:'r',mailbox:box,persist:async()=>{},now});check(calls.includes('restore'));
});
test('cadence, bounded oldest-first scan and aging sweep do not skip overflow',async()=>{
  const state=emptyState(),messages=Array.from({length:5},(_,i)=>m({uid:i+1,gmailId:String(1001+i)})),{box}=mocks(messages),cfg={...c,max_per_run:2};
  for(let i=0;i<3;i++)await runCycle({config:cfg,state,mailbox:box,persist:async()=>{},now:new Date(now.getTime()+i*DAY),force:true});
  check(state.proposal.items.length===5&&state.runtime.scanAfter===0&&state.digest.total_classified===5);
  const before=state.proposal.id;const r=await runCycle({config:cfg,state,mailbox:box,persist:async()=>{},now:new Date(now.getTime()+2*DAY)});check(r.skipped==='cadence'&&state.proposal.id===before);
});
test('automatic eligibility requires opt-in and 28 clean reviewed days; rejection/config edits reset it',()=>{
  const cfg=settings({...c,approval_mode:'eligible_rules',rules:{O1:{auto:true}}});const rows=Array.from({length:29},(_,i)=>({rule:'O1',policy:ruleHash(cfg,'O1'),at:new Date(now-(28-i)*DAY).toISOString(),reviewed:1,rejected:0,complete:true}));
  check(autoEligible(cfg,'O1',rows,now));check(!autoEligible(c,'O1',rows,now));check(!autoEligible(cfg,'O1',[...rows,{...rows.at(-1),rejected:1}],now));check(!autoEligible({...cfg,read_bodies:true},'O1',rows,now));
});
test('disabled CLI exits before consulting credentials or connecting',async()=>{
  let accesses=0;const env=new Proxy({DRY_RUN:'1'},{get(t,k){if(k!=='DRY_RUN')accesses++;return t[k];}});const result=await main({env,connect:async()=>{throw Error('forbidden');},output:()=>{}});check(result===0&&accesses===0);
});
test('no permanent-delete verbs exist in runtime source; adapter capability proxy rejects any other verb',()=>{
  const source=['imap.mjs','core.mjs'].map(x=>readFileSync(new URL('../mail/scripts/'+x,import.meta.url),'utf8')).join('');check(!/\.messageDelete\s*\(|\.expunge\s*\(|\.mailboxDelete\s*\(/.test(source));let caught=false;try{mocks().box.expunge();}catch{caught=true;}check(caught);
});
test('200 synthetic records pass cleanup gate and unsafe bank mutation fails',()=>{const spec=synthetic();validateSet(spec);check(score(spec).pass&&!score(spec,{mutate:true}).pass);});
