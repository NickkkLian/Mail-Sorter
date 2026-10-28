import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {main} from '../mail/scripts/classify.mjs';
import {connectMailbox} from '../mail/scripts/imap.mjs';
import {fake} from './helpers/fake-imap.mjs';
import {settings} from '../mail/scripts/settings.mjs';
import {DealtController} from '../board/dealt.mjs';
import {ReviewController} from '../board/review.mjs';

const id='9007199254740993001';
const env={ANTHROPIC_API_KEY:'synthetic-placeholder',GMAIL_USER:'main@mail.example',GMAIL_APP_PASSWORD:'fake-main',GMAIL2_USER:'second@mail.example',GMAIL2_APP_PASSWORD:'fake-second',RUN_NOW:'1'};
async function fixture(fn,config={}){
 const root=fs.mkdtempSync(new URL('../.tmp-mailboxes-',import.meta.url));
 const write=(name,data)=>fs.writeFileSync(path.join(root,name),JSON.stringify(data));
 const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
 const a=fake({seen:false}),b=fake({seen:false}),calls=[],output=[];
 a.record.envelope.messageId=b.record.envelope.messageId='<same@mail.example>';
 write('config.json',settings({enabled:true,second_mailbox_enabled:true,...config}));
 const connect=async(c,e)=>{calls.push(e.GMAIL_USER);return connectMailbox(c,e,e.GMAIL_USER===env.GMAIL_USER?a.Client:b.Client);};
 const run=(overrides={})=>main({root,env:{...env,...overrides},connect,output:s=>output.push(s)});
 try{await fn({a,b,calls,output,write,read,run,root,connect});}finally{fs.rmSync(root,{recursive:true,force:true});}
}

