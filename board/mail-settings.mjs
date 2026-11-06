import {settings,RULE_IDS} from '../mail/scripts/settings.mjs';
import {ruleName} from './cleanup-copy.mjs';

export function installMailSettings(bridge){
  let draft=null,baseline=null;
  const language=()=>bridge.language(),t=(en,zh)=>language()==='zh'?zh:en;
  const el=(tag,value)=>{const node=document.createElement(tag);if(value)node.textContent=value;return node;};
  const dirty=()=>bridge.markDirty(true);
  bridge.discardCleanupDraft=async()=>{draft=null;baseline=null;bridge.markDirty(false);globalThis.SuiteSettings?.refresh();};
  bridge.renderSettings=container=>{
    if(!bridge.isDirty()||!draft){
      try{baseline=settings(bridge.getConfig()||{});draft=structuredClone(baseline);}
      catch{const note=el('p',t('Update the cleanup rules in your data repository before editing them here. See the setup guide in Source.','请先在数据仓库中更新清理规则，再到这里修改。配置方法见源码说明。'));container.append(note);return;}
    }
    let host=container.querySelector('#mail-rule-settings');
    if(host)host.remove();
    host=el('div');host.id='mail-rule-settings';container.append(host);
    const cleanup=el('details'),summary=el('summary',t('Cleanup','清理'));cleanup.id='settings-cleanup';cleanup.append(summary);
    const form=el('div');form.className='cleanup-settings';cleanup.append(form);host.append(cleanup);
    const status=el('p');status.setAttribute('role','status');status.className='review-status';
    const field=(parent,label,input)=>{const row=el('label',label);row.append(input);parent.append(row);return input;};
    const checkbox=(parent,label,value,change)=>{
      const row=el('label'),input=el('input');input.type='checkbox';input.checked=value;input.disabled=!bridge.getConfig();
      input.addEventListener('change',()=>{change(input.checked);dirty();});row.className='check-label';row.append(input,document.createTextNode(label));parent.append(row);return input;
    };
    const number=(parent,label,value,min,max,change)=>{
      const input=el('input');input.type='number';input.min=min;input.max=max;input.value=value;
      const update=()=>{change(Number(input.value));dirty();};
      input.addEventListener('input',update);input.addEventListener('change',update);return field(parent,label,input);
    };
    const select=(parent,label,value,options,change)=>{
      const input=el('select');for(const [key,name]of options){const option=el('option',name);option.value=key;input.append(option);}input.value=value;
      input.addEventListener('change',()=>{change(input.value);dirty();});return field(parent,label,input);
    };
    checkbox(form,t('Read bodies when a header is not enough','主题不足以判断时，读取少量正文'),draft.read_bodies,value=>draft.read_bodies=value);
    checkbox(form,t('Only scan the Primary tab','只整理「主要」标签页'),draft.primary_only,value=>draft.primary_only=value);
    number(form,t('Hours between cleanup lists','两次清理清单相隔小时数'),draft.frequency_hours,1,720,value=>draft.frequency_hours=value);
    select(form,t('When cleanup may happen','何时允许清理'),draft.approval_mode,[['every_run',t('Ask me every time','每次都先让我确认')],['eligible_rules',t('Allow rules I opted into after clean history','经我开启的规则，积累无否决记录后可自动清理')]],value=>draft.approval_mode=value);
    form.append(el('p',t('Sorting adds folder labels at each sort. Cleanup waits for your approval. Reading bodies sends a short redacted excerpt to your chosen model. The excerpt is never stored.','整理时会添加文件夹标签，清理需要你先确认。读取正文会把少量去敏片段交给你配置的模型，片段不会存储。')));
    for(const id of RULE_IDS){
      const row=el('div');row.className='cleanup-rule-settings';row.append(el('h3',ruleName(id,language())));
      checkbox(row,t('Include in cleanup lists','纳入清理清单'),draft.rules[id].enabled,value=>draft.rules[id].enabled=value);
      select(row,t('Where mail goes','邮件去向'),draft.rules[id].action,[['archive',t('Archive · stays in All Mail','归档 · 仍在「所有邮件」')],['trash',t('Trash · Gmail deletes after 30 days','垃圾箱 · Gmail 会在 30 天后彻底删除')]],value=>draft.rules[id].action=value);
      checkbox(row,t('Allow automatic cleanup after clean review days','积累无否决确认日后，允许自动清理'),draft.rules[id].auto,value=>draft.rules[id].auto=value);
      number(row,t('Review days without a rejection · at least 28','连续无否决的确认天数 · 至少 28 天'),draft.rules[id].clean_days,28,365,value=>draft.rules[id].clean_days=value);
      form.append(row);
    }
    const protectedSection=el('details');protectedSection.id='settings-protected';protectedSection.append(el('summary',t('Protected','保护名单')));
    const protectedForm=el('div');protectedForm.className='protected-settings';protectedSection.append(protectedForm);host.append(protectedSection);
    for(const [key,en,zh]of [['senders','Protected senders · one per line','受保护的发件地址 · 每行一个'],['domains','Protected domains · one per line','受保护的域名 · 每行一个'],['labels','Additional keep labels · one per line','额外保留的 Gmail 标签 · 每行一个']]){
      const area=el('textarea');area.value=draft.protected[key].join('\n');area.addEventListener('input',()=>{draft.protected[key]=area.value.split('\n').map(value=>value.trim()).filter(Boolean);dirty();});field(protectedForm,t(en,zh),area);
    }
    const senderRules=el('textarea');senderRules.value=JSON.stringify(draft.sender_labels,null,2);
    senderRules.addEventListener('input',()=>{try{draft.sender_labels=JSON.parse(senderRules.value);}catch{draft.sender_labels=null;}dirty();});field(protectedForm,t('Sender folder rules · JSON address to folder key','按发件人分组 · 用 JSON 写地址和文件夹标识'),senderRules);
    const save=el('button',t('Save cleanup and protection settings','保存清理规则和保护名单'));save.type='button';save.className='btn';save.disabled=!bridge.getConfig();
    save.onclick=async()=>{
      save.disabled=true;
      try{await bridge.saveConfig(settings(draft),baseline);draft=null;baseline=null;bridge.markDirty(false);status.textContent=t('Saved. The next sort prepares a fresh list with these rules.','已保存。下次整理会按新规则重新列清单。');}
      catch{status.textContent=t('Could not save. Check your entries and connection, then retry.','没能保存。请检查输入和连接，再重试。');}
      finally{save.disabled=false;}
    };
    host.append(save,status);
    const source=el('a',t('Source and setup guide','源码和配置说明'));source.href='https://github.com/NickkkLian/Mail-Sorter';source.target='_blank';source.rel='noopener';source.className='btn text-button';host.append(source);
    if(!bridge.getConfig())for(const input of host.querySelectorAll('input,select,textarea'))input.disabled=true;
  };
}
