import {mailKey,mailboxOf} from '../mail/scripts/mailbox-key.mjs';

export function nextSort(schedule,now=new Date()){
  if(!Array.isArray(schedule)||!schedule.length)return null;
  const candidates=schedule.filter(value=>/^([01]\d|2[0-3]):[0-5]\d$/.test(value)).map(value=>{
    const [hour,minute]=value.split(':').map(Number),date=new Date(now);
    date.setUTCHours(hour,minute,0,0);
    if(date<=now)date.setUTCDate(date.getUTCDate()+1);
    return date;
  });
  return candidates.sort((a,b)=>a-b)[0]||null;
}
export function localTime(value,language='en',timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone){
  if(!Number.isFinite(new Date(value).getTime()))return '—';
  // B.C. uses UTC-7 year-round. Older browser timezone tables may still apply a November change.
  const zone=['America/Vancouver','Canada/Pacific'].includes(timeZone)?'Etc/GMT+7':timeZone;
  const formatted=new Intl.DateTimeFormat(language==='zh'?'zh-CN':'en-US',{hour:'numeric',minute:'2-digit',timeZone:zone}).format(new Date(value));
  return language==='zh'?formatted:formatted.replace(/\s*AM$/,' a.m.').replace(/\s*PM$/,' p.m.');
}

export function senderAddress(from){return (String(from||'').match(/<([^>]+)>/)?.[1]||String(from||'')).trim().toLowerCase();}
export function senderName(from){return String(from||'').replace(/<[^>]*>/,'').trim()||senderAddress(from);}
export function groupSenders(items,{byRule=false}={}){
  const groups=new Map();
  for(const item of items){
    const key=[mailboxOf(item),senderAddress(item.from),...(byRule?[item.rule]:[])].join('|');
    if(!groups.has(key))groups.set(key,{key,from:item.from,name:senderName(item.from),rule:item.rule,mailbox:mailboxOf(item),items:[]});
    groups.get(key).items.push(item);
  }
  return [...groups.values()].sort((a,b)=>b.items.length-a.items.length||a.name.localeCompare(b.name));
}

export function selectedImpact(items,selected){
  const chosen=items.filter(item=>selected.has(mailKey(item))),unread=chosen.filter(item=>item.unread===true);
  const primaryKnown=chosen.every(item=>typeof item.unread==='boolean'&&typeof item.primary==='boolean');
  const threads=new Set(unread.filter(item=>item.primary===true).map(item=>mailboxOf(item)+':'+(item.threadId||item.gmailId)));
  return {count:chosen.length,archive:chosen.filter(item=>item.action!=='trash').length,trash:chosen.filter(item=>item.action==='trash').length,
    unread:chosen.every(item=>typeof item.unread==='boolean')?unread.length:null,primary:primaryKnown?threads.size:null};
}

export function projectedDrop({mail,mailbox,review,dealt,markRead=true,mode='primary'}){
  const chosen=new Map();
  if(markRead)for(const item of mail.items||[])if(mailboxOf(item)===mailbox&&dealt.status(mailKey(item))==='queued')chosen.set(mailKey(item),item);
  if(review.queued&&!review.consumed){
    const applied=new Set((review.data.journal.runs||[]).flatMap(run=>(run.entries||[]).filter(entry=>['done','undone'].includes(entry.status)).map(entry=>mailKey({...entry,mailbox:run.mailbox}))));
    for(const item of review.data.proposal?.items||[])if(mailboxOf(item)===mailbox&&review.data.approval.selected.includes(mailKey(item))&&!applied.has(mailKey(item)))chosen.set(mailKey(item),item);
  }
  const listed=new Set((mail.items||[]).map(mailKey));
  return new Set([...chosen.values()].filter(item=>item.unread===true&&(mode==='primary'?item.primary===true:listed.has(mailKey(item)))).map(item=>mode==='primary'?(item.threadId||item.gmailId):item.gmailId)).size;
}

export function meterData(mail,mailbox,{demo=false}={}){
  const account=mail.mailboxes?.[mailbox]||{},history=(mail.inbox_history||account.inbox_history||[]).filter(row=>!row.mailbox||row.mailbox===mailbox);
  const verified=demo||account.inbox_count_verified===true||mail.inbox_count_verified===true;
  const rows=(mail.items||[]).filter(item=>mailboxOf(item)===mailbox);
  const known=(rows.length>0||Boolean(mail.updated_at||account.updated_at))&&rows.every(item=>typeof item.unread==='boolean');
  const latest=history.at(-1);
  const measuredAt=Date.parse(latest?.at),sortedAt=Date.parse(account.updated_at||mail.updated_at);
  const available=verified&&Boolean(latest)&&Number.isFinite(measuredAt)&&(!Number.isFinite(sortedAt)||measuredAt>=sortedAt);
  const days=new Map();for(const sample of history)days.set(sample.at.slice(0,10),sample);
  return {address:account.mailbox_address||rows.find(item=>item.mailbox_address)?.mailbox_address||'',history:available?[...days.values()].slice(-14):[],verified,
    value:available?latest.inbox_unread_primary:known?rows.filter(item=>item.unread).length:null,
    at:account.updated_at||mail.updated_at||latest?.at,available};
}

export function safetyCopy(items,language='en'){
  const trash=items.some(item=>item.action==='trash'),archive=items.some(item=>item.action!=='trash');
  const destination=language==='zh'
    ?[archive?'归档后仍可在「所有邮件」找到，撤销可放回收件箱。':'',trash?'移入垃圾箱的邮件会在 30 天后被 Gmail 彻底删除，此前可以撤销。':''].filter(Boolean).join('')
    :[archive?'Archived mail stays in All Mail. Undo puts it back.':'',trash?'Mail moved to Trash is deleted for good by Gmail after 30 days. Undo works until then.':''].filter(Boolean).join(' ');
  return destination+(language==='zh'?'你回过信的人、加星邮件和受保护的发件人永远不会进清单。每封邮件动之前都会再核对一次。':' People you wrote to, starred mail and protected senders are never on this list. Each email is checked again before it moves.');
}
