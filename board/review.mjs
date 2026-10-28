import {mailKey,mailboxOf} from '../mail/scripts/mailbox-key.mjs';
import {settings} from '../mail/scripts/settings.mjs';
export const RULE_NAMES={O1:'One-time codes',O2:'Shipping notices',O3:'Past events',O4:'Promotions',O5:'Newsletters',O6:'Social and app notices',O7:'Routine security alerts'};
const PATHS={proposal:'mail/cleanup-proposal.json',journal:'mail/cleanup-log.json',approval:'mail/cleanup-approval.json',undo:'mail/cleanup-undo.json'};
export class ReviewController {
  constructor(io){this.io=io;this.selected=new Set();this.data={proposal:null,journal:{runs:[]},approval:null,undo:{requests:[]}};this.shas={};}
  async load(){const loaded=await Promise.all(Object.entries(PATHS).map(async([k,p])=>[k,await this.io.get(p,true)]));for(const[k,r]of loaded){this.data[k]=r.data||({journal:{runs:[]},undo:{requests:[]}}[k]??null);this.shas[k]=r.sha;}const p=this.data.proposal;if(this.selectionRevision!==p?.revision){this.selected=new Set((p?.items||[]).map(mailKey));this.selectionRevision=p?.revision;}return this.data;}
  setItem(id,on){if(on)this.selected.add(id);else this.selected.delete(id);}
  setRule(rule,on){for(const x of this.data.proposal?.items||[])if(x.rule===rule)this.setItem(mailKey(x),on);}
  get queued(){return this.data.approval?.proposal_id===this.data.proposal?.id&&this.data.approval?.revision===this.data.proposal?.revision;}
  get consumed(){const p=this.data.proposal;return !!p&&p.items.length>0&&[...new Set(p.items.map(mailboxOf))].every(key=>this.data.journal.runs.some(r=>r.proposal_id===p.id&&mailboxOf(r)===key));}
  async approve(){
    const p=this.data.proposal;if(!p||this.queued||this.consumed)throw Error('Refresh the review list.');
    const latest=await this.io.get(PATHS.proposal,true);if(latest.data?.id!==p.id||latest.data?.revision!==p.revision)throw Error('The review list changed. Refresh before approving.');
    const data={proposal_id:p.id,revision:p.revision,selected:p.items.filter(x=>this.selected.has(mailKey(x))).map(mailKey),reviewed_at:new Date().toISOString()};
    await this.io.put(PATHS.approval,data,this.shas.approval,'mail: approve reviewed selection');this.data.approval=data;
  }
  async undo(runId){
    const latest=await this.io.get(PATHS.undo,true),data=latest.data||{requests:[]};if(!data.requests.some(x=>x.run_id===runId))data.requests.push({run_id:runId,requested_at:new Date().toISOString()});
    await this.io.put(PATHS.undo,data,latest.sha,'mail: request undo');this.data.undo=data;
  }
  async protect(sender){const config=settings(this.io.getConfig()),address=String(sender).match(/<([^>]+)>/)?.[1]||String(sender);if(!address.includes('@')||/[\r\n]/.test(address))throw Error('Invalid sender');if(!config.protected.senders.includes(address.toLowerCase()))config.protected.senders.push(address.toLowerCase());await this.io.saveConfig(config);}
}
export function undoStatus(run,requests,now=Date.now()){
  const entries=run.entries||[];
  if(entries.length&&entries.every(e=>e.status==='undone'))return 'Restored';
  if(entries.some(e=>e.undo_status==='retry'||e.undo_status==='missing'))return 'Needs retry or manual check';
  if(entries.length&&entries.every(e=>e.status==='undone'||(e.action==='trash'&&now-Date.parse(e.at)>=30*86400000)))return 'Trash undo expired';
  if(requests.some(x=>x.run_id===run.id))return 'Undo queued';
  return 'Undo';
}
