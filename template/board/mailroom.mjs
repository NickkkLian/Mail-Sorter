import {ReviewController,undoStatus} from './review.mjs';
import {DealtController} from './dealt.mjs';
import {mailKey,mailboxOf} from '../mail/scripts/mailbox-key.mjs';
import {ruleName} from './cleanup-copy.mjs';
import {nextSort,localTime,clockTime,historySpan,groupSenders,selectedImpact,projectedDrop,meterData,safetyCopy,senderAddress,senderName} from './report.mjs';
import {createDemoRunner} from './demo-runner.mjs';
import {installMailSettings} from './mail-settings.mjs';

const bridge=globalThis.HeadersortBoard;
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const clock='<svg class="clock-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const globe='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z"/></svg>';
const runner=bridge.demo?createDemoRunner(bridge,bridge.getMail()):null;
const io=runner?.io||bridge,review=new ReviewController(io),dealt=new DealtController(io);
let loaded=false,busy=false,loading=null,error='',showAll=false,historyLimit=30,historyMailbox='all',expanded=new Set(),opener=null,openerKey=null,closingTimer=null;
let optimisticApproval=null,lastUndo=null,toastTimer=null,goPrefix=false,showDone=false,showMailDetails=false;
const optimisticDone=new Set(),oldMeters=new Map(),meterTimers=new Map(),meterChanges=new Map();
const t=(en,zh)=>bridge.language()==='zh'?zh:en;
const locale=()=>bridge.language()==='zh'?'zh-CN':'en-US';
const formatTime=value=>localTime(value,bridge.language());
const formatDay=value=>Number.isFinite(new Date(value).getTime())?new Intl.DateTimeFormat(locale(),{month:'short',day:'numeric'}).format(new Date(value)):'—';
const next=()=>nextSort(bridge.getConfig()?.sort_schedule_utc||bridge.getMail()?.sort_schedule_utc);
const sortTime=()=>next()?formatTime(next()):t('the next sort','下次整理');
const atSort=()=>next()?t('at the '+formatTime(next())+' sort','在 '+formatTime(next())+' 整理时'):t('at the next sort','下次整理时');
const freshListCopy=()=>next()?t('The next sort, about '+sortTime()+', prepares a fresh list. Approve then.','下次约 '+sortTime()+' 整理时重列清单，之后才能确认。'):t('The next sort prepares a fresh list. Its time is unavailable. Approve then.','下次整理会重新列清单，时间暂不可用。新清单出来后才能确认。');
let place=(()=>{const params=new URLSearchParams(location.search),requested=params.get('place');return ['today','sorted','history'].includes(requested)?requested:params.has('filter')||params.has('q')||params.has('mailbox')?'sorted':'today';})();
const requestStatus=id=>optimisticDone.has(id)?'queued':dealt.status(id);
const effectiveReview=()=>optimisticApproval?{queued:true,consumed:false,data:{...review.data,approval:{...review.data.approval,selected:[...optimisticApproval]}}}:review;
const dropFor=mailbox=>mailboxOff(mailbox)?0:projectedDrop({mail:bridge.getMail()||{items:[]},mailbox,review:effectiveReview(),dealt:{status:requestStatus},markRead:bridge.getConfig()?.mark_dealt_read!==false,mode:meterData(bridge.getMail()||{items:[]},mailbox,{demo:bridge.demo}).available?'primary':'digest'});
const button=(label,action,extra='')=>`<button type="button" class="btn" data-command="${action}" ${extra}>${esc(label)}</button>`;
const mailboxOff=mailbox=>mailbox==='secondary'&&bridge.getConfig()?.second_mailbox_enabled!==true;
const noWrite=()=>busy||!loaded||!bridge.available()||bridge.getConfig()?.enabled===false;

function preserveFocus(fn){
  const active=document.activeElement,key=active?.dataset?.focus,selection=active?.selectionStart;
  const fallback=globalThis.focusKey?.(active);
  fn();
  if(key){const target=[...document.querySelectorAll('[data-focus]')].find(node=>node.dataset.focus===key);if(target){target.focus({preventScroll:true});if(typeof selection==='number'&&target.setSelectionRange)target.setSelectionRange(selection,selection);}}
  globalThis.restoreFocus?.(fallback);
}

function setPlace(value,{focus=false}={}){
  place=value;const url=new URL(location.href);if(value==='today')url.searchParams.delete('place');else url.searchParams.set('place',value);history.replaceState(null,'',url);
  render();if(focus){const target=$(value+'-view').querySelector('h2,summary,input');target?.setAttribute('tabindex','-1');target?.focus();}
}

function announce(message,undo=null,isError=false){
  const host=$('toast');host.replaceChildren(document.createTextNode(message));host.className='toast show'+(isError?' err':'');host.setAttribute('role',isError?'alert':'status');
  if(undo){lastUndo=undo;const button=document.createElement('button');button.type='button';button.textContent=t('Undo','撤销');button.onclick=undo;host.append(' ',button);}
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>host.classList.remove('show'),8000);
}

async function load(){
  if(loading)return loading;
  if(!bridge.available()){loaded=false;render();return;}
  loading=(async()=>{
    try{await Promise.all([review.load(),dealt.load()]);loaded=true;error='';}
    catch{error=t('Could not load the cleanup list and history. Retry to get the latest results.','没能读取清理清单和记录，请重试获取最新结果。');}
    finally{loading=null;render();}
  })();
  return loading;
}

async function perform(action,{paint=true}={}){
  if(busy)return false;busy=true;error='';
  if(paint)render();else for(const control of document.querySelectorAll('[data-command=done],[data-command=approve-mailbox],[data-command=simulate]'))control.disabled=true;
  try{await action();await Promise.all([review.load(),dealt.load()]);return true;}
  catch(problem){
    error=/changed|Refresh/.test(problem.message)?t('This list changed since you opened it. Refresh the list before approving.','清单在打开后有了变化，请刷新清单再确认。'):t('Not saved. Check your connection and retry.','没能保存，请检查连接后重试。');
    announce(error,null,true);return false;
  }finally{busy=false;optimisticDone.clear();optimisticApproval=null;render();if($('cleanup-sheet').open)renderSheet();}
}

function animateEntries(before){
  if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  for(const entry of document.querySelectorAll('.need-entry')){
    const old=before.get(entry.dataset.id),current=entry.getBoundingClientRect();
    if(old&&(old.x!==current.x||old.y!==current.y))entry.animate([{transform:`translate(${old.x-current.x}px,${old.y-current.y}px)`},{transform:'translate(0,0)'}],{duration:200,easing:'cubic-bezier(.23,1,.32,1)'});
  }
}

async function mark(items){
  if(noWrite()||!items.length)return;
  const before=new Map([...document.querySelectorAll('.need-entry')].map(node=>[node.dataset.id,node.getBoundingClientRect()]));
  if(!matchMedia('(prefers-reduced-motion: reduce)').matches)for(const item of items){
    const entry=[...document.querySelectorAll('.need-entry')].find(node=>node.dataset.id===mailKey(item));if(!entry)continue;
    const ghost=entry.cloneNode(true),box=entry.getBoundingClientRect();ghost.setAttribute('aria-hidden','true');
    Object.assign(ghost.style,{position:'fixed',left:box.left+'px',top:box.top+'px',width:box.width+'px',height:box.height+'px',pointerEvents:'none',zIndex:'6'});
    document.body.append(ghost);ghost.animate([{opacity:1,transform:'translateY(0)'},{opacity:0,transform:'translateY(8px)'}],{duration:160,easing:'cubic-bezier(.23,1,.32,1)'}).finished.finally(()=>ghost.remove());
  }
  for(const item of items)optimisticDone.add(mailKey(item));
  const label=bridge.catLabel(items[0].category),read=bridge.getConfig()?.mark_dealt_read!==false;
  const message=items.length===1?t(`Done about ${sortTime()}; it stays in your inbox.`,`约 ${sortTime()} 生效，邮件仍留在收件箱。`):t(`${items.length} done about ${sortTime()}; they stay in your inbox.`,`${items.length} 封约 ${sortTime()} 生效，仍留在收件箱。`);
  render();animateEntries(before);
  const ok=await perform(()=>dealt.mark(items),{paint:false});
  if(ok){const request=dealt.requests.findLast(request=>items.some(item=>request.items.some(chosen=>mailKey(chosen)===mailKey(item))));announce(message,()=>undoRequest(request));}
}

