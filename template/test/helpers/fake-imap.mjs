const check=x=>{if(!x)throw Error("Fake client contract failed (data suppressed)");};
export function fake({sent=0,missingThread=false,bodySize=20,seen=true,downloadError=false}={}){
  const actions=[],flags=new Set(['\\Seen']),record={uid:11,emailId:9007199254740993001n,threadId:missingThread?null:'555',envelope:{from:[{address:'notices@service.example'}],subject:'Verification code',date:new Date('2026-01-01')},labels:new Set(['Original']),flags,bodyStructure:{type:'text/plain',part:'1',size:bodySize}},sentRecord={uid:1,threadId:'555',envelope:{to:[{address:'notices@service.example'}]}};
  class Client{
    constructor(options){check(options.logger===false);this.box='';this.mailbox={uidValidity:9n};this.inbox=true;}
    on(){}async connect(){actions.push('connect');}async logout(){actions.push('close');}
    async list(){return ['All','Trash','Sent'].map(x=>({path:x,specialUse:'\\'+x}));}
    async mailboxOpen(box){this.box=box;}
    async search(query){if(this.box==='Sent')return Array.from({length:sent},(_,i)=>i+1);if(query.gmailRaw)return query.gmailRaw==='category:primary'&&this.inbox?[11]:[];if(query.emailId)return (this.box==='INBOX'&&this.inbox||this.box==='All'&&!this.inbox)?[record.uid]:[];return this.box==='INBOX'&&this.inbox?[11]:[];}
    async *fetch(uids){if(this.box==='Sent'){for(const uid of uids)yield {...sentRecord,uid};}else if(uids.length)yield record;}
    async fetchOne(){return record;}async mailboxCreate(){}
    async messageFlagsAdd(uid,labels,options){check(options.useLabels===true&&labels.every(x=>!x.startsWith('\\')));for(const x of labels)record.labels.add(x);actions.push('label');}
    async messageFlagsRemove(uid,labels,options){if(options.useLabels===true){for(const x of labels)record.labels.delete(x);actions.push('unlabel');}else{check(labels.length===1&&labels[0]==='\\Seen');flags.delete('\\Seen');actions.push('unseen');}}
    async messageMove(uid,destination){check(destination==='All'||destination==='Trash'||destination==='INBOX');this.inbox=destination==='INBOX';record.uid++;actions.push(destination);}
    async messageCopy(uid,destination){check(destination==='INBOX');this.inbox=true;record.uid++;actions.push('restore');}
    async download(){flags.add('\\Seen');if(downloadError)throw Error('Download unavailable');return {content:(async function*(){yield Buffer.from('fictional body');})()};}
  }if(!seen)flags.clear();return {Client,record,flags,actions};
}
