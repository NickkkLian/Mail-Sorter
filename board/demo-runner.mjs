import {mailKey,mailboxOf} from '../mail/scripts/mailbox-key.mjs';
import {senderAddress} from './report.mjs';
import {browserPolicyHash} from './browser-policy.mjs';
import {settings} from '../mail/scripts/settings.mjs';

export function makeDemoFiles(mail){
  const now=Date.parse(mail.updated_at),counts=[14,9,6,4,3,3,3,2,2,2,2,2,2,1,1,1,1,1,1,1,1,1,1];
  const names=['Harbour Goods','Northline Air','Field Supply','Cedar Market','Paper Shop','Trail Outfitters','Everyday Home','Studio Store','Garden Post','Beacon Books','Weekend Gear','Local Finds','Kitchen Post','Notice Desk','Account Mail','Sign-in Desk','Code Delivery','Access Mail','Weekly Reading','Design Notes','City Digest','Science Post','The Reading List'];
  let index=0;
  const items=counts.flatMap((count,sender)=>Array.from({length:count},(_,n)=>{
    const i=index++,rule=sender<14?'O4':sender<19?'O1':'O5';
    return {gmailId:String(9000+i),threadId:String(19000+i),uid:i+1,mailbox:'secondary',mailbox_address:'shop@inbox.example',
      from:names[sender]+' <mail@sender'+sender+'.example>',subject:rule==='O4'?['A weekend offer for you','New arrivals this week'][n%2]:rule==='O1'?'Your verification code has expired':'Your weekly reading digest',
      date:new Date(now-(40+i)*86400000).toISOString(),rule,reason:'Matched the saved age rule',action:'archive',unread:true,primary:i<21};
  }));
  const runs=Array.from({length:8},(_,i)=>{
    const offset=7-i,at=new Date(now-offset*43200000).toISOString(),kind=i===6?'dealt':undefined;
    const entries=i===7?Array.from({length:42},(_,n)=>({gmailId:String(4000+i*100+n),action:'archive',rule:'O4',at,status:'done',changeRead:true,originalLabels:[],label:'AI/Cleaned/O4'})):i===6?Array.from({length:3},(_,n)=>({gmailId:String(4000+i*100+n),action:'dealt',at,status:'done',changeRead:true,category:'finance',label:'AI/Money',addLabel:true})):[];
    return {id:'past-sort-'+i,proposal_id:'past-review-'+i,kind,...(kind?{dealt_request_id:'past-done'}:{}),mailbox:i%2?'secondary':'primary',mailbox_address:i%2?'shop@inbox.example':'me@inbox.example',at,status:'finished',entries,sorted_count:i===7?42:i===6?3:0,skipped_count:i===7?2:0};
  });
  return {'mail/cleanup-proposal.json':{id:'demo-review-1',revision:'demo-revision-1',created_at:mail.updated_at,items,kept_back:{wrote_to:9,starred:3,protected:2,labels:0,uncertain:0}},
    'mail/cleanup-approval.json':null,'mail/cleanup-log.json':{runs,reviews:[]},'mail/cleanup-undo.json':{requests:[]},'mail/dealt-queue.json':{requests:[]}};
}