async function approve(mailbox=sheetMailbox){
  if(noWrite(mailbox)||!review.selected.size||review.consumed||review.policyChanged)return;
  const selected=new Set((review.data.proposal?.items||[]).filter(item=>(mailbox==='all'||mailboxOf(item)===mailbox)&&review.selected.has(mailKey(item))).map(mailKey));
  if(!selected.size)return;
  optimisticApproval=new Set([...(review.queued?review.data.approval.selected:[]),...selected]);render();
  if(!matchMedia('(prefers-reduced-motion: reduce)').matches)document.querySelector('.decision-line.pending')?.animate([{opacity:0},{opacity:1}],{duration:180,easing:'cubic-bezier(.23,1,.32,1)'});
  let accepted;
  const ok=await perform(async()=>{accepted=await review.approve({append:review.queued,selected});},{paint:false});
  if(ok){closeSheet();announce(t(`Approved. Mail changes ${atSort()}, after a fresh check.`,`已确认。${atSort()}会逐封重新核对，再按规则清理。`),()=>undoApproval(accepted));}
}
async function undoRequest(request){if(!request)return;const ok=await perform(()=>dealt.undo(request));if(ok)announce(t(`Undo saved. Waiting choices are cancelled. Applied changes reverse ${atSort()}.`,`已保存撤销。尚未执行的会取消，已生效的会${atSort()}恢复。`));}
async function undoApproval(record){const ok=await perform(()=>review.undoApproval(record));if(ok)announce(t(`Undo saved. If this sort already started, the next sort puts changed mail back.`,`已保存撤销。如果这次整理已开始，下次整理会把已改动的邮件放回。`));}
async function undoRun(id){const ok=await perform(()=>review.undo(id));if(ok)announce(t(`Undo saved. Mail is put back ${atSort()}.`,`已保存撤销。${atSort()}会放回邮件。`));}

function stepLine(history){
  if(history.length<2)return '';
  const samples=history.slice(-14),values=samples.map(row=>row.inbox_unread_primary),max=Math.max(...values,1),min=Math.min(...values),range=Math.max(max-min,1);
  const points=values.map((value,index)=>({x:4+index/(values.length-1)*392,y:4+(max-value)/range*28}));
  const path=points.map((point,index)=>index?`H${point.x}V${point.y}`:`M${point.x} ${point.y}`).join('');
  const dots=points.filter((point,index)=>index===0||values[index]!==values[index-1]).map(point=>`<circle cx="${point.x}" cy="${point.y}" r="2"/>`).join('');
  return `<svg class="step-line" viewBox="0 0 400 40" role="img" aria-label="${esc(t('Unread conversations after each sort','每次整理后的未读会话数'))}"><path d="${path}"/>${dots}</svg>`;
}

function renderMeter(mail,mailbox){
  const data=meterData(mail,mailbox,{demo:bridge.demo}),drop=dropFor(mailbox),prior=oldMeters.get(mailbox),value=data.value??'—';
  let old='';
  if(prior!==undefined&&prior!==value){
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    meterChanges.set(mailbox,{old:prior,value,reduced});
    clearTimeout(meterTimers.get(mailbox));meterTimers.set(mailbox,setTimeout(()=>{meterChanges.delete(mailbox);document.querySelector('[data-meter="'+mailbox+'"] s,[data-meter="'+mailbox+'"] .meter-old')?.remove();},reduced?2000:240));
  }
  const priorChange=meterChanges.get(mailbox);
  if(priorChange?.value===value)old=priorChange.reduced?'<s aria-hidden="true">'+esc(priorChange.old)+'</s>':'<span class="meter-old" aria-hidden="true">'+esc(priorChange.old)+'</span>';
  oldMeters.set(mailbox,value);
  const earliest=data.history[0],change=earliest&&data.value!==null?earliest.inbox_unread_primary-data.value:0;
  const delta=earliest?t(`${Math.abs(change)} ${change<0?'more':'fewer'} since ${formatDay(earliest.at)}`,`比 ${formatDay(earliest.at)}${change<0?'多':'少'}了 ${Math.abs(change)}`):t('A trend appears after two counts','记录两次后显示变化');
  const projection=drop&&data.value!==null?`<span class="projection">${esc(t(`about ${Math.max(0,data.value-drop)} after ${sortTime()}`,`${sortTime()} 整理后约剩 ${Math.max(0,data.value-drop)}`))}</span>`:'';
  return `<article class="meter${bridge.loading()?' updating':''}" data-meter="${mailbox}" tabindex="0" aria-label="${esc(data.address||mailbox)}">
    <div class="meter-number-block"><p class="meter-address">${esc(data.address||t('Mailbox','邮箱'))}</p><div class="meter-value" data-previous="${esc(prior??value)}">${old}<span>${esc(value)}</span></div><span class="meter-label sr-only">${esc(data.available?t('unread in Inbox','收件箱未读'):t('unread in the sorted list','已整理列表里的未读'))}</span></div>
    <div class="meter-trend" title="${esc(delta)}">${stepLine(data.history)}${projection}</div>
  </article>`;
}

function impactText(items,selected){
  const impact=selectedImpact(items,selected),destination=[impact.archive?t(`Archive ${impact.archive}`,`归档 ${impact.archive} 封`):'',impact.trash?t(`Move ${impact.trash} to Trash`,`${impact.trash} 封移入垃圾箱`):''].filter(Boolean).join(' · ');
  const count=impact.primary===null?t('How much the Inbox number drops depends on which tab they are in', '收件箱未读能少多少，取决于邮件在哪个标签页'):
    t(`the Inbox number drops by about ${impact.primary}${impact.primary<impact.count?' · the rest are in other tabs or already read':''}`,`收件箱未读约少 ${impact.primary} 封${impact.primary<impact.count?' · 其余在其他标签页或已读':''}`);
  return (destination||t('Select mail to clean up','请选择要清理的邮件'))+' · '+count+' · '+t('Undo from History','可在记录中撤销');
}

