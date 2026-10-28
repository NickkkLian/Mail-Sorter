import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {settings} from './settings.mjs';
import {emptyState,runCycle} from './core.mjs';
import {connectMailbox} from './imap.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const read=(root,name,fallback)=>{const f=path.join(root,name);return fs.existsSync(f)?JSON.parse(fs.readFileSync(f,'utf8')):fallback;};
export function atomic(root,name,data){const f=path.join(root,name),temp=f+'.tmp';fs.mkdirSync(path.dirname(f),{recursive:true});const fd=fs.openSync(temp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(data,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,f);const dir=fs.openSync(path.dirname(f),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}}
export async function main({root=ROOT,env=process.env,connect=connectMailbox,output=console.log}={}){
  let lock,mailbox;
  // A cancelled workflow sends SIGINT then SIGTERM: stop between mailbox changes so the batch in hand is saved.
  const stop=new AbortController(),onSignal=()=>stop.abort();process.once('SIGINT',onSignal);process.once('SIGTERM',onSignal);
  try{
    let c=settings(read(root,'config.json',{}));
    if(env.DRY_RUN==='1'||!c.enabled){output('Skipped: disabled or dry run; no connections.');return 0;}
    const proposalOnly=env.DRY_RUN==='proposal';
    if(proposalOnly&&env.STATE_BACKEND==='github')throw Error('Dry proposals require local state');
    // Credentials are only consulted after the off switch. Values never enter output or persistence.
    if(!env.GMAIL_USER||!env.GMAIL_APP_PASSWORD){output('Skipped: mailbox not configured.');return 0;}
    lock=fs.openSync(path.join(root,'.runner.lock'),'wx',0o600);
    const store=env.STATE_BACKEND==='github'?(await import('./storage.mjs')).githubStore({repository:env.GITHUB_REPOSITORY,key:env.GITHUB_TOKEN}):{read:async(name,fallback)=>read(root,name,fallback),write:async(name,data)=>atomic(root,name,data)};
    c=settings(await store.read('config.json',c));if(!c.enabled){output('Skipped: disabled; no mailbox connection.');return 0;}
    const state=emptyState();state.digest=await store.read('mail.json',state.digest);state.runtime=await store.read('runtime.json',state.runtime);state.proposal=await store.read('cleanup-proposal.json',null);state.journal=await store.read('cleanup-log.json',state.journal);
    const persist=async s=>{await store.write('cleanup-log.json',s.journal);await store.write('cleanup-proposal.json',s.proposal);await store.write('mail.json',s.digest);await store.write('runtime.json',s.runtime);};
    // One-time migration seeds only protective settings from pre-existing metadata. No body is accessed.
    if(!state.runtime.protection_seeded){const {seedProtection}=await import('./core.mjs');const seeded=seedProtection(c,state.digest);if(JSON.stringify(seeded)!==JSON.stringify(c)){await store.write('config.json',seeded);c=seeded;}state.runtime.protection_seeded=true;await persist(state);}
    mailbox=await connect(c,env);
    const {createEvaluator,modelClassifier}=await import('./intelligence.mjs');let classify=null;
    const diagnostics={errors:0};
    if(!proposalOnly)try{classify=modelClassifier(env,{maxRetries:c.max_retries});}catch{diagnostics.errors++;diagnostics.config_errors=1;}
    // A proposal dry run reads metadata and writes local state, but never calls a model,
    // reads a body, labels, archives or restores mail, even with queued decisions.
    if(proposalOnly){
      c=settings({...c,read_bodies:false,approval_mode:'every_run',rules:Object.fromEntries(Object.entries(c.rules).map(([id,r])=>[id,{...r,auto:false}]))});
      const real=mailbox;mailbox=new Proxy(real,{get(target,key){
        if(key==='addLabel')return async()=>{};
        if(['archive','trash','restore','removeLabel','readBody','markRead','markUnread'].includes(key))return async()=>{throw Error('Mutation forbidden in proposal dry run');};
        const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
      }});classify=null;
    }
    const now=new Date(),evaluate=createEvaluator({config:c,mailbox,classify,now,diagnostics});
    const result=await runCycle({config:c,state,mailbox,persist,approval:proposalOnly?null:await store.read('cleanup-approval.json',null),undoRequests:proposalOnly?[]:(await store.read('cleanup-undo.json',{requests:[]})).requests,dealtRequests:proposalOnly?[]:(await store.read('dealt-queue.json',{requests:[]})).requests,force:proposalOnly||env.RUN_NOW==='1',backfill:env.BACKFILL==='1',evaluate,now,signal:stop.signal});
    if(stop.signal.aborted){output('Run cancelled; progress so far was saved.');return 1;}
    output(result.skipped?'Skipped: '+result.skipped:'Cycle complete. Proposed: '+result.proposed);
    if(!proposalOnly){output('Classification diagnostics: '+JSON.stringify(diagnostics));if(diagnostics.errors){output('::error title=Mail classification incomplete::Classification errors: '+diagnostics.errors+'; see fixed diagnostic counts.');return 1;}}
    return 0;
  }catch{output('Run stopped safely. Check configuration, dependencies, or runner lock; no sensitive error details retained.');return 1;}
  finally{process.off('SIGINT',onSignal);process.off('SIGTERM',onSignal);try{await mailbox?.close();}catch{/* never print provider/mailbox errors */}if(lock!==undefined){fs.closeSync(lock);fs.unlinkSync(path.join(root,'.runner.lock'));}}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=await main();
