import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const ROOT=fileURLToPath(new URL('../',import.meta.url)),WORKSPACE=path.dirname(ROOT.slice(0,-1));
// Exact allowlist: neither private state nor credentials can be swept up by a recursive copy.
export const FILES=[
  'index.html','apple-touch-icon.png','check-csp.mjs','package.json','package-lock.json','README.md','LICENSE',
  'mail/config.example.json','mail/rules.json',
  ...['settings','rules','core','imap','metadata','classify','llm','privacy','intelligence','storage'].map(x=>'mail/scripts/'+x+'.mjs'),
  ...['review.mjs','cleanup.mjs','demo.mjs','cleanup.css'].map(x=>'board/'+x),
  ...['PRIVATE-SET.md','synthetic.mjs','synthetic.json','score-cleanup.mjs'].map(x=>'eval/'+x),
  ...['stage1.test.mjs','stage2.test.mjs','calendar.test.mjs','stage3.test.mjs','adapter.test.mjs','round2.test.mjs','precedence-coverage.test.mjs','tune-notices.test.mjs','release.test.mjs','helpers/fake-imap.mjs'].map(x=>'test/'+x),
  'scripts/check.mjs','scripts/export.mjs','scripts/offline-guard.mjs'
];
const hash=b=>createHash('sha256').update(b).digest('hex');
export function exportTrees({refresh=false}={}){
  const manifest=Object.fromEntries(FILES.map(name=>[name,hash(fs.readFileSync(path.join(ROOT,name)))]));
  for(const kind of ['public','private']){
    const out=path.join(WORKSPACE,'build',kind);
    // Refuse symlinks so this script never writes outside the workspace via an export path.
    for(const part of ['build',path.join('build',kind)]){const p=path.join(WORKSPACE,part);if(fs.existsSync(p)&&fs.lstatSync(p).isSymbolicLink())throw Error('Unsafe export path');}
    if(fs.existsSync(out)&&fs.readdirSync(out).length&&!refresh)throw Error('Export already exists; use --verify to check it.');
    for(const name of [...FILES,'manifest.json','mail/config.json']){let p=path.join(out,name);while(p.startsWith(out)){if(fs.existsSync(p)&&fs.lstatSync(p).isSymbolicLink())throw Error('Unsafe export path');p=path.dirname(p);}}
    for(const name of FILES){const target=path.join(out,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(ROOT,name),target);}
    fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
    const config=kind==='private'?fs.readFileSync(path.join(WORKSPACE,'private/nick-settings.json')):fs.readFileSync(path.join(ROOT,'mail/config.example.json'));
    if(!refresh||!fs.existsSync(path.join(out,'mail/config.json')))fs.writeFileSync(path.join(out,'mail/config.json'),config,{mode:0o600});
  }
  verifyTrees();
}
export function verifyTrees(){
  for(const name of FILES){const source=fs.readFileSync(path.join(ROOT,name));for(const kind of ['public','private'])if(!source.equals(fs.readFileSync(path.join(WORKSPACE,'build',kind,name))))throw Error('Export parity mismatch');}
  const allowed=new Set([...FILES,'mail/config.json','manifest.json']);
  for(const kind of ['public','private']){const out=path.join(WORKSPACE,'build',kind);function walk(dir){for(const file of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,file.name);if(file.isSymbolicLink())throw Error('Unsafe export path');if(file.isDirectory())walk(p);else if(!allowed.has(path.relative(out,p)))throw Error('Unexpected export file');}}walk(out);const manifest=JSON.parse(fs.readFileSync(path.join(out,'manifest.json'),'utf8'));for(const name of FILES)if(manifest[name]!==hash(fs.readFileSync(path.join(ROOT,name))))throw Error('Manifest mismatch');}
  if(!fs.readFileSync(path.join(WORKSPACE,'build/public/mail/config.json')).equals(fs.readFileSync(path.join(ROOT,'mail/config.example.json'))))throw Error('Public settings differ from safe defaults');
  console.log(`PARITY PASS: ${FILES.length} shared files are byte-identical in public and private exports; only settings differ.`);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{if(process.argv.includes('--verify'))verifyTrees();else exportTrees({refresh:process.argv.includes('--refresh')});}catch{console.log('EXPORT FAILED: check allowlist, fresh local build directories, and shared file parity.');process.exitCode=1;}}
