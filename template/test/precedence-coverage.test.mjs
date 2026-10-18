import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {decide,RULE_PRECEDENCE,RULES,policyHash,fingerprint,DAY} from '../mail/scripts/rules.mjs';
import {settings} from '../mail/scripts/settings.mjs';
import {CLASSES,validateSet} from '../eval/score-cleanup.mjs';
import {message,synthetic,NOW} from '../eval/synthetic.mjs';

const now=new Date(NOW),config=settings({enabled:true});
const old=extra=>message({date:new Date(now-120*DAY).toISOString(),...extra});
const availability=spec=>Object.fromEntries(CLASSES.map(k=>[k,spec.items.filter(x=>(x.expected.rule||x.expected.category)===k).length]));
function sparse(){
  const spec=synthetic();spec.synthetic=false;spec.reviewed_by_nick=false;
  for(const [key,retain] of [['O7',1],['health',2],['travel',0]]){
    const rows=spec.items.filter(x=>(x.expected.rule||x.expected.category)===key);
    for(const row of rows.slice(retain)){
      row.expected={kind:'uncertain'};
      row.message.subject='Unknown notice';
    }
  }
  spec.available_in_set=availability(spec);return spec;
}

test('specific eligible rules use the approved precedence and fall back when disabled',()=>{
  assert.deepEqual(RULE_PRECEDENCE,['O1','O2','O3','O7','O6','O5','O4']);
  const m=old({subject:'Verification code; package delivered; Invitation: sale @ 2026-01-01T10:00:00Z',shippingSender:true,bulk:true,tab:'promotions'});
  assert.equal(decide(m,config,now).rule,'O1');
  assert.equal(decide(m,{rules:{O1:{enabled:false}}},now).rule,'O2');
  assert.equal(decide(m,{rules:{O1:{enabled:false},O2:{enabled:false}}},now).rule,'O3');
  assert.equal(decide(old({subject:'New sign-in; sale',bulk:true,tab:'promotions'}),config,now).rule,'O7');
  assert.equal(decide(old({subject:'Sale; someone viewed your profile',bulk:true,tab:'social'}),config,now).rule,'O6');
  assert.equal(decide(old({subject:'Verification code sale',tab:'promotions'}),config,now).rule,'O1');
});
test('bulk newsletter older than 60 days is O5, not O4',()=>{
  assert.equal(decide(old({subject:'Weekly newsletter: sale updates',bulk:true,tab:'promotions'}),config,now).rule,'O5');
});
test('shipping notice from a notification address is O2, not O6',()=>{
  assert.equal(decide(old({from:'Carrier <notifications@carrier.example>',subject:'Your package shipped',shippingSender:true,notificationSender:true,tab:'social'}),config,now).rule,'O2');
});
test('account and security notices never become O6 notifications, regardless of age or sender',()=>{
  const subjects=[
    'Service terms of use have been updated','We changed the terms of service',
    'Please reset your password','Your password has expired',
    'A personal access token was added','API token revoked','A passkey was registered',
    'Your account has been created','We have closed your account','Account closure confirmed',
    'Two-factor authentication enabled','Security settings changed','Recovery details updated',
    'Sign-in notice','Login notice','New sign-in: passkey added',
    'New login: password reset requested','New sign-in: service terms updated',
    '账号已创建','访问令牌已撤销','服务条款更新'
  ];
  for(const subject of subjects)for(const tab of ['social','updates'])for(const days of [15,90,365]){
    const mail=old({from:'Notifications <notifications@service.example>',subject:'New notification: '+subject,
      tab,notificationSender:true,date:new Date(now-days*DAY).toISOString()});
    assert.equal(decide(mail,config,now).rule,null,subject);
  }
  // The veto is about account content, not a blacklist of notification senders.
  assert.equal(decide(old({subject:'New notification: someone commented',tab:'updates',notificationSender:true}),config,now).rule,'O6');
});
test('routine sign-ins use only O7 strictly after 90 days, with no other-rule fallback',()=>{
  for(const subject of ['New sign-in to your account','New login from a browser','Password changed']){
    for(const tab of ['social','updates','promotions'])for(const elapsed of [15*DAY,90*DAY,90*DAY+1,120*DAY]){
      const mail=old({subject:subject+'; sale',tab,bulk:true,notificationSender:true,date:new Date(now-elapsed).toISOString()});
      assert.equal(decide(mail,config,now).rule,elapsed>90*DAY?'O7':null);
      assert.equal(decide(mail,{rules:{O7:{enabled:false}}},now).rule,null);
    }
  }
  assert.equal(decide(old({subject:'Suspicious new sign-in',tab:'social'}),config,now).rule,null);
  assert.equal(decide(old({subject:'New sign-in: Verification code',tab:'social'}),config,now).rule,'O1');
});
test('precedence does not override protection, reply status, missing safety data or young age',()=>{
  const m=old({subject:'Verification code sale',tab:'promotions'});
  for(const patch of [{starred:true},{everWritten:true},{threadParticipated:true},{labels:['AI/财务账单']},{needsReply:true},{protectionComplete:false},{date:NOW}])assert.equal(decide({...m,...patch},config,now).rule,null);
  assert.equal(decide(old({subject:'Newsletter',bulk:true,date:new Date(now-59*DAY).toISOString()}),config,now).rule,null);
});
test('precedence is part of the policy hash, invalidating pre-decision approvals and automatic history',()=>{
  const previous=fingerprint({settings:settings(config),rules:RULES});
  assert.notEqual(policyHash(config),previous);
  const beforeAccountGuard=fingerprint({settings:settings(config),rules:RULES,precedence:RULE_PRECEDENCE});
  assert.notEqual(policyHash(config),beforeAccountGuard);
});
test('coverage requires min(10, declared available-in-set), including genuine zero availability',()=>{
  const spec=sparse(),rows=validateSet(spec,{privateSet:true,draft:true});
  for(const [key,count] of [['O7',1],['health',2],['travel',0]]){
    const row=rows.find(x=>x.class===key);
    assert.equal(row.required,count);assert.equal(row.count,count);assert.equal(row.shortfall,10-count);
  }
  const omitted=structuredClone(spec);omitted.items.find(x=>x.expected.rule==='O7').expected={kind:'uncertain'};
  assert.throws(()=>validateSet(omitted,{privateSet:true,draft:true}),/coverage/);
  const undeclared=structuredClone(spec);delete undeclared.available_in_set;
  assert.throws(()=>validateSet(undeclared,{privateSet:true,draft:true}),/coverage/);
  for(const bad of [-1,0.5,201]){
    const invalid=structuredClone(spec);invalid.available_in_set.O7=bad;
    assert.throws(()=>validateSet(invalid,{privateSet:true,draft:true}),/availability/);
  }
  const incomplete=structuredClone(spec);delete incomplete.available_in_set.O1;
  assert.throws(()=>validateSet(incomplete,{privateSet:true,draft:true}),/availability/);
  const invalidClass=structuredClone(spec);invalidClass.items[0].expected={kind:'outdated',rule:'finance'};
  assert.throws(()=>validateSet(invalidClass,{privateSet:true,draft:true}),/class/);
  const invalidKeep=structuredClone(spec);invalidKeep.items[0].expected={kind:'keep',category:'O1'};
  assert.throws(()=>validateSet(invalidKeep,{privateSet:true,draft:true}),/class/);
});
test('draft scoring prints shortfalls and metrics without certifying review or bypassing the release guard',()=>{
  const root=fs.mkdtempSync(new URL('../.precedence-test-',import.meta.url));
  try{
    const file=root+'/draft.json';
    const fixture=sparse();fs.writeFileSync(file,JSON.stringify(fixture));
    const cli=fileURLToPath(new URL('../eval/score-cleanup.mjs',import.meta.url));
    const run=extra=>spawnSync(process.execPath,[cli,'--private',file,...extra],{encoding:'utf8',env:{PATH:process.env.PATH}});
    const draft=run(['--draft']);assert.equal(draft.status,0);
    assert.match(draft.stdout,/DRAFT ONLY/);assert.match(draft.stdout,/O7: 1 available, 1 included, require 1, short 9/);
    assert.match(draft.stdout,/travel: 0 available, 0 included, require 0, short 10/);
    assert.match(draft.stdout,/Cleanup score:/);assert.match(draft.stdout,/DRAFT CHECK PASS/);assert.doesNotMatch(draft.stdout,/EVAL PASS/);
    const broken=run(['--draft','--break']);assert.equal(broken.status,0);assert.match(broken.stdout,/DRAFT EXPECTED FAILURE/);
    assert.equal(run([]).status,2);assert.equal(run(['--reviewed']).status,2);assert.equal(run(['--draft','--reviewed']).status,2);
    assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).reviewed_by_nick,false);
    assert.throws(()=>validateSet(fixture,{privateSet:true}),/review/);
    fixture.reviewed_by_nick=true;assert.doesNotThrow(()=>validateSet(fixture,{privateSet:true}));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
