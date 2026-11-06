import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,makeProposal,updateDigest} from '../mail/scripts/core.mjs';
import {settings} from '../mail/scripts/settings.mjs';

test('cleanup and digest retain known tab/read evidence without guessing missing flags',async()=>{
  const config=settings(),now=new Date('2026-11-05T17:00:00Z');
  for(const tab of ['primary','promotions',undefined]){
    const state=emptyState(),message={gmailId:'123',uid:1,threadId:'456',inInbox:true,seen:false,tab,date:'2026-01-01'};
    await makeProposal({messages:[message],config,state,now,evaluate:async()=>({rule:'O1'})});
    updateDigest(state,message,{category:'other'},config,now);
    for(const row of [state.proposal.items[0],state.digest.items[0]]){
      assert.equal(row.unread,true);assert.equal(row.threadId,'456');
      assert.equal(row.primary,tab===undefined?undefined:tab==='primary');
    }
  }
  const state=emptyState();updateDigest(state,{gmailId:'123',uid:1},{category:'other'},config,now);
  assert.equal(Object.hasOwn(state.digest.items[0],'unread'),false);
  assert.equal(Object.hasOwn(state.digest.items[0],'primary'),false);
});
