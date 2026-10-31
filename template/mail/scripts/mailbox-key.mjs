// Browser-safe stable identity. Legacy unscoped items belong to primary only.
export const mailboxOf=x=>x?.mailbox===undefined?'primary':x.mailbox;
export const mailKey=x=>mailboxOf(x)==='primary'?String(x.gmailId):mailboxOf(x)+':'+x.gmailId;

// Scope identities survive aggregate saves and empty sibling proposals.
export const proposalIdFor=(proposal,key)=>proposal?.scopes?.[key]?.id||proposal?.id;
export function proposalConsumed(proposal,journal){
  if(!proposal?.items?.length)return false;
  const runs=(journal?.runs||[]).filter(r=>r.kind!=='dealt');
  return proposal.items.every(item=>runs.some(run=>mailboxOf(run)===mailboxOf(item)&&(
    run.proposal_id===proposalIdFor(proposal,mailboxOf(item))||
    (run.status==='finished'&&(run.approved_items||run.entries||[]).some(x=>x.gmailId===item.gmailId&&x.rule===item.rule&&x.action===item.action))
  )));
}
