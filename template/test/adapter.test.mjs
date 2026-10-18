import {test} from 'node:test';
import {connectMailbox} from '../mail/scripts/imap.mjs';
import {settings} from '../mail/scripts/settings.mjs';
const check=x=>{if(!x)throw Error('Adapter expectation failed (data suppressed)');};
import {fake} from './helpers/fake-imap.mjs';
const env={GMAIL_USER:'synthetic',GMAIL_APP_PASSWORD:'synthetic'};
test('adapter preserves exact large stable IDs, flags and original labels across archive/restore',async()=>{
  const f=fake(),box=await connectMailbox(settings(),env,f.Client),page=await box.scan({after:0,limit:10});const m=page.messages[0];check(m.gmailId==='9007199254740993001'&&m.protectionComplete&&m.tab==='primary');
  await box.addLabel(m.gmailId,'AI/Cleaned/O1');await box.archive(m.gmailId);check(f.actions.at(-1)==='All'&&!f.actions.includes('Trash'));const archived=await box.get(m.gmailId);check(archived.uid!==m.uid&&!archived.inInbox);await box.restore(m.gmailId);await box.removeLabel(m.gmailId,'AI/Cleaned/O1');check(f.record.labels.has('Original')&&f.flags.has('\\Seen'));await box.close();
});
test('complete Sent index protects correspondents/threads; incomplete and unknown metadata block cleanup',async()=>{
  for(const options of [{sent:1},{sent:2},{missingThread:true}]){const f=fake(options),box=await connectMailbox(settings({max_sent:1}),env,f.Client),m=(await box.scan({after:0,limit:10})).messages[0];if(options.sent===1)check(m.everWritten&&m.threadParticipated);else check(!m.protectionComplete);await box.close();}
});
test('UIDVALIDITY change rescans from oldest instead of retaining an invalid cursor',async()=>{
  const f=fake(),box=await connectMailbox(settings(),env,f.Client),page=await box.scan({after:999,expectedUidValidity:'old',limit:10});check(page.reset&&page.messages.length===1);await box.close();
});
test('body part is bounded; oversized or unsupported data is unavailable',async()=>{
  for(const size of [20,100000]){const f=fake({bodySize:size}),box=await connectMailbox(settings(),env,f.Client),body=await box.readBody('9007199254740993001');check(size===20?typeof body==='string':body===null);await box.close();}
});