function decisionTitle(items){
  const promotions=items.filter(item=>item.rule==='O4').length>items.length*.7,trash=items.every(item=>item.action==='trash'),archive=items.every(item=>item.action!=='trash');
  return t(`${trash?'Trash':archive?'Archive':'Clean up'} ${items.length} ${promotions?'shop':'old'} emails`,`${trash?'移入垃圾箱':archive?'归档':'清理'} ${items.length} 封${promotions?'推广':'过期'}邮件`);
}
function mailboxLabel(key){return meterData(bridge.getMail()||{items:[]},key,{demo:bridge.demo}).address||t('Mailbox','邮箱');}
const disclosureIcon='<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5"/><path d="M10 9v5M10 6h.01"/></svg>';
function safetyInfo(items,selected,key){
  return `<details class="safety-info" data-disclosure="${key}"><summary aria-label="${esc(t('How this is safe','清理安全说明'))}">${disclosureIcon}${esc(t('Safety','安全说明'))}</summary><div class="disclosure-body"><p class="safety">${esc(safetyCopy(items,bridge.language()))}</p><p>${esc(impactText(items,selected))}</p>${button(t('How it works','整理过程'),'how')}${keptSafe()}${sortDetails(bridge.getMail()||{},Object.keys(bridge.getMail()?.mailboxes||{primary:{}}))}</div></details>`;
}
function conciseImpact(items,selected){
  const impact=selectedImpact(items,selected);
  return impact.primary===null?t('Inbox impact unknown','未读变化未知'):t(`unread drops by about ${impact.primary}`,`未读约减少 ${impact.primary}`);
}
function sortDetails(mail,boxes){
  const at=mail.updated_at;
  return `<details class="sort-details"><summary>${esc(at?t('Last sort '+formatTime(at),'上次整理 '+formatTime(at)):t('No sort recorded','还没有整理记录'))}<span class="phone-next-sort">${esc(next()?t('Next: about '+sortTime(),'下次约 '+sortTime()):t('Next sort time unavailable','下次时间暂不可用'))}</span>${disclosureIcon}</summary><div class="disclosure-body"><p>${esc(t('Scheduled times are approximate. GitHub can start a sort hours later.','计划时间仅供参考，GitHub 有时会晚几小时才开始整理。'))}</p>${boxes.map(key=>{const data=meterData(mail,key,{demo:bridge.demo}),first=data.history[0];return `<p><strong>${esc(data.address)}</strong><br>${esc(data.available?t('Same unread Primary-conversation count as Gmail Inbox.','与 Gmail 收件箱相同的主要标签页未读会话数。'):t('The Inbox count is unavailable. Only unread mail in the sorted list is counted.','暂时没有收件箱统计，只计算已整理列表里的未读邮件。'))}${first?'<br>'+esc(t(`${first.inbox_unread_primary-data.value} fewer since ${formatDay(first.at)}`,`比 ${formatDay(first.at)} 少 ${first.inbox_unread_primary-data.value}`)):''}</p>`;}).join('')}<div class="actions"><button type="button" class="btn" data-act="loadAll">${esc(t('Get the latest results','获取最新结果'))}</button><a class="btn" href="${esc(runLogURL())}" target="_blank" rel="noopener">${esc(t('Open the run log','打开运行记录'))}</a></div></div></details>`;
}

function renderDecisions(){
  if(!loaded)return `<p class="decision-line">${esc(error||t('Getting the latest cleanup list…','正在获取最新清理清单…'))}</p>`;
  const proposal=review.data.proposal;
  if(review.policyChanged){const mailbox=mailboxOf(proposal?.items?.[0]||{});return `<div class="decision-line pending">${clock}<span>${esc(freshListCopy())}</span><button type="button" class="btn" disabled>${esc(t('Waiting for a fresh list','等待新清单'))}</button>${button(t('Review status','查看清单状态'),'review',`data-focus="review-${mailbox}" data-mailbox="${mailbox}"`)}${button(t('Get the latest list','获取最新清单'),'reload-review')}</div>`;}
  if(!proposal||!proposal.items.length||review.consumed)return `<p class="decision-line">${clock}${esc(t(`Nothing waiting for your yes. The next list comes with ${sortTime()}.`,`没有等你确认的。下次清单会在${sortTime()}整理时准备。`))}</p>`;
  return [...new Set(proposal.items.map(mailboxOf))].map(mailbox=>{
    const items=proposal.items.filter(item=>mailboxOf(item)===mailbox),selected=new Set(items.map(mailKey));
    const approved=optimisticApproval||new Set(review.queued?review.data.approval.selected:[]),approvedCount=items.filter(item=>approved.has(mailKey(item))).length;
    if(approvedCount)return `<div class="decision-line pending">${clock}<span>${esc(t(`Approved ${approvedCount} in ${mailboxLabel(mailbox)}. Changes ${atSort()}.`,`已确认 ${mailboxLabel(mailbox)} 中的 ${approvedCount} 封，${atSort()}清理。`))}</span>${button(t('Undo approval','撤销确认'),'undo-approval',busy?'disabled':'')}</div>`;
    return `<section class="decision" data-decision-mailbox="${mailbox}"><h2>${esc(decisionTitle(items))}</h2>
      <p class="decision-context">${esc(mailboxLabel(mailbox))} · ${esc(conciseImpact(items,selected))}</p>
      <div class="decision-controls"><div class="actions"><button type="button" class="btn primary" data-command="approve-mailbox" data-mailbox="${mailbox}" ${noWrite(mailbox)?'disabled':''}>${esc(t(`Approve ${items.length}`,`确认 ${items.length} 封`))}</button><button type="button" class="btn" data-command="review" data-mailbox="${mailbox}" data-focus="review-${mailbox}" aria-label="${esc(t('Review the list and safety details','查看清单和安全说明'))}">${esc(t('Review','查看清单'))}</button></div></div>
      </section>`;
  }).join('');
}

function gmailLink(item){const home=item.mailbox_address?'https://mail.google.com/mail/?authuser='+encodeURIComponent(item.mailbox_address):'https://mail.google.com/mail/u/0/';return item.msgid?home+'#search/rfc822msgid:'+encodeURIComponent(item.msgid):home;}
function ageText(date){const days=Math.max(0,Math.floor((Date.now()-Date.parse(date))/86400000));return days?t(`${days} d`,`${days} 天`):t('Today','今天');}
function renderNeed(item){
  const id=mailKey(item),address=item.mailbox_address||mailboxLabel(mailboxOf(item));
  return `<details class="need-entry" data-id="${esc(id)}"><summary data-focus="need-${esc(id)}"><h2>${esc(bridge.subjectFor(item.subject))}</h2><svg class="entry-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg><span class="need-top"><span>${esc(senderName(item.from))}</span><span class="mailbox-name" title="${esc(address)}">${esc(address.includes('@')?address.split('@')[0]:mailboxOf(item))}</span></span></summary><div class="need-actions"><p class="entry-details">${esc(formatDay(item.date)+' · '+bridge.catLabel(item.category)+(bridge.reasonFor(item)?' · '+bridge.reasonFor(item):''))}</p><div class="actions"><a class="btn text-button gmail-link" href="${esc(gmailLink(item))}" target="_blank" rel="noopener" data-demo-gmail="${bridge.demo}" data-focus="open-${esc(id)}">${esc(t('Open in Gmail','在 Gmail 打开'))}</a><button type="button" class="btn text-button" data-command="done" data-id="${esc(id)}" data-dealt-id="${esc(id)}" data-focus="done-${esc(id)}" ${noWrite(mailboxOf(item))||!/^\d+$/.test(item.gmailId)?'disabled':''}>${esc(t('Done','处理完'))}</button></div></div></details>`;
}

function postmark(at){
  const time=clockTime(at);
  return `<svg class="postmark" viewBox="0 0 54 54" aria-hidden="true"><circle cx="27" cy="27" r="25.5"/><circle class="postmark-inner" cx="27" cy="27" r="23"/><text x="27" y="31" text-anchor="middle">${esc(time)}</text></svg>`;
}

