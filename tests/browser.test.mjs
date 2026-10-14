import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const root = path.resolve(import.meta.dirname,'..');
let server, browser, profile, origin, debuggerURL;
const pages = [];
before(async () => {
  server = http.createServer(async (req,res) => {
    if(req.url === '/fixture') {res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body></body></html>');return;}
    const filename=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname));
    if(!filename.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    try {const data=await fs.readFile(filename);res.setHeader('Content-Type',filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':filename.endsWith('.html')?'text/html':'application/octet-stream');res.end(data);}
    catch {res.writeHead(404).end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r)); origin=`http://127.0.0.1:${server.address().port}`;
  profile=await fs.mkdtemp(path.join(os.tmpdir(),'merch-browser-test-'));
  browser=spawn(process.env.CHROMIUM_PATH || 'chromium',['--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',`--user-data-dir=${profile}`,'--remote-debugging-port=0','about:blank'],{stdio:['ignore','ignore','pipe']});
  debuggerURL=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Chromium did not start within 15 seconds')),15000);
    let output='';browser.stderr.on('data',chunk=>{output+=chunk;const match=output.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
    browser.once('error',error=>{clearTimeout(timer);reject(error);});
    browser.once('exit',code=>{clearTimeout(timer);reject(new Error(`Chromium exited with ${code}`));});
  });
});
after(async()=>{
  for(const page of pages) page.ws.close();
  if(browser && browser.exitCode===null){const exited=new Promise(r=>browser.once('exit',r));browser.kill('SIGTERM');await exited;}
  if(server)await new Promise(r=>server.close(r));
  if(profile)await fs.rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
});
async function page(url='/popup.html') {
  const endpoint=new URL(debuggerURL);
  const target=await (await fetch(`http://${endpoint.host}/json/new?${encodeURIComponent(origin+url)}`,{method:'PUT'})).json();
  const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
  let id=0;const pending=new Map();
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;const timer=setTimeout(()=>{pending.delete(n);reject(new Error(`CDP timeout: ${method}`));},20000);pending.set(n,m=>{clearTimeout(timer);m.error?reject(new Error(JSON.stringify(m.error))):resolve(m.result);});ws.send(JSON.stringify({id:n,method,params}));});
  const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);return result.result.value;};
  const p={ws,send,evaluate};pages.push(p);
  await send('Page.enable');await send('Page.navigate',{url:origin+url});
  for(let i=0;i<100;i++){if(await evaluate(url==='/popup.html'?"typeof handleCSVFile === 'function'":"document.readyState === 'complete'"))return p;await new Promise(r=>setTimeout(r,25));}
  throw new Error('Page did not load');
}
async function importSample(p) {
  const csv=await fs.readFile(root+'/sample-listings.csv','utf8');
  const png=(await fs.readFile(root+'/icons/icon16.png')).toString('base64');
  await p.evaluate(`(async()=>{
    await handleCSVFile(new File([${JSON.stringify(csv)}],'sample.CSV'));
    const bytes=Uint8Array.from(atob(${JSON.stringify(png)}),c=>c.charCodeAt(0));
    await handleDesignFiles(csvData.map(r=>new File([bytes],r.design_filename,{type:'image/png'})));
    document.querySelector('#toStep3').click();
  })()`);
}
const tabsMock=`(() => {
  const event=()=>({listeners:new Set(),addListener(fn){this.listeners.add(fn);},removeListener(fn){this.listeners.delete(fn);}});
  globalThis.mock={created:[],calls:[],responses:[],active:0,maxActive:0};
  globalThis.chrome={runtime:{id:'test'},windows:{async update(){}},scripting:{async executeScript(){}},tabs:{
    onUpdated:event(),onRemoved:event(),
    async create(details){const id=mock.created.length+1;mock.created.push(details);return{id,windowId:1};},
    async get(id){return{id,status:'complete',url:'https://merch.amazon.com/designs/new'};},
    async update(id){return{id,windowId:1};},
    async sendMessage(id,message){
      mock.calls.push({id,action:message.action});
      if(message.action==='CANCEL_FILL')return{success:true};
      mock.active++;mock.maxActive=Math.max(mock.maxActive,mock.active);
      await new Promise(r=>setTimeout(r,20));mock.active--;
      const response=mock.responses.shift();if(response==='reject')throw new Error('Channel disconnected');
      return response || {success:true,status:'prepared'};
    }
  }};
})()`;
test('real popup imports sample, matches images and builds three queue entries',async()=>{
  const p=await page();await importSample(p);
  assert.deepEqual(await p.evaluate(`({rows:csvData.length,queue:document.querySelectorAll('.queue-item').length,blocked:document.querySelector('#toStep3').disabled,auto:document.querySelector('#autoPublish').checked})`),{rows:3,queue:3,blocked:false,auto:false});
});
test('popup rejects missing, duplicate and invalid designs, safely renders filenames, and invalid CSV clears stale state',async()=>{
  const p=await page();await importSample(p);
  const result=await p.evaluate(`(async()=>{
    delete designFiles['cat_programmer.png'];checkDesignMatches();const missing=document.querySelector('#toStep3').disabled;
    csvData[0].design_filename='<img src=x onerror="globalThis.injected=true">';checkDesignMatches();
    const escaped=!document.querySelector('#matchStatus img');
    const bytes=await(await fetch('/icons/icon16.png')).arrayBuffer();
    await handleDesignFiles([new File([bytes],'a.png'),new File([bytes],'a.png')]);
    const duplicate=document.querySelector('#inputError').textContent;
    await handleDesignFiles([new File(['not an image'],'bad.png')]);const invalid=document.querySelector('#inputError').textContent;
    await handleCSVFile(new File(['Title,Brand\\nA,B'],'broken.csv'));
    return{missing,escaped,duplicate,invalid,rows:csvData.length,blocked:document.querySelector('#toStep2').disabled};
  })()`);
  assert.equal(result.missing,true);assert.equal(result.escaped,true);assert.match(result.duplicate,/Duplicate/);assert.match(result.invalid,/not PNG or JPEG/);assert.equal(result.rows,0);assert.equal(result.blocked,true);
});
test('queue handles failed channels without retry, preserves tabs, and does not rerun settled rows',async()=>{
  const p=await page();await importSample(p);await p.evaluate(tabsMock);
  const result=await p.evaluate(`(async()=>{mock.responses=['reject',{success:true,status:'submitted'},{success:true,status:'prepared'}];await startUpload();await startUpload();return{statuses,created:mock.created.length,calls:mock.calls.length,disabled:document.querySelector('#startUpload').disabled};})()`);
  assert.deepEqual(result,{statuses:['error','submitted','prepared'],created:3,calls:3,disabled:true});
});
test('stop drains active work and continue processes only untouched pending rows',async()=>{
  const p=await page();await importSample(p);await p.evaluate(tabsMock);
  const result=await p.evaluate(`(async()=>{
    chrome.tabs.sendMessage=async(id,msg)=>{mock.calls.push({id,action:msg.action});if(msg.action==='CANCEL_FILL')return{success:true};await new Promise(r=>setTimeout(r,80));return{success:false,error:'Stopped'};};
    const first=startUpload();while(!activeTabs.size)await new Promise(r=>setTimeout(r,1));stopUpload();await first;
    const stopped=[...statuses];chrome.tabs.sendMessage=async()=>({success:true,status:'prepared'});await startUpload();
    return{stopped,statuses,created:mock.created.length};
  })()`);
  assert.deepEqual(result.stopped,['stopped','pending','pending']);assert.deepEqual(result.statuses,['stopped','prepared','prepared']);assert.equal(result.created,3);
});
test('tab readiness handles already loaded, timeout and closed tabs with listener cleanup',async()=>{
  const p=await page();await p.evaluate(tabsMock);
  const result=await p.evaluate(`(async()=>{
    await waitForTabLoad(1,50);const clean=chrome.tabs.onUpdated.listeners.size===0;
    chrome.tabs.get=async()=>({status:'loading'});let timeout='';try{await waitForTabLoad(2,20);}catch(e){timeout=e.message;}
    const closing=waitForTabLoad(3,100);chrome.tabs.onRemoved.listeners.forEach(fn=>fn(3));let closed='';try{await closing;}catch(e){closed=e.message;}
    return{clean,timeout,closed,listeners:chrome.tabs.onUpdated.listeners.size+chrome.tabs.onRemoved.listeners.size};
  })()`);
  assert.equal(result.clean,true);assert.match(result.timeout,/timed out/);assert.match(result.closed,/closed/);assert.equal(result.listeners,0);
});
async function contentFixture() {
  const p=await page('/fixture');
  await p.evaluate(`globalThis.handlers=[];globalThis.chrome={runtime:{id:'test',onMessage:{addListener(fn){handlers.push(fn);}}}};
    document.body.innerHTML='<div class="dropzone-container"><input type="file" class="file-upload-input" accept="image/png,image/jpeg"></div><input id="designCreator-productEditor-brandName"><textarea id="prdm-copy-designCreator-productEditor-title-en"></textarea><textarea id="prdm-copy-designCreator-productEditor-featureBullet1-en">old bullet</textarea><textarea id="prdm-copy-designCreator-productEditor-featureBullet2-en"></textarea><textarea id="designCreator-productEditor-description"></textarea><button id="submit-button">Publish</button>';
    globalThis.uploads=0;globalThis.drops=0;globalThis.published=0;
    document.querySelector('input[type=file]').addEventListener('change',()=>uploads++);
    document.querySelector('.dropzone-container').addEventListener('drop',()=>drops++);
    document.querySelector('#submit-button').addEventListener('click',()=>published++);
    globalThis.message=msg=>new Promise(resolve=>handlers[0](msg,{id:'test'},resolve));`);
  const script=await fs.readFile(root+'/content.js','utf8');
  await p.evaluate(script);await p.evaluate(script);
  const png=(await fs.readFile(root+'/icons/icon16.png')).toString('base64');
  await p.evaluate(`globalThis.fill={action:'FILL_LISTING',designBase64:'data:image/png;base64,${png}',designFileName:'design.png',listing:{title:'Cat "&" programmer',brand:'Brand',bullet1:'',bullet2:'Second',description:'Line one\\nLine two',delay:500}}`);
  return p;
}
test('content script is idempotent, fills and clears fields, uploads once, and defaults to manual review',async()=>{
  const p=await contentFixture();
  const result=await p.evaluate(`(async()=>{const result=await message(fill);await new Promise(r=>setTimeout(r,0));return{result,handlers:handlers.length,uploads,drops,published,bullet:document.querySelector('#prdm-copy-designCreator-productEditor-featureBullet1-en').value,title:document.querySelector('#prdm-copy-designCreator-productEditor-title-en').value,overlay:!!document.querySelector('#merch-uploader-overlay')};})()`);
  assert.deepEqual(result.result,{success:true,status:'prepared'});assert.equal(result.handlers,1);assert.equal(result.uploads,1);assert.equal(result.drops,0);assert.equal(result.published,0);assert.equal(result.bullet,'');assert.equal(result.title,'Cat "&" programmer');assert.equal(result.overlay,false);
});
test('automatic publish is explicit and reports submission as unverified',async()=>{
  const p=await contentFixture();
  const result=await p.evaluate(`(async()=>{const result=await message({...fill,autoPublish:true});return{result,published};})()`);
  assert.deepEqual(result.result,{success:true,status:'submitted',publicationVerified:false});assert.equal(result.published,1);
});
test('content rejects simultaneous fills and cancellation prevents publishing',async()=>{
  const p=await contentFixture();
  const result=await p.evaluate(`(async()=>{const first=message({...fill,autoPublish:true});const duplicate=await message(fill);await message({action:'CANCEL_FILL'});const cancelled=await first;return{duplicate,cancelled,published};})()`);
  assert.equal(result.duplicate.success,false);assert.match(result.duplicate.error,/already/);assert.equal(result.cancelled.success,false);assert.match(result.cancelled.error,/Stopped/);assert.equal(result.published,0);
});
test('maxlength, disabled fields and discarded input values fail rather than publish',async()=>{
  for(const change of ["document.querySelector('#prdm-copy-designCreator-productEditor-title-en').maxLength=2", "document.querySelector('#prdm-copy-designCreator-productEditor-title-en').disabled=true", "document.querySelector('#prdm-copy-designCreator-productEditor-title-en').addEventListener('input',e=>{e.target.value='discarded';})"]){
    const p=await contentFixture();await p.evaluate(change);
    const result=await p.evaluate(`(async()=>{const result=await message({...fill,autoPublish:true});return{result,published};})()`);
    assert.equal(result.result.success,false);assert.equal(result.published,0);assert.match(result.result.error,/limit|editable|retain/);
  }
});
test('image imports normalize JPEG MIME, reject corrupt PNG, and content upload preserves JPEG type',async()=>{
  const jpeg=(await fs.readFile(root+'/tests/fixtures/design.jpg')).toString('base64');
  const p=await page();await importSample(p);
  const normalized=await p.evaluate(`(async()=>{const bytes=Uint8Array.from(atob('${jpeg}'),c=>c.charCodeAt(0));await handleDesignFiles([new File([bytes],'design.jpg')]);const type=designFiles['design.jpg'].type;await handleDesignFiles([new File([new Uint8Array([137,80,78,71,13,10,26,10])],'broken.png')]);return{type,error:document.querySelector('#inputError').textContent,blocked:document.querySelector('#toStep3').disabled};})()`);
  assert.equal(normalized.type,'image/jpeg');assert.match(normalized.error,/corrupt|decoded/);assert.equal(normalized.blocked,true);
  const content=await contentFixture();
  const result=await content.evaluate(`(async()=>{const result=await message({...fill,designBase64:'data:image/jpeg;base64,${jpeg}',designFileName:'design.jpg'});return{result,type:document.querySelector('input[type=file]').files[0].type};})()`);
  assert.equal(result.result.status,'prepared');assert.equal(result.type,'image/jpeg');
});
test('concurrency is bounded and rapid start clicks cannot launch another runner',async()=>{
  const p=await page();await importSample(p);await p.evaluate(tabsMock);
  const result=await p.evaluate(`(async()=>{concurrentTabs=2;await Promise.all([startUpload(),startUpload()]);return{created:mock.created.length,maxActive:mock.maxActive,statuses};})()`);
  assert.equal(result.created,3);assert.equal(result.maxActive,2);assert.deepEqual(result.statuses,['prepared','prepared','prepared']);
});
test('missing content field reports timeout and never clicks Publish',async()=>{
  const p=await contentFixture();
  const result=await p.evaluate(`(async()=>{
    document.querySelector('#designCreator-productEditor-description').remove();
    // Advance the test clock to exercise the real polling timeout without a 15-second wait.
    const original=Date.now;let clock=original();Date.now=()=>clock+=1000;
    try{const result=await message({...fill,autoPublish:true});return{result,published};}finally{Date.now=original;}
  })()`);
  assert.equal(result.result.success,false);assert.match(result.result.error,/Timed out waiting for field description/);assert.equal(result.published,0);
});
