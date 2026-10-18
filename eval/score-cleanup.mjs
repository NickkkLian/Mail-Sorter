import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {decide} from '../mail/scripts/rules.mjs';
import {SAMPLE_FIELDS} from '../mail/scripts/metadata.mjs';
export const CLASSES=Object.freeze(['O1','O2','O3','O4','O5','O6','O7','people','finance','official','travel','security','school','job','health']);
// Availability is a separate, human-curated declaration, never sampling signals
// or a classifier's guesses. Without a declaration retain the ten-per-class gate.
export function coverage(spec){
  const counts=Object.fromEntries(CLASSES.map(k=>[k,0]));
  for(const x of spec.items){
    const e=x.expected,k=e.kind==='outdated'?e.rule:e.kind==='keep'?e.category:null;
    if(k!==null){if(!Object.hasOwn(counts,k)||(e.kind==='outdated')!==/^O[1-7]$/.test(k))throw Error('Invalid expected class');counts[k]++;}
  }
  const available=spec.available_in_set;
  if(available!==undefined&&(!available||Array.isArray(available)||typeof available!=='object'||Object.keys(available).length!==CLASSES.length||CLASSES.some(k=>!Number.isInteger(available[k])||available[k]<0||available[k]>200||available[k]<counts[k])))throw Error('Invalid class availability');
  return CLASSES.map(k=>({class:k,count:counts[k],available:available?.[k]??Math.max(10,counts[k]),required:Math.min(10,available?.[k]??10),shortfall:Math.max(0,10-(available?.[k]??counts[k]))}));
}
export function validateSet(spec,{privateSet=false,draft=false}={}){
  if(!spec||spec.items?.length!==200||!Number.isFinite(Date.parse(spec.now)))throw Error('Expected 200 labelled records and a fixed reference date');
  if(privateSet&&(spec.synthetic!==false||(draft?spec.reviewed_by_nick!==false:spec.reviewed_by_nick!==true)))throw Error('Private set requires the appropriate Nick review marker');
  const ids=new Set();
  for(const x of spec.items){if(!x.id||ids.has(x.id)||!x.message||!['keep','outdated','uncertain'].includes(x.expected?.kind))throw Error('Invalid evaluation record');ids.add(x.id);
    const allowed=['uid',...SAMPLE_FIELDS];
    if(Object.keys(x.message).some(k=>!allowed.includes(k)))throw Error('Evaluation must contain metadata only');
  }
  const rows=coverage(spec);
  if(rows.some(row=>row.count<row.required))throw Error('Insufficient class coverage');
  return rows;
}
export function score(spec,{mutate=false}={}){
  let wrong=0,proposed=0,trueCleans=0,outdated=0,keepHits=0,keepCount=0;
  for(const x of spec.items){const v=decide(x.message,{},new Date(spec.now));if(mutate&&x.expected.category==='finance')v.rule='BAD';
    if(x.expected.kind==='outdated')outdated++;
    if(x.expected.kind==='keep'){keepCount++;if(v.category===x.expected.category)keepHits++;}
    if(v.rule){proposed++;if(x.expected.kind==='outdated'&&v.rule===x.expected.rule)trueCleans++;else wrong++;}
  }
  const precision=proposed?trueCleans/proposed:0,recall=outdated?trueCleans/outdated:0;
  return {wrong,proposed,precision,recall,keepAccuracy:keepCount?keepHits/keepCount:0,pass:wrong===0&&precision===1&&recall>=0.5};
}
function main(){try{const args=process.argv.slice(2),privateIndex=args.indexOf('--private'),draft=args.includes('--draft');let spec,rows;
  if(draft&&(privateIndex<0||args.includes('--reviewed')))throw Error('Draft diagnostics require a private unreviewed set');
  if(privateIndex>=0){if(!draft&&!args.includes('--reviewed'))throw Error('Private scoring requires --reviewed after Nick checks labels');spec=JSON.parse(fs.readFileSync(args[privateIndex+1],'utf8'));rows=validateSet(spec,{privateSet:true,draft});}
  else{spec=JSON.parse(fs.readFileSync(new URL('./synthetic.json',import.meta.url),'utf8'));rows=validateSet(spec);}
  if(draft)console.log('DRAFT ONLY: labels and availability are unreviewed; this is not a release gate.');
  const short=rows.filter(row=>row.shortfall>0);
  console.log(short.length?'Coverage shortfalls (target 10): '+short.map(row=>`${row.class}: ${row.available} available, ${row.count} included, require ${row.required}, short ${row.shortfall}`).join('; '):'Coverage: all 15 classes have at least 10 examples.');
  const r=score(spec,{mutate:args.includes('--break')});
  console.log(`Cleanup score: wrong cleans ${r.wrong}; precision ${(r.precision*100).toFixed(1)}%; outdated recall ${(r.recall*100).toFixed(1)}%; keep accuracy ${(r.keepAccuracy*100).toFixed(1)}%`);
  if(args.includes('--break')){console.log((draft?'DRAFT ': '')+(!r.pass?'EXPECTED FAILURE: unsafe bank-mail mutation rejected':'FAIL: unsafe mutation escaped'));return r.pass?1:0;}
  console.log((draft?'DRAFT CHECK ':'EVAL ')+(r.pass?'PASS':'FAIL'));return r.pass?0:1;
}catch{console.log('EVAL INVALID: check schema, coverage, fixed date, and review marker. No message data printed.');return 2;}}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=main();
