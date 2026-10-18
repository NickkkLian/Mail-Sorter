// Gmail-only adapter. Dynamic dependency loading keeps imports/tests/disabled CLI offline.
// No delete, expunge, mark-read, reply, or arbitrary-folder operation is exposed.
// Gmail can return either decoded UTF-8 names or RFC 3501 modified UTF-7. Malformed encodings fail closed.
import {normalizeMetadata} from "./metadata.mjs";
export {decodeLabel} from "./metadata.mjs";
export async function connectMailbox(config,env,createClient){
  const ImapFlow=createClient||((await import('imapflow')).ImapFlow);
  const client=new ImapFlow({host:'imap.gmail.com',port:993,secure:true,auth:{user:env.GMAIL_USER,pass:env.GMAIL_APP_PASSWORD},logger:false,emitLogs:false});
  client.on?.('error',()=>{});await client.connect();
  try{
  const boxes=await client.list();const folder=flag=>boxes.find(x=>x.specialUse===flag||x.flags?.has(flag))?.path;
  const all=folder('\\All'),trash=folder('\\Trash'),sent=folder('\\Sent');
  if(!all||!trash||!sent){await client.logout();throw Error('Required Gmail folders unavailable');}
  const sentThreads=new Set(),written=new Set();let protectionComplete=true;
  await client.mailboxOpen(sent);
  const sentUids=await client.search({all:true},{uid:true})||[];
  if(sentUids.length>config.max_sent)protectionComplete=false;
  let sentFetched=0;
  if(protectionComplete&&sentUids.length)for await(const m of client.fetch(sentUids,{threadId:true,envelope:true},{uid:true})){
    sentFetched++;
    if(m.threadId==null){protectionComplete=false;continue;}sentThreads.add(String(m.threadId));
    for(const x of [...(m.envelope?.to||[]),...(m.envelope?.cc||[]),...(m.envelope?.bcc||[])])if(x.address)written.add(x.address.toLowerCase());
  }
  if(protectionComplete&&sentFetched!==sentUids.length)protectionComplete=false;
  const fetchFields={uid:true,emailId:true,threadId:true,envelope:true,internalDate:true,flags:true,labels:true,headers:['list-unsubscribe','precedence'],bodyStructure:true};
  let tabSets={};
  async function inbox(){await client.mailboxOpen('INBOX');}
  async function tabs(){tabSets={};for(const tab of ['primary','promotions','social','updates','forums'])tabSets[tab]=new Set(await client.search({gmailRaw:'category:'+tab},{uid:true})||[]);}
  const metadata=(m,inInbox)=>normalizeMetadata(m,{inInbox,tabSets,sentThreads,written,protectionComplete});
  async function locate(id){
    if(!/^\d+$/.test(String(id)))throw Error('Invalid stable ID');
    // Recheck INBOX first so execution always has fresh flags, labels, and tab evidence.
    for(const box of ['INBOX',all,trash]){await client.mailboxOpen(box);const u=await client.search({emailId:String(id)},{uid:true})||[];if(u.length===1){if(box==='INBOX')await tabs();const m=await client.fetchOne(u[0],fetchFields,{uid:true});if(m&&String(m.emailId)===String(id))return {m,box};}}
    return null;
  }
  async function withMessage(id,fn){const x=await locate(id);if(!x)throw Error('Message unavailable');return fn(x);}
  return {
    async scan({after,expectedUidValidity,limit,primaryOnly}){await inbox();await tabs();const validity=String(client.mailbox.uidValidity||'');const reset=expectedUidValidity!=null&&expectedUidValidity!==validity;if(reset)after=0;const u=(await client.search(primaryOnly?{gmailRaw:'category:primary'}:{all:true},{uid:true})||[]).filter(x=>x>after).sort((a,b)=>a-b);const page=u.slice(0,limit),messages=[];
      if(page.length)for await(const m of client.fetch(page,fetchFields,{uid:true}))messages.push(metadata(m,true));
      messages.sort((a,b)=>a.uid-b.uid);return {messages,done:u.length<=limit,uidValidity:validity,reset};},
    get:id=>withMessage(id,async x=>metadata(x.m,x.box==='INBOX')).catch(()=>null),
    addLabel:(id,label)=>withMessage(id,async x=>{try{await client.mailboxCreate(label);}catch{/* existing label */}await client.messageFlagsAdd(x.m.uid,[label],{uid:true,useLabels:true});}),
    removeLabel:(id,label)=>withMessage(id,x=>client.messageFlagsRemove(x.m.uid,[label],{uid:true,useLabels:true})),
    archive:id=>withMessage(id,x=>{if(x.box!=='INBOX')throw Error('Inbox changed');return client.messageMove(x.m.uid,all,{uid:true});}),
    trash:id=>withMessage(id,x=>{if(x.box!=='INBOX')throw Error('Inbox changed');return client.messageMove(x.m.uid,trash,{uid:true});}),
    restore:id=>withMessage(id,x=>x.box==='INBOX'?true:x.box===trash?client.messageMove(x.m.uid,'INBOX',{uid:true}):client.messageCopy(x.m.uid,'INBOX',{uid:true})),
    // Stage 2 supplies the privacy boundary; never fetch source/full MIME content here.
    async readBody(id){return withMessage(id,async x=>{
      if(x.m.flags==null)throw Error('Unread state unavailable');const wasSeen=x.m.flags.has('\\Seen');
      try{
      const parts=[];const visit=n=>{if(!n)return;if(['text/plain','text/calendar','text/html'].includes(n.type))parts.push(n);for(const ch of n.childNodes||[])visit(ch);};visit(x.m.bodyStructure);
      const plain=parts.find(p=>p.type==='text/plain')||parts.find(p=>p.type==='text/html'),calendar=parts.find(p=>p.type==='text/calendar'),selected=[plain,calendar].filter(Boolean);if(!selected.length)return null;
      let text='',bytes=0;
      for(const part of selected){if(!part.part||part.size>config.body_fetch_bytes-bytes)return null;const charset=part.parameters?.charset;if(charset&&!/^(?:utf-?8|us-ascii)$/i.test(charset))return null;
        const data=await client.download(x.m.uid,part.part,{uid:true,maxBytes:config.body_fetch_bytes-bytes}),decoder=new TextDecoder('utf-8');let current='';
        for await(const chunk of data.content){const room=config.body_fetch_bytes-bytes;if(room<=0){data.content.destroy();return null;}const section=chunk.subarray(0,room);bytes+=section.length;current+=decoder.decode(section,{stream:true});if(chunk.length>room){data.content.destroy();return null;}}text+=(text?'\n':'')+current+decoder.decode();
      }return bytes>=config.body_fetch_bytes?null:text;
      }finally{
        // Explicit fallback from FIXES.md §3: do not assume download() uses PEEK in an uninspected dependency.
        // If the message began unread, restore that state on success, truncation, and download/stream errors.
        if(!wasSeen)await client.messageFlagsRemove(x.m.uid,['\\Seen'],{uid:true});
      }
    });},
    async close(){await client.logout();}
  };
  }catch{try{await client.logout();}catch{}throw Error('Mailbox initialization unavailable');}
}
