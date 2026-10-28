import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const read=n=>fs.readFileSync(new URL('../assets/settings-standard/'+n,import.meta.url),'utf8');
test('v2 header owns immediate preferences',()=>{assert.ok(read('entry.js').includes('suite-theme-toggle'));assert.ok(read('entry.js').includes('suite-language-toggle'));});
test('v2 panel excludes preference rows and starts at app',()=>{assert.ok(!/id="suite-(?:language|theme|theme-mode|section-appearance)"/.test(read('panel.js')));assert.ok(read('panel.js').includes("section='app'"));});
test('pointer title focus is suppressed and keyboard focus remains',()=>{assert.ok(read('panel.css').includes('[data-open-input="pointer"] #suite-settings-title:focus'));assert.ok(read('panel.css').includes('#suite-settings-title:focus-visible'));});