function ledgerRows(){
  const runs=(review.data.journal.runs||[]).map(run=>({...run,type:'run'}));
  const requests=dealt.requests.filter(request=>!runs.some(run=>run.dealt_request_id===request.id)).map(request=>({...request,type:'request',at:request.requested_at}));
  return [...runs,...requests].sort((a,b)=>String(b.at).localeCompare(String(a.at)));
}
function runSummary(run){
  const entries=run.entries||[],archive=entries.filter(entry=>entry.action==='archive'&&entry.status==='done').length,trash=entries.filter(entry=>entry.action==='trash'&&entry.status==='done').length,read=entries.filter(entry=>entry.action==='dealt'&&entry.status==='done').length;
  const restored=entries.length&&entries.every(entry=>entry.status==='undone');
  if(restored)return t('Put back'+(run.restored_at?' at '+formatTime(run.restored_at):''),'已放回'+(run.restored_at?' · '+formatTime(run.restored_at):''));
  const parts=[run.sorted_count?t(`Sorted ${run.sorted_count}`,`整理 ${run.sorted_count} 封`):'',archive?t(`archived ${archive}`,`归档 ${archive} 封`):'',trash?t(`moved ${trash} to Trash`,`${trash} 封移入垃圾箱`):'',read?t(`marked ${read} done`,`${read} 封已处理`):''].filter(Boolean);
  return parts.join(' · ')||t('Checked · nothing to change','已检查 · 无需改动');
}
function renderLedgerRow(row,compact=false){
  if(row.type==='request'){
    const undone=dealt.undone(row),text=undone?t('Cancelled','已取消'):t(`${row.items.length} marked done`,`${row.items.length} 封处理完`);
    return `<article class="ledger-row" data-request="${esc(row.id)}">${postmark(row.at)}<div class="ledger-copy"><strong>${esc(text)}</strong><p>${esc(undone?formatDay(row.at):t('Applies about '+sortTime(),'约 '+sortTime()+' 生效'))}</p>${!undone?button(t('Undo','撤销'),'undo-request',`data-id="${esc(row.id)}" ${noWrite()?'disabled':''}`):''}</div></article>`;
  }
  const state=undoStatus(row,review.data.undo.requests),pending=state==='Undo queued'||row.dealt_request_id&&review.data.undo.requests.some(request=>request.dealt_request_id===row.dealt_request_id),restored=state==='Restored',expired=state==='Trash undo expired';
  const uncertain=(row.entries||[]).filter(entry=>['intent','uncertain','retry'].includes(entry.status)||['retry','missing'].includes(entry.undo_status)).length;
  const disabled=noWrite(row.mailbox)||pending||restored||expired||!row.entries?.length;
  const summary=runSummary(row).split(' · ').filter(text=>!/^Sorted|^整理/.test(text)).join(' · ')||t('Checked','已检查');
  return `<article class="ledger-row${Date.parse(row.at)<lastVisit?' older':''}" data-run="${esc(row.id)}">${postmark(row.at)}<div class="ledger-copy"><strong title="${esc(runSummary(row))}">${esc(summary)}</strong><p class="ledger-secondary">${esc(uncertain?t('Change not confirmed · check details','改动尚未确认，请查看详情'):row.mailbox_address||mailboxLabel(row.mailbox||'primary'))}</p><div class="ledger-actions">${row.entries?.length?button(restored?t('Put back','已放回'):expired?t('30 days passed','已过 30 天'):pending?t('Undo saved','撤销已保存'):t('Undo','撤销'),'undo-run',`data-id="${esc(row.id)}" ${disabled?'disabled':''}`):''}<details class="run-details"><summary>${esc(t('Details','详情'))}</summary><div class="disclosure-body"><p>${esc(formatDay(row.at)+' · '+formatTime(row.at))}</p><p>${esc(runSummary(row))}</p>${row.skipped_count?`<p>${esc(t(`${row.skipped_count} skipped · no longer matched`,`${row.skipped_count} 封已不符合条件，没动`))}</p>`:''}${uncertain?`<p>${esc(t(`${uncertain} changes not confirmed. Undo can put them back. Check Gmail if unsure.`,`${uncertain} 封的改动尚未确认，仍可撤销恢复，不确定时请到 Gmail 核对。`))}</p>`:''}${row.entries?.some(entry=>entry.action==='trash')?`<p>${esc(t('Trash can be undone for 30 days, until Gmail deletes it for good.','垃圾箱邮件可在 30 天内撤销，此后 Gmail 会彻底删除。'))}</p>`:''}${pending?`<p>${esc(t('Puts mail back about '+sortTime(),'约 '+sortTime()+' 放回邮件'))}</p>`:''}</div></details></div></div></article>`;
}
let lastVisit=0;
try{const key=HubSettingsContract.preferenceKey('mail-last-visit');lastVisit=Number(localStorage.getItem(key)||0);localStorage.setItem(key,String(Date.now()));}catch{}

function keptSafe(){
  const proposal=review.data.proposal,scopes=proposal?.scopes?Object.values(proposal.scopes).map(scope=>scope.kept_back).filter(Boolean):proposal?.kept_back?[proposal.kept_back]:[];
  if(!scopes.length)return '';
  const counts=Object.fromEntries(['wrote_to','starred','protected','labels','uncertain'].map(key=>[key,scopes.reduce((sum,count)=>sum+(count[key]||0),0)]));
  return `<div class="safe-summary"><h3>${esc(t('Kept safe','已保护'))}</h3><p>${esc(t(`Never proposed in the latest scan · ${counts.wrote_to} from people you wrote to, ${counts.starred} starred, ${counts.protected} protected`, `本次没有进清单的 · 你回过信的人 ${counts.wrote_to} 封，加星 ${counts.starred} 封，受保护 ${counts.protected} 封`))}</p>${counts.labels||counts.uncertain?`<p>${esc(t(`${counts.labels} with keep labels · ${counts.uncertain} left because the checks were uncertain`,`${counts.labels} 封有保留标签 · ${counts.uncertain} 封因无法确定而保留`))}</p>`:''}</div>`;
}

function healthLine(mail,config,boxes){
  const readError=bridge.loadError?.(),stale=boxes.map(key=>meterData(mail,key,{demo:bridge.demo})).find(data=>data.at&&Date.now()-Date.parse(data.at)>36*3600000);
  let state='on',content='';
  if(readError||error){
    state='error';const message=readError?[readError.reason,readError.fix,t('Your saved work is unchanged.','已保存的内容没有改动。')].filter(Boolean).join(' '):error;
    const action=readError?`<button class="btn text-button" type="button" data-act="${readError.kind==='auth'?'openSettings':'loadAll'}">${esc(readError.kind==='auth'?t('Settings','设置'):t('Retry','重试'))}</button>`:button(t('Get latest','获取最新结果'),'reload-review');
    content=`<details class="health-details"><summary>${esc(t('Results unavailable','结果暂不可用'))}</summary><p class="disclosure-body">${esc(message)}</p></details>${action}`;
  }else if(config?.enabled===false){state='off';content=`<span>${esc(t('Sorting off','自动整理已关闭'))}</span>${button(t('Turn on','开启'),'settings')}`;
  }else if(stale){state='stale';content=`<span title="${esc(stale.address+' · '+formatDay(stale.at)+' '+formatTime(stale.at))}">${esc(t('No sort for '+Math.floor((Date.now()-Date.parse(stale.at))/3600000)+' hours','已 '+Math.floor((Date.now()-Date.parse(stale.at))/3600000)+' 小时未整理'))}</span><a href="${esc(runLogURL())}" target="_blank" rel="noopener">${esc(t('Check runs','检查运行记录'))}</a>`;
  }else if(bridge.loading()){state='updating';content=`<span>${esc(t('Updating results…','正在更新结果…'))}</span>`;
  }else{content=`<span>${esc(t('Sorting on','自动整理中')+' · '+(mail.updated_at?t('last '+formatTime(mail.updated_at),'上次 '+formatTime(mail.updated_at)):t('no sort recorded','尚无整理记录'))+' · '+(next()?t('next about '+sortTime(),'下次约 '+sortTime()):t('Next sort time unavailable','下次时间暂不可用')))}</span>`;}
  return `<div class="sort-health" data-state="${state}" role="${state==='error'?'alert':'status'}"><span class="health-dot" aria-hidden="true"></span>${content}</div>`;
}

