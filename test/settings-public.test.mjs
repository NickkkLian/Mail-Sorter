import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {test} from 'node:test';
const assets=new URL('../assets/settings-standard/',import.meta.url),manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',assets))),source=fs.readFileSync(new URL('core.js',assets),'utf8');
function context(marked,manager='/?app=test#keys-and-connections'){
 const c={window:{},document:{querySelector:s=>s.includes('settings-host')?{content:marked?'same-origin-v1':''}:{content:manager}},location:{protocol:'https:',origin:'https://example.test'},URL};
 vm.runInNewContext(source,c);return c.window.HubSettingsContract;
}
test('public preferences use only this app namespace; validated host keeps original slots',()=>{
 const own=context(false),hub=context(true);assert.equal(own.hosted,false);assert.equal(hub.hosted,true);
 for(const key of ['pha-lang','pha-theme','nl-theme','nl-scheme','nl-shortcuts','pha-settings-v1:']){assert.equal(own.preferenceKey(key),manifest.app+':public-preferences:'+key);assert.equal(hub.preferenceKey(key),key);}
 assert.equal(own.PROVENANCE,manifest.app+':public-preferences:pha-settings-provenance-v1');assert.equal(hub.PROVENANCE,'pha-settings-provenance-v1');
 for(const manager of ['//example.test/','https://example.test/','/elsewhere'])assert.equal(context(true,manager).hosted,false);
 const values=new Map([['pha-lang','zh'],['pha-theme','light']]),store={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 own.preferencesWrite(store,{lang:'en',theme:'dark'},{lang:null,theme:null});assert.equal(values.get(manifest.app+':public-preferences:pha-lang'),'en');assert.equal(values.get(manifest.app+':public-preferences:pha-theme'),'dark');assert.equal(values.get('pha-lang'),'zh');assert.equal(values.get('pha-theme'),'light');
});
