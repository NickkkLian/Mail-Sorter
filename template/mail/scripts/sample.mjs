// Private operational tool. No model, settings, production adapter, or mutation capability is imported.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizeMetadata,SAMPLE_FIELDS} from './metadata.mjs';

const POOL_HEADERS=['from','subject','date','list-unsubscribe','precedence'];
const READ_VERBS=new Set(['on','connect','logout','list','mailboxOpen','status','search','fetch']);
const fail=()=>{throw Error('Read-only capability denied');};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>keys.includes(k));
// Unknown verbs, raw commands and client internals are inaccessible.
export function readOnlyClient(target){
  return new Proxy(Object.create(null),{
    get(_unused,verb){
      if(!READ_VERBS.has(verb))return fail();
      return (...args)=>{
        if(verb==='mailboxOpen'&&(args.length!==2||typeof args[0]!=='string'||!exact(args[1],['readOnly'])||args[1].readOnly!==true))fail();
        if(verb==='status'&&(args.length!==2||!exact(args[1],['unseen'])||args[1].unseen!==true))fail();
        if(verb==='search'&&(!exact(args[0],['all','gmailRaw'])||!exact(args[1],['uid'])||args[1].uid!==true||args.length!==2))fail();
        if(verb==='fetch'){
          const [,q,o]=args;
          if(args.length!==3||!Array.isArray(args[0])||!exact(q,['uid','emailId','threadId','internalDate','flags','labels','headers','envelope'])||!exact(o,['uid'])||o.uid!==true)fail();
          if(Object.entries(q).some(([k,v])=>k==='headers'? !Array.isArray(v)||v.some(x=>!POOL_HEADERS.includes(x)):v!==true))fail();
          // Recipients are read ONLY for the complete in-memory Sent index.
          if(q.envelope&&Object.keys(q).some(k=>!['uid','threadId','envelope'].includes(k)))fail();
        }
        if(verb==='on'){
          if(args[0]!=='error'||typeof args[1]!=='function'||args.length!==2)fail();
          target.on?.(...args);return undefined; // EventEmitter.on would otherwise leak the raw client.
        }
        if(['connect','logout','list'].includes(verb)&&args.length)fail();
        if(['connect','logout','mailboxOpen'].includes(verb))return Promise.resolve(target[verb](...args)).then(()=>undefined);
        return target[verb](...args);
      };
    },set:fail,defineProperty:fail,deleteProperty:fail,setPrototypeOf:fail,
  });
}

// Discovery signals, never expected answers. Age cutoffs/terms mirror rules.json and rules.mjs.
export const SIGNALS={
  O1:'older_than:1d {subject:"verification code" subject:"your code is" subject:"one-time code" subject:"one-time password" subject:"confirm your email" subject:"verify your email" subject:"sign-in link" subject:验证码 subject:验证链接}',
  O2:'older_than:7d {subject:shipped subject:"out for delivery" subject:delivered subject:"order is on its way" subject:shipment subject:物流 subject:已送达}',
  O3:'older_than:2d {subject:invitation subject:"event reminder" subject:calendar subject:"starts in" subject:"starting in" subject:邀请 subject:活动提醒}',
  O4:'older_than:30d {category:promotions subject:sale subject:offer subject:discount subject:promotion subject:"% off" subject:促销 subject:优惠}',
  O5:'older_than:60d {subject:newsletter subject:digest subject:"weekly roundup" subject:"weekly reading" subject:订阅 subject:周报}',
  O6:'older_than:14d {category:social subject:"viewed your profile" subject:"new message" subject:"new notification" subject:"job alert" subject:commented subject:"mentioned you" subject:通知 subject:职位推荐 from:notification from:notify}',
  O7:'older_than:90d {subject:"new sign-in" subject:"new login" subject:"password changed" subject:"password was changed" subject:新登录 subject:密码已更改}',
  people:'{subject:hello subject:thanks subject:meeting subject:你好}',
  finance:'{subject:receipt subject:invoice subject:statement subject:"order confirm" subject:"payment confirm" subject:"transfer confirm" subject:"e-transfer" subject:"tax slip" subject:T4 subject:T5 subject:1099 subject:收据 subject:账单 subject:订单确认}',
  official:'{from:gc.ca from:canada.ca from:gov.uk subject:contract subject:agreement subject:"notice of assessment" subject:"insurance policy" subject:"lease agreement" subject:immigration subject:合同 subject:移民}',
  travel:'{subject:"booking confirm" subject:itinerary subject:"boarding pass" subject:"flight ticket" subject:"hotel reservation" subject:"check-in opens" subject:行程 subject:机票}',
  security:'{subject:suspicious subject:unauthorized subject:unauthorised subject:compromised subject:breach subject:"security incident" subject:"security vulnerability" subject:recovery subject:"action required" subject:"account created" subject:"account closed" subject:"terms update" subject:"2fa" subject:可疑 subject:泄露 subject:恢复}',
  school:'{from:edu from:ac.uk from:edu.cn from:utoronto.ca from:ubc.ca subject:"course registration" subject:"course enrol" subject:professor subject:tuition subject:课程 subject:学费}',
  job:'{subject:"application received" subject:"application status" subject:interview subject:"job offer" subject:recruiter subject:面试 subject:录用}',
  health:'{subject:clinic subject:prescription subject:pharmacy subject:"medical appointment" subject:"insurance claim" subject:patient subject:诊所 subject:处方}',
};

