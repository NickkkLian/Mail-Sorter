import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
test('Settings has an explicit header row and never mounts at body',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/data-settings-row=/);const entry=fs.readFileSync(new URL('../assets/settings-standard/entry.js',import.meta.url),'utf8');
 assert.doesNotMatch(entry,/document\.body\.(?:append|prepend)/);assert.match(entry,/data-settings-slot/);assert.match(entry,/Settings \/ 设置/);
});
