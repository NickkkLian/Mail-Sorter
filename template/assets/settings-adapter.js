/* Headersort: repository-managed mail and backend-only AI; no browser Anthropic credential. */
(() => {
  const C=HubSettingsContract,R=HubSettingsRuntime,H=SuiteSettingsHelpers,kit=H.kitPreferences('Mail-Sorter');
  const gear=document.getElementById('nl-settings-button');let classifierDirty=false,dealtReadDirty=false,secondMailboxDirty=false;
  const adapter=window.settingsAdapter={
    ...kit,app:'Mail-Sorter',demo:DEMO,connectionSlot:'mail_connection',
    routing:'mail/mail.json digest; mail/config.json classifier settings; mail/dealt-queue.json dealt requests; mail/cleanup-* review, approval and undo files.',
    language:()=>lang,setLanguage(value){if(value!==lang){lang=value;applyStatic();render();}H.gear(gear,T('设置','Settings'));},
    connection:()=>({...mailConnection}),unsaved:()=>mailCleanupDirty||classifierDirty||dealtReadDirty||secondMailboxDirty,
    settingsDirty:()=>kit.settingsDirty()||classifierDirty||dealtReadDirty||secondMailboxDirty,
    discardSettings(){kit.discardSettings();secondMailboxDirty=false;const second=document.getElementById('suite-second-mailbox');if(second){delete second.dataset.dirty;second.checked=CONF?.second_mailbox_enabled===true;second._base=second.checked;}classifierDirty=false;dealtReadDirty=false;const dealt=document.getElementById('suite-dealt-read');if(dealt){delete dealt.dataset.dirty;dealt.checked=CONF?.mark_dealt_read!==false;dealt._base=dealt.checked;}const input=document.getElementById('suite-classifier-enabled');if(input){delete input.dataset.dirty;input.checked=CONF?.enabled!==false;input._base=CONF?.enabled;}},
    adopt(next){if(R.sameConnection(mailConnection,next))return;mailConnection={...next};MAIL=null;CONF=null;SHA_CONF=null;BASE_CONF=null;LOADED=false;LOAD_ERROR=null;render();},
    async reload(){if(DEMO)return;if(!C.complete(mailConnection))throw new C.SettingsError('required');if(!await loadAll())throw new C.SettingsError('storage');},
    refreshAI(){},
    aiNotice:{en:'AI classification runs in your data repository’s scheduled backend. Its Anthropic and Gmail credentials belong in repository Actions secrets. This browser stores no AI key and cannot test or replace those credentials.',zh:'AI 分类在数据仓库的定时后台运行。Anthropic 与 Gmail 凭据由仓库 Actions Secrets 管理；此浏览器不保存 AI 密钥，也不能测试或替换后台凭据。'},
    dataMode:'repository',
    backupHelp:{en:'Mail, classifier configuration, cleanup review, approval and undo history are managed in the private data repository. This digest is not a complete mailbox backup. Existing review and Undo controls stay below the digest; there is no browser whole-repository restore. Reset only changes this app’s appearance and shortcut preferences.',zh:'邮件、分类配置、清理审核、批准与撤销记录由私有数据仓库管理。摘要不是完整邮箱备份。原审核与撤销控件保留在摘要下方；浏览器没有整仓恢复功能。重置仅更改此应用的外观与快捷键偏好。'},
    appControls(container,settings){
      let intro=container.querySelector('p');if(!intro){intro=document.createElement('p');container.append(intro);}intro.textContent=T('定时分类开关只保存 enabled；后台模型、Gmail 凭据、清理规则与审核流程保持各自管理。','The scheduled classifier switch saves only enabled. Backend models and credentials, cleanup rules and review keep their existing controls.');
      let group=container.querySelector('#suite-classifier');if(!group){group=document.createElement('div');group.id='suite-classifier';container.append(group);}
      if(!group.firstChild){
        const label=document.createElement('label'),input=document.createElement('input'),save=document.createElement('button'),status=document.createElement('p'),review=document.createElement('button'),discard=document.createElement('button');
        input.type='checkbox';input.id='suite-classifier-enabled';label.htmlFor=input.id;save.id='suite-classifier-save';status.id='suite-classifier-status';status.setAttribute('role','status');review.id='suite-mail-review';discard.id='suite-mail-discard';group.append(label,input,save,status,review,discard);
        input.onchange=()=>{input.dataset.dirty='true';classifierDirty=true;SuiteSettings.refresh();};
        save.onclick=async()=>{if(DEMO||R.pending||mailCleanupDirty||!CONF){status.textContent=T('请先完成操作并保存或取消清理设置。','Finish pending work and save or discard cleanup settings first.');return;}const before=CONF.enabled;try{await R.track(async()=>{if(before!==input._base)throw new C.SettingsError('conflict');CONF={...CONF,enabled:input.checked};await saveConf('mail: update scheduled classifier');render();});delete input.dataset.dirty;classifierDirty=false;status.textContent=T('已保存','Saved');}catch{CONF={...CONF,enabled:before};render();status.textContent=T('没有确认保存；请刷新后检查。','Save not confirmed; reload and review.');}SuiteSettings.refresh();};
        review.onclick=async()=>{await settings.close();if(!document.querySelector('#suite-settings').open){document.getElementById('cleanup-panel')?.scrollIntoView();document.querySelector('#cleanup-panel h2')?.focus();}};
        discard.onclick=async()=>{if(R.pending)return;if(await settings.confirm('Discard only the unsaved cleanup settings form and reload its saved values?','仅放弃尚未保存的清理设置表单，并重新加载已保存值？','Discard','放弃'))await HeadersortBoard.discardCleanupDraft?.();};
      }
      const input=group.querySelector('input'),buttons=group.querySelectorAll('button');
      group.querySelector('label').textContent=T('定时自动分类','Scheduled classification');
      if(!input.dataset.dirty){input.checked=CONF?.enabled!==false;input._base=CONF?.enabled;}
      input.disabled=DEMO||!CONF;buttons[0].textContent=T('保存分类开关','Save classifier switch');buttons[0].disabled=DEMO||!CONF||!classifierDirty||Boolean(R.pending);buttons[1].textContent=T('打开清理审核与撤销','Open cleanup review and Undo');buttons[2].textContent=T('放弃本机清理设置草稿','Discard local cleanup settings draft');buttons[2].disabled=!mailCleanupDirty;
      let dealt=container.querySelector('#suite-dealt-settings');if(!dealt){
        dealt=document.createElement('div');dealt.id='suite-dealt-settings';
        const label=document.createElement('label'),input=document.createElement('input'),help=document.createElement('p'),save=document.createElement('button'),status=document.createElement('p');
        input.id='suite-dealt-read';input.type='checkbox';label.htmlFor=input.id;save.type='button';save.id='suite-dealt-save';status.setAttribute('role','status');help.className='hint';dealt.append(label,input,help,save,status);container.append(dealt);
        input.onchange=()=>{input.dataset.dirty='true';dealtReadDirty=true;SuiteSettings.refresh();};
        save.onclick=async()=>{
          if(R.pending||mailCleanupDirty||!CONF){status.textContent=T('请先完成操作并保存或取消清理设置。','Finish pending work and save or discard cleanup settings first.');return;}
          const before=CONF.mark_dealt_read;try{await R.track(async()=>{if((CONF.mark_dealt_read!==false)!==input._base)throw new C.SettingsError('conflict');CONF={...CONF,mark_dealt_read:input.checked};if(!DEMO)await saveConf('mail: update dealt read preference');render();});delete input.dataset.dirty;dealtReadDirty=false;status.textContent=T('已保存','Saved');}catch{CONF={...CONF,mark_dealt_read:before};render();status.textContent=T('没有确认保存；请刷新后检查。','Save not confirmed; reload and review.');}SuiteSettings.refresh();
        };
      }
      const dealtInput=dealt.querySelector('input'),dealtSave=dealt.querySelector('button');
      dealt.querySelector('label').textContent=T('将已处理邮件标为已读','Mark dealt mail as read');
      dealt.querySelector('.hint').textContent=T('默认开启。下次 mail-sync 运行时生效，同时添加类别标签并保留在收件箱。','On by default. Applies on the next mail-sync run, with a category label; mail stays in Inbox.');
      if(!dealtInput.dataset.dirty){dealtInput.checked=CONF?.mark_dealt_read!==false;dealtInput._base=dealtInput.checked;}
      dealtInput.disabled=!CONF;dealtSave.textContent=T('保存已处理邮件设置','Save dealt mail setting');dealtSave.disabled=!CONF||!dealtReadDirty||Boolean(R.pending);
      let second=container.querySelector('#suite-second-settings');if(!second){
        second=document.createElement('div');second.id='suite-second-settings';
        const label=document.createElement('label'),input=document.createElement('input'),help=document.createElement('p'),save=document.createElement('button'),status=document.createElement('p');
        input.id='suite-second-mailbox';input.type='checkbox';label.htmlFor=input.id;save.type='button';save.id='suite-second-save';status.setAttribute('role','status');help.className='hint';second.append(label,input,help,save,status);container.append(second);
        input.onchange=()=>{input.dataset.dirty='true';secondMailboxDirty=true;SuiteSettings.refresh();};
        save.onclick=async()=>{
          if(R.pending||mailCleanupDirty||!CONF){status.textContent=T('请先完成操作并保存或取消清理设置。','Finish pending work and save or discard cleanup settings first.');return;}
          const before=CONF.second_mailbox_enabled;try{await R.track(async()=>{if((CONF.second_mailbox_enabled===true)!==input._base)throw new C.SettingsError('conflict');CONF={...CONF,second_mailbox_enabled:input.checked};if(!DEMO)await saveConf('mail: update second mailbox switch');render();});delete input.dataset.dirty;secondMailboxDirty=false;status.textContent=T('已保存','Saved');}catch{CONF={...CONF,second_mailbox_enabled:before};render();status.textContent=T('没有确认保存；请刷新后检查。','Save not confirmed; reload and review.');}SuiteSettings.refresh();
        };
      }
      const secondInput=second.querySelector('input'),secondSave=second.querySelector('button');
      second.querySelector('label').textContent=T('启用第二邮箱','Enable second mailbox');
      second.querySelector('.hint').textContent=T('默认关闭。需在数据仓库的 Actions secrets 设置 GMAIL2_USER 和 GMAIL2_APP_PASSWORD。关闭会暂停该邮箱的同步、处理和撤销。','Off by default. Set GMAIL2_USER and GMAIL2_APP_PASSWORD in the data repository’s Actions secrets. Turning off pauses this mailbox’s sync, dealt actions and Undo.');
      if(!secondInput.dataset.dirty){secondInput.checked=CONF?.second_mailbox_enabled===true;secondInput._base=secondInput.checked;}
      secondInput.disabled=!CONF;secondSave.textContent=T('保存第二邮箱设置','Save second mailbox setting');secondSave.disabled=!CONF||!secondMailboxDirty||Boolean(R.pending);
      kit.shortcuts(container);
    },
    install(settings){gear.onclick=()=>settings.open();H.gear(gear,T('设置','Settings'));},
  };
})();
