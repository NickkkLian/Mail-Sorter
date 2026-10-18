import {ReviewController,RULE_NAMES,undoStatus} from './review.mjs';
import {settings} from '../mail/scripts/settings.mjs';
import {demoBridge} from './demo.mjs';

export function mountReview(bridge,document){
  const host=document.getElementById('cleanup-panel');if(!host)return;
  let controller,busy=false,configForm;const say=text=>{const status=host.querySelector('[role=status]');status.textContent=text;status.setAttribute('tabindex','-1');status.focus();};
  const el=(tag,text,attrs={})=>{const n=document.createElement(tag);if(text)n.textContent=text;for(const[k,v]of Object.entries(attrs))n.setAttribute(k,String(v));return n;};
  const button=(text,fn)=>{const b=el('button',text,{type:'button',class:'btn btn-sm'});b.addEventListener('click',()=>perform(fn,b));return b;};
  async function perform(fn,target){if(busy)return;busy=true;if(target)target.disabled=true;try{await fn();}catch(e){say(['The review list changed. Refresh before approving.','Refresh the review list.'].includes(e.message)?e.message:'Could not save. Refresh and try again.');}finally{busy=false;if(target?.isConnected)target.disabled=false;}}
  function checkbox(text,on,fn){const label=el('label'),input=el('input',null,{type:'checkbox'});input.checked=on;input.addEventListener('change',()=>fn(input.checked));label.append(input,document.createTextNode(' '+text));return {label,input};}
  function select(values,value){const n=el('select');for(const[v,text]of values){const option=el('option',text,{value:v});option.selected=v===value;n.append(option);}return n;}
  async function load(){
    if(!bridge.available()){host.hidden=true;return;}host.hidden=false;
    if(!controller)controller=new ReviewController({get:bridge.get,put:bridge.put,getConfig:bridge.getConfig,saveConfig:bridge.saveConfig});
    try{await controller.load();render();}catch{host.replaceChildren(el('h2','Cleanup review'),el('p','Could not load the review list.'),button('Try again',load),el('p','',{role:'status','aria-live':'polite'}));}
  }
  function render(){
    const c=settings(bridge.getConfig()),{proposal:p,journal,undo}=controller.data;
    host.replaceChildren(el('h2','Cleanup review'),el('p','Review outdated mail before it leaves your inbox. Unselected items stay. Changes are rechecked by the next runner.'),el('p','',{role:'status','aria-live':'polite',class:'review-status'}));
    if(bridge.demo)host.append(el('p','Demo: fictional messages. Approval, undo and settings stay in this page and connect to nothing.'));
    const toolbar=el('div',null,{class:'review-toolbar'});toolbar.append(button('Refresh review',load));host.append(toolbar);
    if(!p)host.append(el('p','No review list yet. The next enabled run will prepare one.'));
    else if(controller.consumed)host.append(el('p','This review has been processed. See the run history below.'));
    else if(controller.queued)host.append(el('p','Approval queued. The next runner will recheck the selected messages.'));
    else if(!p.items.length)host.append(el('p','No outdated mail proposed in the latest scan.'));
    else{
      host.append(el('p',new Date(p.created_at).toLocaleString()+' · '+p.items.length+' proposed'));
      const checks=new Map(),protectButtons=new Map(),ruleChecks=new Map();let approve;
      const update=()=>{approve.textContent='Approve '+controller.selected.size+' selected';approve.disabled=!c.enabled;for(const[id,button]of protectButtons)button.hidden=controller.selected.has(id);for(const[rule,{input}]of ruleChecks){const group=p.items.filter(x=>x.rule===rule),n=group.filter(x=>controller.selected.has(x.gmailId)).length;input.checked=n===group.length;input.indeterminate=n>0&&n<group.length;}};
      for(const[rule,name]of Object.entries(RULE_NAMES)){
        const group=p.items.filter(x=>x.rule===rule);if(!group.length)continue;const field=el('fieldset'),legend=el('legend');const ruleCheck=checkbox(rule+' · '+name+' ('+group.length+')',true,on=>{controller.setRule(rule,on);for(const x of group)checks.get(x.gmailId).checked=on;update();});ruleChecks.set(rule,ruleCheck);legend.append(ruleCheck.label);field.append(legend);
        for(const x of group){const row=el('div',null,{class:'review-item'}),input=el('input',null,{type:'checkbox','aria-label':'Select '+x.subject});input.checked=controller.selected.has(x.gmailId);checks.set(x.gmailId,input);const body=el('span'),label=el('label',x.subject),id='cleanup-'+x.gmailId;input.id=id;label.setAttribute('for',id);body.append(label,el('small',x.from+' · '+new Date(x.date).toLocaleDateString()),el('small',x.reason+' · '+(x.action==='trash'?'Trash — Gmail deletes after 30 days':'Archive — kept in All Mail')));
          const protect=button('Protect sender',async()=>{await controller.protect(x.from);controller.setItem(x.gmailId,false);input.checked=false;update();say('Sender protected. A new review will be prepared using your settings.');});protectButtons.set(x.gmailId,protect);protect.hidden=input.checked;input.addEventListener('change',()=>{controller.setItem(x.gmailId,input.checked);protect.hidden=input.checked;update();});row.append(input,body,protect);field.append(row);
        }host.append(field);
      }
      approve=button('',async()=>{await controller.approve();render();say('Approval queued. Mail changes only after the runner rechecks it.');});toolbar.append(approve);update();
      if(!c.enabled)host.append(el('p','Classification is off. Enable it before approving cleanup.'));
    }
    host.append(el('h3','Run history'));
    if(!journal.runs.length)host.append(el('p','No cleanup runs yet.'));
    for(const run of journal.runs.slice().reverse().slice(0,30)){
      const row=el('div',null,{class:'review-toolbar'}),done=run.entries.filter(x=>x.status==='done'||x.status==='undone').length,status=undoStatus(run,undo.requests);
      row.append(el('span',new Date(run.at).toLocaleString()+' · '+done+'/'+(run.selected_count??run.entries.length)+' completed'));
      const undoButton=button(status,async()=>{await controller.undo(run.id);render();say('Undo queued. Refresh after the next runner to see restoration status.');});undoButton.disabled=!c.enabled||['Restored','Trash undo expired','Undo queued'].includes(status)||!run.entries.length;row.append(undoButton);host.append(row);
      if(run.entries.some(x=>x.status==='intent'||x.status==='uncertain'))host.append(el('small','A run stopped during a change. Undo can recover a recorded intent; check Gmail if it remains uncertain.'));
      if(run.skipped_count)host.append(el('small','Some selected messages no longer qualified and stayed in place.'));
      if(run.entries.some(x=>x.action==='trash'))host.append(el('small','Trash undo is available only before Gmail removes mail after 30 days.'));
    }
    const details=el('details'),summary=el('summary','Cleanup settings and protected list');details.append(summary);configForm=structuredClone(c);const grid=el('div',null,{class:'review-settings'});
    grid.append(checkbox('Read bodies for sorting and cleanup',c.read_bodies,on=>{configForm.read_bodies=on;}).label);
    grid.append(checkbox('Only scan the Primary tab',c.primary_only,on=>{configForm.primary_only=on;}).label);
    const cadence=el('label','Hours between review lists'),hours=el('input',null,{type:'number',min:1,max:720,value:c.frequency_hours});hours.addEventListener('change',()=>{configForm.frequency_hours=Number(hours.value);});cadence.append(hours);grid.append(cadence);
    const approvalLabel=el('label','Approval'),approvalMode=select([['every_run','Approve every run'],['eligible_rules','Allow opted-in rules after clean history']],c.approval_mode);approvalMode.addEventListener('change',()=>{configForm.approval_mode=approvalMode.value;});approvalLabel.append(approvalMode);grid.append(approvalLabel);details.append(grid);details.append(el('p','Sorting labels are added on every run without approval; only cleanups wait for approval.'));
    details.append(el('p','Body reading sends a short redacted excerpt to your configured model for undecided mail. Quoted history is removed; bodies are never stored. Automatic cleanup requires explicit rule opt-in and at least 28 clean reviewed days.'));
    for(const[id,name]of Object.entries(RULE_NAMES)){
      const row=el('div',null,{class:'rule-options'});row.append(checkbox(id+' '+name,c.rules[id].enabled,on=>{configForm.rules[id].enabled=on;}).label);
      const actionLabel=el('label','Destination'),action=select([['archive','Archive'],['trash','Trash (30 days)']],c.rules[id].action);action.addEventListener('change',()=>{configForm.rules[id].action=action.value;});actionLabel.append(action);row.append(actionLabel,checkbox('Auto after '+c.rules[id].clean_days+' clean days',c.rules[id].auto,on=>{configForm.rules[id].auto=on;}).label);details.append(row);
      const daysLabel=el('label',id+' clean history days (minimum 28)'),days=el('input',null,{type:'number',min:28,max:365,value:c.rules[id].clean_days});days.addEventListener('change',()=>{configForm.rules[id].clean_days=Number(days.value);});daysLabel.append(days);details.append(daysLabel);
    }
    details.append(el('p','Trash is deleted by Gmail after 30 days. Archive keeps mail in All Mail. Existing labels remain.'));
    for(const [key,title]of [['senders','Protected senders'],['domains','Protected domains'],['labels','Additional keep labels']]){const label=el('label',title+' (one per line)'),area=el('textarea',null,{'aria-label':title});area.value=c.protected[key].join('\n');area.addEventListener('change',()=>{configForm.protected[key]=area.value.split(/\n/).map(x=>x.trim()).filter(Boolean);});label.append(area);details.append(label);}
    const rulesLabel=el('label','Sender label rules (JSON address to category)'),rulesInput=el('textarea',null,{'aria-label':'Sender label rules'});rulesInput.value=JSON.stringify(c.sender_labels,null,2);rulesInput.addEventListener('change',()=>{try{configForm.sender_labels=JSON.parse(rulesInput.value);}catch{configForm.sender_labels=null;}});rulesLabel.append(rulesInput);details.append(rulesLabel);
    details.append(button('Save cleanup settings',async()=>{await bridge.saveConfig(settings(configForm));say('Settings saved. The next runner will create a new review before applying changed permissions.');}));host.append(details);
  }
  bridge.subscribe(load);const ready=load();return {load,ready,get controller(){return controller;}};
}
if(globalThis.document&&globalThis.HeadersortBoard)mountReview(globalThis.HeadersortBoard.demo?demoBridge(globalThis.HeadersortBoard):globalThis.HeadersortBoard,globalThis.document);
