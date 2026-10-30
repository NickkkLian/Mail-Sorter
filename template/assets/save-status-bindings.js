/* Source adoption invalidates old attempts; Settings writes/preferences never acknowledge data. */
(()=>{const a=settingsAdapter,adopt=a.adopt,setLanguage=a.setLanguage;
 a.adopt=function(...args){const before=appSave.key();const result=adopt.apply(this,args);if(before!==appSave.key())appSave.reset();appSave.sync();return result;};
 a.setLanguage=function(...args){const result=setLanguage.apply(this,args);appSave.view.refresh();return result;};
 new MutationObserver(()=>appSave.draft('settings-form',!!document.querySelector('#suite-classifier-enabled[data-dirty],#suite-dealt-read[data-dirty],#suite-second-mailbox[data-dirty]'))).observe(document.body,{subtree:true,attributes:true,attributeFilter:['data-dirty']});
 appSave.sync();
})();
