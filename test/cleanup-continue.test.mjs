import '../scripts/offline-guard.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {settings} from '../mail/scripts/settings.mjs';
import {emptyState,makeProposal,applyApproval,runCycle,undoRun} from '../mail/scripts/core.mjs';
import {message,NOW} from '../eval/synthetic.mjs';
async function setup(){
 const config=settings({enabled:true}),now=new Date(NOW),state=emptyState(),data=new Map(Array.from({length:8},(_,i)=>{const m=message({uid:i+1,gmailId:String(9000+i),subject:'Verification code'});return [m.gmailId,m];})),calls=[];
 let tick=0,saved;
 const mailbox={markRead:async id=>{data.get(id).seen=true;},markUnread:async id=>{data.get(id).seen=false;},
    get:async id=>structuredClone(data.get(id)),addLabel:async(id,l)=>data.get(id).labels.push(l),archive:async id=>{data.get(id).inInbox=false;calls.push(id);tick+=10;},restore:async id=>{data.get(id).inInbox=true;},removeLabel:async(id,l)=>{data.get(id).labels=data.get(id).labels.filter(x=>x!==l);},scan:async()=>{throw Error('must not scan while pending');}};
 await makeProposal({messages:[...data.values()],config,state,now});
 const approval={proposal_id:state.proposal.id,revision:state.proposal.revision,selected:[...data.keys()]};
 const persist=async s=>{saved=structuredClone(s);};
 return {config,now,state,data,calls,mailbox,approval,persist,clock:()=>tick,reload:()=>structuredClone(saved)};
}
test('budget stops normally, persists pending selection, rechecks on restart and Undo covers both runs',async()=>{
 const a=await setup();
 await applyApproval({...a,deadline:25});
 assert.equal(a.calls.length,3,'stop starting emails once the fake clock reaches the budget');
 assert.equal(a.state.journal.runs[0].status,'in_progress');
 a.state=a.reload();a.data.get('9003').inInbox=false; // changed since approval: must be skipped
 await runCycle({...a,approval:null,deadline:1000});
 assert.equal(a.calls.length,7);assert.equal(new Set(a.calls).size,7);
 const r=a.state.journal.runs[0];assert.equal(r.status,'finished');assert.equal(r.skipped_count,1);assert.equal(a.state.journal.runs.length,1);
 await undoRun({...a,runId:r.id});
 assert(a.calls.every(id=>a.data.get(id).inInbox));
});
test('cancellation and a hard-crash intent resume only untouched emails',async()=>{
 const a=await setup(),stop=new AbortController(),archive=a.mailbox.archive;
 a.mailbox.archive=async id=>{await archive(id);stop.abort();};
 await applyApproval({...a,signal:stop.signal});
 assert.equal(a.state.journal.runs[0].status,'in_progress');
 a.state=a.reload();a.state.journal.runs[0].entries[0].status='intent';a.mailbox.archive=archive;
 await runCycle({...a,approval:null});
 assert.equal(a.calls.length,8);assert.equal(new Set(a.calls).size,8);assert.equal(a.state.journal.runs[0].entries[0].status,'intent');
});
test('Undo during continuation cancels pending work durably',async()=>{
 const a=await setup();await applyApproval({...a,deadline:15});const id=a.state.journal.runs[0].id;
 await undoRun({...a,runId:id});a.state=a.reload();
 await runCycle({...a});assert.equal(a.calls.length,2);assert(a.calls.every(id=>a.data.get(id).inInbox));
});
test('legacy cancelled approval resumes with original selection and original run ID',async()=>{
 const a=await setup();await applyApproval({...a,deadline:15});const r=a.state.journal.runs[0],id=r.id;
 delete r.approved_items;delete r.policy;delete r.skipped_ids;r.status='cancelled';
 await runCycle({...a});assert.equal(a.calls.length,8);assert.equal(a.state.journal.runs[0].id,id);
});
test('changed permissions stop continuation without touching pending mail',async()=>{
 const a=await setup();await applyApproval({...a,deadline:15});
 a.config=settings({...a.config,protected:{...a.config.protected,senders:['keep@sender.example']}});
 await runCycle({...a});assert.equal(a.calls.length,2);assert.equal(a.state.journal.runs[0].status,'permissions_changed');
});
test('slow recheck crossing deadline starts no mutation and stays pending',async()=>{
 const a=await setup();let tick=0;a.clock=()=>tick;const get=a.mailbox.get;
 a.mailbox.get=async id=>{tick+=100;return get(id);};
 await applyApproval({...a,deadline:50});assert.equal(a.calls.length,0);assert.equal(a.state.journal.runs[0].not_reached_count,8);
});
test('CLI budget is a successful exit and persisted selection continues on next invocation',async()=>{
 const fs=await import('node:fs'),{main}=await import('../mail/scripts/classify.mjs');
 const a=await setup(),root=fs.mkdtempSync(new URL('../.tmp-continue-',import.meta.url));let tick=0,invocation=1;const lines=[];
 try{
  for(const [n,d] of Object.entries({'config.json':a.config,'mail.json':a.state.digest,'runtime.json':a.state.runtime,'cleanup-proposal.json':a.state.proposal,'cleanup-log.json':a.state.journal,'cleanup-approval.json':a.approval}))fs.writeFileSync(root+'/'+n,JSON.stringify(d));
  const archive=a.mailbox.archive;a.mailbox.archive=async id=>{await archive(id);tick+=60000;};
  const args={root,env:{ANTHROPIC_API_KEY:'synthetic-placeholder',RUN_BUDGET_MINUTES:'2',GMAIL_USER:'synthetic',GMAIL_APP_PASSWORD:'synthetic'},clock:()=>tick,connect:async()=>({...a.mailbox,scan:async()=>({messages:[],done:true,uidValidity:'1'}),close:async()=>{}}),output:line=>{lines.push(line);process.stderr.write(`[CLI invocation ${invocation}] ${line}\n`);}};
  assert.equal(await main(args),0);assert.equal(a.calls.length,2);
  assert.equal(JSON.parse(fs.readFileSync(root+'/cleanup-log.json')).runs[0].status,'in_progress');
  invocation=2;args.env.RUN_BUDGET_MINUTES='22';const secondExit=await main(args);process.stderr.write(`[CLI invocation 2] exit=${secondExit}\n`);const journal=JSON.parse(fs.readFileSync(root+'/cleanup-log.json'));process.stderr.write(`[CLI invocation 2] saved=${JSON.stringify(journal.runs.map(r=>({status:r.status,entries:r.entries.length,done:r.entries.filter(e=>e.status==='done').length})))}\n`);assert.equal(secondExit,0,lines.join('\n'));assert.equal(a.calls.length,8);assert.equal(new Set(a.calls).size,8);
  assert.equal(journal.runs.length,1);assert.equal(journal.runs[0].status,'finished');assert.equal(journal.runs[0].entries.filter(e=>e.status==='done').length,8);
  assert(lines.every(line=>!line.includes('model_requests')&&!line.includes('::error')),'completed archived mail must not trigger model calls');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