function renderToday(){
  const mail=bridge.getMail()||{items:[]},config=bridge.getConfig(),boxes=[...new Set([...Object.keys(mail.mailboxes||{}),...(mail.items||[]).map(mailboxOf)])];
  if(!bridge.available()&&!mail.items.length&&!bridge.loadError?.()){$('today-view').innerHTML='';return;}
  if(!boxes.length)boxes.push('primary');
  const needs=(mail.items||[]).filter(item=>item.action&&!requestStatus(mailKey(item))).sort((a,b)=>String(b.date).localeCompare(String(a.date))),done=(mail.items||[]).filter(item=>item.action&&requestStatus(mailKey(item)));
  const allVerified=boxes.every(key=>meterData(mail,key,{demo:bridge.demo}).available),mixed=boxes.some(key=>meterData(mail,key,{demo:bridge.demo}).available)&&!allVerified;
  const spans=boxes.map(key=>historySpan(meterData(mail,key,{demo:bridge.demo}).history)).filter(Boolean),minSpan=Math.min(...spans),maxSpan=Math.max(...spans);
  const spanLabel=spans.length?t(minSpan===maxSpan?`${maxSpan} days`:`${minSpan}–${maxSpan} days`,minSpan===maxSpan?`近 ${maxSpan} 天`:`近 ${minSpan}–${maxSpan} 天`):'';
  const visibleNeeds=matchMedia('(max-width:899px)').matches?1:2,hasWork=review.queued||review.policyChanged||dealt.requests.some(request=>!dealt.undone(request))||review.data.undo.requests.length;
  $('today-view').innerHTML=`<div class="today-grid"><section class="inbox-report${mixed?' mixed-counts':''}"><div class="report-heading"><h2 class="inbox-heading">${esc(allVerified?t('Unread in Inbox','收件箱未读'):mixed?t('Unread mail','未读邮件'):t('Unread in the sorted list','已整理列表里的未读'))}</h2>${healthLine(mail,config,boxes)}</div><div class="meters">${boxes.map(mailbox=>renderMeter(mail,mailbox)).join('')}</div>${spanLabel?`<p class="trend-span">${esc(spanLabel)}</p>`:''}</section>
    <div class="decision-row"><div class="decision-stack">${renderDecisions()}</div><section class="latest-panel${hasWork?' has-work':''}"><div class="latest-change"><h2>${esc(t('Latest change','最近改动'))}</h2><div class="ledger">${ledgerRows().slice(0,1).map(row=>renderLedgerRow(row,true)).join('')||`<p>${esc(t('No changes yet','还没有改动'))}</p>`}</div></div>${bridge.demo?`<button type="button" class="btn demo-sort" data-command="simulate" ${busy?'disabled':''}>${clock}${esc(t('Run next sort','模拟下次整理'))}</button>`:''}</section></div>
    <section class="needs" aria-labelledby="needs-title"><div class="section-heading"><h1 id="needs-title">${esc(t('Needs you','需要你处理'))}</h1><span class="count" id="needs-count">${needs.length}</span></div>
    <div class="need-grid">${(showAll?needs:needs.slice(0,visibleNeeds)).map(renderNeed).join('')}</div>
    ${!needs.length?`<div class="quiet-line">${postmark(new Date())}<p>${esc(t('Nothing needs you.','没有需要你处理的。'))}</p></div>`:''}
    ${needs.length>visibleNeeds?button(showAll?t('Show fewer','收起'):t(`Show all ${needs.length}`,`查看全部 ${needs.length} 封`),'show-all','data-show-needs'):''}
    ${done.length?`<div class="done-tray"><span>${esc(t(`${done.length} done · applies ${atSort()}`,`${done.length} 封处理完 · ${atSort()}生效`))}</span>${button(showDone?t('Hide','收起'):t('Show','查看'),'show-done')}</div>${showDone?done.map(item=>`<p class="done-tray">${esc(item.subject)} · ${esc(t(requestStatus(mailKey(item))==='queued'?'Waiting for the next sort':'Applied',requestStatus(mailKey(item))==='queued'?'等待下次整理':'已生效'))}</p>`).join(''):''}`:''}</section></div>`;
  for(const value of document.querySelectorAll('.meter-value'))if(value.dataset.previous!==value.lastElementChild?.textContent&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
    value.querySelector('.meter-old')?.animate([{opacity:1,transform:'translateY(0)'},{opacity:0,transform:'translateY(-.5rem)'}],{duration:240,easing:'cubic-bezier(.23,1,.32,1)'});
    value.lastElementChild?.animate([{opacity:0,transform:'translateY(.5rem)'},{opacity:1,transform:'translateY(0)'}],{duration:240,easing:'cubic-bezier(.23,1,.32,1)'});
  }
}

function runLogURL(){const config=globalThis.cfg?.();return config?.owner&&config?.repo?'https://github.com/'+encodeURIComponent(config.owner)+'/'+encodeURIComponent(config.repo)+'/actions/workflows/mail-sync.yml':'https://github.com/NickkkLian/Mail-Sorter/actions';}

function renderSorted(){
  const mail=bridge.getMail()||{items:[]},all=mail.items||[],state=bridge.viewState(),counts={};
  for(const item of all)counts[item.category]=(counts[item.category]||0)+1;
  $('sorted-title').textContent=t('Sorted mail','已整理邮件');$('clear-filters').textContent=t('Clear filters','清除筛选');$('q').placeholder=t('Search subject or sender…','搜索主题或发件人…');$('q').setAttribute('aria-label',t('Search mail','搜索邮件'));
  $('mailbox-filter-label').textContent=t('Mailbox','邮箱');
  const activeFilters=Number(state.filter!=='all')+Number(state.mailboxFilter!=='all');
  $('filter-menu-label').textContent=t('Filters','筛选')+(activeFilters?' · '+activeFilters:'');
  $('mail-details-toggle').textContent=showMailDetails?t('Hide mail details','收起邮件详情'):t('Show mail details','显示邮件详情');
  $('mail-details-toggle').setAttribute('aria-pressed',String(showMailDetails));
  const boxes=[...new Set(all.map(mailboxOf))];
  $('mailbox-filter').innerHTML=`<option value="all">${esc(t('All mailboxes','全部邮箱'))}</option>`+boxes.map(key=>`<option value="${esc(key)}">${esc(mailboxLabel(key))}</option>`).join('');$('mailbox-filter').value=state.mailboxFilter;
  const chip=(key,label,count)=>`<button type="button" data-filter="${esc(key)}" aria-pressed="${state.filter===key}" data-focus="filter-${esc(key)}">${esc(label)}<span class="n">${count}</span></button>`;
  $('filter').setAttribute('aria-label',t('Filter by folder','按文件夹筛选'));$('filter').innerHTML=chip('all',t('All','全部'),all.length)+chip('__action',t('Needs you','需要你处理'),all.filter(item=>item.action&&!requestStatus(mailKey(item))).length)+Object.keys(counts).map(key=>chip(key,bridge.catLabel(key),counts[key])).join('');
  let items=all.filter(item=>state.mailboxFilter==='all'||mailboxOf(item)===state.mailboxFilter);
  if(state.filter==='__action')items=items.filter(item=>item.action&&!requestStatus(mailKey(item)));else if(state.filter!=='all')items=items.filter(item=>item.category===state.filter);
  if(state.query)items=items.filter(item=>(item.subject+' '+item.from).toLowerCase().includes(state.query));
  const shown=items.slice(0,150);bridge.setShownItems(shown);
  $('list').innerHTML=shown.length?`<div class="mail-list">${shown.map(item=>{
    const id=mailKey(item),status=requestStatus(id);
    return `<article class="mail" data-id="${esc(id)}"><div class="mail-copy"><a class="subj" href="${esc(gmailLink(item))}" target="_blank" rel="noopener" data-demo-gmail="${bridge.demo}" data-focus="sorted-open-${esc(id)}" title="${esc(bridge.subjectFor(item.subject))}">${esc(bridge.subjectFor(item.subject))}</a><span class="sender" tabindex="0" title="${esc(item.from+' · '+formatDay(item.date)+' · '+bridge.catLabel(item.category)+(bridge.reasonFor(item)?' · '+bridge.reasonFor(item):''))}">${esc(senderName(item.from))}</span></div><span class="cat sr-only">${esc(bridge.catLabel(item.category))}</span><span class="mailbox-dot ${mailboxOf(item)==='secondary'?'secondary':''}" role="img" aria-label="${esc(item.mailbox_address||mailboxLabel(mailboxOf(item)))}" title="${esc(item.mailbox_address||mailboxLabel(mailboxOf(item)))}"></span><button type="button" class="btn text-button" data-command="done" data-dealt-id="${esc(id)}" data-id="${esc(id)}" data-focus="sorted-done-${esc(id)}" ${noWrite(mailboxOf(item))||status||!/^\d+$/.test(item.gmailId)?'disabled':''}>${esc(status==='queued'?t('Waiting','待生效'):status==='uncertain'?t('Check History','查看记录'):status?t('Done','已处理'):t('Done','处理完'))}</button>${showMailDetails?`<p class="entry-details">${esc(formatDay(item.date)+' · '+bridge.catLabel(item.category)+(bridge.reasonFor(item)?' · '+bridge.reasonFor(item):''))}</p>`:''}</article>`;
  }).join('')}</div>${items.length>150?`<p class="meter-note">${esc(t(`Showing the first 150 of ${items.length}. Narrow the search for more.`,`共 ${items.length} 封，先显示 150 封。可缩小筛选范围查找。`))}</p>`:''}`:`<div class="empty"><h2>${esc(t('No mail matches','没有匹配的邮件'))}</h2>${button(t('Clear filters','清除筛选'),'clear')}</div>`;
  const days=Array.from({length:7},(_,i)=>{const date=new Date(Date.now()-(6-i)*86400000);return {date,count:all.filter(item=>new Date(item.date).toDateString()===date.toDateString()).length};}),max=Math.max(1,...days.map(day=>day.count));
  const filtered=state.filter!=='all'||state.mailboxFilter!=='all'||state.query;
  $('sorted-summary').innerHTML=`<h2>${esc(t('In this report','本次报告'))}</h2><p>${esc(t(`${all.length} emails kept`,`${all.length} 封邮件已保留`))}</p><p>${esc(t(`${mail.total_is_floor?'At least ':''}${Number(mail.total_classified||0).toLocaleString(locale())} sorted in total`,`${mail.total_is_floor?'至少':''}已累计整理 ${Number(mail.total_classified||0).toLocaleString(locale())} 封`))}</p><p>${esc(t(`The digest keeps the newest ${mail.keep_items||300}.`,`摘要保留最新 ${mail.keep_items||300} 封。`))}</p><div class="incoming-chart" role="img" aria-label="${esc(t('Mail received in the last seven days','近七天收到的邮件'))}">${days.map(day=>`<i style="height:${Math.max(2,day.count/max*60)/16}rem" title="${esc(formatDay(day.date)+': '+day.count)}"></i>`).join('')}</div><p class="chart-caption">${esc(t('Last 7 days · incoming mail in this list','近 7 天 · 列表中的来信'))}</p>${filtered&&shown.length?button(t(`Mark these ${shown.length} done`,`将这 ${shown.length} 封标记处理完`),'bulk',noWrite()?'disabled':''):''}${filtered&&items.length>150?`<p class="meter-note">${esc(t('Only the first 150 are marked at a time.','每次最多标记前 150 封。'))}</p>`:''}`;
  const recent=document.createElement('p');
  const dayCount=all.filter(item=>Date.now()-Date.parse(item.date)<86400000).length;
  const weekCount=all.filter(item=>Date.now()-Date.parse(item.date)<7*86400000).length;
  recent.textContent=t(dayCount+' in the last 24 hours · '+weekCount+' in the last 7 days','近 24 小时 '+dayCount+' 封 · 近 7 天 '+weekCount+' 封');
  $('sorted-summary').querySelector('h2').after(recent);
  document.dispatchEvent(new Event('headersort-list'));
}

