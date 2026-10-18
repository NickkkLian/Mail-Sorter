// No secrets or real mailbox metadata belongs in this public repository.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {settings} from '../mail/scripts/settings.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),fail=[];
const sensitive=/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgithub_pat_[A-Za-z0-9_]{30,}|\bgh[pousr]_[A-Za-z0-9]{30,}|\bsk-ant-[A-Za-z0-9_-]{30,}|\bAKIA[A-Z0-9]{16}\b/;
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){
  if(['.git','node_modules'].includes(e.name)||e.name.startsWith('.tmp')||e.name.startsWith('.dry-test')||e.name.startsWith('.sample-test'))continue;
  const p=path.join(dir,e.name),rel=path.relative(root,p);
  if(e.isSymbolicLink()){fail.push(rel);continue;}if(e.isDirectory()){walk(p);continue;}
  if(/(?:mail\.json|sample-pool\.json|testset-reviewed\.json|mail-corrections.*\.json|config-legacy\.json)$/.test(rel))fail.push(rel);
  if(!/\.(?:mjs|html|css|json|md|ya?ml)$/.test(e.name))continue;
  const text=fs.readFileSync(p,'utf8');if(sensitive.test(text))fail.push(rel);
  if(/^(?:index\.html|board\/|mail\/|template\/(?:index\.html|board\/|mail\/))/.test(rel)){
    const emails=text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)||[];
    if(emails.some(x=>!x.endsWith('.example')))fail.push(rel);
  }
}}
walk(root);
const c=settings(JSON.parse(fs.readFileSync(path.join(root,'template/mail/config.json'))));
if(c.enabled||c.read_bodies||c.approval_mode!=='every_run'||Object.values(c.rules).some(x=>x.action!=='archive'||x.auto)||Object.values(c.protected).some(x=>x.length)||Object.keys(c.sender_labels).length)fail.push('template/mail/config.json');
for(const [name,empty]of Object.entries({'runtime.json':{scanAfter:0,lastProposalAt:null},'cleanup-proposal.json':null,'cleanup-approval.json':null,'cleanup-log.json':{runs:[],reviews:[]},'cleanup-undo.json':{requests:[]}})){
  if(JSON.stringify(JSON.parse(fs.readFileSync(path.join(root,'template/mail',name))))!==JSON.stringify(empty))fail.push('template/mail/'+name);
}
if(fail.length){console.error('PRIVACY CHECK FAILED (paths only): '+[...new Set(fail)].join(', '));process.exitCode=1;}else console.log('PRIVACY CHECK PASS: no mailbox artifacts, personal settings, non-example product addresses or secret patterns.');
