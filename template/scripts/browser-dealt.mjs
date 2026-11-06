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
const root=process.cwd(),types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json','.woff2':'font/woff2'};
const server=http.createServer((req,res)=>{const name=path.resolve(root,'.'+(new URL(req.url,'http://localhost').pathname==='/'?'/index.html':new URL(req.url,'http://localhost').pathname));if(!name.startsWith(root+path.sep)){res.writeHead(403).end();return;}try{res.setHeader('Content-Type',types[path.extname(name)]||'application/octet-stream');res.end(fs.readFileSync(name));}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-sandbox']});
try{
 for(const language of ['en','zh'])for(const theme of ['light','dark'])for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:950},colorScheme:theme});
  await page.addInitScript(({language,theme})=>{localStorage.setItem('Mail-Sorter:public-preferences:pha-lang',language);localStorage.setItem('Mail-Sorter:public-preferences:pha-settings-v1:Mail-Sorter',JSON.stringify({lang:language,themeMode:'app',theme,connectionMode:'override'}));},{language,theme});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  await page.goto(`${origin}/?demo=1&lang=${language}`);
  await page.evaluate(({language,theme})=>{settingsAdapter.setLanguage(language);settingsAdapter.setTheme(theme);},{language,theme});
  await page.waitForFunction(()=>window.Mailroom?.review.data.proposal);
  if(await page.evaluate(()=>settingsAdapter.language())!==language)await page.locator('#suite-language-toggle').click();
  const initial=Number(await page.locator('#needs-count').innerText());
  await page.locator('.need-entry > summary').first().click();
  await page.locator('.need-entry [data-command=done]').first().click();
  await page.waitForFunction(n=>Number(document.querySelector('#needs-count').textContent)===n-1,initial);
  await page.locator('#toast button').waitFor({state:'visible'});
  assert((await page.locator('#toast').innerText()).includes(language==='en'?'stays in your inbox':'仍留在收件箱'));
  await page.screenshot({path:evidence+'/done-'+language+'-'+theme+'-'+width+'.png'});
  await page.locator('#toast button').click();
  await page.waitForFunction(n=>Number(document.querySelector('#needs-count').textContent)===n,initial);
  await page.locator('[data-place=sorted]').click();
  await page.locator('#filter-menu > summary').click();
  await page.locator('[data-filter=__action]').click();
  await page.locator('[data-command=bulk]').click();
  await page.waitForFunction(()=>HeadersortBoard.shownItems().every(item=>Mailroom.dealt.status((item.mailbox==='secondary'?'secondary:':'')+item.gmailId)==='queued'));
  await page.locator('#nl-settings-button').click();
  assert.equal(await page.locator('#suite-second-mailbox').isChecked(),true);
  const setting=page.locator('#suite-dealt-read');await setting.scrollIntoViewIfNeeded();assert(await setting.isChecked());
  await page.screenshot({path:evidence+'/settings-'+language+'-'+theme+'-'+width+'.png'});
  await page.waitForFunction(()=>HubSettingsRuntime.pending===0);await setting.uncheck();await page.locator('#suite-dealt-save').click();
  await page.waitForFunction(()=>settingsAdapter.settingsDirty()===false);
  assert.equal(await page.evaluate(()=>HeadersortBoard.getConfig().mark_dealt_read),false);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
  console.log('PASS '+language+' '+theme+' '+width+': Done, filtered bulk, Undo, Settings, no overflow/errors');await page.close();
 }
 // Exercise the real GitHub bridge and conflict-aware Settings save using in-memory Contents fixtures.
 const page=await browser.newPage({viewport:{width:1280,height:950}}),files=new Map(),writes=[];let revision=1,failConfig=false;
 const config=settings({enabled:true}),items=[{gmailId:'101',uid:1,category:'finance',subject:'Synthetic statement',from:'billing@service.example',date:new Date().toISOString()},{gmailId:'102',uid:2,category:'travel',subject:'Synthetic itinerary',from:'travel@service.example',date:new Date().toISOString()}];
 items.push({...items[0],mailbox:'secondary',mailbox_address:'second@mail.example',subject:'Synthetic second statement'});
 for(const [key,data]of Object.entries({'mail/config.json':config,'mail/mail.json':{items,updated_at:new Date().toISOString()},'mail/cleanup-log.json':{runs:[],reviews:[]},'mail/cleanup-undo.json':{requests:[]}}))files.set(key,{data,sha:String(revision++)});
 await page.addInitScript(()=>{localStorage.setItem('pha-lang','en');localStorage.setItem('mail_connection',JSON.stringify({owner:'synthetic-owner',repo:'synthetic-repository',token:'synthetic-placeholder'}));localStorage.setItem('Mail-Sorter:public-preferences:pha-settings-v1:Mail-Sorter',JSON.stringify({connectionMode:'override',lang:'en'}));});
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.origin===origin)return route.continue();
  if(url.hostname!=='api.github.com')return route.abort();
  const key=url.pathname.split('/contents/')[1],current=files.get(key);
  if(route.request().method()==='PUT'){
   const body=route.request().postDataJSON();if((failConfig&&key==='mail/config.json')||body.sha!==current?.sha&&(body.sha||current))return route.fulfill({status:409,json:{message:'Synthetic conflict'}});
   const data=JSON.parse(Buffer.from(body.content,'base64').toString());files.set(key,{data,sha:String(revision++)});writes.push({key,data});return route.fulfill({json:{content:{sha:files.get(key).sha}}});
  }
  return route.fulfill(current?{json:{sha:current.sha,encoding:'base64',content:Buffer.from(JSON.stringify(current.data)).toString('base64')}}:{status:404,json:{message:'Synthetic missing file'}});
 });
 await page.goto(origin+'/?place=sorted');await page.locator('[data-dealt-id="101"]:enabled').waitFor();
 await page.locator('#filter-menu > summary').click();
 await page.locator('#mailbox-filter').selectOption('primary');await page.locator('#q').fill('statement');await page.locator('[data-command=bulk]').click();await page.waitForFunction(()=>Mailroom.dealt.requests.some(request=>request.items.length===1));
 assert.deepEqual(files.get('mail/dealt-queue.json').data.requests[0].items,[{gmailId:'101',category:'finance'}]);
 await page.locator('[data-place=history]').click();await page.locator('[data-command=undo-request]').first().click();await page.locator('[data-place=sorted]').click();await page.waitForFunction(()=>!document.querySelector('[data-dealt-id="101"]').disabled);
 assert.equal(files.get('mail/cleanup-undo.json').data.requests.length,1);
 await page.locator('#mailbox-filter').selectOption('secondary');assert.equal(await page.locator('.mail .mailbox-dot').first().getAttribute('aria-label'),'second@mail.example');
 assert(new URL(page.url()).searchParams.get('mailbox')==='secondary');
 await page.locator('[data-command=bulk]').click();await page.waitForFunction(()=>Mailroom.dealt.requests.some(request=>request.items.length===1));
 assert.deepEqual(files.get('mail/dealt-queue.json').data.requests.at(-1).items,[{gmailId:'101',category:'finance',mailbox:'secondary'}]);
 await page.locator('#mailbox-filter').selectOption('primary');await page.locator('[data-dealt-id="101"]:enabled').waitFor();
 await page.reload();await page.locator('[data-dealt-id="101"]:enabled').waitFor();assert.equal(await page.locator('#mailbox-filter').inputValue(),'primary');

 await page.locator('#nl-settings-button').click();await page.locator('#suite-dealt-read').scrollIntoViewIfNeeded();await page.waitForFunction(()=>HubSettingsRuntime.pending===0);
 assert.equal(await page.locator('#suite-second-mailbox').isChecked(),false);
 await page.locator('#suite-second-mailbox').check();await page.locator('#suite-second-save').click();await page.waitForFunction(()=>!settingsAdapter.settingsDirty());
 assert.equal(files.get('mail/config.json').data.second_mailbox_enabled,true);assert.equal(files.get('mail/config.json').data.mark_dealt_read,true);
 await page.locator('#suite-dealt-read').uncheck();await page.locator('#suite-dealt-save').click();await page.waitForFunction(()=>!settingsAdapter.settingsDirty());
 assert.equal(files.get('mail/config.json').data.mark_dealt_read,false);assert.equal(files.get('mail/config.json').data.enabled,true);
 failConfig=true;await page.locator('#suite-second-mailbox').uncheck();await page.locator('#suite-second-save').click();
 await page.locator('#suite-second-settings').getByText('Save not confirmed; reload and review.',{exact:true}).waitFor();
 assert.equal(files.get('mail/config.json').data.second_mailbox_enabled,true);assert.equal(await page.evaluate(()=>HeadersortBoard.getConfig().second_mailbox_enabled),true);assert.equal(await page.locator('#suite-second-mailbox').isChecked(),false);
 await page.evaluate(()=>settingsAdapter.discardSettings());assert(await page.locator('#suite-second-mailbox').isChecked());
 // A write conflict must retain the input draft, restore the displayed saved config, and report failure.
 failConfig=true;await page.locator('#suite-dealt-read').check();await page.locator('#suite-dealt-save').click();
 await page.locator('#suite-dealt-settings').getByText('Save not confirmed; reload and review.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>HeadersortBoard.getConfig().mark_dealt_read),false);assert(await page.locator('#suite-dealt-read').isChecked());
 assert(writes.every(x=>['mail/dealt-queue.json','mail/cleanup-undo.json','mail/config.json'].includes(x.key)));
 console.log('PASS synthetic connected bridge: duplicate-ID mailbox filter/badges/URL reload, scoped bulk, second mailbox setting, filtered bulk IDs, queued Undo, Settings save preserves unrelated fields, 409 retains draft and saved state');await page.close();
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
