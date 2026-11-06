import {proposalConsumed} from './mailbox-key.mjs';
import {randomUUID} from 'node:crypto';
import {settings,RULE_IDS} from './settings.mjs';
import {decide,policyHash,fingerprint,DAY,protectedReason,address,safetyKnown} from './rules.mjs';
export const emptyState=()=>({digest:{items:[],lastUid:0,total_classified:0,total_is_floor:true},runtime:{scanAfter:0,lastProposalAt:null},proposal:null,journal:{runs:[],reviews:[]}});
export async function recordInboxCounts({state,mailbox,persist,now=new Date()}){
  if(!mailbox.inboxCounts)return false;
  let counts;
  try{counts=await mailbox.inboxCounts();}catch{return false;}
  if(!['inbox_unread_primary','inbox_unread_all'].every(key=>Number.isSafeInteger(counts[key])&&counts[key]>=0)||counts.inbox_unread_primary>counts.inbox_unread_all)return false;
  const sample={at:now.toISOString(),...counts};
  state.digest.inbox_history=[...(state.digest.inbox_history||[]).filter(row=>row.at!==sample.at),sample].slice(-60);
  await persist(state);return true;
}
const confirmed=async operation=>{if(await operation===false)throw Error('Mailbox operation refused');};
const quarantined=(state,id)=>state.journal.runs.some(r=>r.entries.some(e=>e.gmailId===id&&((e.action==='dealt'&&e.status==='done')||e.status==='intent'||e.status==='uncertain'||['intent','retry','missing'].includes(e.undo_status))));
export function seedProtection(config,digest){const c=settings(config),senders=new Set(c.protected.senders.map(address));for(const x of digest.items||[])if(['action','job','finance','school','health','official'].includes(x.category)){const a=address(x.fromAddr||x.from);if(a.includes('@'))senders.add(a);}c.protected.senders=[...senders];return c;}
export const ruleHash=(c,id)=>fingerprint({id,rule:settings(c).rules[id],policy:policyHash(c)});
export function autoEligible(c,id,reviews,now){
  const r=c.rules[id];if(c.approval_mode!=='eligible_rules'||!r.auto)return false;
  const rows=reviews.filter(x=>x.rule===id&&x.policy===ruleHash(c,id)).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
  const reject=rows.findLastIndex(x=>x.rejected>0||x.complete===false);const clean=rows.slice(reject+1).filter(x=>x.reviewed>0&&x.rejected===0&&x.complete===true);
  const days=new Set(clean.map(x=>x.at.slice(0,10)));
  return days.size>=r.clean_days&&clean.length>0&&Date.parse(now)-Date.parse(clean[0].at)>=r.clean_days*DAY&&Date.parse(now)-Date.parse(clean.at(-1).at)<=2*DAY;
}
const readEvidence=m=>({...(['primary','promotions','social','updates','forums'].includes(m.tab)?{primary:m.tab==='primary'}:{}),...(typeof m.seen==='boolean'?{unread:!m.seen}:{}),...(m.threadId?{threadId:String(m.threadId)}:{})});
const item=(m,v,c)=>({gmailId:m.gmailId,uid:m.uid,msgid:m.msgid||null,from:m.from||'',subject:m.subject||'',date:m.date,rule:v.rule,reason:v.reason,action:c.rules[v.rule].action,...readEvidence(m)});
export async function makeProposal({messages,config,state,backfill=false,pendingIds=[],retainedItems=[],now=new Date(),evaluate=async m=>decide(m,config,now)}){
  const c=settings(config),items=structuredClone(retainedItems);const unique=new Set(items.map(x=>x.gmailId));
  const kept_back={wrote_to:0,starred:0,protected:0,labels:0,uncertain:0};
  const newest=(a,b)=>String(b.date).localeCompare(String(a.date))||b.uid-a.uid;
  const rows=[...messages].filter(m=>m.inInbox!==false&&m.seen!==true).sort(newest),pending=new Set(pendingIds);
  // A one-time larger review must retain already-pending choices even when newer arrivals fill the page.
  const ordered=backfill?[...rows.filter(m=>pending.has(m.gmailId)),...rows.filter(m=>!pending.has(m.gmailId))]:rows;
  for(const m of ordered){
    if(items.length>=(backfill?c.max_backfill:c.max_per_run))break;
    if(unique.has(m.gmailId)||quarantined(state,m.gmailId)||state.journal.runs.some(r=>r.status==='finished'&&r.kind!=='dealt'&&r.entries.some(e=>e.gmailId===m.gmailId&&e.status==='done')))continue;
    unique.add(m.gmailId);const v=await evaluate(m);
    if(v.rule)items.push(item(m,v,c));
    else{
      const reason=protectedReason(m,c),key={'participated':'wrote_to','starred':'starred','protected sender':'protected','keep label':'labels'}[reason];
      if(key)kept_back[key]++;
      else if(!safetyKnown(m)||m.classificationFailed===true||/uncertain|veto|unavailable/i.test(v.reason||''))kept_back.uncertain++;
    }
  }
  items.sort(newest);
  const proposal={...(backfill?{review_mode:'primary_backfill'}:{}),id:randomUUID(),created_at:now.toISOString(),policy:policyHash(c),items,kept_back};
  proposal.revision=fingerprint({policy:proposal.policy,items});state.proposal=proposal;state.runtime.lastProposalAt=now.toISOString();return proposal;
}
// persist must durably record the journal BEFORE any side effect. Only these mailbox verbs are used.
// State is saved in batches, not per email: each save is one commit in the private repository.
// Cleanup intents for up to BATCH.size messages (or BATCH.ms of work, whichever first) are saved together BEFORE
// any of those messages is touched; the results are saved right after. A hard crash can therefore lose at most one
// batch of "done" marks (those entries stay as saved intents, which later runs never replay and Undo still restores).
export const BATCH={size:25,ms:120000};
// Requests are append-only and consumed by a durable run ID, including interrupted runs.
// An intent/uncertain entry is never replayed. Undo uses its before-image, as cleanup does.
export async function applyDealt({config,state,requests=[],mailbox,persist,now=new Date(),signal=null,batch=BATCH}){
  const c=settings(config);if(!c.enabled||signal?.aborted)return {applied:0};let applied=0;
  for(const request of requests){
    if(signal?.aborted)break;
    if(!request||typeof request.id!=='string'||!request.id||!Array.isArray(request.items)||!request.items.length||request.items.length>150||state.journal.runs.some(r=>r.dealt_request_id===request.id))continue;
    const run={id:randomUUID(),kind:'dealt',dealt_request_id:request.id,at:now.toISOString(),status:'running',entries:[]};state.journal.runs.push(run);await persist(state);
    const unique=new Set();
    for(let at=0;at<request.items.length&&!signal?.aborted;at+=batch.size){
      const group=[];
      for(const x of request.items.slice(at,at+batch.size)){
        if(!x||typeof x.gmailId!=='string'||!/^\d+$/.test(x.gmailId)||unique.has(x.gmailId)||quarantined(state,x.gmailId))continue;unique.add(x.gmailId);
        if(state.journal.runs.some(r=>r.kind==='dealt'&&r.entries.some(e=>e.gmailId===x.gmailId&&e.status==='done')))continue;
        const digest=state.digest.items.find(i=>i.gmailId===x.gmailId),category=c.categories.find(i=>i.key===x.category);
        if(!digest||digest.category!==x.category||!category)continue;
        let m;try{m=await mailbox.get(x.gmailId);}catch{continue;}
        if(!m||!m.inInbox||typeof m.seen!=='boolean'||!Array.isArray(m.labels)||m.labelsKnown===false)continue;
        const label=c.label_prefix+category.label;
        const entry={gmailId:x.gmailId,category:x.category,action:'dealt',label,at:now.toISOString(),status:'intent',changeRead:c.mark_dealt_read&&!m.seen,addLabel:!m.labels.includes(label)};
        run.entries.push(entry);group.push(entry);
      }
      if(!group.length)continue;await persist(state);let next=0,saved=Date.now();
      try{
        while(next<group.length&&!signal?.aborted){
          const e=group[next];try{if(e.addLabel)await mailbox.addLabel(e.gmailId,e.label);if(e.changeRead)await mailbox.markRead(e.gmailId);e.status='done';applied++;}catch{e.status='uncertain';}
          next++;if(Date.now()-saved>=batch.ms){await persist(state);saved=Date.now();}
        }
      }finally{const untouched=new Set(group.slice(next));run.entries=run.entries.filter(e=>!untouched.has(e));await persist(state);}
    }
    run.status=signal?.aborted?'cancelled':'finished';run.skipped_count=request.items.length-run.entries.length;await persist(state);
  }return {applied};
}
export async function applyApproval({config,state,approval,mailbox,persist,now=new Date(),recordReview=true,evaluate=async m=>decide(m,config,now),signal=null,batch=BATCH,deadline=Infinity,clock=Date.now,resumeRun=null}){
  const c=settings(config),p=state.proposal;
  let run=resumeRun||(approval&&state.journal.runs.find(r=>r.proposal_id===approval.proposal_id));
  if(!c.enabled)return {applied:0,skipped:'disabled'};
  if(run?.resume_cancelled||run&& !['running','in_progress','cancelled'].includes(run.status))return {applied:0,skipped:'consumed'};
  // Older cancelled records can be resumed only with their original, still matching approval.
  if(!run?.approved_items){
    if(!p||!approval)return {applied:0,skipped:'no approval'};
    if(approval.proposal_id!==p.id||approval.revision!==p.revision||p.policy!==policyHash(c)||!Array.isArray(approval.selected)||approval.selected.some(x=>!p.items.some(i=>i.gmailId===x))||new Set(approval.selected).size!==approval.selected.length)return {applied:0,skipped:'stale approval'};
  }else if(run.policy!==policyHash(c)){
    run.status='permissions_changed';await persist(state);return {applied:0,skipped:'stale approval'};
  }
  const stopped=()=>signal?.aborted||clock()>=deadline;
  if(stopped())return {applied:0,skipped:signal?.aborted?'cancelled':'budget'};
  const fresh=!run;
  run||={id:randomUUID(),proposal_id:p.id,at:now.toISOString(),entries:[]};
  if(fresh)state.journal.runs.push(run);
  if(!run.approved_items){run.approved_items=structuredClone(p.items.filter(x=>approval.selected.includes(x.gmailId)));run.policy=p.policy;run.selected_count=approval.selected.length;run.skipped_ids=[];}
  run.status='in_progress';
  const chosen=new Set(run.approved_items.map(x=>x.gmailId));
  if(fresh&&recordReview)for(const id of RULE_IDS){const group=p.items.filter(x=>x.rule===id);if(group.length)state.journal.reviews.push({run_id:run.id,rule:id,policy:ruleHash(c,id),at:now.toISOString(),reviewed:group.length,rejected:group.filter(x=>!chosen.has(x.gmailId)).length,complete:false});}
  await persist(state);
  const todo=run.approved_items.filter(x=>!run.entries.some(e=>e.gmailId===x.gmailId&&e.status!=='retry')&&!run.skipped_ids.includes(x.gmailId));let at=0;
  while(at<todo.length&&!stopped()){
    const group=[],started=clock();
    for(;at<todo.length&&group.length<batch.size&&(!group.length||clock()-started<batch.ms)&&!stopped();at++){
      const x=todo[at],existing=run.entries.find(e=>e.gmailId===x.gmailId);
      // A finished operation is cheap to consume even if an old proposal was given a different ID.
      if(!existing&&state.journal.runs.some(r=>r!==run&&r.status==='finished'&&r.entries.some(e=>e.gmailId===x.gmailId&&e.rule===x.rule&&e.action===x.action&&e.status==='done'))){run.skipped_ids.push(x.gmailId);continue;}
      if(quarantined(state,x.gmailId)){if(!existing)run.skipped_ids.push(x.gmailId);continue;}
      let m,v;
      try{m=await mailbox.get(x.gmailId);if(m?.inInbox===true)v=await evaluate(m);}catch{continue;} // transient failure stays approved, never a permanent skip
      if(!m){if(!existing)run.skipped_ids.push(x.gmailId);continue;}
      if(m.inInbox!==true){
        // A confirmed archive followed by a failed read can resume in All Mail.
        // An ambiguous MOVE is only treated as applied if its own durable cleanup label is present.
        if(!existing||(existing.retry_stage!=='read'&&!m.labels?.includes(existing.label))){if(!existing)run.skipped_ids.push(x.gmailId);continue;}
        existing.retry_stage='read';
      }else if(v?.rule!==x.rule||c.rules[x.rule].action!==x.action||!c.rules[x.rule].enabled){if(existing)existing.status='skipped';else run.skipped_ids.push(x.gmailId);continue;}
      if(stopped())break;
      const entry=existing||{gmailId:x.gmailId,rule:x.rule,action:x.action,label:`${c.label_prefix}Cleaned/${x.rule}`,at:now.toISOString(),changeRead:(x.action==='archive'||c.mark_dealt_read)&&!m.seen,originalLabels:[...m.labels],hadCleanLabel:m.labels.includes(`${c.label_prefix}Cleaned/${x.rule}`)};
      entry.status='intent';entry.retry_stage=m.inInbox?'archive':'read';
      if(!existing)run.entries.push(entry);group.push({entry,existing:Boolean(existing)});
    }
    if(!group.length)continue;
    await persist(state); // every intent in this group is durable before the first mailbox change
    let saved=clock(),next=0;
    try{
      while(next<group.length&&!stopped()){
        const {entry}=group[next];
        try{
          if(entry.retry_stage!=='read'){await confirmed(mailbox.addLabel(entry.gmailId,entry.label));await confirmed(mailbox[entry.action](entry.gmailId));entry.retry_stage='read';}
          if(entry.changeRead)await confirmed(mailbox.markRead(entry.gmailId));
          entry.status='done';delete entry.retry_stage;
        }catch{entry.status='retry';} // durable before-image plus last confirmed stage; retry only after a fresh lookup
        next++; // counted as acted on BEFORE any save, so a failing save can never drop the record of a changed email
        if(clock()-saved>=batch.ms){await persist(state);saved=clock();}
      }
    }finally{
      // Only entries never attempted (cancel) are dropped: they were not touched, so they must not stay as intents.
      const untouched=new Set(group.slice(next).filter(x=>!x.existing).map(x=>x.entry));for(const x of group.slice(next))if(x.existing)x.entry.status='retry';if(untouched.size){run.entries=run.entries.filter(e=>!untouched.has(e));}
      await persist(state); // failed or cancelled runs still keep the progress already made
    }
  }
  run.not_reached_count=chosen.size-run.entries.filter(e=>e.status!=='retry').length-run.skipped_ids.length;
  run.status=run.not_reached_count?'in_progress':'finished';
  run.skipped_count=run.skipped_ids.length+run.entries.filter(e=>e.status==='skipped').length;
  for(const review of state.journal.reviews.filter(x=>x.run_id===run.id)){const selected=run.approved_items.filter(x=>x.rule===review.rule&&chosen.has(x.gmailId));review.complete=selected.every(x=>run.entries.some(e=>e.gmailId===x.gmailId&&e.status==='done'));}
  // Do not discard incomplete operations. Older completed runs retain Gmail cleanup labels for manual restoration.
  // Dealt queue requests remain append-only: their consumption records must outlive cleanup log pruning.
  const completed=state.journal.runs.filter(r=>r.status==='finished'&&r.kind!=='dealt');
  if(completed.length>c.log_runs){const drop=new Set(completed.slice(0,completed.length-c.log_runs).filter(r=>r.entries.every(e=>e.status==='undone'||(e.status==='done'&&!e.undo_status))).map(r=>r.id));state.journal.runs=state.journal.runs.filter(r=>!drop.has(r.id));}
  state.journal.reviews=state.journal.reviews.filter(r=>Date.parse(now)-Date.parse(r.at)<400*DAY);
  await persist(state);return {applied:run.entries.filter(x=>x.status==='done').length};
}
export async function undoRun({state,runId,mailbox,persist,now=new Date(),signal=null,batch=BATCH}){
  const run=state.journal.runs.find(x=>x.id===runId);if(!run)return {restored:0};run.resume_cancelled=true;let restored=0;
  const todo=run.entries.filter(e=>!(e.status==='undone'||(e.action==='trash'&&Date.parse(now)-Date.parse(e.at)>=30*DAY)));let at=0;
  while(at<todo.length&&!signal?.aborted){
    const group=todo.slice(at,at+batch.size);at+=group.length;
    const before=new Map(group.map(e=>[e,e.undo_status]));for(const e of group)e.undo_status='intent';
    await persist(state); // same rule as cleanup: intents are durable before the first restore
    let saved=Date.now(),next=0;
    try{
      while(next<group.length&&!signal?.aborted){
        const e=group[next];
        try{const m=await mailbox.get(e.gmailId);if(!m)e.undo_status='missing';else{
          if(e.action==='dealt'){
            if(e.changeRead)await mailbox.markUnread(e.gmailId);
            if(e.addLabel)await mailbox.removeLabel(e.gmailId,e.label);
          }else{
            if(e.changeRead)await mailbox.markUnread(e.gmailId);
            await mailbox.restore(e.gmailId);for(const label of e.originalLabels||[])if(!label.startsWith('\\')&&!m.labels?.includes(label))await mailbox.addLabel(e.gmailId,label);if(!e.hadCleanLabel)await mailbox.removeLabel(e.gmailId,e.label);
          }
          e.status='undone';e.undo_status='done';restored++;
          if(e.action!=='dealt')state.journal.reviews.push({rule:e.rule,policy:state.journal.reviews.findLast(x=>x.rule===e.rule)?.policy||'',at:now.toISOString(),reviewed:1,rejected:1,complete:false});}
        }catch{e.undo_status='retry';}
        next++; // counted as acted on BEFORE any save, same rule as cleanup
        if(Date.now()-saved>=batch.ms){await persist(state);saved=Date.now();}
      }
    }finally{
      // Entries not reached were never touched: put them back as they were before this undo started.
      for(const e of group.slice(next)){if(before.get(e)===undefined)delete e.undo_status;else e.undo_status=before.get(e);}
      await persist(state);
    }
  }if(!todo.length)await persist(state);return {restored};
}
export function updateDigest(state,m,v,c,now){
  const d=state.digest,known=(d.items||[]).some(i=>i.gmailId===m.gmailId||(!i.gmailId&&i.uid===m.uid));
  const errors={model_unavailable:'Model unavailable; left in place',model_not_configured:'Model not configured; left in place',invalid_output:'Invalid model output; left in place',body_unavailable:'Body unavailable; left in place'};
  const safe={uid:m.uid,gmailId:m.gmailId,msgid:m.msgid||null,date:m.date,from:m.from||'',fromAddr:m.fromAddr||'',subject:m.subject||'',category:v.category,action:v.action===true,...readEvidence(m),reason:v.rule?'Cleanup rule '+v.rule:(v.category==='other'?'Unsorted':'Keep signal'),reason_en:v.rule?'Cleanup rule '+v.rule:(v.category==='other'?'Unsorted':'Keep signal')};
  if(Object.hasOwn(errors,v.classification_status)){safe.classification_status=v.classification_status;safe.reason=safe.reason_en=errors[v.classification_status];}
  d.items=[safe,...d.items.filter(i=>i.gmailId!==m.gmailId&&(i.gmailId||i.uid!==m.uid))].sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,c.keep_items);
  if(!known&&m.uid>(d.lastUid||0))d.total_classified=Number(d.total_classified||0)+1;
  d.lastUid=Math.max(d.lastUid||0,m.uid);
  d.updated_at=now.toISOString();d.keep_items=c.keep_items;
}
export async function runCycle({config,state,mailbox,persist,approval=null,undoRequests=[],dealtRequests=[],now=new Date(),force=false,backfill=false,phase='all',digestDecisions=new Map(),sortingFailed=false,evaluate=async m=>decide(m,config,now),signal=null,deadline=Infinity,clock=Date.now}){
  const externalSignal=signal;signal={get aborted(){return externalSignal?.aborted||clock()>=deadline;}};
  const c=settings(config);if(!c.enabled)return {skipped:'disabled'};
  if(signal.aborted)return {skipped:externalSignal?.aborted?'cancelled':'budget',sorted:false};
  const scanAfter=state.runtime.scanAfter||0;
  const all=[],decisions=digestDecisions;
  const classifyDigest=async m=>{
    if(decisions.has(m.gmailId))return decisions.get(m.gmailId);
    let v=await evaluate(m);
    const queued=dealtRequests.flatMap(r=>r.items||[]).find(x=>x.gmailId===m.gmailId&&state.digest.items.some(i=>i.gmailId===x.gmailId&&i.category===x.category));
    if(queued)v={...v,category:queued.category};
    const label=c.categories.find(x=>x.key===v.category);
    // Dealt owns this message's category label, including an explicit Undo; a scan must not re-add it.
    const dealtOwned=state.journal.runs.some(r=>r.kind==='dealt'&&r.entries.some(e=>e.gmailId===m.gmailId));
    if(!signal?.aborted&&label&&label.key!=='other'&&!protectedReason(m,c)&&!quarantined(state,m.gmailId)&&!dealtOwned&&!queued)await mailbox.addLabel(m.gmailId,c.label_prefix+label.label);
    updateDigest(state,m,v,c,now);decisions.set(m.gmailId,v);return v;
  };
  // Intake gets its own bounded share; a sort failure must never suppress Undo or approved work.
  if(phase!=='work'){
    const sortDeadline=phase==='all'&&Number.isFinite(deadline)?clock()+(deadline-clock())/2:deadline;
    try{
      const fresh=await mailbox.scan({after:state.digest.lastUid||0,expectedUidValidity:state.runtime.uidValidity,limit:c.max_per_run,primaryOnly:c.primary_only});
      if(fresh.reset){state.digest.lastUid=0;state.runtime.scanAfter=0;state.digest.total_is_floor=true;}
      for(const m of fresh.messages){if(signal.aborted||clock()>=sortDeadline){sortingFailed=true;break;}try{await classifyDigest(m);}catch{sortingFailed=true;break;}}
      state.runtime.uidValidity=fresh.uidValidity;
    }catch{sortingFailed=true;}
    if(!sortingFailed&&!signal.aborted)state.digest.updated_at=now.toISOString();
    await persist(state);
    if(phase==='sort')return {sorted:!sortingFailed&&!signal.aborted,skipped:sortingFailed?'sorting incomplete':signal.aborted?'budget':undefined};
  }
  if(state.runtime.afterAuto){state.proposal=state.runtime.afterAuto;delete state.runtime.afterAuto;await persist(state);}
  for(const req of undoRequests)await undoRun({state,runId:req.run_id||state.journal.runs.find(r=>r.dealt_request_id===req.dealt_request_id)?.id,mailbox,persist,now,signal});
  if(signal?.aborted)return {skipped:clock()>=deadline?'budget':'cancelled'}; // cancelled during Undo: do not start the approval
  await applyDealt({config:c,state,requests:dealtRequests.filter(r=>!undoRequests.some(u=>u.dealt_request_id===r.id)),mailbox,persist,now,signal});
  if(signal?.aborted)return {skipped:clock()>=deadline?'budget':'cancelled'};
  for(const run of state.journal.runs.filter(r=>r.approved_items&&!r.resume_cancelled&&['running','in_progress','cancelled'].includes(r.status))){
    await applyApproval({config:c,state,mailbox,persist,now,evaluate,signal,deadline,clock,resumeRun:run});
    if(run.status==='in_progress')return {skipped:clock()>=deadline?'budget':'continuing'};
  }
  await applyApproval({config:c,state,approval,mailbox,persist,now,evaluate,signal,deadline,clock});
  if(state.journal.runs.some(r=>r.status==='in_progress'&&!r.resume_cancelled))return {skipped:clock()>=deadline?'budget':'continuing'};
  if(signal?.aborted)return {skipped:clock()>=deadline?'budget':'cancelled'};
  if(sortingFailed)return {skipped:'sorting incomplete',sorted:false};
  const outstanding=state.proposal&&!proposalConsumed(state.proposal,state.journal)?state.proposal:null;
  // Daily work must not replace an unapproved one-time batch with a smaller daily list.
  if(outstanding?.items.length&&((!backfill&&outstanding.review_mode==='primary_backfill')||(backfill&&outstanding.items.length>c.max_backfill)))return {skipped:'pending review',sorted:true};
  if(!force&&!backfill&&state.runtime.lastProposalAt&&Date.parse(now)-Date.parse(state.runtime.lastProposalAt)<c.frequency_hours*3600000)return {skipped:'cadence',sorted:true};
  if(!backfill){
  const page=await mailbox.scan({after:state.runtime.scanAfter||0,expectedUidValidity:state.runtime.uidValidity,limit:c.max_per_run,primaryOnly:c.primary_only});
  if(page.reset){state.runtime.scanAfter=0;state.digest.lastUid=0;state.digest.total_is_floor=true;}
  for(const m of page.messages){
    if(signal?.aborted)break;
    let v;try{v=await classifyDigest(m);}
    catch{break;}
    all.push(m);decisions.set(m.gmailId,v);state.runtime.scanAfter=m.uid;
  }
  state.runtime.uidValidity=page.uidValidity;
  if(page.done&&page.messages.every(m=>m.uid<=(state.runtime.scanAfter||0)))state.runtime.scanAfter=0;
  if(signal?.aborted){state.runtime.scanAfter=page.reset?0:scanAfter;await persist(state);return {skipped:clock()>=deadline?'budget':'cancelled'};}
  }
  // A separate descending unread walk reaches older candidates after newer pages.
  const review=mailbox.scanReview?await mailbox.scanReview({before:backfill?null:state.runtime.reviewBefore,limit:backfill?c.max_backfill:c.max_per_run,primaryOnly:backfill||c.primary_only}):{messages:all,done:true};
  const pending=[],retainedItems=[];
  if(outstanding)for(const x of outstanding.items){
    if(signal.aborted)break;
    try{const m=await mailbox.get(x.gmailId);if(m?.inInbox&&m.seen===false)pending.push(m);else if(!m)retainedItems.push({...x,unread:undefined,lookup_pending:true});}
    catch{retainedItems.push({...x,unread:undefined,lookup_pending:true});}
  }
  if(signal?.aborted){await persist(state);return {skipped:'budget',sorted:true};}
  const p=await makeProposal({messages:[...pending,...review.messages],config:c,state,backfill,pendingIds:pending.map(m=>m.gmailId),retainedItems,now,evaluate:async m=>decisions.get(m.gmailId)||evaluate(m)});
  // Do not advance past candidates displaced by a still-pending batch.
  if(!backfill&&!pending.length&&!retainedItems.length)state.runtime.reviewBefore=review.done?null:review.next;
  await persist(state);
  const eligible=p.items.filter(x=>!x.lookup_pending&&autoEligible(c,x.rule,state.journal.reviews,now));
  // Automated reviews never add clean-history evidence; only human approval can establish eligibility.
  if(eligible.length){const manual=p.items.filter(x=>!eligible.includes(x));state.runtime.afterAuto={...p,id:randomUUID(),items:manual,revision:fingerprint({policy:p.policy,items:manual})};await persist(state);state.proposal={...p,items:eligible};state.proposal.revision=fingerprint({policy:p.policy,items:eligible});await persist(state);await applyApproval({config:c,state,approval:{proposal_id:p.id,revision:state.proposal.revision,selected:eligible.map(x=>x.gmailId)},mailbox,persist,now,evaluate,recordReview:false,signal,deadline,clock});state.proposal=state.runtime.afterAuto;delete state.runtime.afterAuto;await persist(state);}
  return {proposed:p.items.length};
}
