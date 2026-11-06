import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,makeProposal} from '../mail/scripts/core.mjs';
import {settings} from '../mail/scripts/settings.mjs';

test('proposal records exclusive safety counts without saving rejected identities',async()=>{
  const config=settings({protected:{senders:['protected@inbox.example'],labels:['Keep']}}),state=emptyState();
  const base={inInbox:true,seen:false,threadId:'1',protectionComplete:true,labels:[],starred:false,important:false,replied:false,threadParticipated:false,everWritten:false,date:'2026-01-01',subject:'Unknown'};
  const flags=[{everWritten:true},{starred:true},{from:'protected@inbox.example'},{labels:['Keep']},{protectionComplete:false}];
  const messages=flags.map((flag,i)=>({...base,from:'safe@inbox.example',...flag,gmailId:String(i+1)}));
  await makeProposal({messages:[...messages,messages[0]],config,state,now:new Date('2026-11-05')});
  assert.deepEqual(state.proposal.kept_back,{wrote_to:1,starred:1,protected:1,labels:1,uncertain:1});
  assert.deepEqual(state.proposal.items,[]);
  assert.equal(JSON.stringify(state.proposal).includes('@inbox.example'),false);
});
