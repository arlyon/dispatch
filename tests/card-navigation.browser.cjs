// Production Inbox/App with native IPC mocked. No prototype route or live queue/API/model.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const request=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));request.files=['src/App.tsx','src/Diff.tsx','src/types.ts','src/AgentReport.tsx'].map(path=>request.files.find(f=>f.path===path)).filter(Boolean);
(async()=>{
 const server=spawn('pnpm',['exec','vite','--host','127.0.0.1','--port','14729','--strictPort'],{cwd:path.resolve(__dirname,'..'),stdio:'ignore'});let browser;
 try{
  for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:14729')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1700,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(request=>{
   let next=1;const callbacks=new Map(),listeners=new Map(),reviews=[request,{...request,id:"archive",title:"Archived local",source:{...request.source,repo:"/archive"}}],results={};
   window.__forcedFinishes=0;const animate=Element.prototype.animate;
   Element.prototype.animate=function(...args){const animation=animate.apply(this,args);if(this.matches('.pr-accordion-card,.remote-divider')){const finish=animation.finish.bind(animation);animation.finish=()=>{window.__forcedFinishes++;return finish();};}return animation;};
   window.__source={query:'Approved query',items:[44,43,42].map(n=>({url:`https://github.com/carpe-lab/repo/pull/${n}`,repo:'carpe-lab/repo',number:n,title:`Remote ${n}`,author:'someone',updatedAt:'2026-10-22T00:00:00Z',createdAt:`2026-10-${n-25}T00:00:00Z`})),heads:[],total:3,partial:false,polling:false,lastSuccess:1,error:null};
   window.__captures=[];window.__models=[];window.__submits=[];window.__head='b';window.__fileCount=2;
   window.__emitCapture=patch=>{const id=listeners.get('github-capture');callbacks.get(id)?.({event:'github-capture',payload:{...window.__capture,...patch}});};
   window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:cb=>{const id=next++;callbacks.set(id,cb);return id;},invoke:async(command,args)=>{
    if(command==='plugin:event|listen'){listeners.set(args.event,args.handler);return next++;}if(command==='plugin:event|unlisten')return;
    if(command==='desktop_bootstrap')return {checkpoint:null,review:null};
    if(['desktop_ready','desktop_checkpoint','desktop_checkpoint_failed','desktop_hide','desktop_quit'].includes(command))return;
    if(command==='pr_dispositions')return [];
    if(command==='github_source'){if(window.__pauseSources)await new Promise(resolve=>(window.__sourceWaiters??=[]).push(resolve));return structuredClone(window.__source);}
    if(command==='list_reviews'){const entries=reviews.map((r,i)=>({id:r.id,title:r.title,source:r.source,fileCount:r.files.length,complete:r.id==="archive"||Boolean(results[r.id]),intakeAt:i+1}));if(window.__holdQueue){window.__holdQueue=false;window.__heldQueuePending=true;await new Promise(resolve=>window.__releaseHeldQueue=resolve);}return entries;}
    if(command==='open_review')return reviews.find(r=>r.id===args.id);
    if(command==='review_context'){if(window.__contextDelay)await new Promise(resolve=>setTimeout(resolve,window.__contextDelay));return {owner:'caller',reviewerEnabled:false,guide:'Own-source fixture',comments:[]};}
    if(command==='review_result')return results[args.id]||null;
    if(command==='file_identities')return Object.fromEntries(request.files.map((f,i)=>[f.path,i.toString(16).padStart(64,'0')]));
    if(command==='list_review_agents')return [];
    if(command==='start_review_agent'){window.__models.push(args);throw Error('No automatic model');}
    if(command==='open_github_pr'){
     const head=window.__head;window.__capture=args;window.__captures.push(args);await new Promise((resolve,reject)=>{window.__finishCapture=resolve;window.__failCapture=()=>reject(Error('Capture failed fixture'));});
     let r=reviews.find(r=>r.source.prUrl===args.url&&r.source.head===head.repeat(40));
     if(!r){r={...request,id:crypto.randomUUID(),title:`Captured ${args.url.split('/').at(-1)}`,source:{...request.source,prUrl:args.url,repo:'/private/tmp/mock-review',head:head.repeat(40)},files:request.files.slice(0,window.__fileCount)};reviews.push(r);}return r;
    }
    if(command==='start_quiz'){const r=reviews.find(r=>r.id===args.id);return window.__quiz={id:'card-quiz',requestId:args.id,head:r.source.head,phase:'question',sequence:0,segments:[],answers:[],error:null,sessionPath:'/mock/quiz',question:{question:'Pinned source?',choices:['Yes'],anchors:[]}};}
    if(command==='end_quiz')return {id:args.id,requestId:window.__quiz.requestId,head:window.__quiz.head,passed:0,failed:0,unassessed:0,endedEarly:true};
    if(command==='submit_review'){window.__submits.push(args);return results[args.id]={version:1,requestId:args.id,status:'complete',feedback:args.feedback};}
    throw Error('Unexpected command '+command);
   }};
  },request);
  await page.goto('http://127.0.0.1:14729');await page.getByRole('textbox',{name:'Final summary',exact:true}).waitFor();
  await page.emulateMedia({reducedMotion:'reduce'});
  const press=async key=>page.keyboard.press(key);
  const focused=()=>page.evaluate(()=>document.activeElement?.dataset.cardKey);
  await page.evaluate(()=>{document.activeElement.blur();window.__cards=[...document.querySelectorAll('[data-card-key]')];window.__workspace=document.querySelector('.workspace')?.scrollTop;});
  await press('Control+ArrowDown');assert.equal(await focused(),request.id);await press('Meta+ArrowUp');assert.equal(await focused(),request.id);
  const order=[request.id,...[42,43,44].map(n=>`https://github.com/carpe-lab/repo/pull/${n}`)];
  for(const id of order.slice(1)){await press('Meta+ArrowDown');assert.equal(await focused(),id);}
  await press('Control+ArrowDown');assert.equal(await focused(),order.at(-1));
  await page.locator('.archive-section:not(.hidden-pr-section) > summary').click();await page.evaluate(()=>document.activeElement.blur());
  await press('Meta+ArrowUp');assert.equal(await focused(),'archive');
  await press('Control+ArrowUp');assert.equal(await focused(),order.at(-1));
  await page.locator('.archive-section:not(.hidden-pr-section) > summary').click();await page.evaluate(()=>document.activeElement.blur());await press('Meta+ArrowUp');assert.equal(await focused(),order.at(-1));
  await page.getByRole('textbox',{name:'Search reviews'}).fill('Remote 43');await page.evaluate(()=>document.activeElement.blur());await press('Control+ArrowDown');assert.equal(await focused(),order[2]);
  for(const selector of ['input','textarea','select','div[contenteditable]','div.cm-editor','section.quiz-panel','div[role=dialog]']){
   await page.evaluate(selector=>{const el=document.createElement(selector.split(/[.[]/)[0]);if(selector.includes('contenteditable'))el.contentEditable='true';if(selector.includes('.'))el.className=selector.split('.')[1];if(selector.includes('role='))el.setAttribute('role','dialog');el.tabIndex=0;el.id='guard';document.body.append(el);el.focus();},selector);
   assert.equal(await page.evaluate(()=>{const e=new KeyboardEvent('keydown',{key:'ArrowDown',ctrlKey:true,bubbles:true,cancelable:true});document.activeElement.dispatchEvent(e);return e.defaultPrevented;}),false,selector);await page.locator('#guard').evaluate(el=>el.remove());
  }
  for(const flags of [{altKey:true},{shiftKey:true}])assert.equal(await page.evaluate(flags=>{const e=new KeyboardEvent('keydown',{key:'ArrowDown',metaKey:true,bubbles:true,cancelable:true,...flags});document.body.dispatchEvent(e);return e.defaultPrevented;},flags),false);
  assert.ok(await page.evaluate(()=>window.__cards.every(el=>el.isConnected&&[...document.querySelectorAll('[data-card-key]')].includes(el))));
  assert.deepEqual(await page.evaluate(()=>window.__captures),[]);assert.deepEqual(await page.evaluate(()=>window.__models),[]);assert.equal(await page.evaluate(()=>document.querySelector('.workspace')?.scrollTop),await page.evaluate(()=>window.__workspace));assert.deepEqual(errors,[]);
  await page.getByRole('textbox',{name:'Search reviews'}).fill('');
  const local=page.locator(`[data-card-key="${request.id}"]`),archive=page.locator('[data-card-key="archive"]');
  await page.locator('.archive-section:not(.hidden-pr-section) > summary').click();
  assert.equal(await local.locator('.pr-expand-toggle').getAttribute('aria-expanded'),'true');
  await archive.locator('.pr-summary').click();
  await page.waitForFunction(()=>document.querySelector('[data-card-key="archive"]').classList.contains('is-current'));
  assert.equal(await local.locator('.pr-expand-toggle').getAttribute('aria-expanded'),'false');
  assert.equal(await local.locator('.pr-file-accordion').count(),0);
  assert.equal(await archive.locator('.pr-expand-toggle').getAttribute('aria-expanded'),'true');
  await local.locator('.pr-summary').click();
  await page.waitForFunction(id=>document.querySelector(`[data-card-key="${id}"]`).classList.contains('is-current'),request.id);
  assert.equal(await archive.locator('.pr-expand-toggle').getAttribute('aria-expanded'),'false');
  assert.equal(await archive.locator('.pr-file-accordion').count(),0);
  assert.equal(await local.locator('.pr-expand-toggle').getAttribute('aria-expanded'),'true');
  await local.locator('.pr-expand-toggle').click();
  assert.equal(await local.locator('.pr-expand-toggle').getAttribute('aria-expanded'),'false');
  await local.locator('.pr-expand-toggle').click();
  assert.equal(await local.locator('.pr-expand-toggle').getAttribute('aria-expanded'),'true');
  assert.deepEqual(errors,[]);
  console.log('PASS real Inbox DOM: card navigation guards; selecting another card collapses the previous cached card; selected files still toggle');
 }finally{await browser?.close();server.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
