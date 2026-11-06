/* App-owned queue and source bindings for the pinned shared save-status view. */
// A fresh public visit starts in the app's light palette. Existing choices and
// the hosted hub's appearance contract continue to take precedence.
try {
 const C=HubSettingsContract;
 if(!C.hosted&&['pha-settings-v1:Mail-Sorter','nl-scheme','pha-theme','theme','qm-theme'].every(key=>localStorage.getItem(C.preferenceKey(key))===null)){
  HubSettingsRuntime.write('Mail-Sorter',{themeMode:'app',theme:'light'});
  document.documentElement.dataset.scheme='light';
 }
} catch { /* A storage failure must not prevent reading the board. */ }
window.RolloutSave={create({connection,language,path}){
 const store=SuiteSaveStatus.create(),view=SuiteSaveStatus.mount(document.querySelector('#app-save-status'),store,{language});
 const key=(suffix=path)=>{const c=connection();return JSON.stringify([c.owner,c.repo,c.branch||'',suffix]);};
 const sync=()=>{const c=connection();store.connection({online:navigator.onLine,connected:new URLSearchParams(location.search).get('demo')==='1'||!!(c.owner&&c.repo&&c.token)});view.refresh();};
 window.addEventListener('online',sync);window.addEventListener('offline',sync);
 const api=Object.assign(store,{key,sync,view});queueMicrotask(sync);return api;
}};