// Only the five listed headers are fetched; raw header blocks never reach serialization.
function words(value){
  return value.replace(/(\?=)\s+(=\?)/g,'$1$2').replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi,(_all,charset,encoding,text)=>{
    const bytes=encoding.toLowerCase()==='b'?Buffer.from(text,'base64'):Buffer.from(text.replace(/_/g,' ').replace(/=([a-f0-9]{2})/gi,(_x,h)=>String.fromCharCode(parseInt(h,16))),'latin1');
    return new TextDecoder(charset,{fatal:true}).decode(bytes);
  });
}
function headerEnvelope(raw){
  const values={};
  for(const line of Buffer.from(raw||'').toString('utf8').replace(/\r?\n[ \t]+/g,' ').split(/\r?\n/)){
    const i=line.indexOf(':');if(i<1)continue;const key=line.slice(0,i).toLowerCase();if(POOL_HEADERS.includes(key))values[key]=words(line.slice(i+1).trim());
  }
  const from=values.from||'',match=from.match(/<([^<>\s]+@[^<>\s]+)>/)||from.match(/^([^<>\s]+@[^<>\s]+)$/);
  return {from:match?[{address:match[1],name:from.includes('<')?from.slice(0,from.indexOf('<')).trim().replace(/^"|"$/g,''):''}]:[],subject:values.subject,date:values.date};
}
const descending=ids=>[...new Set(ids||[])].sort((a,b)=>b-a);
async function fetchBatches(client,uids,query,fn){
  for(let i=0;i<uids.length;i+=200)for await(const message of client.fetch(uids.slice(i,i+200),query,{uid:true}))await fn(message);
}
function writeOutputs(dir,pool,report){
  // Refuse symlinked destinations and parents before creating or writing anything.
  for(const name of ['sample-pool.json','sample-report.json']){
    let current=path.resolve(dir,name);
    while(true){if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw Error('Unsafe sample output path');const parent=path.dirname(current);if(parent===current)break;current=parent;}
  }
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'sample-pool.json'),JSON.stringify(pool,null,2)+'\n',{mode:0o600});
  fs.writeFileSync(path.join(dir,'sample-report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
}

export async function runSample({client:rawClient,outputDir=fileURLToPath(new URL('../eval/',import.meta.url)),output=console.log,limit=3000,newest=1200}={}){
  if(!Number.isInteger(limit)||limit<1||limit>3000||!Number.isInteger(newest)||newest<0||newest>limit)throw Error('Invalid sample bounds');
  const started=Date.now(),client=readOnlyClient(rawClient),opened=[],written=new Set(),sentThreads=new Set();
  const report={messages_read:0,pool_messages:0,sent_index_complete:false,sent_messages_expected:0,sent_messages_read:0,labels_seen:{modified_utf7:0,plain:0},mailboxes:[],mailbox_open_mode:'EXAMINE',signals:{},run_time_ms:0};
  let protectionComplete=false,items=[];
  async function open(box,role){
    const before=await client.status(box,{unseen:true});if(!Number.isInteger(before?.unseen)||before.unseen<0)throw Error('Unread count unavailable');
    opened.push({box,role,unread_before:before.unseen});await client.mailboxOpen(box,{readOnly:true});
  }
  client.on('error',()=>{});
  try{
    await client.connect();
    const boxes=await client.list(),sent=boxes.find(x=>x.specialUse==='\\Sent'||x.flags?.has('\\Sent'))?.path;
    if(sent){
      try{
        await open(sent,'sent');
        const uids=descending(await client.search({all:true},{uid:true})),expected=new Set(uids),received=new Set();let valid=true;
        report.sent_messages_expected=uids.length;
        await fetchBatches(client,uids,{uid:true,threadId:true,envelope:true},m=>{
          report.messages_read++;report.sent_messages_read++;
          if(!expected.has(m.uid)||received.has(m.uid))valid=false;received.add(m.uid);
          if(m.threadId==null||!/^\d+$/.test(String(m.threadId))||!m.envelope)valid=false;else sentThreads.add(String(m.threadId));
          for(const x of [...(m.envelope?.to||[]),...(m.envelope?.cc||[]),...(m.envelope?.bcc||[])]){
            if(typeof x.address!=='string'||!x.address.includes('@'))valid=false;else written.add(x.address.toLowerCase());
          }
        });
        // Detect concurrent additions/removals; no cap or cursor can turn a partial index into complete protection.
        const end=descending(await client.search({all:true},{uid:true}));
        protectionComplete=valid&&received.size===uids.length&&JSON.stringify(uids)===JSON.stringify(end);
      }catch{protectionComplete=false;}
    }
    report.sent_index_complete=protectionComplete;
    await open('INBOX','inbox');
    const all=descending(await client.search({all:true},{uid:true})),tabSets={};
    for(const tab of ['primary','promotions','social','updates','forums'])tabSets[tab]=new Set(await client.search({gmailRaw:'category:'+tab},{uid:true})||[]);
    const signalUids={};
    for(const [key,query]of Object.entries(SIGNALS)){
      const found=new Set(await client.search({gmailRaw:query},{uid:true})||[]);
      if(key==='people'){
        const addresses=[...written];
        for(let i=0;i<addresses.length;i+=50){
          const terms=addresses.slice(i,i+50).filter(x=>/^[a-z0-9.!#$%&'*+/=?^_`{|}~@-]+$/i.test(x)).map(x=>'from:'+x);
          if(terms.length)for(const uid of await client.search({gmailRaw:'{'+terms.join(' ')+'}'},{uid:true})||[])found.add(uid);
        }
      }
      signalUids[key]=descending([...found]);report.signals[key]={found:found.size,in_pool:0};
    }
    const selected=new Set(all.slice(0,newest));
    // Round-robin prevents one common class from consuming the entire older-mail budget.
    const queues=Object.values(signalUids);let index=0;
    while(selected.size<limit&&queues.some(q=>index<q.length)){
      for(const q of queues)if(index<q.length&&selected.size<limit)selected.add(q[index]);index++;
    }
    for(const uid of all){if(selected.size>=limit)break;selected.add(uid);}
    const seenUids=new Set(),stableIds=new Set();
    await fetchBatches(client,descending([...selected]),{uid:true,emailId:true,threadId:true,internalDate:true,flags:true,labels:true,headers:POOL_HEADERS},m=>{
      report.messages_read++;if(!selected.has(m.uid)||seenUids.has(m.uid))throw Error('Sample fetch mismatch');seenUids.add(m.uid);
      for(const label of m.labels||[])report.labels_seen[/&[A-Za-z0-9+,]*-/.test(label)?'modified_utf7':'plain']++;
      const normalized=normalizeMetadata({...m,envelope:headerEnvelope(m.headers)},{inInbox:true,tabSets,sentThreads,written,protectionComplete});
      if(!/^\d+$/.test(normalized.gmailId)||!/^\d+$/.test(normalized.threadId)||stableIds.has(normalized.gmailId))throw Error('Sample identity unavailable');stableIds.add(normalized.gmailId);
      if(!normalized.fromAddr)normalized.protectionComplete=false;
      items.push(Object.fromEntries(SAMPLE_FIELDS.map(key=>[key,normalized[key]])));
    });
    if(seenUids.size!==selected.size)throw Error('Sample fetch incomplete');
    for(const [key,ids]of Object.entries(signalUids))report.signals[key].in_pool=ids.filter(uid=>seenUids.has(uid)).length;
    items.sort((a,b)=>(Date.parse(b.date)||0)-(Date.parse(a.date)||0)||(BigInt(a.gmailId)<BigInt(b.gmailId)?1:-1));
    for(const openedBox of opened){
      const after=await client.status(openedBox.box,{unseen:true});
      if(!Number.isInteger(after?.unseen)||after.unseen!==openedBox.unread_before)throw Error('Unread counts changed; sample not published');
      report.mailboxes.push({role:openedBox.role,unread_before:openedBox.unread_before,unread_after:after.unseen});
    }
  }finally{await client.logout();}
  report.pool_messages=items.length;report.run_time_ms=Date.now()-started;
  const pool={schema_version:1,now:new Date().toISOString(),items};
  writeOutputs(outputDir,pool,report);
  output(`Sample: ${report.pool_messages} messages; metadata reads ${report.messages_read}; Sent complete ${Number(protectionComplete)}; unread counts unchanged.`);
  for(const [key,value]of Object.entries(report.signals))output(`${key}: found ${value.found}; in pool ${value.in_pool}`);
  return {pool,report};
}

export async function main({env=process.env,createClient,output=console.log}={}){
  try{
    if(!env.GMAIL_USER||!env.GMAIL_APP_PASSWORD)throw Error('Missing configuration');
    const Client=createClient||(await import('imapflow')).ImapFlow;
    const client=new Client({host:'imap.gmail.com',port:993,secure:true,auth:{user:env.GMAIL_USER,pass:env.GMAIL_APP_PASSWORD},logger:false,emitLogs:false});
    await runSample({client,output,outputDir:path.resolve('mail/eval')});return 0;
  }catch{output('Sample failed; no message data or connection errors logged.');return 1;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=await main();