test('two fake IMAP mailboxes retain identical Gmail IDs and independent cursors',()=>fixture(async({run,read,calls})=>{
 assert.equal(await run(),0);assert.deepEqual(calls,[env.GMAIL_USER,env.GMAIL2_USER]);
 const d=read('mail.json');assert.equal(d.items.length,2);assert.deepEqual(d.items.map(i=>i.gmailId),[id,id]);
 assert.deepEqual(new Set(d.items.map(i=>i.mailbox)),new Set(['primary','secondary']));
 assert.deepEqual(new Set(d.items.map(i=>i.mailbox_address)),new Set([env.GMAIL_USER,env.GMAIL2_USER]));
 assert.equal(d.total_classified,2);assert.equal(read('runtime.json').mailboxes.secondary.uidValidity,'9');
}));
test('secondary Dealt and Undo never affect identical primary message',()=>fixture(async({run,read,write,a,b})=>{
 await run();const category=read('mail.json').items.find(i=>i.mailbox==='secondary').category;
 write('dealt-queue.json',{requests:[{id:'both',items:[{mailbox:'secondary',gmailId:id,category}]}]});
 await run();assert(!a.flags.has('\\Seen'));assert(b.flags.has('\\Seen'));
 const r=read('cleanup-log.json').runs.find(r=>r.kind==='dealt');assert.equal(r.mailbox,'secondary');
 write('cleanup-undo.json',{requests:[{dealt_request_id:'both'}]});await run();
 assert(!a.flags.has('\\Seen'));assert(!b.flags.has('\\Seen'));assert(!b.record.labels.has('AI/Unsorted'));
}));
test('cleanup selection and Undo route same ID to the selected mailbox',()=>fixture(async({run,read,write,a,b})=>{
 await run();const p=read('cleanup-proposal.json');assert.equal(p.items.length,2);
 write('cleanup-approval.json',{proposal_id:p.id,revision:p.revision,selected:['secondary:'+id]});
 await run();assert(!a.actions.includes('All'));assert(b.actions.includes('All'));
 const r=read('cleanup-log.json').runs.find(r=>r.mailbox==='secondary'&&r.entries.length);
 write('cleanup-undo.json',{requests:[{run_id:r.id}]});await run();
 assert(b.actions.includes('restore'));assert(!a.actions.includes('restore'));
}));
test('missing second secret visibly skips it while main succeeds; no values logged',()=>fixture(async({run,read,output,calls})=>{
 assert.equal(await run({GMAIL2_APP_PASSWORD:''}),0);assert.deepEqual(calls,[env.GMAIL_USER]);
 assert.equal(read('mail.json').items.length,1);assert(output.some(s=>s.includes('secondary')&&s.includes('not configured')));
 assert(!output.join().includes(env.GMAIL_APP_PASSWORD));assert(!output.join().includes(env.GMAIL2_USER));
}));
test('off switch keeps secondary inert and preserves existing secondary state',()=>fixture(async({run,read,write,calls})=>{
 await run();const d=read('mail.json').items.find(i=>i.mailbox==='secondary');
 write('config.json',settings({enabled:true,second_mailbox_enabled:false}));calls.length=0;await run();
 assert.deepEqual(calls,[env.GMAIL_USER]);assert.deepEqual(read('mail.json').items.find(i=>i.mailbox==='secondary'),d);
}));
test('legacy unscoped Dealt requests belong only to primary',()=>fixture(async({run,read,write,a,b})=>{
 await run();write('dealt-queue.json',{requests:[{id:'legacy',items:[{gmailId:id,category:read('mail.json').items[0].category}]}]});
 await run();assert(a.flags.has('\\Seen'));assert(!b.flags.has('\\Seen'));
}));
test('failed secondary connection preserves main progress and reports failure',()=>fixture(async({root,connect,read,output})=>{
 assert.equal(await main({root,env,connect:async(c,e)=>{if(e.GMAIL_USER===env.GMAIL2_USER)throw Error('fake-secret-do-not-log');return connect(c,e);},output:s=>output.push(s)}),1);
 assert.equal(read('mail.json').items[0].mailbox,'primary');assert(!output.join().includes('fake-secret-do-not-log'));
}));
test('account rebinding fails closed before connection or mutations',()=>fixture(async({run,calls,read})=>{
 await run();calls.length=0;assert.equal(await run({GMAIL2_USER:'different@mail.example'}),1);
 assert.deepEqual(calls,[env.GMAIL_USER]);assert(read('mail.json').items.some(i=>i.mailbox_address===env.GMAIL2_USER));
}));
test('mixed-account bulk Dealt is consumed once per mailbox and Undo restores both',()=>fixture(async({run,read,write,a,b})=>{
 await run();write('dealt-queue.json',{requests:[{id:'mixed',items:read('mail.json').items.map(({mailbox,gmailId,category})=>({mailbox,gmailId,category}))}]});
 await run();assert(a.flags.has('\\Seen'));assert(b.flags.has('\\Seen'));
 const actions=[a.actions.length,b.actions.length];await run();assert.deepEqual([a.actions.length,b.actions.length],actions.map(n=>n+2));
 write('cleanup-undo.json',{requests:[{dealt_request_id:'mixed'}]});await run();assert(!a.flags.has('\\Seen'));assert(!b.flags.has('\\Seen'));
 assert.equal(read('cleanup-log.json').runs.filter(r=>r.kind==='dealt').length,2);
}));
test('unknown scope cannot mutate either mailbox; missing main does not block configured second',()=>fixture(async({run,read,write,a,b,calls})=>{
 await run();write('dealt-queue.json',{requests:[{id:'bad',items:[{mailbox:'unknown',gmailId:id,category:'other'}]}]});
 calls.length=0;assert.equal(await run({GMAIL_APP_PASSWORD:''}),0);assert.deepEqual(calls,[env.GMAIL2_USER]);
 assert(!a.flags.has('\\Seen'));assert(!b.flags.has('\\Seen'));assert.equal(read('mail.json').items.length,2);
}));
test('duplicate configured account is rejected without a second connection',()=>fixture(async({run,calls})=>{
 assert.equal(await run({GMAIL2_USER:env.GMAIL_USER}),1);assert.deepEqual(calls,[env.GMAIL_USER]);
}));
test('secondary-only first run preserves legacy primary totals and digest',()=>fixture(async({run,read,write})=>{
 write('mail.json',{items:[{gmailId:'42',category:'finance'}],total_classified:37,keep_items:500});
 assert.equal(await run({GMAIL_APP_PASSWORD:''}),0);
 assert.equal(read('mail.json').total_classified,38);assert(read('mail.json').items.some(i=>i.gmailId==='42'));
 assert.equal(read('mail.json').mailboxes.primary.total_classified,37);
}));
test('legacy state migrates to primary while the second mailbox keeps an independent UID reset',()=>fixture(async({run,read,write})=>{
 write('mail.json',{items:[{gmailId:'42',uid:2,category:'finance',date:'2025-01-01'}],lastUid:2,total_classified:7});
 write('runtime.json',{scanAfter:2,uidValidity:'9',protection_seeded:true});
 await run();assert.equal(read('mail.json').items.find(i=>i.gmailId==='42').mailbox,'primary');
 const runtime=read('runtime.json');runtime.mailboxes.secondary.uidValidity='old';write('runtime.json',runtime);
 await run();assert.equal(read('runtime.json').mailboxes.primary.uidValidity,'9');assert.equal(read('runtime.json').mailboxes.secondary.uidValidity,'9');
 assert.equal(read('mail.json').items.filter(i=>i.gmailId===id).length,2);
}));
test('fresh same-content proposals get a new identity and cannot replay an old approval',()=>fixture(async({run,read,write,a,b})=>{
 await run();const first=read('cleanup-proposal.json');await run();const next=read('cleanup-proposal.json');assert.notEqual(first.id,next.id);
 write('cleanup-approval.json',{proposal_id:first.id,revision:first.revision,selected:['secondary:'+id]});await run();
 assert(!a.actions.includes('All'));assert(!b.actions.includes('All'));
}));
test('browser controllers preserve scoped selections and partial mixed-request status',async()=>{
 const items=[{gmailId:id,category:'other',mailbox:'primary'},{gmailId:id,category:'other',mailbox:'secondary'}];
 const files={'mail/cleanup-proposal.json':{id:'p',revision:'r',items},'mail/cleanup-log.json':{runs:[]}};
 const io={get:async p=>({data:structuredClone(files[p]||null),sha:null}),put:async(p,d)=>{files[p]=structuredClone(d);}};
 const dealt=new DealtController(io);await dealt.mark(items);assert.equal(dealt.status(id),'queued');assert.equal(dealt.status('secondary:'+id),'queued');
 files['mail/cleanup-log.json']={runs:[{kind:'dealt',dealt_request_id:dealt.requests[0].id,mailbox:'primary',entries:[{gmailId:id,status:'done'}]}]};await dealt.load();
 assert.equal(dealt.status(id),'done');assert.equal(dealt.status('secondary:'+id),'queued');assert.equal(dealt.run(dealt.requests[0]).entries.length,1);
 const review=new ReviewController(io);await review.load();review.setItem(id,false);await review.approve();
 assert.deepEqual(files['mail/cleanup-approval.json'].selected,['secondary:'+id]);
});
