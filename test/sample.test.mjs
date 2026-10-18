import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readOnlyClient,runSample,main,SIGNALS} from '../mail/scripts/sample.mjs';
import {sampleFake,BODY_CANARY} from './helpers/sample-imap.mjs';
const check=x=>{if(!x)throw Error('Sample expectation failed (data suppressed)');};
const ALLOWED=['gmailId','threadId','from','fromAddr','subject','date','tab','labels','bulk','starred','important','replied','threadParticipated','everWritten','protectionComplete','inInbox','shippingSender','notificationSender','personal','needsReply'].sort();
test('sample capability proxy denies every unlisted verb, raw commands, client internals and mutation aliases',()=>{
  let calls=0;const target=new Proxy({},{get:()=>()=>{calls++;}}),client=readOnlyClient(target);
  for(const verb of ['messageFlagsAdd','messageFlagsRemove','messageFlagsSet','messageMove','messageCopy','messageDelete','append','mailboxCreate','mailboxDelete','mailboxRename','mailboxSubscribe','mailboxUnsubscribe','mailboxClose','expunge','exec','run','download','fetchOne','getMailboxLock','setFlag','delete','store','move','copy','close','unknownFutureVerb','constructor','__proto__','socket','client','connection']){
    assert.throws(()=>client[verb](),/Read-only/);
  }
  check(calls===0);
});
test('sample guard requires EXAMINE and rejects body/source/unknown fetch fields before dispatch',()=>{
  const f=sampleFake(),client=readOnlyClient(f.client);
  for(const args of [['INBOX'],['INBOX',{readOnly:false}],['INBOX',{readOnly:true,other:true}]])assert.throws(()=>client.mailboxOpen(...args),/Read-only/);
  for(const field of ['bodyParts','source','bodyStructure','binary','body','preview','unknown'])assert.throws(()=>client.fetch([1],{[field]:true},{uid:true}),/Read-only/);
  assert.throws(()=>client.fetch([1],{headers:true},{uid:true}),/Read-only/);
  assert.throws(()=>client.fetch([1],{headers:['received']},{uid:true}),/Read-only/);
  assert.throws(()=>client.search({gmailRaw:'x'},{uid:true,changedSince:1n}),/Read-only/);
  assert.throws(()=>client.status('INBOX',{messages:true}),/Read-only/);
  check(f.calls.length===0);
});
async function fixture(options={},runOptions={}){
  const root=fs.mkdtempSync(new URL('../.sample-test-',import.meta.url)),f=sampleFake(options),lines=[];
  try{const result=await runSample({client:f.client,outputDir:root,output:x=>lines.push(x),...runOptions});
    const poolText=fs.readFileSync(root+'/sample-pool.json','utf8'),reportText=fs.readFileSync(root+'/sample-report.json','utf8');
    check(![poolText,reportText,...lines].join('\n').includes(BODY_CANARY));
    return {result,pool:JSON.parse(poolText),report:JSON.parse(reportText),f,lines};
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}
test('sample reads metadata only, projects exact allowed fields, preserves flags and records counts only',async()=>{
  const {pool,report,f,lines}=await fixture();check(pool.items.length===20&&pool.items.length<=3000);
  for(const m of pool.items){check(JSON.stringify(Object.keys(m).sort())===JSON.stringify(ALLOWED));check(typeof m.gmailId==='string'&&typeof m.threadId==='string'&&m.protectionComplete&&m.everWritten&&m.fromAddr==='notices@service.example'&&m.from.startsWith('测试')&&m.date==='2026-01-02T12:00:00.000Z');}
  check(pool.items[0].gmailId==='9007199254740993020'&&pool.items.at(-1).labels.includes('AI/重要待办')&&pool.items.at(-1).needsReply);
  check(f.flags.size===0&&report.mailboxes.every(x=>x.unread_before===x.unread_after)&&report.mailbox_open_mode==='EXAMINE');
  check(report.labels_seen.modified_utf7===1&&report.labels_seen.plain===19&&report.messages_read===22);
  check(Object.keys(report.signals).length===15&&Object.values(report.signals).every(x=>x.found===20));
  for(const call of f.calls.filter(x=>x[0]==='mailboxOpen'))check(call[2].readOnly===true);
  for(const call of f.calls.filter(x=>x[0]==='fetch'))check(!Object.keys(call[2]).some(x=>['bodyParts','source','bodyStructure'].includes(x)));
  check(!JSON.stringify(report).includes('service.example')&&!lines.join().includes('Verification code'));
});
test('sample missing, partial and failed Sent indices fail closed without leaking errors',async()=>{
  for(const options of [{missingSent:true},{partialSent:true},{sentError:true}]){const {pool,report}=await fixture(options);check(pool.items.every(x=>x.protectionComplete===false)&&report.sent_index_complete===false);}
});
test('sample aborts on changed unread counts and publishes neither file',async()=>{
  const root=fs.mkdtempSync(new URL('../.sample-test-',import.meta.url));
  try{await assert.rejects(runSample({client:sampleFake({changedUnread:true}).client,outputDir:root,output:()=>{}}),/Unread/);check(fs.readdirSync(root).length===0);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('sample caps its pool and still searches all coverage signals',async()=>{
  const {pool,report}=await fixture({}, {limit:5,newest:2});check(pool.items.length===5&&Object.keys(report.signals).length===15);
});
test('sample reserves older coverage for all 15 classes alongside the newest across all tabs',async()=>{
  const root=fs.mkdtempSync(new URL('../.sample-test-',import.meta.url)),f=sampleFake({size:5000}),search=f.client.search;
  f.client.search=async(query,options)=>{
    const index=Object.values(SIGNALS).indexOf(query.gmailRaw);
    return index<0?search(query,options):Array.from({length:10},(_,i)=>index*10+i+1);
  };
  const before=f.messages.map(x=>[...x.flags].join(','));
  try{const {pool,report}=await runSample({client:f.client,outputDir:root,output:()=>{}});
    check(pool.items.length===3000&&Object.values(report.signals).every(x=>x.in_pool>=10));
    const ids=new Set(pool.items.map(x=>x.gmailId));for(let i=3800;i<5000;i++)check(ids.has(String(f.messages[i].emailId)));
    check(JSON.stringify(before)===JSON.stringify(f.messages.map(x=>[...x.flags].join(','))));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('sample CLI hides connection failures, disables dependency logging and never connects without configuration',async()=>{
  const lines=[];let constructed=0;
  class Client{constructor(options){constructed++;check(options.logger===false&&options.emitLogs===false);const f=sampleFake();f.client.connect=async()=>{throw Error(BODY_CANARY);};return f.client;}}
  check(await main({env:{},createClient:Client,output:x=>lines.push(x)})===1&&constructed===0);
  check(await main({env:{GMAIL_USER:'fictional',GMAIL_APP_PASSWORD:'fictional'},createClient:Client,output:x=>lines.push(x)})===1&&constructed===1);
  check(lines.length===2&&lines.every(x=>x==='Sample failed; no message data or connection errors logged.'));
});
