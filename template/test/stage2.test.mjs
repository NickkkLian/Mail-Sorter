import {test} from 'node:test';
import {settings} from '../mail/scripts/settings.mjs';
import {safeText,redact,stripHistory,bodyEvidence,modelInput} from '../mail/scripts/privacy.mjs';
import {createEvaluator,modelClassifier} from '../mail/scripts/intelligence.mjs';
import {complete,config as llmConfig} from '../mail/scripts/llm.mjs';
import {makeProposal,emptyState,runCycle} from '../mail/scripts/core.mjs';
import {message,NOW} from '../eval/synthetic.mjs';
const check=x=>{if(!x)throw Error('Privacy expectation failed (data suppressed)');};
const now=new Date(NOW),base=settings({enabled:true}),canary='BODY-CANARY-NOT-FOR-STORAGE';
const mail=message({subject:'Verification code'}),agree={category:'other',action:false,cleanup:'agree'};
test('body switch off prevents fetching and rule matches avoid model requests',async()=>{
  let fetches=0,models=0;const v=await createEvaluator({config:base,mailbox:{readBody:async()=>{fetches++;}},classify:async()=>{models++;return agree;},now})(mail);check(v.rule==='O1'&&fetches===0&&models===0);
});
test('protected and known keep mail never fetches a body or calls model',async()=>{
  let calls=0;const evaluate=createEvaluator({config:{...base,read_bodies:true},mailbox:{readBody:async()=>{calls++;return '';}},classify:async()=>{calls++;return agree;},now});
  for(const patch of [{starred:true},{subject:'Invoice received'},{everWritten:true},{labels:['AI/Money']}])await evaluate({...mail,...patch});check(calls===0);
});
test('redacts cards, spaced digits, account identifiers, short suffixes, and IBANs',()=>{
  const numbers=['4111111111111111','4111 1111 1111 1111','123456789','GB82 WEST 1234 5698 7654 32','account ending in 1234','acct: ABCD12345'];
  for(const value of numbers){const v=redact(value);check(!v.includes('4111')&&!v.includes('1234')&&!v.includes('GB82')&&!v.includes('ABCD12345'));}
  check(safeText('&#52;&#49;&#49;&#49;&#49;&#49;&#49;&#49;&#49;&#49;&#49;&#49;&#49;&#49;&#49;&#49;').includes('REDACTED'));
});
test('HTML/plain quoted history and forwarded sections are stripped before model calls',()=>{
  for(const input of ['Current\nOn yesterday Someone wrote:\n'+canary,'<p>Current</p><blockquote>'+canary+'</blockquote>','<div>Current</div><div class="gmail_quote">'+canary+'</div>','Current\n> '+canary,'Current\n-----Original Message-----\n'+canary])check(!stripHistory(input).includes(canary));
  check(!safeText('<script>'+canary+'</script>Current').includes(canary));check(safeText('a'.repeat(9000),128).length===128);
});
test('all model-visible fields are sanitized and body length is bounded',async()=>{
  const cfg=settings({...base,read_bodies:true,body_max_chars:128});let sent;
  const evaluate=createEvaluator({config:cfg,mailbox:{readBody:async()=> 'Current card 4111 1111 1111 1111\n'+'x'.repeat(9000)+'\nOn yesterday Person wrote:\n'+canary},classify:async x=>{sent=x;return agree;},now});
  await evaluate({...mail,from:'sender12345678@service.example',subject:'Verification code 12345678'});
  check(sent.body.length<=128&&!JSON.stringify(sent).includes('12345678')&&!JSON.stringify(sent).includes('4111')&&!JSON.stringify(sent).includes(canary));
});
test('typed calendar evidence resolves otherwise undated invites without storing body',async()=>{
  const cfg={...base,read_bodies:true},text='BEGIN:VCALENDAR\nDTEND:20260101T150000Z\nEND:VCALENDAR\n'+canary;
  const evaluate=createEvaluator({config:cfg,mailbox:{readBody:async()=>text},now});const m={...mail,subject:'Invitation: quarterly event'};
  check((await createEvaluator({config:base,mailbox:{},now})(m)).rule===null);check((await evaluate(m)).rule==='O3');
  const state=emptyState();await makeProposal({messages:[m],config:cfg,state,now,evaluate});check(!JSON.stringify(state).includes(canary)&&!JSON.stringify(state).includes('VCALENDAR'));
  check(bodyEvidence('DTEND;TZID=America/Toronto:20260101T150000',now)===null);
});
test('body receipt, incident, upcoming renewal and future promotion veto cleanup',async()=>{
  const cases=[['Verification code','Subscription has renewed: receipt','finance'],['Verification code','Security breach: account compromised','security'],['Verification code','Subscription will renew next week','security'],['Sale','Offer ends 2027-01-01','other']];
  for(const [subject,body,category]of cases){const v=await createEvaluator({config:{...base,read_bodies:true},mailbox:{readBody:async()=>body},now})({...mail,subject,tab:'promotions'});check(!v.rule&&v.category===category);}
});
test('model can veto rules and assign keep/status; never invents cleanup authority',async()=>{
  for(const verdict of [{category:'finance',action:false,cleanup:'keep'},{category:'other',action:true,cleanup:'agree'},{category:'other',action:false,cleanup:'uncertain'}]){
    const v=await createEvaluator({config:{...base,read_bodies:true},mailbox:{readBody:async()=>''},classify:async()=>verdict,now})(mail);check(!v.rule);
  }
  const v=await createEvaluator({config:base,mailbox:{},classify:async()=>agree,now})({...mail,subject:'Unknown notice'});check(!v.rule);
});
test('model prose, extra fields, error echoes and fetch failures never persist or log body',async()=>{
  for(const fail of ['extra','throw','fetch']){const state=emptyState(),cfg={...base,read_bodies:true},evaluate=createEvaluator({config:cfg,mailbox:{readBody:async()=>{if(fail==='fetch')throw Error(canary);return canary;}},classify:async()=>{if(fail==='throw')throw Error(canary);return {...agree,reason:canary};},now});
    const v=await evaluate(mail);check(!v.rule&&!JSON.stringify(v).includes(canary));await makeProposal({messages:[mail],config:cfg,state,now,evaluate});check(!JSON.stringify(state).includes(canary));
  }
});
test('digest persists only fixed reasons and metadata, never model/body content',async()=>{
  const state=emptyState(),cfg={...base,read_bodies:true},evaluate=createEvaluator({config:cfg,mailbox:{readBody:async()=>canary},classify:async()=>({category:'job',action:true,cleanup:'keep'}),now});
  const mailbox={scan:async()=>({messages:[mail],done:true,uidValidity:'1'}),addLabel:async()=>{}};
  await runCycle({config:cfg,state,mailbox,persist:async s=>{check(!JSON.stringify(s).includes(canary));},now,evaluate});check(state.digest.items[0].category==='job'&&state.digest.items[0].action);
});
test('classifier retries with bounded attempts and emits only generic errors',async()=>{
  let count=0;const classify=modelClassifier({LLM_PROVIDER:'openai-compatible',LLM_MODEL:'mock',LLM_BASE_URL:'http://unused.invalid'},{maxRetries:3,wait:async()=>{},completeImpl:async()=>{count++;throw Error(canary);}});
  let safe=false;try{await classify(modelInput(mail,base));}catch(e){safe=!e.message.includes(canary);}check(count===3&&safe);
});
test('all provider errors discard echoed HTTP and network content without local servers',async()=>{
  for(const provider of ['anthropic','openai','gemini','openai-compatible']){
    const cfg=llmConfig({provider,model:'mock',baseUrl:'https://unused.invalid',apiKey:'synthetic-placeholder'});
    for(const fetchImpl of [async()=>({ok:false,status:400,text:async()=>canary}),async()=>{throw Error(canary);}]){
      let safe=false;try{await complete(cfg,'','',{fetchImpl});}catch(e){safe=!e.message.includes(canary);}check(safe);
    }
  }
});
test('one scan does not repeat body/model requests merely to write the proposal',async()=>{
  const state=emptyState(),cfg={...base,read_bodies:true};let calls=0;const mailbox={readBody:async()=>canary,scan:async()=>({messages:[mail],done:true,uidValidity:'1'})},evaluate=createEvaluator({config:cfg,mailbox,classify:async()=>{calls++;return agree;},now});
  await runCycle({config:cfg,state,mailbox,persist:async()=>{},now,evaluate});check(calls===1&&state.proposal.items.length===1);
});
