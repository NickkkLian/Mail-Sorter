// Fictional metadata only. The planted payload must never reach logs or either output file.
export const BODY_CANARY='PLANTED_BODY_MUST_NOT_ESCAPE';
export function sampleFake({missingSent=false,partialSent=false,sentError=false,changedUnread=false,size=20}={}){
  const calls=[],flags=new Set(),sentFlags=new Set(),messages=Array.from({length:size},(_,i)=>({
    uid:i+1,emailId:9007199254740993001n+BigInt(i),threadId:String(500+i),
    headers:Buffer.from('From: =?UTF-8?B?5rWL6K+V?= <notices@service.example>\r\nSubject: Verification code\r\nDate: Thu, 1 Jan 2026 12:00:00 +0000\r\nList-Unsubscribe: <mailto:unsubscribe@service.example>\r\n'),
    internalDate:new Date('2026-01-02T12:00:00Z'),labels:new Set(i===0?['AI/&kc2JgV+FUp4-']:['AI/账号安全']),flags:i%2?new Set(['\\Seen']):flags,
    body:BODY_CANARY,source:BODY_CANARY,bodyParts:new Map([['1',BODY_CANARY]]),
    envelope:{to:[{address:'recipient@private.example'}]},snippet:BODY_CANARY
  }));
  let box='',statusReads=0;
  const client={
    on(){},async connect(){calls.push(['connect']);},async logout(){calls.push(['logout']);},
    async list(){return missingSent?[]:[{path:'Sent',specialUse:'\\Sent'}];},
    async mailboxOpen(path,options){calls.push(['mailboxOpen',path,options]);box=path;},
    async status(path,query){calls.push(['status',path,query]);statusReads++;const count=path==='Sent'?2:messages.filter(x=>!x.flags.has('\\Seen')).length;return {unseen:count+(changedUnread&&statusReads>2?1:0)};},
    async search(query,options){calls.push(['search',query,options]);if(box==='Sent')return [1,2];if(query.gmailRaw?.startsWith('category:'))return query.gmailRaw==='category:primary'?messages.map(x=>x.uid):[];return messages.map(x=>x.uid);},
    async *fetch(uids,query,options){calls.push(['fetch',uids,query,options]);if(box==='Sent'){
      if(sentError)throw Error(BODY_CANARY);for(const uid of partialSent?[1]:uids)yield {uid,threadId:'500',envelope:{to:[{address:'notices@service.example'}]},flags:sentFlags};
    }else for(const uid of uids)yield messages[uid-1];},
  };
  return {client,calls,flags,messages};
}
