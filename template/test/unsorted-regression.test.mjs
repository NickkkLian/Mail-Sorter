import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createEvaluator} from '../mail/scripts/intelligence.mjs';
import {settings} from '../mail/scripts/settings.mjs';
import {emptyState,runCycle,updateDigest} from '../mail/scripts/core.mjs';
import fs from 'node:fs';
import {main} from '../mail/scripts/classify.mjs';
const NOW='2026-10-27T12:00:00.000Z';
const message=(patch={})=>({uid:1,gmailId:'1001',threadId:'2001',from:'notices@service.example',subject:'Unknown notice',date:'2026-10-17T12:00:00.000Z',tab:'primary',labels:[],bulk:false,starred:false,important:false,replied:false,threadParticipated:false,everWritten:false,protectionComplete:true,inInbox:true,...patch});

for(const category of ['finance','job'])test(`protected sender still gets metadata classification: ${category}`,async()=>{
  const m=message({from:'Alerts <alerts@service.example>',subject:category==='finance'?'Your order has been filled':'Engineer Intern opportunities'});
  const config=settings({enabled:true,read_bodies:true,protected:{senders:['alerts@service.example']}});
  let models=0,bodies=0,mutations=0;
  const mailbox={readBody:async()=>{bodies++;return 'BODY MUST NOT BE READ';},scan:async()=>({messages:[m],done:true,uidValidity:'1'}),addLabel:async()=>{mutations++;}};
  const evaluate=createEvaluator({config,mailbox,classify:async input=>{models++;assert.equal(input.body,undefined);return {category,action:false,cleanup:'agree'};},now:new Date(NOW)});
  const state=emptyState();
  await runCycle({config,state,mailbox,persist:async()=>{},evaluate,now:new Date(NOW)});
  assert.equal(models,1);assert.equal(bodies,0);assert.equal(mutations,0);
  assert.equal(state.digest.items[0].category,category);assert.equal(state.proposal.items.length,0);
});

test('protected mail cannot acquire cleanup authority from a model',async()=>{
  const config=settings({enabled:true});
  const evaluate=createEvaluator({config,mailbox:{},classify:async()=>({category:'other',action:false,cleanup:'agree'}),now:new Date(NOW)});
  const v=await evaluate(message({starred:true,subject:'Unknown notice'}));
  assert.equal(v.rule,null);
});

test('model errors are counted and persisted as a fixed diagnostic, never Unsorted',async()=>{
  for(const classify of [null,async()=>{throw Error('PRIVATE-ERROR-CANARY');},async()=>({category:'bad'})]){
    const diagnostics={errors:0},config=settings({enabled:true}),m=message({subject:'Unknown notice'});
    const v=await createEvaluator({config,mailbox:{},classify,diagnostics,now:new Date(NOW)})(m);
    const state=emptyState();updateDigest(state,m,v,config,new Date(NOW));
    assert.equal(diagnostics.errors,1);assert.notEqual(state.digest.items[0].reason_en,'Unsorted');
    assert.ok(!JSON.stringify(state).includes('PRIVATE-ERROR-CANARY'));
    assert.equal(v.rule,null);
  }
});

test('runner makes missing model configuration visible and returns failure after saving progress',async()=>{
  const root=fs.mkdtempSync(new URL('../.tmp-unsorted-',import.meta.url)),lines=[];
  try{
    fs.writeFileSync(root+'/config.json',JSON.stringify(settings({enabled:true})));
    const m=message({subject:'Unknown notice'});
    const code=await main({root,env:{GMAIL_USER:'synthetic',GMAIL_APP_PASSWORD:'synthetic'},connect:async()=>({scan:async()=>({messages:[m],done:true,uidValidity:'1'}),close:async()=>{}}),output:x=>lines.push(x)});
    assert.equal(code,1);assert.ok(lines.some(x=>x.startsWith('::error')));
    assert.ok(lines.some(x=>x.includes('"model_not_configured":1')));
    const saved=JSON.parse(fs.readFileSync(root+'/mail.json','utf8'));
    assert.equal(saved.items[0].classification_status,'model_not_configured');
    assert.ok(!fs.existsSync(root+'/.runner.lock'));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
