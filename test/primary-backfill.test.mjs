import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {main} from '../mail/scripts/classify.mjs';
import {connectMailbox} from '../mail/scripts/imap.mjs';
import {emptyState,makeProposal,runCycle} from '../mail/scripts/core.mjs';
import {settings} from '../mail/scripts/settings.mjs';
import {message} from '../eval/synthetic.mjs';
const now=new Date('2026-10-31T12:00:00Z');
const config=settings({enabled:true,max_per_run:2,max_backfill:4});
const messages=[message({uid:1,gmailId:'1',subject:'Verification code',date:'2020-01-01',seen:false}),...Array.from({length:6},(_,i)=>message({uid:i+2,gmailId:String(i+2),subject:'Verification code',date:`2026-09-0${i+1}T00:00:00.000Z`,seen:false})),message({uid:9,gmailId:'9',subject:'Seasonal sale',date:'2026-10-01T00:00:00.000Z',tab:'promotions',bulk:true,seen:false})];
async function pendingState(){const state=emptyState();await makeProposal({config,state,now,messages:[messages[0]]});state.runtime.reviewBefore={date:'2021-01-01',uid:20};return state;}
const scanResult={messages:[],done:true,uidValidity:'1'};
test('backfill ignores daily review cursor, expands Primary review and reserves pending items; daily resumes unchanged',async()=>{
 const state=await pendingState(),cursor=structuredClone(state.runtime.reviewBefore),queries=[];
 const mailbox={scan:async()=>scanResult,get:async id=>messages.find(m=>m.gmailId===id),scanReview:async q=>{queries.push(q);return {messages:messages.filter(m=>m.tab==='primary').sort((a,b)=>b.date.localeCompare(a.date)).slice(0,q.limit),done:false,next:{date:'2026-09-03',uid:4}};},addLabel:async()=>{},archive:async()=>assert.fail('unapproved archive')};
 await runCycle({config,state,mailbox,persist:async()=>{},now,backfill:true});
 assert.deepEqual(queries,[{before:null,limit:4,primaryOnly:true}]);
 assert.deepEqual(state.proposal.items.map(x=>x.gmailId),['7','6','5','1']);
 assert.deepEqual(state.runtime.reviewBefore,cursor);assert.equal(state.journal.runs.length,0);
 const p=structuredClone(state.proposal);
 await runCycle({config,state,mailbox,persist:async()=>{},now:new Date(now.getTime()+86400000),force:true});
 assert.deepEqual(state.proposal,p,'daily run must not shrink a pending backfill batch');assert.deepEqual(state.runtime.reviewBefore,cursor);
 // Once the batch has been consumed, ordinary review resumes using its own cursor and cap.
 state.journal.runs.push({id:'consumed',proposal_id:p.id,status:'finished',entries:[]});
 await runCycle({config,state,mailbox,persist:async()=>{},now:new Date(now.getTime()+2*86400000),force:true});
 assert.deepEqual(queries.at(-1),{before:cursor,limit:2,primaryOnly:false});assert.equal(state.proposal.items.length,2);
});
test('workflow BACKFILL reaches main → runCycle → real scanReview → expanded proposal, without RUN_NOW or approval',async()=>{
 const workflow=fs.readFileSync(new URL('../template/.github/workflows/mail-sync.yml',import.meta.url),'utf8');
 assert(workflow.includes("BACKFILL: ${{ inputs.backfill && '1' || '0' }}"));assert(workflow.includes('run: node mail/scripts/classify.mjs'));
 const state=await pendingState(),root=fs.mkdtempSync(new URL('../.tmp-primary-backfill-',import.meta.url)),queries=[],reviewCalls=[],mutations=[];
 class Client{
  constructor(){this.mailbox={uidValidity:'1'};this.box='';}on(){}async connect(){}async logout(){}
  async list(){return ['All','Trash','Sent'].map(path=>({path,specialUse:'\\'+path}));}
  async mailboxOpen(box){this.box=box;}
  async search(q){
   if(this.box==='Sent')return [];
   if(q.emailId)return messages.filter(m=>m.gmailId===q.emailId).map(m=>m.uid);
   if(q.gmailRaw){queries.push(q.gmailRaw);if(q.gmailRaw.startsWith('in:inbox is:unread'))return messages.filter(m=>!q.gmailRaw.includes('category:primary')||m.tab==='primary').map(m=>m.uid);return messages.filter(m=>'category:'+m.tab===q.gmailRaw).map(m=>m.uid);}
   return messages.map(m=>m.uid);
  }
  raw(m){return {uid:m.uid,emailId:m.gmailId,threadId:String(100+m.uid),envelope:{subject:m.subject,from:[{address:'notices@service.example'}],date:new Date(m.date)},flags:new Set(),labels:new Set(),headers:Buffer.from(m.bulk?'Precedence: bulk\r\n':''),bodyStructure:{}};}
  async *fetch(uids){for(const m of messages.filter(m=>uids.includes(m.uid)))yield this.raw(m);}
  async fetchOne(uid){return this.raw(messages.find(m=>m.uid===uid));}
  async mailboxCreate(){}async messageFlagsAdd(){}async messageFlagsRemove(){}
  async messageMove(){mutations.push('move');}async messageCopy(){mutations.push('copy');}
 }
 try{
  for(const [name,value]of Object.entries({'config.json':config,'mail.json':state.digest,'runtime.json':state.runtime,'cleanup-proposal.json':state.proposal,'cleanup-log.json':state.journal}))fs.writeFileSync(root+'/'+name,JSON.stringify(value));
  const result=await main({root,env:{BACKFILL:'1',GMAIL_USER:'synthetic',GMAIL_APP_PASSWORD:'synthetic',ANTHROPIC_API_KEY:'synthetic-placeholder'},connect:async(c,e)=>{const box=await connectMailbox(c,e,Client),scan=box.scanReview;box.scanReview=async q=>{reviewCalls.push(q);return scan(q);};return box;},output:()=>{}});
  assert.equal(result,0);assert.deepEqual(reviewCalls,[{before:null,limit:4,primaryOnly:true}]);
  assert(queries.includes('in:inbox is:unread category:primary'));
  const p=JSON.parse(fs.readFileSync(root+'/cleanup-proposal.json'));
  assert.deepEqual(p.items.map(x=>x.gmailId),['7','6','5','1']);assert(!p.items.some(x=>x.gmailId==='9'));assert.deepEqual(mutations,[]);
  assert.deepEqual(JSON.parse(fs.readFileSync(root+'/runtime.json')).reviewBefore,state.runtime.reviewBefore);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
