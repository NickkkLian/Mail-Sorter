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
    const hint=el('p',bridge.getConfig()?.enabled===false?t('Classification is off. Enable it in Settings to process dealt mail.','定时分类已关闭。请在设置中启用以处理邮件。'):t('Saved requests are applied at the next automatic check, normally within about 17 hours. Checks happen twice daily and may be delayed. Emails stay in the inbox. Your saved “Mark dealt mail as read” setting decides whether they become read.','保存后会在下次自动检查时添加分类标签，通常约 17 小时内开始，也可能延迟。每天检查两次，邮件保留在收件箱，是否标为已读取决于届时保存的设置。'));hint.className='hint';host.append(hint);
    const status=el('p',error);status.setAttribute('role','status');status.setAttribute('aria-live','polite');host.append(status);
    const history=el('details'),summary=el('summary',t('Dealt history and Undo','处理记录与撤销'));history.open=true;history.append(summary);host.append(history);history.append(el('p',t('Undo cancels emails still waiting. For changes already applied, the next automatic check removes only labels added by this request and marks emails unread only if this request made them read. It does not move emails. Keep classification and the account enabled; refresh after the check.','撤销会取消尚未执行的请求。若已执行，下次自动检查只移除本次新增的标签；只有本次把未读改为已读的邮件才会改回未读，不会移动邮件。请保持分类和对应邮箱开启，检查后刷新。')));
    for(const request of controller.requests.slice().reverse()){
      const run=controller.run(request),row=el('div');row.className='dealt-history';
      const undone=controller.undone(request),undoQueued=controller.undos.some(u=>u.dealt_request_id===request.id);
      const state=undone?t('Undone','已撤销'):undoQueued?t('Undo requested; refresh after the next check','已申请撤销，下次检查后请刷新'):run?run.entries.some(e=>e.status==='uncertain'||e.status==='intent'||['retry','missing'].includes(e.undo_status))?t('Changes not confirmed; try Undo or check Gmail','改动未确认，请撤销或到 Gmail 检查'):t('Changes applied','改动已生效'):t('Saved; waiting for the next automatic check','已保存，等待下次自动检查');
      row.append(el('span',t(`${request.items.length} emails · ${state}`,`${request.items.length} 封邮件 · ${state}`)));
      if(run)row.append(el('span',t(`${run.entries.filter(e=>e.status==='done').length} emails updated; ${run.entries.filter(e=>!['done','undone'].includes(e.status)).length} email changes not confirmed; ${run.skipped_count||0} emails skipped`,`${run.entries.filter(e=>e.status==='done').length} 封已更新；${run.entries.filter(e=>!['done','undone'].includes(e.status)).length} 封改动未确认；跳过 ${run.skipped_count||0} 封`)));
      const undo=button(t('Undo read and label changes','撤销已读和标签改动'),()=>controller.undo(request));undo.disabled=busy||undone||(undoQueued&&!run?.entries.some(e=>['retry','missing'].includes(e.undo_status)));row.append(undo);history.append(row);
    }
    for(const b of document.querySelectorAll('[data-dealt-id]')){const s=controller.status(b.dataset.dealtId);b.textContent=s?({queued:t('Dealt · waiting for next check','已处理 · 等待下次检查'),done:t('Dealt','已处理'),uncertain:t('Check dealt history','请查看处理记录')}[s]):t('Dealt','已处理');b.disabled=busy||!loaded||Boolean(s)||bridge.getConfig()?.enabled===false;b.setAttribute('aria-label',b.textContent+' · '+(bridge.shownItems().find(i=>mailKey(i)===b.dataset.dealtId)?.subject||''));}
  }
  async function load(){if(!bridge.available()){paint();return;}await perform(async()=>{await controller.load();loaded=true;});}
  document.addEventListener('click',e=>{const b=e.target.closest('[data-dealt-id]');if(b&&!b.disabled)perform(()=>controller.mark(bridge.shownItems().filter(i=>mailKey(i)===b.dataset.dealtId)));});
  document.addEventListener('headersort-list',paint);bridge.subscribe(load);const ready=load();return {ready,controller,load};
}
if(typeof document!=='undefined'&&globalThis.HeadersortBoard){
 const bridge=HeadersortBoard;
 if(bridge.demo){const files={};mountDealt({...bridge,get:async p=>({data:structuredClone(files[p]||null),sha:null}),put:async(p,d)=>{files[p]=structuredClone(d);}},document);}else mountDealt(bridge,document);
}
