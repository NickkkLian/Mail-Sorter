// Repository compatibility check; also works after copying this template into a private repo.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const local=fileURLToPath(new URL('./',import.meta.url)),parent=fileURLToPath(new URL('../',import.meta.url));
function run(cwd,args){const r=spawnSync(process.execPath,args,{cwd,stdio:'inherit',env:{PATH:process.env.PATH}});if(r.status!==0)process.exit(r.status||1);}
const paired=fs.existsSync(parent+'template/mail/config.json');
if(paired)run(parent,['scripts/verify-shared.mjs']);
run(local,['scripts/check.mjs']);
if(paired)run(parent,['scripts/privacy-check.mjs']);
