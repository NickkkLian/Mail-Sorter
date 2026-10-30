// Runner state is saved in batches (one commit per batch), never one commit per email.
import {test} from 'node:test';
import {githubStore} from '../mail/scripts/storage.mjs';
import {settings} from '../mail/scripts/settings.mjs';
import {emptyState,makeProposal,applyApproval,undoRun,runCycle,BATCH} from '../mail/scripts/core.mjs';
import {message,NOW} from '../eval/synthetic.mjs';
const check=x=>{if(!x)throw Error('Batching expectation failed');};
const config=settings({enabled:true}),now=new Date(NOW),COUNT=60;
// A fake Contents API that records every commit (PUT) per file.
function fakeGitHub(){
  const files={},puts=[];
  const fetchImpl=async(url,init={})=>{
    const name=url.split('/').at(-1).split('?')[0];
    if(init.method!=='PUT'){const f=files[name];return {status:f?200:404,ok:!!f,json:async()=>f};}
    const b=JSON.parse(init.body);puts.push(name);files[name]={content:b.content,encoding:'base64',sha:'sha'+puts.length};
    return {ok:true,json:async()=>({content:{sha:files[name].sha}})};
  };
  const saved=name=>JSON.parse(Buffer.from(files[name].content,'base64').toString('utf8'));
  return {store:githubStore({repository:'owner/private-example',key:'synthetic-placeholder',fetchImpl}),puts,saved,count:name=>puts.filter(x=>x===name).length};
}
const persistTo=store=>async s=>{await store.write('cleanup-log.json',s.journal);await store.write('cleanup-proposal.json',s.proposal);await store.write('mail.json',s.digest);await store.write('runtime.json',s.runtime);};
async function setup(n=COUNT){
  const messages=Array.from({length:n},(_,i)=>message({uid:i+1,gmailId:String(2000+i),subject:'Verification code'}));
  const data=new Map(messages.map(m=>[m.gmailId,structuredClone(m)])),calls=[],hooks={before:async()=>{}};
  const mailbox={
    get:async id=>structuredClone(data.get(id)),
    addLabel:async(id,l)=>{await hooks.before('label',id);data.get(id).labels.push(l);},
    archive:async id=>{await hooks.before('archive',id);data.get(id).inInbox=false;calls.push(id);},
    removeLabel:async(id,l)=>{data.get(id).labels=data.get(id).labels.filter(x=>x!==l);},
    restore:async id=>{await hooks.before('restore',id);data.get(id).inInbox=true;calls.push('restore:'+id);}
  };
  const state=emptyState();await makeProposal({messages,config,state,now});
  const p=state.proposal,approval={proposal_id:p.id,revision:p.revision,selected:p.items.map(x=>x.gmailId)};
  return {state,approval,mailbox,data,calls,hooks};
}
test('approving 60 emails writes the journal in a few batches, not once or twice per email',async()=>{
  const gh=fakeGitHub(),{state,approval,mailbox,data}=await setup();
  await applyApproval({config,state,approval,mailbox,persist:persistTo(gh.store),now});
  check([...data.values()].filter(x=>!x.inInbox).length===COUNT);
  const log=gh.saved('cleanup-log.json');check(log.runs[0].entries.length===COUNT&&log.runs[0].entries.every(e=>e.status==='done')&&log.runs[0].status==='finished');
  // old behaviour: 2 commits per email (intent + result) = more than 120; now one run record + 2 per batch + final
  check(gh.count('cleanup-log.json')<=2+2*Math.ceil(COUNT/BATCH.size));
});
test('every intent is saved before its email is touched (batching keeps the crash-safety rule)',async()=>{
  const gh=fakeGitHub(),{state,approval,mailbox,hooks}=await setup(30);let checked=0;
  hooks.before=async(verb,id)=>{const e=gh.saved('cleanup-log.json').runs[0].entries.find(x=>x.gmailId===id);check(e&&e.status==='intent');checked++;};
  await applyApproval({config,state,approval,mailbox,persist:persistTo(gh.store),now});check(checked===60);
});
test('a cancelled run saves the finished emails and keeps untouched emails pending',async()=>{
  const gh=fakeGitHub(),{state,approval,mailbox,data,hooks}=await setup(30),stop=new AbortController();let archives=0;
  hooks.before=async verb=>{if(verb==='archive'&&++archives===5)stop.abort();};
  await applyApproval({config,state,approval,mailbox,persist:persistTo(gh.store),now,signal:stop.signal});
  const log=gh.saved('cleanup-log.json'),entries=log.runs[0].entries;
  check(entries.length===5&&entries.every(e=>e.status==='done')&&log.runs[0].status==='in_progress'&&log.runs[0].not_reached_count===25&&log.runs[0].skipped_count===0);
  check([...data.values()].filter(x=>!x.inInbox).length===5); // exactly the recorded five were archived
});
test('long batches are also saved on a timer',async()=>{
  const gh=fakeGitHub(),{state,approval,mailbox,hooks}=await setup(8);
  hooks.before=async()=>{await new Promise(r=>setTimeout(r,8));};
  await applyApproval({config,state,approval,mailbox,persist:persistTo(gh.store),now,batch:{size:25,ms:20}});
  check(gh.count('cleanup-log.json')>=6); // size alone would give 3
});
test('undo of 60 emails also saves in batches and a cancelled undo keeps its progress',async()=>{
  const gh=fakeGitHub(),{state,approval,mailbox,data,hooks}=await setup();
  await applyApproval({config,state,approval,mailbox,persist:async()=>{},now});const runId=state.journal.runs[0].id;
  await undoRun({state,runId,mailbox,persist:persistTo(gh.store),now});
  check([...data.values()].every(x=>x.inInbox)&&gh.count('cleanup-log.json')<=2*Math.ceil(COUNT/BATCH.size)+1);
  const again=await setup(30),stop=new AbortController();let restores=0;
  await applyApproval({config,state:again.state,approval:again.approval,mailbox:again.mailbox,persist:async()=>{},now});
  again.hooks.before=async verb=>{if(verb==='restore'&&++restores===4)stop.abort();};
  const gh2=fakeGitHub();await undoRun({state:again.state,runId:again.state.journal.runs[0].id,mailbox:again.mailbox,persist:persistTo(gh2.store),now,signal:stop.signal});
  const es=gh2.saved('cleanup-log.json').runs[0].entries;
  check(es.filter(e=>e.status==='undone').length===4&&es.every(e=>e.undo_status==='done'||e.undo_status===undefined));
});
test('the runner wires a cancel signal through: progress saved, cancelled message, non-zero exit',async()=>{
  const fs=await import('node:fs'),{main}=await import('../mail/scripts/classify.mjs');
  const {state,approval,mailbox,hooks}=await setup(10),root=fs.mkdtempSync(new URL('../.tmp-batch-',import.meta.url)),lines=[];let archives=0;
  try{
    const put=(n,d)=>fs.writeFileSync(root+'/'+n,JSON.stringify(d));
    put('config.json',config);put('mail.json',state.digest);put('runtime.json',state.runtime);put('cleanup-proposal.json',state.proposal);put('cleanup-log.json',state.journal);put('cleanup-approval.json',approval);
    hooks.before=async verb=>{if(verb==='archive'&&++archives===3)process.emit('SIGTERM');};
    const code=await main({root,env:{GMAIL_USER:'synthetic',GMAIL_APP_PASSWORD:'synthetic'},connect:async()=>({...mailbox,scan:async()=>({messages:[],done:true,uidValidity:'1'}),close:async()=>{}}),output:x=>lines.push(x)});
    const log=JSON.parse(fs.readFileSync(root+'/cleanup-log.json','utf8')).runs[0].entries;
    check(code===1&&lines.join().includes('cancelled')&&log.length===3&&log.every(e=>e.status==='done')&&archives===3);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('a failing timed save never drops the record of an email that was already changed',async()=>{
  const {state,approval,mailbox,data}=await setup(3);let n=0,remote=null,thrown=false;
  const persist=async s=>{n++;if(n===3)throw Error('409');remote=structuredClone(s.journal);};
  try{await applyApproval({config,state,approval,mailbox,persist,now,batch:{size:25,ms:0}});}catch{thrown=true;}
  const changed=[...data.values()].filter(x=>!x.inInbox).map(x=>x.gmailId),saved=remote.runs[0].entries.map(e=>e.gmailId);
  check(thrown&&changed.length>=1&&changed.every(id=>saved.includes(id)));
});
test('a failing timed save during Undo keeps the records of restored emails',async()=>{
  const {state,approval,mailbox,data}=await setup(3);await applyApproval({config,state,approval,mailbox,persist:async()=>{},now});
  let n=0,remote=null,thrown=false;const persist=async s=>{n++;if(n===3)throw Error('409');remote=structuredClone(s.journal);};
  try{await undoRun({state,runId:state.journal.runs[0].id,mailbox,persist,now,batch:{size:25,ms:0}});}catch{thrown=true;}
  const back=[...data.values()].filter(x=>x.inInbox).map(x=>x.gmailId),undone=remote.runs[0].entries.filter(e=>e.status==='undone'&&e.undo_status==='done').map(e=>e.gmailId);
  check(thrown&&back.length>=1&&back.every(id=>undone.includes(id)));
});
test('a cancel during Undo does not start the pending approval or use it up',async()=>{
  const a=await setup(3),stop=new AbortController();
  await applyApproval({config,state:a.state,approval:a.approval,mailbox:a.mailbox,persist:async()=>{},now});const runA=a.state.journal.runs[0].id;
  const more=Array.from({length:3},(_,i)=>message({uid:20+i,gmailId:String(6000+i),subject:'Verification code'}));
  for(const m of more)a.data.set(m.gmailId,structuredClone(m));
  await makeProposal({messages:more,config,state:a.state,now});const p=a.state.proposal,approvalB={proposal_id:p.id,revision:p.revision,selected:p.items.map(x=>x.gmailId)};
  a.hooks.before=async v=>{if(v==='restore')stop.abort();};
  const r=await runCycle({config,state:a.state,mailbox:a.mailbox,persist:async()=>{},approval:approvalB,undoRequests:[{run_id:runA}],now,signal:stop.signal});
  check(r.skipped==='cancelled'&&!a.state.journal.runs.some(x=>x.proposal_id===p.id));
  const again=await applyApproval({config,state:a.state,approval:approvalB,mailbox:a.mailbox,persist:async()=>{},now});
  check(again.applied===3);
});
test('a run cancelled before it changed anything leaves no run record and keeps the approval usable',async()=>{
  const {state,approval,mailbox}=await setup(3),stop=new AbortController();stop.abort();
  const r=await applyApproval({config,state,approval,mailbox,persist:async()=>{},now,signal:stop.signal});
  check(r.skipped==='cancelled'&&state.journal.runs.length===0);
  check((await applyApproval({config,state,approval,mailbox,persist:async()=>{},now})).applied===3);
});
