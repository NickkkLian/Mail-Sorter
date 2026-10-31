// Shared state stays in the existing files. Each core cycle receives only one mailbox's state.
// Missing mailbox fields are legacy primary records. Unknown scopes never gain mutation authority.
import {randomUUID} from 'node:crypto';
import {emptyState} from './core.mjs';
import {fingerprint} from './rules.mjs';
import {mailboxOf,mailKey} from './mailbox-key.mjs';
export {mailboxOf,mailKey} from './mailbox-key.mjs';
const proposalMeta=p=>Object.fromEntries(Object.entries(p).filter(([k])=>!['items','scopes'].includes(k)));
const belongs=(x,key)=>mailboxOf(x)===key;
const tagged=(x,key,address)=>({...x,mailbox:key,...(address?{mailbox_address:address}:{})});
export function scopeState(shared,key){
 const s=emptyState(),old=key==='primary'?shared.runtime:{};
 s.runtime=structuredClone(shared.runtime.mailboxes?.[key]||Object.fromEntries(Object.entries(old).filter(([k])=>k!=='mailboxes')));
 const counters=shared.digest.mailboxes?.[key]||(key==='primary'?shared.digest:{});
 s.digest={...s.digest,...structuredClone(counters),items:structuredClone(shared.digest.items.filter(x=>belongs(x,key)))};
 s.journal={runs:structuredClone(shared.journal.runs.filter(x=>belongs(x,key))),reviews:structuredClone(shared.journal.reviews.filter(x=>belongs(x,key)))};
 s.proposal=shared.proposal?{...structuredClone(shared.proposal.scopes?.[key]||proposalMeta(shared.proposal)),items:structuredClone(shared.proposal.items.filter(x=>belongs(x,key)))}:null;
 return s;
}
export function mergeState(shared,s,key,address,newProposal=false){
 const replace=(old,rows)=>[...old.filter(x=>!belongs(x,key)),...rows.map(x=>tagged(x,key,address))];
 shared.journal.runs=replace(shared.journal.runs,s.journal.runs);shared.journal.reviews=replace(shared.journal.reviews,s.journal.reviews);
 shared.runtime.mailboxes||={};shared.runtime.mailboxes[key]={...s.runtime,account:address};
 // Keep legacy primary cursor mirrors for older read-only tools; runner authority is per mailbox.
 if(key==='primary')Object.assign(shared.runtime,s.runtime);
 if(!shared.digest.mailboxes){const {items,...legacy}=shared.digest;shared.digest.mailboxes={primary:legacy};}
 const {items,...counter}=s.digest;delete counter.mailboxes;
 shared.digest.mailboxes[key]=counter;
 shared.digest.items=replace(shared.digest.items,items).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
 shared.digest.total_classified=Object.values(shared.digest.mailboxes).reduce((n,d)=>n+Number(d.total_classified||0),0);
 shared.digest.total_is_floor=true;shared.digest.updated_at=s.digest.updated_at||shared.digest.updated_at;
 shared.digest.keep_items=Object.values(shared.digest.mailboxes).reduce((n,d)=>n+Number(d.keep_items||0),0);
 if(key==='primary')shared.digest.lastUid=s.digest.lastUid;
  if(s.proposal){
    const previous=shared.proposal,oldItems=(previous?.items||[]).filter(x=>belongs(x,key)),items=replace(previous?.items||[],s.proposal.items);
    const scopes=structuredClone(previous?.scopes||Object.fromEntries(['primary','secondary'].map(k=>[k,proposalMeta(previous||s.proposal)])));
    scopes[key]=proposalMeta(s.proposal);
    // An empty sibling refresh does not replace another account's batch, mode, timestamp or identity.
    const changed=newProposal&&(oldItems.length>0||s.proposal.items.length>0),base=changed?s.proposal:(previous||s.proposal);
    const active=Object.fromEntries(Object.entries(scopes).filter(([k])=>items.some(x=>belongs(x,k))));
    const revision=fingerprint({policy:base.policy,items,scopes:active});
    shared.proposal={...proposalMeta(base),id:previous&&!changed?previous.id:previous?randomUUID():s.proposal.id,revision,items,scopes};
    delete shared.proposal.review_mode;
    if(Object.values(active).some(p=>p.review_mode==='primary_backfill'))shared.proposal.review_mode='primary_backfill';
  }
}
export function scopeApproval(approval,proposal,key){
 if(!approval||!proposal||approval.proposal_id!==proposal.id||approval.revision!==proposal.revision||!Array.isArray(approval.selected))return null;
 // Validate against the full aggregate before partitioning: malformed/unknown IDs are never dropped silently.
 if(approval.selected.some(id=>!proposal.items.some(x=>mailKey(x)===id))||new Set(approval.selected).size!==approval.selected.length)return null;
 const scoped=proposal.scopes?.[key]||proposal;
 return {...approval,proposal_id:scoped.id,revision:scoped.revision,selected:proposal.items.filter(x=>belongs(x,key)&&approval.selected.includes(mailKey(x))).map(x=>x.gmailId)};
}
export function scopeDealt(requests,key){return requests.filter(r=>Array.isArray(r?.items)&&r.items.length<=150).map(r=>({...r,items:r.items.filter(x=>belongs(x,key))})).filter(r=>r.items.length);}
