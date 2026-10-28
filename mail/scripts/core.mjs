import {randomUUID} from 'node:crypto';
import {settings,RULE_IDS} from './settings.mjs';
import {decide,policyHash,fingerprint,DAY,protectedReason,address} from './rules.mjs';
export const emptyState=()=>({digest:{items:[],lastUid:0,total_classified:0,total_is_floor:true},runtime:{scanAfter:0,lastProposalAt:null},proposal:null,journal:{runs:[],reviews:[]}});
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
const item=(m,v,c)=>({gmailId:m.gmailId,uid:m.uid,msgid:m.msgid||null,from:m.from||'',subject:m.subject||'',date:m.date,rule:v.rule,reason:v.reason,action:c.rules[v.rule].action});
export async function makeProposal({messages,config,state,now=new Date(),evaluate=async m=>decide(m,config,now)}){
  const c=settings(config),items=[];const unique=new Set();
  for(const m of messages){if(unique.has(m.gmailId)||quarantined(state,m.gmailId))continue;unique.add(m.gmailId);const v=await evaluate(m);if(v.rule)items.push(item(m,v,c));}
  const proposal={id:randomUUID(),created_at:now.toISOString(),policy:policyHash(c),items};
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
export async function applyApproval({config,state,approval,mailbox,persist,now=new Date(),recordReview=true,evaluate=async m=>decide(m,config,now),signal=null,batch=BATCH}){
  const c=settings(config),p=state.proposal; if(!c.enabled||!p||!approval)return {applied:0,skipped:'no approval'};
  if(approval.proposal_id!==p.id||approval.revision!==p.revision||p.policy!==policyHash(c)||!Array.isArray(approval.selected)||approval.selected.some(x=>!p.items.some(i=>i.gmailId===x))||new Set(approval.selected).size!==approval.selected.length)return {applied:0,skipped:'stale approval'};
  if(state.journal.runs.some(r=>r.proposal_id===p.id))return {applied:0,skipped:'consumed'};
  if(signal?.aborted)return {applied:0,skipped:'cancelled'}; // a cancelled wake must not record a run or use up the approval
  const run={id:randomUUID(),proposal_id:p.id,at:now.toISOString(),selected_count:approval.selected.length,entries:[],status:'running'};
  state.journal.runs.push(run);const chosen=new Set(approval.selected);
  if(recordReview)for(const id of RULE_IDS){const group=p.items.filter(x=>x.rule===id);if(group.length)state.journal.reviews.push({run_id:run.id,rule:id,policy:ruleHash(c,id),at:now.toISOString(),reviewed:group.length,rejected:group.filter(x=>!chosen.has(x.gmailId)).length,complete:false});}
  await persist(state);
  const todo=p.items.filter(x=>chosen.has(x.gmailId));let at=0,notReached=0;
  while(at<todo.length&&!signal?.aborted){
    const group=[],started=Date.now();
    for(;at<todo.length&&group.length<batch.size&&(!group.length||Date.now()-started<batch.ms)&&!signal?.aborted;at++){
      const x=todo[at];if(quarantined(state,x.gmailId))continue;
      let m,v;try{m=await mailbox.get(x.gmailId);v=m?await evaluate(m):null;}catch{continue;}
      if(!m||v?.rule!==x.rule||c.rules[x.rule].action!==x.action||!c.rules[x.rule].enabled)continue;
      const entry={gmailId:x.gmailId,rule:x.rule,action:x.action,label:`${c.label_prefix}Cleaned/${x.rule}`,at:now.toISOString(),status:'intent',originalLabels:[...m.labels],hadCleanLabel:m.labels.includes(`${c.label_prefix}Cleaned/${x.rule}`)};
      run.entries.push(entry);group.push(entry);
    }
    if(!group.length)continue;
    await persist(state); // every intent in this group is durable before the first mailbox change
    let saved=Date.now(),next=0;
    try{
      while(next<group.length&&!signal?.aborted){
        const entry=group[next];
        try{await mailbox.addLabel(entry.gmailId,entry.label);await mailbox[entry.action](entry.gmailId);entry.status='done';}
        catch{entry.status='uncertain';} // journal retains intent; never blindly replay a partially applied mutation
        next++; // counted as acted on BEFORE any save, so a failing save can never drop the record of a changed email
        if(Date.now()-saved>=batch.ms){await persist(state);saved=Date.now();}
      }
    }finally{
      // Only entries never attempted (cancel) are dropped: they were not touched, so they must not stay as intents.
      const untouched=new Set(group.slice(next));if(untouched.size){run.entries=run.entries.filter(e=>!untouched.has(e));notReached+=untouched.size;}
      await persist(state); // failed or cancelled runs still keep the progress already made
    }
  }
  notReached+=todo.length-at;
  if(signal?.aborted){
    if(!run.entries.length){ // cancelled before changing anything: leave no trace, the approval stays usable
      state.journal.runs=state.journal.runs.filter(r=>r!==run);state.journal.reviews=state.journal.reviews.filter(r=>r.run_id!==run.id);
      await persist(state);return {applied:0,skipped:'cancelled'};
    }
    run.status='cancelled';run.not_reached_count=notReached;
  }else run.status='finished';
  run.skipped_count=chosen.size-run.entries.length-notReached;
  for(const review of state.journal.reviews.filter(x=>x.run_id===run.id)){const selected=p.items.filter(x=>x.rule===review.rule&&chosen.has(x.gmailId));review.complete=selected.every(x=>run.entries.some(e=>e.gmailId===x.gmailId&&e.status==='done'));}
  // Do not discard incomplete operations. Older completed runs retain Gmail cleanup labels for manual restoration.
  // Dealt queue requests remain append-only: their consumption records must outlive cleanup log pruning.
  const completed=state.journal.runs.filter(r=>r.status==='finished'&&r.kind!=='dealt');
  if(completed.length>c.log_runs){const drop=new Set(completed.slice(0,completed.length-c.log_runs).filter(r=>r.entries.every(e=>e.status==='undone'||(e.status==='done'&&!e.undo_status))).map(r=>r.id));state.journal.runs=state.journal.runs.filter(r=>!drop.has(r.id));}
  state.journal.reviews=state.journal.reviews.filter(r=>Date.parse(now)-Date.parse(r.at)<400*DAY);
  await persist(state);return {applied:run.entries.filter(x=>x.status==='done').length};
}
export async function undoRun({state,runId,mailbox,persist,now=new Date(),signal=null,batch=BATCH}){
  const run=state.journal.runs.find(x=>x.id===runId);if(!run)return {restored:0};let restored=0;
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
  }return {restored};
}
export function updateDigest(state,m,v,c,now){
  const d=state.digest,known=(d.items||[]).some(i=>i.gmailId===m.gmailId||(!i.gmailId&&i.uid===m.uid));
  const errors={model_unavailable:'Model unavailable; left in place',model_not_configured:'Model not configured; left in place',invalid_output:'Invalid model output; left in place',body_unavailable:'Body unavailable; left in place'};
  const safe={uid:m.uid,gmailId:m.gmailId,msgid:m.msgid||null,date:m.date,from:m.from||'',fromAddr:m.fromAddr||'',subject:m.subject||'',category:v.category,action:v.action===true,reason:v.rule?'Cleanup rule '+v.rule:(v.category==='other'?'Unsorted':'Keep signal'),reason_en:v.rule?'Cleanup rule '+v.rule:(v.category==='other'?'Unsorted':'Keep signal')};
  if(Object.hasOwn(errors,v.classification_status)){safe.classification_status=v.classification_status;safe.reason=safe.reason_en=errors[v.classification_status];}
  d.items=[safe,...d.items.filter(i=>i.gmailId!==m.gmailId&&(i.gmailId||i.uid!==m.uid))].sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,c.keep_items);
  if(!known&&m.uid>(d.lastUid||0))d.total_classified=Number(d.total_classified||0)+1;
  d.lastUid=Math.max(d.lastUid||0,m.uid);
  d.updated_at=now.toISOString();d.keep_items=c.keep_items;
}
export async function runCycle({config,state,mailbox,persist,approval=null,undoRequests=[],dealtRequests=[],now=new Date(),force=false,backfill=false,evaluate=async m=>decide(m,config,now),signal=null}){
  const c=settings(config);if(!c.enabled)return {skipped:'disabled'};
  if(state.runtime.afterAuto){state.proposal=state.runtime.afterAuto;delete state.runtime.afterAuto;await persist(state);}
  for(const req of undoRequests)await undoRun({state,runId:req.run_id||state.journal.runs.find(r=>r.dealt_request_id===req.dealt_request_id)?.id,mailbox,persist,now,signal});
  if(signal?.aborted)return {skipped:'cancelled'}; // cancelled during Undo: do not start the approval
  await applyDealt({config:c,state,requests:dealtRequests.filter(r=>!undoRequests.some(u=>u.dealt_request_id===r.id)),mailbox,persist,now,signal});
  if(signal?.aborted)return {skipped:'cancelled'};
  await applyApproval({config:c,state,approval,mailbox,persist,now,evaluate,signal});
  if(signal?.aborted)return {skipped:'cancelled'};
  if(!force&&state.runtime.lastProposalAt&&Date.parse(now)-Date.parse(state.runtime.lastProposalAt)<c.frequency_hours*3600000)return {skipped:'cadence'};
  const page=await mailbox.scan({after:state.runtime.scanAfter||0,expectedUidValidity:state.runtime.uidValidity,limit:backfill?c.max_backfill:c.max_per_run,primaryOnly:c.primary_only});
  if(page.reset){state.runtime.scanAfter=0;state.digest.lastUid=0;state.digest.total_is_floor=true;}
  const pending=new Map((state.proposal?.items||[]).filter(x=>!state.journal.runs.some(r=>r.proposal_id===state.proposal.id)).map(x=>[x.gmailId,x]));
  const all=[],decisions=new Map();
  // Revalidate pending items; proposals never derive from the capped digest.
  for(const id of pending.keys()){try{const m=await mailbox.get(id);if(m)all.push(m);}catch{/* unknown stays */}}
  const classifyDigest=async m=>{
    const v=await evaluate(m),label=c.categories.find(x=>x.key===v.category);
    // Dealt owns this message's category label, including an explicit Undo; a scan must not re-add it.
    const dealtOwned=state.journal.runs.some(r=>r.kind==='dealt'&&r.entries.some(e=>e.gmailId===m.gmailId));
    if(label&&label.key!=='other'&&!protectedReason(m,c)&&!quarantined(state,m.gmailId)&&!dealtOwned)await mailbox.addLabel(m.gmailId,c.label_prefix+label.label);
    updateDigest(state,m,v,c,now);return v;
  };
  for(const m of page.messages){
    let v;try{v=await classifyDigest(m);}
    catch{break;}
    all.push(m);decisions.set(m.gmailId,v);state.runtime.scanAfter=m.uid;
  }
  state.runtime.uidValidity=page.uidValidity;
  if(page.done&&page.messages.every(m=>m.uid<=(state.runtime.scanAfter||0)))state.runtime.scanAfter=0;
  // A historical cleanup sweep must not starve the legacy digest's incremental intake.
  // Keep its cursor and proposal unchanged; the extra digest page is independently bounded.
  if(!page.done&&(state.digest.lastUid||0)>(state.runtime.scanAfter||0)){
    const fresh=await mailbox.scan({after:state.digest.lastUid,expectedUidValidity:page.uidValidity,limit:c.max_per_run,primaryOnly:c.primary_only});
    if(fresh.reset)throw Error('Mailbox UID validity changed during digest scan');
    for(const m of fresh.messages){try{await classifyDigest(m);}catch{break;}}
  }
  const latest=[...new Map(all.map(m=>[m.gmailId,m])).values()];
  const p=await makeProposal({messages:latest,config:c,state,now,evaluate:async m=>decisions.has(m.gmailId)?decisions.get(m.gmailId):evaluate(m)});await persist(state);
  const eligible=p.items.filter(x=>autoEligible(c,x.rule,state.journal.reviews,now));
  // Automated reviews never add clean-history evidence; only human approval can establish eligibility.
  if(eligible.length){const manual=p.items.filter(x=>!eligible.includes(x));state.runtime.afterAuto={...p,id:randomUUID(),items:manual,revision:fingerprint({policy:p.policy,items:manual})};await persist(state);state.proposal={...p,items:eligible};state.proposal.revision=fingerprint({policy:p.policy,items:eligible});await persist(state);await applyApproval({config:c,state,approval:{proposal_id:p.id,revision:state.proposal.revision,selected:eligible.map(x=>x.gmailId)},mailbox,persist,now,evaluate,recordReview:false});state.proposal=state.runtime.afterAuto;delete state.runtime.afterAuto;await persist(state);}
  return {proposed:p.items.length};
}
