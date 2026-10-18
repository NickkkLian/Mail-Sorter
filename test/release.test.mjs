import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {main} from '../mail/scripts/classify.mjs';
import {settings} from '../mail/scripts/settings.mjs';
import {message} from '../eval/synthetic.mjs';

test('proposal dry mode writes a review but calls no mutation, body or model adapter with queued decisions',async()=>{
  const root=fs.mkdtempSync(new URL('../.dry-test-',import.meta.url));let mutations=0,reads=0,closed=0;
  try{
    fs.writeFileSync(root+'/config.json',JSON.stringify(settings({enabled:true,read_bodies:true})));
    fs.writeFileSync(root+'/cleanup-undo.json',JSON.stringify({requests:[{run_id:'old-run'}]}));
    const box={scan:async()=>({messages:[message({subject:'Verification code'}),message({uid:2,gmailId:'1002',subject:'Invoice receipt'})],done:true,uidValidity:'1'}),get:async()=>message({subject:'Verification code'}),readBody:async()=>{reads++;throw Error('Forbidden');},close:async()=>{closed++;}};
    for(const key of ['addLabel','removeLabel','archive','trash','restore'])box[key]=async()=>{mutations++;};
    const lines=[],result=await main({root,env:{DRY_RUN:'proposal',GMAIL_USER:'synthetic',GMAIL_APP_PASSWORD:'synthetic'},connect:async()=>box,output:x=>lines.push(x)});
    assert.equal(result,0);assert.equal(mutations,0);assert.equal(reads,0);assert.equal(closed,1);
    const proposal=JSON.parse(fs.readFileSync(root+'/cleanup-proposal.json'));
    assert.equal(proposal.items.length,1);assert.equal(proposal.items[0].rule,'O1');assert.match(lines.join(),/Proposed: 1/);
    assert.deepEqual(JSON.parse(fs.readFileSync(root+'/cleanup-log.json')).runs,[]);
    assert.equal(fs.existsSync(root+'/.runner.lock'),false);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('proposal dry mode refuses hosted state before credentials, persistence or connection',async()=>{
  const root=fs.mkdtempSync(new URL('../.dry-test-',import.meta.url));let connected=0;
  try{
    fs.writeFileSync(root+'/config.json','{"enabled":true}');
    assert.equal(await main({root,env:{DRY_RUN:'proposal',STATE_BACKEND:'github'},connect:async()=>{connected++;},output:()=>{}}),1);
    assert.equal(connected,0);assert.equal(fs.readdirSync(root).length,1);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
