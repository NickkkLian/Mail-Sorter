/* App-owned queue and source bindings for the pinned shared save-status view. */
window.RolloutSave={create({connection,language,path}){
 const store=SuiteSaveStatus.create(),view=SuiteSaveStatus.mount(document.querySelector('#app-save-status'),store,{language});
 const key=(suffix=path)=>{const c=connection();return JSON.stringify([c.owner,c.repo,c.branch||'',suffix]);};
 const sync=()=>{const c=connection();store.connection({online:navigator.onLine,connected:!!(c.owner&&c.repo&&c.token)});view.refresh();};
 window.addEventListener('online',sync);window.addEventListener('offline',sync);
 const api=Object.assign(store,{key,sync,view});queueMicrotask(sync);return api;
}};
