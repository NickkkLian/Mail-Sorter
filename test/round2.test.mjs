import {test} from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {connectMailbox,decodeLabel} from '../mail/scripts/imap.mjs';
import {fake} from './helpers/fake-imap.mjs';
import {settings,DEFAULTS} from '../mail/scripts/settings.mjs';
import {decide,LEGACY_KEEP_LABELS} from '../mail/scripts/rules.mjs';
import {seedProtection,makeProposal,emptyState,applyApproval,runCycle} from '../mail/scripts/core.mjs';
import {createEvaluator} from '../mail/scripts/intelligence.mjs';
import {safeText} from '../mail/scripts/privacy.mjs';
import {main} from '../mail/scripts/classify.mjs';
import {FILES} from '../scripts/export.mjs';
import {message,NOW} from '../eval/synthetic.mjs';
const check=x=>{if(!x)throw Error('Round 2 safety expectation failed (data suppressed)');};
const now=new Date(NOW),config=settings({enabled:true}),env={GMAIL_USER:'synthetic-placeholder',GMAIL_APP_PASSWORD:'synthetic-placeholder'},id='9007199254740993001';
const temporary=()=>fs.mkdtempSync(new URL('../.tmp-round2-',import.meta.url));
const encodeLabel=s=>{const b=Buffer.from(s,'utf16le');return '&'+b.swap16().toString('base64').replace(/=/g,'').replace(/\//g,',')+'-';};
test('legacy action/job/finance/school/security labels protect mail matching O6; migration seeds action/job',async()=>{
  for(const label of LEGACY_KEEP_LABELS){const m=message({subject:'New message',tab:'updates',labels:[label]});check(decide(m,config,now).rule===null);const state=emptyState();await makeProposal({messages:[m],config,state,now});check(state.proposal.items.length===0);}
  const seeded=seedProtection(config,{items:[{category:'action',from:'person@action.example'},{category:'job',from:'recruiter@job.example'}]});check(seeded.protected.senders.length===2);
});
test('adapter normalizes UTF-8 and modified UTF-7 keep labels and derives needsReply from actual labels',async()=>{
  check(decodeLabel('AI/学校学术')==='AI/学校学术'&&decodeLabel('Research &- Design')==='Research & Design'&&decodeLabel('AI/&ZeVnLIqe-')==='AI/日本語');
  for(const encoded of [false,true])for(const label of LEGACY_KEEP_LABELS){const f=fake(),box=await connectMailbox(config,env,f.Client);f.record.labels=new Set([encoded?'AI/'+encodeLabel(label.slice(3)):label]);f.record.envelope.subject='New message';const m=await box.get(id);check(m.labels.includes(label)&&decide({...m,tab:'updates'},config,now).rule===null);check(m.needsReply===(label==='AI/重要待办'));await box.close();}
});
test('body download preserves originally unread/read flags on success and errors',async()=>{
  for(const seen of [false,true])for(const downloadError of [false,true]){const f=fake({seen,downloadError}),box=await connectMailbox(config,env,f.Client);try{await box.readBody(id);}catch{}check(f.flags.has('\\Seen')===seen);check(seen?!f.actions.includes('unseen'):f.actions.includes('unseen'));await box.close();}
});
test('received internal date overrides misleading sender date; header is fallback only',async()=>{
  const f=fake(),box=await connectMailbox(config,env,f.Client);f.record.internalDate=new Date(NOW);f.record.envelope.date=new Date('2020-01-01');let m=await box.get(id);check(m.date===NOW&&!decide(m,config,now).rule);delete f.record.internalDate;m=await box.get(id);check(m.date==='2020-01-01T00:00:00.000Z');delete f.record.envelope.date;m=await box.get(id);check(m.date===null&&!decide(m,config,now).rule);await box.close();
});
test('redaction handles full-width digits, query/fragment links, mixed tokens and CVV/CVC',()=>{
  const inputs=['４１１１ １１１１ １１１１ １１１１','https://service.example/reset?token=short#private','https://service.example/signin#short-secret','AbCdEfGh01234567TOKEN','CVV: 123','CVC 4567','security code 789','123 is your security code'];
  const forbidden=['４１１１','4111','?token','#private','#short-secret','AbCdEfGh','123','4567','789'];
  for(const value of inputs){const result=safeText(value);check(forbidden.every(x=>!result.includes(x)));}check(safeText('https://service.example/path?q=1').includes('https://service.example/path'));
});
test('evaluator never writes body text to console or any proposed reason',async()=>{
  const sentinel='FICTIONAL-BODY-PRIVACY-CANARY',m=message({subject:'Verification code'}),cfg={...config,read_bodies:true},state=emptyState();let logs=0;
  const original=console.log;console.log=()=>{logs++;};
  try{const evaluate=createEvaluator({config:cfg,mailbox:{readBody:async()=>sentinel},classify:async()=>({category:'other',action:false,cleanup:'agree'}),now});await makeProposal({messages:[m],config:cfg,state,now,evaluate});check(state.proposal.items.length===1&&!JSON.stringify(state).includes(sentinel)&&logs===0);}finally{console.log=original;}
});
test('enabled:false, without DRY_RUN, stops CLI before credentials, locks or connections',async()=>{
  const root=temporary();let connections=0,credentialReads=0;
  try{fs.writeFileSync(path.join(root,'config.json'),JSON.stringify({enabled:false}));const e=new Proxy({}, {get(_t,key){if(key!=='DRY_RUN')credentialReads++;return key==='GMAIL_USER'||key==='GMAIL_APP_PASSWORD'?'synthetic-placeholder':undefined;}});const result=await main({root,env:e,connect:async()=>{connections++;throw Error('Must remain offline');},output:()=>{}});check(result===0&&connections===0&&credentialReads===0&&!fs.existsSync(path.join(root,'.runner.lock')));}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('enabled:false also blocks direct cycle/approval with populated approvals and undo requests',async()=>{
  const cfg=settings({enabled:false}),state=emptyState(),m=message({subject:'Verification code'});await makeProposal({messages:[m],config:cfg,state,now});const p=state.proposal,approval={proposal_id:p.id,revision:p.revision,selected:[m.gmailId]};let calls=0;const mailbox=new Proxy({}, {get:()=>async()=>{calls++;throw Error('Disabled');}}),persist=async()=>{calls++;};
  await applyApproval({config:cfg,state,approval,mailbox,persist,now});await runCycle({config:cfg,state,approval,undoRequests:[{run_id:'any'}],mailbox,persist,now});check(calls===0&&state.journal.runs.length===0);
});
test('export --verify rejects a planted private public-config value',()=>{
  const root=temporary(),source=fileURLToPath(new URL('../',import.meta.url));
  try{for(const kind of ['code','build/public','build/private'])for(const name of FILES){const target=path.join(root,kind,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(source,name),target);}
    const manifest=Object.fromEntries(FILES.map(name=>[name,createHash('sha256').update(fs.readFileSync(path.join(source,name))).digest('hex')]));for(const kind of ['public','private']){fs.writeFileSync(path.join(root,'build',kind,'manifest.json'),JSON.stringify(manifest));fs.copyFileSync(path.join(source,'mail/config.example.json'),path.join(root,'build',kind,'mail/config.json'));}
    const run=()=>spawnSync(process.execPath,[path.join(root,'code/scripts/export.mjs'),'--verify'],{encoding:'utf8',env:{PATH:process.env.PATH}});check(run().status===0);fs.writeFileSync(path.join(root,'build/public/mail/config.json'),JSON.stringify({...DEFAULTS,read_bodies:true}));check(run().status===1);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
