// Shared by the production adapter and the read-only sampler. No network or body access.
export const SAMPLE_FIELDS=['gmailId','threadId','from','fromAddr','subject','date','tab','labels','bulk','starred','important','replied','threadParticipated','everWritten','protectionComplete','inInbox','shippingSender','notificationSender','personal','needsReply'];
export function decodeLabel(value){return String(value).replace(/&([A-Za-z0-9+,]*)-/g,(whole,encoded)=>{
  if(!encoded)return '&';const base=encoded.replace(/,/g,'/'),bytes=Buffer.from(base+'='.repeat((4-base.length%4)%4),'base64');
  if(!bytes.length||bytes.length%2||bytes.toString('base64').replace(/=+$/,'')!==base)throw Error('Invalid label encoding');
  const text=Buffer.from(bytes).swap16().toString('utf16le');if(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text))throw Error('Invalid label encoding');return text;
});}
export function normalizeMetadata(m,{inInbox=true,tabSets={},sentThreads=new Set(),written=new Set(),protectionComplete=false}={}){
    const e=m.envelope||{},f=e.from?.[0]||{},a=(f.address||'').toLowerCase(),flags=new Set(m.flags||[]),threadId=m.threadId==null?'':String(m.threadId);let labels=[],labelsKnown=true;
    try{labels=[...(m.labels||[])].map(decodeLabel);}catch{labelsKnown=false;}
    const received=Date.parse(m.internalDate),header=Date.parse(e.date),date=Number.isFinite(received)?new Date(received).toISOString():Number.isFinite(header)?new Date(header).toISOString():null;
    const bulk=/list-unsubscribe|precedence:\s*(?:bulk|list)/i.test(String(m.headers||''));
    return {uid:m.uid,gmailId:m.emailId==null?'':String(m.emailId),threadId,msgid:(e.messageId||'').replace(/^<|>$/g,''),from:(f.name?f.name+' ':'')+'<'+a+'>',fromAddr:a,subject:e.subject||'(no subject)',date,
      bulk,personal:!bulk&&!/no.?reply|notices|notif|alert|account|verify|security|calendar|shipment|delivery|support@|info@|admin@|mailer|automated|news@|offers@/i.test(a),labels,starred:flags.has('\\Flagged')||labels.includes('\\Starred'),important:labels.includes('\\Important'),
      needsReply:labels.includes('AI/重要待办'),replied:sentThreads.has(threadId),threadParticipated:sentThreads.has(threadId),everWritten:written.has(a),protectionComplete:protectionComplete&&labelsKnown&&m.labels!=null&&m.flags!=null&&!!threadId,inInbox,
      tab:inInbox?Object.keys(tabSets).find(t=>tabSets[t].has(m.uid))||'unknown':'unknown',
      shippingSender:/@(?:[^@]+\.)?(?:ups\.com|fedex\.com|usps\.com|canadapost-postescanada\.ca|amazon\.[a-z.]+|shop\.example)$/.test(a),
      notificationSender:/notification|notify|noreply@(?:github|linkedin)\./i.test(a),bodyStructure:m.bodyStructure};
  }