function howItWorks(){
  const proposal=review.data.proposal,mail=bridge.getMail()||{},last=ledgerRows().find(row=>row.type==='run'),kept=proposal?.kept_back||{},safe=Object.values(kept).reduce((sum,count)=>sum+count,0);
  const steps=[
    [bridge.demo?120:t('Up to ','最多 ')+(bridge.getConfig()?.max_per_run||120),t('newest unread headers · no bodies by default','封最新未读邮件头 · 默认不读正文'),'sorted'],
    [bridge.demo?42:mail.items?.length||0,t('in your kept list','封在保留列表中'),'sorted'],
    [proposal?.items.length||0,t('proposed by saved age rules','封符合你保存的清理规则'),'review'],
    [safe,t('left out for safety','封为安全起见保留'),'safe'],
    ['',t('Waits for your yes','等你确认'),'review'],
    [last?.skipped_count||0,t('no longer match on a fresh check','封复核时已不符合条件'),'ledger'],
    ['',t('Archives or moves to Trash, by rule','按规则归档或移入垃圾箱'),'ledger'],
    ['',t('Undo puts mail back · Trash: within 30 days','撤销可放回邮件 · 垃圾箱须在 30 天内'),'ledger']
  ];
  const arrow='<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 10h14m-5-5 5 5-5 5"/></svg>';
  return `<details class="how-it-works" id="how-it-works"><summary>${esc(t('How it works','整理过程'))}</summary><div class="pipeline">${steps.map(([count,label,link],i)=>`<a href="#${link==='ledger'?'history-ledger':link}" data-pipeline="${link}"><span>${count!==''?`<b>${count}</b>`:''}${esc(label)}</span>${i<steps.length-1?arrow:''}</a>`).join('')}</div><ul class="how-facts"><li><a href="https://github.com/NickkkLian/Mail-Sorter/blob/main/mail/scripts/core.mjs#L90" target="_blank" rel="noopener">${esc(t('A model can suggest a folder or veto a cleanup. It can never approve one.','模型可以建议文件夹或否决清理，不能替你确认清理。'))}</a></li><li><a href="https://github.com/NickkkLian/Mail-Sorter/blob/main/mail/scripts/imap.mjs#L1" target="_blank" rel="noopener">${esc(t('The app has no permanent-delete operation. Gmail permanently deletes Trash after 30 days.','应用没有彻底删除操作。Gmail 会在 30 天后彻底删除垃圾箱邮件。'))}</a></li><li><a href="https://github.com/NickkkLian/Mail-Sorter/blob/main/mail/scripts/core.mjs#L19" target="_blank" rel="noopener">${esc(t('Automatic cleanup needs at least 28 clean review days and your opt-in for each rule.','每条规则都需你主动开启，并积累至少 28 个无否决确认日，才能自动清理。'))}</a></li><li><a href="https://github.com/NickkkLian/Mail-Sorter#offline-checks" target="_blank" rel="noopener">${esc(t('How this is tested · offline checks and deliberate failures','如何测试 · 离线检查与故障测试'))}</a></li></ul></details>`;
}

function renderHistory(){
  const rows=ledgerRows().filter(row=>historyMailbox==='all'||row.mailbox===historyMailbox||row.type==='request'&&row.items.some(item=>mailboxOf(item)===historyMailbox));
  const opened=$('how-it-works')?.open;
    $('history-view').innerHTML=howItWorks()+`<details class="history-safety"><summary>${esc(t('Kept safe','已保护'))}</summary>${keptSafe()}</details><div class="history-toolbar"><h1>${esc(t('History','整理记录'))}</h1><label><span class="sr-only">${esc(t('Mailbox','邮箱'))}</span><select id="history-mailbox"><option value="all">${esc(t('All mailboxes','全部邮箱'))}</option>${['primary','secondary'].filter(key=>(bridge.getMail()?.items||[]).some(item=>mailboxOf(item)===key)).map(key=>`<option value="${key}">${esc(mailboxLabel(key))}</option>`).join('')}</select></label>${review.data.proposal?.items.length?button(t('Review the current list','查看当前清单'),'review','data-focus="review-history"'):''}</div><div id="history-ledger" class="ledger history-ledger">${rows.slice(0,historyLimit).map(row=>renderLedgerRow(row)).join('')||`<p>${esc(t('Your first sort will appear here.','第一次整理后，记录会出现在这里。'))}</p>`}</div>${rows.length>historyLimit?button(t('Older','更早的记录'),'older'):''}`;
  $('history-mailbox').value=historyMailbox;if(opened!==undefined)$('how-it-works').open=opened;
}

