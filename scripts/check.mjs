import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {Script} from 'node:vm';
const root=fileURLToPath(new URL('../',import.meta.url));
function run(args){const r=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit',env:{PATH:process.env.PATH}});if(r.status!==0)process.exit(r.status||1);}
const tests=fs.readdirSync(path.join(root,'test')).filter(x=>x.endsWith('.test.mjs')).sort().map(x=>'test/'+x);
run(['--import','./scripts/offline-guard.mjs','--test','--test-reporter=dot',...tests]);
console.log('OFFLINE TESTS PASS');
run(['eval/score-cleanup.mjs']);run(['eval/score-cleanup.mjs','--break']);
run(['check-csp.mjs']);run(['check-csp.mjs','--self-test']);
const page=fs.readFileSync(path.join(root,'index.html'),'utf8');
for(const m of page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))if(!/\bsrc=/.test(m[1]))new Script(m[2]);
console.log('BOARD INLINE SYNTAX PASS');
for(const dir of ['mail/scripts','board','eval','scripts'])for(const file of fs.readdirSync(path.join(root,dir)))if(file.endsWith('.mjs'))run(['--check',dir+'/'+file]);
console.log('MODULE SYNTAX PASS');
if(fs.existsSync(path.join(root,'template/mail/config.json'))){run(['scripts/verify-shared.mjs']);run(['scripts/privacy-check.mjs']);}
console.log('ALL CHECKS PASS (no network, no mailbox, no real-mail evaluation)');