export function createDemoRunner(bridge,mail){
  const files=makeDemoFiles(mail),original=structuredClone(files['mail/cleanup-proposal.json']),versions=new Map();
  const ready=browserPolicyHash(bridge.getConfig()).then(policy=>{files['mail/cleanup-proposal.json'].policy=policy;});
  const appliedUndos=new Set(),appliedRequests=new Set();let sequence=1;
  const log=()=>files['mail/cleanup-log.json'];
  const counter=(mailbox,amount)=>{
    const history=mail.inbox_history.filter(row=>row.mailbox===mailbox),prior=history.at(-1);
    if(prior){const at=new Date().toISOString();if(prior.at===at){prior.inbox_unread_primary+=amount;prior.inbox_unread_all+=amount;}else mail.inbox_history.push({...prior,at,inbox_unread_primary:prior.inbox_unread_primary+amount,inbox_unread_all:prior.inbox_unread_all+amount});}
  };
  const complete=at=>{
    mail.updated_at=at;
    for(const key of Object.keys(mail.mailboxes||{})){
      if(key==='secondary'&&bridge.getConfig().second_mailbox_enabled!==true)continue;
      mail.mailboxes[key].updated_at=at;
      const prior=mail.inbox_history.findLast(sample=>sample.mailbox===key);
      if(prior&&prior.at<at)mail.inbox_history.push({...prior,at});
    }
    mail.inbox_history=mail.inbox_history.sort((a,b)=>a.at.localeCompare(b.at)).slice(-60);
    for(const path of Object.keys(files))versions.set(path,(versions.get(path)||0)+1);
  };
  const io={...bridge,
    get:async path=>({data:structuredClone(files[path]||null),sha:String(versions.get(path)||0)}),
    put:async(path,data,sha)=>{
      const write=()=>{if(String(versions.get(path)||0)!==String(sha))throw Error('Changed elsewhere');files[path]=structuredClone(data);versions.set(path,(versions.get(path)||0)+1);};
      return bridge.localWrite?bridge.localWrite(path,write):write();
    },
  };
  async function run(){
    await ready;
    if(bridge.getConfig()?.enabled===false)return;
    const at=new Date().toISOString();
    for(const request of files['mail/cleanup-undo.json'].requests){
      const key=request.run_id||request.dealt_request_id||request.approval_id||request.proposal_id+request.reviewed_at;if(appliedUndos.has(key))continue;
      const runs=log().runs.filter(run=>run.id===request.run_id||request.dealt_request_id&&run.dealt_request_id===request.dealt_request_id||request.proposal_id===run.proposal_id&&(request.approval_id?request.approval_id===run.approval_id:request.reviewed_at===run.approval_reviewed_at));
      for(const run of runs){
        for(const entry of run.entries){
          if(entry.status==='undone')continue;
          if(entry.primary&&(entry.changeRead||entry.action==='trash'))counter(run.mailbox,1);
          const item=mail.items.find(item=>mailKey(item)===mailKey({...entry,mailbox:run.mailbox}));if(item&&entry.changeRead)item.unread=true;
          entry.status='undone';entry.undo_status='done';
        }
        run.restored_at=at;
      }
      appliedUndos.add(key);
    }
    for(const request of files['mail/dealt-queue.json'].requests){
      if(appliedRequests.has(request.id)||appliedUndos.has(request.id))continue;
      for(const mailbox of new Set(request.items.map(mailboxOf))){
        const entries=request.items.filter(item=>mailboxOf(item)===mailbox).flatMap(item=>{
          const row=mail.items.find(row=>mailKey(row)===mailKey(item));if(!row)return [];
          const changeRead=bridge.getConfig()?.mark_dealt_read!==false&&row.unread;
          if(changeRead){row.unread=false;if(row.primary)counter(mailbox,-1);}
          return [{...item,primary:row.primary,action:'dealt',at,status:'done',changeRead,addLabel:true,label:'AI/'+item.category}];
        });
        log().runs.push({id:'demo-done-'+sequence++,kind:'dealt',dealt_request_id:request.id,mailbox,at,status:'finished',entries,skipped_count:0});
      }
      appliedRequests.add(request.id);
    }
    const approval=files['mail/cleanup-approval.json'],proposal=files['mail/cleanup-proposal.json'],policy=await browserPolicyHash(bridge.getConfig());
    if(proposal.policy!==policy){
      const config=settings(bridge.getConfig()),protectedSenders=new Set(config.protected.senders);
      const protectedItem=item=>protectedSenders.has(senderAddress(item.from))||config.protected.domains.some(domain=>senderAddress(item.from).endsWith('@'+domain)||senderAddress(item.from).endsWith('.'+domain));
      const items=original.items.filter(item=>!protectedItem(item)&&config.rules[item.rule].enabled&&!config.sender_labels[senderAddress(item.from)]).map(item=>({...item,action:config.rules[item.rule].action}));
      files['mail/cleanup-proposal.json']={...structuredClone(original),id:'demo-review-'+sequence++,revision:'demo-revision-'+sequence,created_at:at,policy,items,kept_back:{...original.kept_back,protected:original.kept_back.protected+original.items.filter(protectedItem).length}};
      files['mail/cleanup-approval.json']=null;
      log().runs.push({id:'demo-prepared-'+sequence++,kind:'review',at,mailbox:'secondary',mailbox_address:'shop@inbox.example',status:'finished',sorted_count:42,entries:[]});
      complete(at);
      return;
    }
    const withdrawn=approval&&files['mail/cleanup-undo.json'].requests.some(request=>request.proposal_id===proposal.id&&(request.approval_id?request.approval_id===approval.id:request.reviewed_at===approval.reviewed_at));
    if(approval&&!withdrawn&&approval.proposal_id===proposal.id&&approval.revision===proposal.revision&&!log().runs.some(run=>run.proposal_id===proposal.id)){
      const chosen=proposal.items.filter(item=>approval.selected.includes(mailKey(item))),config=bridge.getConfig();
      const protectedSenders=new Set(config.protected?.senders||[]);
      const valid=chosen.filter(item=>!['9062','9063'].includes(item.gmailId)&&!protectedSenders.has(senderAddress(item.from)));
      const entries=valid.map(item=>({...item,at,status:'done',changeRead:item.unread&&(item.action!=='trash'||config.mark_dealt_read!==false),originalLabels:[],label:'AI/Cleaned/'+item.rule}));
      for(const entry of entries)if(entry.primary&&(entry.changeRead||entry.action==='trash'))counter(entry.mailbox,-1);
      log().runs.push({id:'demo-sort-'+sequence++,proposal_id:proposal.id,approval_id:approval.id,approval_reviewed_at:approval.reviewed_at,mailbox:'secondary',mailbox_address:'shop@inbox.example',at,status:'finished',entries,sorted_count:42,skipped_count:chosen.length-valid.length});
    }
    const last=log().runs.findLast(run=>run.proposal_id===proposal.id);
    if(last?.entries.length&&last.entries.every(entry=>entry.status==='undone')){
      files['mail/cleanup-proposal.json']={...structuredClone(original),id:'demo-review-'+sequence,revision:'demo-revision-'+sequence,created_at:at,policy};
      files['mail/cleanup-approval.json']=null;
    }
    complete(at);
  }
  return {io,run,files,ready};
}