function render(){
  preserveFocus(()=>{
    if(bridge.demo){let badge=$('phone-demo');if(!badge){badge=document.createElement('span');badge.id='phone-demo';badge.className='phone-demo';$('app-save-status').append(badge);}badge.textContent=t('Demo · fictional mail','演示 · 虚构邮件');}
    for(const name of ['today','sorted','history'])$(name+'-view').hidden=name!==place;
    for(const tab of document.querySelectorAll('[data-place]')){tab.textContent=({today:t('Today','今天'),sorted:t('Sorted','已整理'),history:t('History','记录')})[tab.dataset.place];if(tab.dataset.place===place)tab.setAttribute('aria-current','page');else tab.removeAttribute('aria-current');}
    $('places').setAttribute('aria-label',t('Places','页面'));
    document.body.classList.toggle('today-health-error',place==='today'&&Boolean(bridge.loadError?.()));
    document.querySelector('.topbar .gh').hidden=true;
    $('refresh').hidden=true;
    document.querySelector('.topbar .gh').setAttribute('aria-label',t('Source','源码'));
    document.querySelector('.topbar .gh').title=t('Source','源码');
    if(place==='today')renderToday();
    renderSorted();
    if(place==='history')renderHistory();
  });
}

let sheetMailbox='all';
function sheetItems(){return (review.data.proposal?.items||[]).filter(item=>sheetMailbox==='all'||mailboxOf(item)===sheetMailbox);}
function openSheet(button,mailbox='all'){
  opener=button||document.activeElement;openerKey=opener?.dataset?.focus||(place==='history'?'review-history':'review-'+(mailbox==='all'?mailboxOf(review.data.proposal?.items?.[0]||{}):mailbox));sheetMailbox=mailbox;clearTimeout(closingTimer);renderSheet();
  const sheet=$('cleanup-sheet');if(!sheet.open)sheet.showModal();requestAnimationFrame(()=>sheet.classList.add('shown'));
  sheet.querySelector('button')?.focus();
}
function closeSheet(){
  const sheet=$('cleanup-sheet');sheet.classList.remove('shown');clearTimeout(closingTimer);
  closingTimer=setTimeout(()=>{sheet.close();const target=opener?.isConnected&&opener.checkVisibility()?opener:[...document.querySelectorAll('[data-focus]')].find(node=>node.dataset.focus===openerKey)||document.querySelector('[data-place=today]');target?.focus({preventScroll:true});},matchMedia('(prefers-reduced-motion: reduce)').matches?0:220);
}
function renderSheet(){
  preserveFocus(()=>{
    const items=sheetItems(),proposal=review.data.proposal,groups=groupSenders(items,{byRule:true}),state=!loaded?'loading':!proposal?'none':review.policyChanged?'policy':review.consumed?'consumed':review.queued?'approved':!items.length?'empty':'waiting';
    const messages={policy:freshListCopy(),loading:t('Getting the latest list…','正在获取最新清单…'),none:t(`No list yet. The next sort prepares one, about ${sortTime()}.`,`还没有清单。下次整理时会准备，计划约 ${sortTime()}。`),consumed:t('This list was carried out. See History for the result and Undo.','这份清单已经执行，可到记录查看结果或撤销。'),approved:t(`Approved. Waiting for ${sortTime()}.`,`已确认，等待 ${sortTime()} 整理。`),empty:t('The last sort found nothing old to clean up.','上次整理没有找到需要清理的过期邮件。')};
    $('cleanup-panel').innerHTML=`<header class="review-head"><div class="review-title-row"><h2 id="review-title">${esc(items.length?decisionTitle(items):t('Cleanup review','查看清理清单'))}</h2><button type="button" class="btn btn-icon" data-command="close-sheet" aria-label="${esc(t('Close review','关闭清单'))}" data-focus="close-sheet"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div><p class="review-impact">${esc(items[0]?.mailbox_address||t('All mailboxes','全部邮箱'))} · ${esc(conciseImpact(items,review.selected))}</p></header>
      <div class="review-body">${safetyInfo(items,review.selected,'sheet')}<p class="review-status" role="status">${esc(error)}</p>${state==='waiting'?Object.entries(Object.groupBy(groups,group=>group.rule)).map(([rule,ruleGroups])=>`<fieldset class="review-rule"><legend><label class="check-label"><input type="checkbox" data-rule="${rule}" data-focus="rule-${rule}" ${busy?'disabled':''}>${esc(ruleName(rule,bridge.language()))} · ${ruleGroups.reduce((sum,group)=>sum+group.items.length,0)}</label></legend>${ruleGroups.map(group=>{
        const n=group.items.filter(item=>review.selected.has(mailKey(item))).length,open=expanded.has(group.key);
        return `<div class="sender-group" data-group="${esc(group.key)}"><div class="sender-row"><input type="checkbox" class="sender-select" data-sender="${esc(group.key)}" data-focus="sender-${esc(group.key)}" aria-label="${esc(t('Select mail from ','选择来自 ')+group.name)}" ${busy?'disabled':''}><button type="button" class="sender-expand" data-command="expand-sender" data-id="${esc(group.key)}" data-focus="expand-${esc(group.key)}" aria-expanded="${open}"><strong>${esc(group.name)}</strong> <span class="${n!==group.items.length?'selected-count':''}">${n} ${t('of','/')} ${group.items.length}</span></button></div>${n<group.items.length?`<button type="button" class="btn text-button protect-sender" data-command="protect" data-id="${esc(group.key)}" title="${esc(t('Never propose mail from '+group.name+' again','以后不再提议清理 '+group.name+' 的邮件'))}" ${busy?'disabled':''}>${esc(t('Protect this sender','保护这位发件人'))}</button>`:''}${open?group.items.map(item=>`<div class="review-item"><input type="checkbox" id="review-${esc(mailKey(item))}" data-item="${esc(mailKey(item))}" data-focus="item-${esc(mailKey(item))}" ${review.selected.has(mailKey(item))?'checked':''}><label for="review-${esc(mailKey(item))}">${esc(item.subject)}</label><small>${esc(formatDay(item.date))} · ${esc(typeof item.primary!=='boolean'?t('Tab unknown','标签页未知'):item.primary?t('Primary','主要'):t('Other tab','其他标签页'))} · ${esc(typeof item.unread!=='boolean'?t('Read status unknown','已读状态未知'):item.unread?t('Unread','未读'):t('Read','已读'))}</small></div>`).join(''):''}</div>`;
      }).join('')}</fieldset>`).join(''):`<p class="quiet-line">${esc(messages[state]||'')}</p>`}</div>
      <footer class="review-footer"><div class="actions">${state==='waiting'?`<button type="button" class="btn primary" data-command="approve" data-focus="sheet-approve" ${noWrite()||!items.some(item=>review.selected.has(mailKey(item)))?'disabled':''}>${esc(t(`Approve ${items.filter(item=>review.selected.has(mailKey(item))).length} of ${items.length}`,`${items.length} 封中选了 ${items.filter(item=>review.selected.has(mailKey(item))).length} 封，确认清理`))}</button>`:''}${button(t('Refresh the list','刷新清单'),'reload-review')}${button(t('Change cleanup rules','修改清理规则'),'cleanup-settings')}</div>${bridge.getConfig()?.enabled===false?`<p class="review-status">${esc(t('Sorting is off. Turn it on in Settings before approving.','整理已关闭，请在设置中开启后再确认。'))}</p>`:''}</footer>`;
    if(state==='policy'){
      for(const impact of $('cleanup-panel').querySelectorAll('.review-impact'))impact.textContent=t('Waiting for a fresh list','等待新清单');
      const approve=document.createElement('button');approve.type='button';approve.className='btn primary';approve.disabled=true;approve.textContent=t('Approve after the fresh list arrives','新清单出来后才能确认');
      $('cleanup-panel').querySelector('.review-footer .actions').prepend(approve);
    }
    for(const group of groups){const input=[...document.querySelectorAll('[data-sender]')].find(node=>node.dataset.sender===group.key);if(input){const n=group.items.filter(item=>review.selected.has(mailKey(item))).length;input.checked=n===group.items.length;input.indeterminate=n>0&&n<group.items.length;}}
    for(const input of document.querySelectorAll('[data-rule]')){const ruleItems=items.filter(item=>item.rule===input.dataset.rule),n=ruleItems.filter(item=>review.selected.has(mailKey(item))).length;input.checked=n===ruleItems.length;input.indeterminate=n>0&&n<ruleItems.length;}
  });
}

