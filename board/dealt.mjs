import {mailKey} from '../mail/scripts/mailbox-key.mjs';
const QUEUE='mail/dealt-queue.json',LOG='mail/cleanup-log.json',UNDO='mail/cleanup-undo.json';
export class DealtController{
  constructor(io){this.io=io;this.requests=[];this.runs=[];this.undos=[];}
  async load(){const [queue,log,undo]=await Promise.all([QUEUE,LOG,UNDO].map(p=>this.io.get(p,true)));this.requests=queue.data?.requests||[];this.runs=(log.data?.runs||[]).filter(r=>r.kind==='dealt');this.undos=undo.data?.requests||[];}
  run(request){const runs=this.runs.filter(r=>r.dealt_request_id===request.id);return runs.length?{entries:runs.flatMap(r=>r.entries.map(e=>({...e,mailbox:r.mailbox}))),skipped_count:runs.reduce((n,r)=>n+(r.skipped_count||0),0)}:null;}
  undone(request){const run=this.run(request);return run?run.entries.length>0&&run.entries.every(e=>e.status==='undone'):this.undos.some(u=>u.dealt_request_id===request.id);}
  status(id){
    for(const request of this.requests.slice().reverse()){
      if(!request.items.some(i=>mailKey(i)===id)||this.undone(request))continue;
      const run=this.runs.find(r=>r.dealt_request_id===request.id&&request.items.some(i=>mailKey(i)===id&&(i.mailbox||'primary')===(r.mailbox||'primary'))),entry=run?.entries.find(e=>mailKey({...e,mailbox:run.mailbox})===id);
      if(!run)return 'queued';if(entry?.status==='done')return 'done';if(entry&&entry.status!=='undone')return 'uncertain';
    }return null;
  }
  async mark(items){
    await this.load();const chosen=items.filter(i=>/^\d+$/.test(i.gmailId)&&!this.status(mailKey(i))).slice(0,150).map(({gmailId,category,mailbox})=>({gmailId,category,...(mailbox?{mailbox}:{})}));if(!chosen.length)return;
    const latest=await this.io.get(QUEUE,true),data=latest.data||{requests:[]};
    // CAS, no automatic retry: concurrent queues must be refreshed before another decision.
    data.requests.push({id:globalThis.crypto.randomUUID(),items:chosen,requested_at:new Date().toISOString()});
    await this.io.put(QUEUE,data,latest.sha,'mail: mark digest mail as dealt');await this.load();
  }
  async undo(request){
    const latest=await this.io.get(UNDO,true),data=latest.data||{requests:[]};
    if(!data.requests.some(u=>u.dealt_request_id===request.id))data.requests.push({dealt_request_id:request.id,requested_at:new Date().toISOString()});
    await this.io.put(UNDO,data,latest.sha,'mail: undo dealt mail');await this.load();
  }
}
export function mountDealt(bridge,document){
  const host=document.getElementById('dealt-toolbar');if(!host)return;
  const controller=new DealtController(bridge);let busy=false,loaded=false,error='';
  const t=(en,zh)=>bridge.language()==='zh'?zh:en;
  const el=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
  const button=(text,fn)=>{const n=el('button',text);n.type='button';n.className='btn btn-sm';n.disabled=busy;n.addEventListener('click',()=>perform(fn));return n;};
  async function perform(fn){if(busy)return;busy=true;paint();try{await (globalThis.HubSettingsRuntime?HubSettingsRuntime.track(fn):fn());error='';}catch{error=t('Save not confirmed. Refresh before trying again.','未确认保存。请刷新后重试。');}finally{busy=false;paint();}}
  function paint(){
    host.hidden=!bridge.available();if(host.hidden)return;
    host.replaceChildren();
    const bulk=button(t('Mark all shown as dealt','将所有显示邮件标为已处理'),()=>controller.mark(bridge.shownItems()));bulk.dataset.dealtAll='';bulk.disabled=busy||!loaded||bridge.getConfig()?.enabled===false||!bridge.shownItems().some(i=>/^\d+$/.test(i.gmailId)&&!controller.status(mailKey(i)));host.append(bulk);
    const hint=el('p',bridge.getConfig()?.enabled===false?t('Classification is off. Enable it in Settings to process dealt mail.','定时分类已关闭。请在设置中启用以处理邮件。'):t('Applies on the next mail-sync run (scheduled 15:00 / 22:00 UTC; schedules may be delayed). Mail stays in Inbox. The saved “Mark dealt mail as read” setting is used then.','将在下次 mail-sync 运行时应用（计划为 UTC 15:00 / 22:00，可能延迟）。邮件保留在收件箱；届时使用已保存的“将已处理邮件标为已读”设置。'));hint.className='hint';host.append(hint);
    const status=el('p',error);status.setAttribute('role','status');status.setAttribute('aria-live','polite');host.append(status);
    const history=el('details'),summary=el('summary',t('Dealt history and Undo','处理记录与撤销'));history.open=true;history.append(summary);host.append(history);
    for(const request of controller.requests.slice().reverse()){
      const run=controller.run(request),row=el('div');row.className='dealt-history';
      const undone=controller.undone(request),undoQueued=controller.undos.some(u=>u.dealt_request_id===request.id);
      const state=undone?t('Undone','已撤销'):undoQueued?t('Undo queued','撤销待同步'):run?run.entries.some(e=>e.status==='uncertain'||e.status==='intent'||['retry','missing'].includes(e.undo_status))?t('Needs Undo or manual check','需撤销或手动检查'):t('Processed','已同步'):t('Queued','待同步');
      row.append(el('span',`${request.items.length} · ${state}`));
      if(run)row.append(el('span',t(`${run.entries.length} applied or attempted; ${run.skipped_count||0} skipped`,`${run.entries.length} 封已应用或尝试；跳过 ${run.skipped_count||0} 封`)));
      const undo=button(t('Undo','撤销'),()=>controller.undo(request));undo.disabled=busy||undone||(undoQueued&&!run?.entries.some(e=>['retry','missing'].includes(e.undo_status)));row.append(undo);history.append(row);
    }
    for(const b of document.querySelectorAll('[data-dealt-id]')){const s=controller.status(b.dataset.dealtId);b.textContent=s?({queued:t('Dealt · queued','已处理 · 待同步'),done:t('Dealt','已处理'),uncertain:t('Check dealt history','请查看处理记录')}[s]):t('Dealt','已处理');b.disabled=busy||!loaded||Boolean(s)||bridge.getConfig()?.enabled===false;b.setAttribute('aria-label',b.textContent+' · '+(bridge.shownItems().find(i=>mailKey(i)===b.dataset.dealtId)?.subject||''));}
  }
  async function load(){if(!bridge.available()){paint();return;}await perform(async()=>{await controller.load();loaded=true;});}
  document.addEventListener('click',e=>{const b=e.target.closest('[data-dealt-id]');if(b&&!b.disabled)perform(()=>controller.mark(bridge.shownItems().filter(i=>mailKey(i)===b.dataset.dealtId)));});
  document.addEventListener('headersort-list',paint);bridge.subscribe(load);const ready=load();return {ready,controller,load};
}
if(typeof document!=='undefined'&&globalThis.HeadersortBoard){
 const bridge=HeadersortBoard;
 if(bridge.demo){const files={};mountDealt({...bridge,get:async p=>({data:structuredClone(files[p]||null),sha:null}),put:async(p,d)=>{files[p]=structuredClone(d);}},document);}else mountDealt(bridge,document);
}
