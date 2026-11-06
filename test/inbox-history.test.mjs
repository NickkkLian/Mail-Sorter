import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,recordInboxCounts} from '../mail/scripts/core.mjs';
import {mergeState,scopeState} from '../mail/scripts/mailboxes.mjs';
import {connectMailbox} from '../mail/scripts/imap.mjs';
import {settings} from '../mail/scripts/settings.mjs';
import {fake} from './helpers/fake-imap.mjs';

test('unread history is bounded, replaces retried timestamps and retains sibling accounts',async()=>{
  const shared=emptyState();
  for(const key of ['primary','secondary']){
    const state=scopeState(shared,key);
    for(let day=0;day<65;day++)await recordInboxCounts({state,mailbox:{inboxCounts:async()=>({inbox_unread_primary:day,inbox_unread_all:day+2})},persist:async()=>{},now:new Date(Date.UTC(2026,0,day+1))});
    assert.equal(state.digest.inbox_history.length,60);
    mergeState(shared,state,key,key+'@inbox.example');
  }
  assert.equal(shared.digest.inbox_history.length,60);
  assert.deepEqual(new Set(shared.digest.inbox_history.map(row=>row.mailbox)),new Set(['primary','secondary']));
  const state=scopeState(shared,'primary'),at=state.digest.inbox_history.at(-1).at;
  await recordInboxCounts({state,mailbox:{inboxCounts:async()=>({inbox_unread_primary:2,inbox_unread_all:3})},persist:async()=>{},now:new Date(at)});
  assert.equal(state.digest.inbox_history.length,60);
  assert.equal(state.digest.inbox_history.at(-1).inbox_unread_primary,2);
});

test('unavailable or incomplete counts retain the last measurement',async()=>{
  const state=emptyState();state.digest.inbox_history=[{at:'prior',inbox_unread_primary:5,inbox_unread_all:7}];
  for(const mailbox of [{},{inboxCounts:async()=>{throw Error('offline');}},{inboxCounts:async()=>({inbox_unread_primary:8,inbox_unread_all:7})}]){
    assert.equal(await recordInboxCounts({state,mailbox,persist:async()=>assert.fail('must not save')}),false);
    assert.equal(state.digest.inbox_history[0].at,'prior');
  }
});

test('adapter counts unread conversations and fails closed when thread IDs are missing',async()=>{
  for(const missingThread of [false,true]){
    const f=fake({seen:false,missingThread}),box=await connectMailbox(settings(),{GMAIL_USER:'fictional',GMAIL_APP_PASSWORD:'fictional'},f.Client);
    await box.scan({after:0,limit:10});
    if(missingThread)await assert.rejects(box.inboxCounts());
    else assert.deepEqual(await box.inboxCounts(),{inbox_unread_primary:1,inbox_unread_all:1});
    await box.close();
  }
});