document.addEventListener('click',async event=>{
  const tab=event.target.closest('[data-place]');if(tab){setPlace(tab.dataset.place);return;}
  const fakeMail=event.target.closest('[data-demo-gmail=true]');if(fakeMail){event.preventDefault();announce(t('This email is fictional. In your connected mailbox, it opens directly in Gmail.','这是虚构邮件。连接你自己的邮箱后，会直接在 Gmail 打开。'));return;}
  const pipeline=event.target.closest('[data-pipeline]');if(pipeline){event.preventDefault();if(pipeline.dataset.pipeline==='sorted')setPlace('sorted');else if(pipeline.dataset.pipeline==='review')openSheet(pipeline);else if(pipeline.dataset.pipeline==='safe'){setPlace('history');document.querySelector('.history-safety').open=true;document.querySelector('.history-safety')?.scrollIntoView({block:'center'});}else $('history-ledger')?.scrollIntoView();return;}
  const control=event.target.closest('[data-command]');if(!control||control.disabled)return;
  const command=control.dataset.command,id=control.dataset.id;
  if(command==='done')return mark((bridge.getMail()?.items||[]).filter(item=>mailKey(item)===id));
  if(command==='bulk')return mark(bridge.shownItems().filter(item=>!requestStatus(mailKey(item))));
  if(command==='show-all'){showAll=!showAll;render();}
  if(command==='show-done'){showDone=!showDone;render();}
  if(command==='clear')bridge.clearFilters();
  if(command==='mail-details'){showMailDetails=!showMailDetails;renderSorted();}
  if(command==='history')setPlace('history');
  if(command==='how'){if($('cleanup-sheet').open)closeSheet();setPlace('history');$('how-it-works').open=true;$('how-it-works').scrollIntoView();}
  if(command==='older'){historyLimit+=30;renderHistory();}
  if(command==='settings')bridge.showSettings();
  if(command==='review')openSheet(control,control.dataset.mailbox||'all');
  if(command==='close-sheet')closeSheet();
  if(command==='reload-review'){await load();if($('cleanup-sheet').open)renderSheet();}
  if(command==='approve-mailbox'){
    const mailbox=control.dataset.mailbox;
    for(const item of review.data.proposal.items)review.setItem(mailKey(item),mailboxOf(item)===mailbox||review.data.approval?.selected?.includes(mailKey(item)));
    await approve(mailbox);
  }
  if(command==='approve')await approve();
  if(command==='undo-approval')await undoApproval();
  if(command==='undo-request')await undoRequest(dealt.requests.find(request=>request.id===id));
  if(command==='undo-run')await undoRun(id);
  if(command==='expand-sender'){if(expanded.has(id))expanded.delete(id);else expanded.add(id);renderSheet();}
  if(command==='protect'){
    const group=groupSenders(sheetItems(),{byRule:true}).find(group=>group.key===id);
    const ok=await perform(async()=>{await review.protect(group.from);for(const item of review.data.proposal.items)if(senderAddress(item.from)===senderAddress(group.from))review.setItem(mailKey(item),false);});
    if(ok){announce(t('Sender protected. ','已保护这位发件人。')+freshListCopy());renderSheet();}
  }
  if(command==='cleanup-settings'){closeSheet();setTimeout(()=>{bridge.showSettings();setTimeout(()=>{const section=$('settings-cleanup');if(section){section.open=true;section.scrollIntoView();}},0);},230);}
  if(command==='simulate'&&runner){const ok=await perform(()=>runner.run());if(ok)announce(t('Sort complete. The report shows what changed.','模拟整理完成，报告已更新。'));}
});

document.addEventListener('change',event=>{
  if(event.target.id==='history-mailbox'){historyMailbox=event.target.value;historyLimit=30;renderHistory();return;}
  if(event.target.matches('[data-item]'))review.setItem(event.target.dataset.item,event.target.checked);
  if(event.target.matches('[data-rule]'))for(const item of sheetItems().filter(item=>item.rule===event.target.dataset.rule))review.setItem(mailKey(item),event.target.checked);
  if(event.target.matches('[data-sender]')){const group=groupSenders(sheetItems(),{byRule:true}).find(group=>group.key===event.target.dataset.sender);for(const item of group.items)review.setItem(mailKey(item),event.target.checked);}
  if(event.target.closest('#cleanup-panel')&&event.target.matches('input'))renderSheet();
});
$('cleanup-sheet').addEventListener('cancel',event=>{event.preventDefault();closeSheet();});
$('cleanup-sheet').addEventListener('keydown',event=>{
  if((event.metaKey||event.ctrlKey)&&event.key==='Enter'){event.preventDefault();approve();return;}
  const rows=[...document.querySelectorAll('.sender-expand')],row=event.target.closest('.sender-group'),index=rows.findIndex(button=>button.closest('.sender-group')===row);
  if(['ArrowDown','ArrowUp'].includes(event.key)&&rows.length){event.preventDefault();rows[(index+(event.key==='ArrowDown'?1:-1)+rows.length)%rows.length].focus();}
  if(event.key===' '&&event.target.matches('.sender-expand')){event.preventDefault();row.querySelector('[data-sender]').click();}
  if(event.key==='Tab'){
    const controls=[...$('cleanup-sheet').querySelectorAll('button,a[href],input,select,textarea,summary,[tabindex="0"]')].filter(node=>!node.disabled&&node.checkVisibility()),first=controls[0],last=controls.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }
});

document.addEventListener('keydown',event=>{
  if(!globalThis.Appearance?.shortcutsOn()||event.metaKey||event.ctrlKey||event.altKey||event.target.closest('input,textarea,select,[contenteditable=true],dialog[open]'))return;
  const key=event.key.toLowerCase();
  if(goPrefix){goPrefix=false;const destination={t:'today',s:'sorted',h:'history'}[key];if(destination){event.preventDefault();setPlace(destination,{focus:true});}return;}
  if(key==='g'){goPrefix=true;setTimeout(()=>goPrefix=false,1000);return;}
  if(key==='/'){event.preventDefault();setPlace('sorted');$('q').focus();return;}
  if(key==='z'&&lastUndo){event.preventDefault();lastUndo();return;}
  if(key==='?'){event.preventDefault();announce(t('j / k · move through mail. o / Enter · open Gmail. e · done. z · undo. / · search. g then t / s / h · Today / Sorted / History.','j / k 移动，o 或回车在 Gmail 打开，e 处理完，z 撤销，/ 搜索，g 后按 t / s / h 切换今天、已整理、记录。'));return;}
  const entries=[...document.querySelectorAll(place==='today'?'.need-entry':place==='sorted'?'.mail':'.no-shortcuts')],current=document.activeElement.closest('.need-entry,.mail'),index=entries.indexOf(current);
  if((key==='j'||key==='k')&&entries.length){event.preventDefault();const target=entries[(index+(key==='j'?1:-1)+entries.length)%entries.length];target.querySelector('summary,a')?.focus();}
  if(key==='o'&&current){event.preventDefault();current.querySelector('a')?.click();}
  if(key==='e'&&current){event.preventDefault();current.querySelector('[data-command=done]')?.click();}
});

installMailSettings(bridge);
globalThis.Mailroom={render,renderSorted,setPlace,openSheet,closeSheet,review,dealt,runner,load};
const languageIcon=()=>{const node=$('suite-language-toggle');if(node&&!node.querySelector('svg'))node.innerHTML=globe;};
new MutationObserver(languageIcon).observe(document.querySelector('header.topbar'),{subtree:true,childList:true});languageIcon();
matchMedia('(max-width:899px)').addEventListener('change',()=>render());
bridge.subscribe(load);render();if(bridge.demo){await runner.ready;await bridge.localWrite('demo-initial-state',()=>{});}await load();
