import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const same=(a,b)=>{if(!fs.readFileSync(path.join(root,a)).equals(fs.readFileSync(path.join(root,b))))throw Error('Shared file mismatch: '+b);};
const modules=fs.readdirSync(path.join(root,'mail/scripts')).filter(x=>x.endsWith('.mjs'));
for(const file of modules)same('mail/scripts/'+file,'template/mail/scripts/'+file);
for(const file of fs.readdirSync(path.join(root,'board')))same('board/'+file,'template/board/'+file);
for(const file of ['index.html','check-csp.mjs','mail/rules.json','mail/config.example.json','package.json','package-lock.json'])same(file,'template/'+file);
for(const file of ['app.webmanifest','favicon.svg','apple-touch-icon.png'])same(file,'template/'+file);
function assets(dir){for(const entry of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){const file=dir+'/'+entry.name;if(entry.isDirectory())assets(file);else same(file,'template/'+file);}}
assets('assets');
same('mail/config.example.json','template/mail/config.json');
console.log('SHARED CODE PASS: runtime, rules, board, locked dependencies and safe example settings match template.');
