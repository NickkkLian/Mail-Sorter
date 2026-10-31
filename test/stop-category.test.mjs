import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {main,stopCategory} from '../mail/scripts/classify.mjs';
import {settings} from '../mail/scripts/settings.mjs';
const privateText='secret-token subject private@mail.example id=12345';
test('only fixed categories can be logged, never arbitrary codes or messages',()=>{
 for(const [code,category]of [['STATE_WRITE_CONFLICT','state write conflict'],['STATE_WRITE_FAILED','state write failed'],['STATE_READ_FAILED','state read failed'],[privateText,'other'],['toString','other'],[undefined,'other']]){
  assert.equal(stopCategory(Object.assign(Error(privateText),{code})),category);
 }
});
async function run({connect,github=false,fetchImpl}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mail-stop-test-')),output=[],originalFetch=globalThis.fetch;
 fs.writeFileSync(path.join(root,'config.json'),JSON.stringify(settings({enabled:true})));
 try{
  if(fetchImpl)globalThis.fetch=fetchImpl;
  const result=await main({root,env:{GMAIL_USER:'fake@mail.example',GMAIL_APP_PASSWORD:'fake',RUN_NOW:'1',...(github?{STATE_BACKEND:'github',GITHUB_REPOSITORY:'owner/example',GITHUB_TOKEN:'fake'}:{})},connect,output:s=>output.push(s)});
  assert.equal(result,1);assert(!output.join().includes(privateText));assert(!output.join().includes('fake@mail.example'));
  return output;
 }finally{globalThis.fetch=originalFetch;fs.rmSync(root,{recursive:true,force:true});}
}
test('connection failure has a fixed category and suppresses private provider text',async()=>{
 const output=await run({connect:async()=>{throw Error(privateText);}});
 assert(output.some(s=>s.includes('Mailbox primary stopped safely; category: mailbox connection;')));
});
test('uncategorized cycle failure logs other and closes the fake mailbox',async()=>{
 let closed=false;
 const output=await run({connect:async()=>({scan:async()=>{throw Error(privateText);},close:async()=>{closed=true;}})});
 assert(output.some(s=>s.includes('Mailbox primary stopped safely; category: other;')));assert(closed);
});
for(const [status,category]of [[409,'state write conflict'],[503,'state write failed']])test(`failed PUT ${status} logs ${category} without connecting`,async()=>{
 let puts=0;
 const output=await run({github:true,connect:async()=>assert.fail('must not connect before saving'),fetchImpl:async(url,init)=>{
  const isPut=init.method==='PUT';if(isPut)puts++;
  return {ok:false,status:isPut?status:404,json:async()=>{throw Error(privateText);}};
 }});
 assert.equal(puts,4);assert(output.some(s=>s.includes('Mailbox primary stopped safely; category: '+category+';')));
});
test('failed initial state read logs its category without provider details',async()=>{
 const output=await run({github:true,connect:async()=>assert.fail('must not connect'),fetchImpl:async()=>({ok:false,status:500,json:async()=>{throw Error(privateText);}})});
 assert(output.some(s=>s.includes('Run stopped safely; category: state read failed;')));
});
