import test from 'node:test';
import assert from 'node:assert/strict';
const {githubStore}=await import(process.env.STORAGE_UNDER_TEST||'../mail/scripts/storage.mjs');
const response=(status,data={})=>({status,ok:status>=200&&status<300,json:async()=>data});
const file=sha=>sha===null?response(404):response(200,{sha,encoding:'base64',content:Buffer.from('{}').toString('base64')});
function fixture(statuses,{initial='original',current=initial}={}){
 const calls=[],delays=[];let gets=0;
 const store=githubStore({repository:'owner/example',key:'fake',sleep:async ms=>delays.push(ms),fetchImpl:async(url,init)=>{
  calls.push({url,...init});
  if(init.method==='PUT')return response(statuses.shift(),{content:{sha:'saved'}});
  return file(gets++===0?initial:current);
 }});
 return {store,calls,delays,puts:()=>calls.filter(c=>c.method==='PUT').map(c=>JSON.parse(c.body))};
}
for(const status of [409,500,502,503,599])test(`${status}: unchanged file after branch/server failure retries and succeeds`,async()=>{
 const x=fixture([status,200]);await x.store.read('runtime.json',null);await x.store.write('runtime.json',{scanAfter:1});
 assert.equal(x.puts().length,2);assert(x.puts().every(p=>p.sha==='original'));assert.deepEqual(x.delays,[100]);
 const count=x.calls.length;await x.store.write('runtime.json',{scanAfter:1});assert.equal(x.calls.length,count);
});
for(const status of [409,503])for(const [initial,current]of [['original','changed'],[null,'created'],['original',null]])test(`${status}: file ${initial} to ${current} fails without overwriting`,async()=>{
 const x=fixture([status,200],{initial,current});await x.store.read('runtime.json',null);
 await assert.rejects(x.store.write('runtime.json',{scanAfter:1}),{message:'State write conflict or unavailable'});assert.equal(x.puts().length,1);
 // A failed validation must not adopt the competing SHA for a later write either.
 await x.store.write('runtime.json',{scanAfter:2});assert.equal(x.puts()[1].sha,initial??undefined);
});
for(const status of [409,500])test(`${status}: every attempt fails, bounded at four PUTs`,async()=>{
 const x=fixture([status,status,status,status]);await x.store.read('runtime.json',null);
 await assert.rejects(x.store.write('runtime.json',{scanAfter:1}),{message:'State write conflict or unavailable'});
 assert.equal(x.puts().length,4);assert(x.puts().every(p=>p.sha==='original'));assert.deepEqual(x.delays,[100,200,400]);
});
test('a file still absent may be created after a branch conflict',async()=>{
 const x=fixture([409,200],{initial:null});await x.store.write('runtime.json',{scanAfter:1});assert(x.puts().every(p=>!('sha'in p)));assert.equal(x.puts().length,2);
});
test('non-retryable status is not retried',async()=>{
 const x=fixture([403,200]);await assert.rejects(x.store.write('runtime.json',{scanAfter:1}));assert.equal(x.puts().length,1);assert.deepEqual(x.delays,[]);
});
test('a writer racing after validation is still guarded by the original PUT SHA',async()=>{
 let gets=0;const shas=[];
 const store=githubStore({repository:'owner/example',key:'fake',sleep:async()=>{},fetchImpl:async(url,init)=>{
  if(init.method==='PUT'){shas.push(JSON.parse(init.body).sha);return response(409);}
  return file(++gets<=2?'original':'changed');
 }});
 await assert.rejects(store.write('runtime.json',{scanAfter:1}),{message:'State write conflict or unavailable'});assert.deepEqual(shas,['original','original']);
});
test('failed recheck cannot issue another PUT',async()=>{
 let gets=0,puts=0;
 const store=githubStore({repository:'owner/example',key:'fake',sleep:async()=>{},fetchImpl:async(url,init)=>init.method==='PUT'?(puts++,response(503)):(++gets===1?file('original'):response(500))});
 await assert.rejects(store.write('runtime.json',{scanAfter:1}));assert.equal(puts,1);
});
