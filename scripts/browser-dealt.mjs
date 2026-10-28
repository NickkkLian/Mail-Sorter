// Run against a local server: PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs node scripts/browser-dealt.mjs
// All repository reads/writes use synthetic, in-memory Contents responses. No external requests are allowed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {settings} from '../mail/scripts/settings.mjs';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
const evidence=process.env.EVIDENCE_DIR||'evidence';fs.mkdirSync(evidence,{recursive:true});
const root=process.cwd(),types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
const server=http.createServer((req,res)=>{const name=path.resolve(root,'.'+(new URL(req.url,'http://localhost').pathname==='/'?'/index.html':new URL(req.url,'http://localhost').pathname));if(!name.startsWith(root+path.sep)){res.writeHead(403).end();return;}try{res.setHeader('Content-Type',types[path.extname(name)]||'application/octet-stream');res.end(fs.readFileSync(name));}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(8765,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-sandbox']});
try{
 for(const language of ['en','zh'])for(const theme of ['light','dark'])for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:950},colorScheme:theme});
  await page.addInitScript(({language,theme})=>{localStorage.setItem('pha-lang',language);localStorage.setItem('pha-settings-v1:Mail-Sorter',JSON.stringify({lang:language,themeMode:'app',theme,connectionMode:'override'}));},{language,theme});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:')?route.continue():route.abort());
  await page.goto(`http://127.0.0.1:8765/?demo=1&lang=${language}`);
  await page.evaluate(({language,theme})=>{settingsAdapter.setLanguage(language);settingsAdapter.setTheme(theme);},{language,theme});
  const bulk=page.locator('[data-dealt-all]');await bulk.waitFor({state:'visible'});
  await page.locator('[data-dealt-id]').first().click();await page.getByText(language==='en'?'Dealt · queued':'已处理 · 待同步',{exact:true}).first().waitFor();
  assert((await page.locator('#dealt-toolbar').innerText()).includes(language==='en'?'next mail-sync run':'下次 mail-sync'));
  await page.locator('#dealt-toolbar').scrollIntoViewIfNeeded();
  await page.screenshot({path:`${evidence}/dealt-${language}-${theme}-${width}.png`});
  await page.locator('#dealt-toolbar').getByRole('button',{name:language==='en'?'Undo':'撤销',exact:true}).first().click();
  await page.waitForFunction(()=>!document.querySelector('[data-dealt-id]').disabled);
  await bulk.click();await page.waitForFunction(()=>[...document.querySelectorAll('[data-dealt-id]')].every(b=>b.textContent.includes('queued')||b.textContent.includes('待同步')));
  await page.locator('#nl-settings-button').click();await page.locator('[data-section="app"]').click();
  const setting=page.locator('#suite-dealt-read');await setting.waitFor({state:'visible'});assert(await setting.isChecked());
  await page.screenshot({path:`${evidence}/settings-${language}-${theme}-${width}.png`});
  await page.waitForFunction(()=>HubSettingsRuntime.pending===0);await setting.uncheck();await page.locator('#suite-dealt-save').click();await page.waitForFunction(()=>settingsAdapter.settingsDirty()===false);assert.equal(await page.evaluate(()=>HeadersortBoard.getConfig().mark_dealt_read),false);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
  console.log(`PASS ${language} ${theme} ${width}: dealt, bulk, queue copy, Settings default, no overflow/errors`);await page.close();
 }
 // Exercise the real GitHub bridge and conflict-aware Settings save using in-memory Contents fixtures.
 const page=await browser.newPage({viewport:{width:1280,height:950}}),files=new Map(),writes=[];let revision=1,failConfig=false;
 const config=settings({enabled:true}),items=[{gmailId:'101',uid:1,category:'finance',subject:'Synthetic statement',from:'billing@service.example',date:new Date().toISOString()},{gmailId:'102',uid:2,category:'travel',subject:'Synthetic itinerary',from:'travel@service.example',date:new Date().toISOString()}];
 for(const [key,data]of Object.entries({'mail/config.json':config,'mail/mail.json':{items,updated_at:new Date().toISOString()},'mail/cleanup-log.json':{runs:[],reviews:[]},'mail/cleanup-undo.json':{requests:[]}}))files.set(key,{data,sha:String(revision++)});
 await page.addInitScript(()=>{localStorage.setItem('pha-lang','en');localStorage.setItem('mail_connection',JSON.stringify({owner:'synthetic-owner',repo:'synthetic-repository',token:'synthetic-placeholder'}));localStorage.setItem('pha-settings-v1:Mail-Sorter',JSON.stringify({connectionMode:'override',lang:'en'}));});
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.origin==='http://127.0.0.1:8765')return route.continue();
  if(url.hostname!=='api.github.com')return route.abort();
  const key=url.pathname.split('/contents/')[1],current=files.get(key);
  if(route.request().method()==='PUT'){
   const body=route.request().postDataJSON();if((failConfig&&key==='mail/config.json')||body.sha!==current?.sha&&(body.sha||current))return route.fulfill({status:409,json:{message:'Synthetic conflict'}});
   const data=JSON.parse(Buffer.from(body.content,'base64').toString());files.set(key,{data,sha:String(revision++)});writes.push({key,data});return route.fulfill({json:{content:{sha:files.get(key).sha}}});
  }
  return route.fulfill(current?{json:{sha:current.sha,encoding:'base64',content:Buffer.from(JSON.stringify(current.data)).toString('base64')}}:{status:404,json:{message:'Synthetic missing file'}});
 });
 await page.goto('http://127.0.0.1:8765/');await page.locator('[data-dealt-id="101"]:enabled').waitFor();
 await page.locator('#q').fill('statement');await page.locator('[data-dealt-all]').click();await page.getByText('1 · Queued',{exact:true}).waitFor();
 assert.deepEqual(files.get('mail/dealt-queue.json').data.requests[0].items,[{gmailId:'101',category:'finance'}]);
 await page.locator('#dealt-toolbar').getByRole('button',{name:'Undo',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[data-dealt-id="101"]').disabled);
 assert.equal(files.get('mail/cleanup-undo.json').data.requests.length,1);
 await page.locator('#nl-settings-button').click();await page.locator('#suite-dealt-read').scrollIntoViewIfNeeded();await page.waitForFunction(()=>HubSettingsRuntime.pending===0);
 await page.locator('#suite-dealt-read').uncheck();await page.locator('#suite-dealt-save').click();await page.waitForFunction(()=>!settingsAdapter.settingsDirty());
 assert.equal(files.get('mail/config.json').data.mark_dealt_read,false);assert.equal(files.get('mail/config.json').data.enabled,true);
 // A write conflict must retain the input draft, restore the displayed saved config, and report failure.
 failConfig=true;await page.locator('#suite-dealt-read').check();await page.locator('#suite-dealt-save').click();
 await page.getByText('Save not confirmed; reload and review.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>HeadersortBoard.getConfig().mark_dealt_read),false);assert(await page.locator('#suite-dealt-read').isChecked());
 assert(writes.every(x=>['mail/dealt-queue.json','mail/cleanup-undo.json','mail/config.json'].includes(x.key)));
 console.log('PASS synthetic connected bridge: filtered bulk IDs, queued Undo, Settings save preserves unrelated fields, 409 retains draft and saved state');await page.close();
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
