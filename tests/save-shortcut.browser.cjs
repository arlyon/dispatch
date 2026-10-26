// Real production App, mocked IPC: publication/freshness plus resident close/checkpoint guards.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const cwd=path.resolve(__dirname,'..'),request=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const port=process.env.DISPATCH_TEST_PORT||'14691',origin=`http://127.0.0.1:${port}`;
(async()=>{
 const server=spawn('pnpm',['exec','vite','--host','127.0.0.1','--port',port,'--strictPort'],{cwd,stdio:'ignore'});let browser;
 try{
  for(let i=0;i<100;i++){try{if((await fetch(origin)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1700,height:1100}}),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR',e.message);});page.setDefaultTimeout(12000);
  await page.addInitScript(request=>{
   const callbacks=new Map(),listeners=new Map();let next=1;const q=new URLSearchParams(location.search);
   const pr={url:'https://github.com/carpe-lab/repo/pull/42',repo:'carpe-lab/repo',number:42,title:'Remote candidate',author:'someone',updatedAt:'2026-10-22T00:00:00Z'};
   if(q.has('remote-review'))request.source={...request.source,prUrl:pr.url};
   const other={...request,id:crypto.randomUUID(),title:'Other editable shortcut fixture'},archived={...request,id:crypto.randomUUID(),title:'Archived shortcut fixture'},results={};
   window.__requestId=request.id;window.__events=[];window.__closeCalls=[];window.__destroyCalls=[];window.__hideCalls=[];window.__quitCalls=[];window.__submits=[];window.__unexpectedWork=[];window.__quizStarts=[];window.__quizEnds=[];window.__failSubmit=true;
   window.__source={query:'Mock source',items:q.has('other-remote')?[pr,{...pr,url:pr.url.replace('/42','/43'),number:43}]:q.has('same-remote')?[pr]:[],total:q.has('unknown')?null:q.has('other-remote')?2:q.has('same-remote')?1:0,partial:q.has('partial'),polling:q.has('polling'),lastSuccess:q.has('unknown')?null:1,error:q.has('stale')?'network':null,heads:q.has('remote-review')?[{url:pr.url,checking:q.has('branch-checking'),head:q.has('branch-unknown')?null:q.has('branch-changed')?'c'.repeat(40):request.source.head,error:q.has('branch-unknown')?'network':null}]:[]};
   window.__quit=()=>callbacks.get(listeners.get('desktop-quit'))?.({event:'desktop-quit',id:1,payload:null});
   window.__shortcut=(control,repeat=false)=>{const e=new KeyboardEvent('keydown',{key:'s',metaKey:!control,ctrlKey:control,repeat,bubbles:true,cancelable:true});document.dispatchEvent(e);return e.defaultPrevented;};
   window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:cb=>{const id=next++;callbacks.set(id,cb);return id;},invoke:async(command,args)=>{
    if(command==='plugin:event|listen'){listeners.set(args.event,args.handler);return next++;}if(command==='plugin:event|unlisten')return;
    if(command==='desktop_bootstrap')return {checkpoint:null,review:null};
    if(['desktop_ready','desktop_checkpoint','desktop_checkpoint_failed'].includes(command))return;
    if(command==='desktop_hide'){window.__hideCalls.push(args);window.__events.push('hide');return;}
    if(command==='desktop_quit'){window.__quitCalls.push(args);return;}
    if(command==='plugin:window|close'){window.__closeCalls.push(args);window.__events.push('close');if(window.__delayClose)await new Promise(r=>window.__releaseClose=r);if(window.__failClose)throw Error('Simulated native close failure');await callbacks.get(listeners.get('tauri://close-requested'))({event:'tauri://close-requested',id:1,payload:{}});return;}
    if(command==='plugin:window|destroy'){window.__destroyCalls.push(args);return;}
    if(command==='pr_dispositions')return [];
    if(command==='github_source'){
     if(q.has('source-error'))throw Error('Source IPC error');
     if(q.get('freshness')==='source'&&window.__submits.length){if(!window.__postSourcePending){const old=structuredClone(window.__source);window.__postSourcePending=true;await new Promise(r=>window.__releaseOldSource=r);window.__oldSourceDelivered=true;return old;}window.__source={...window.__source,items:[{...pr,url:pr.url.replace('/42','/43'),number:43}],total:1};}
     return structuredClone(window.__source);
    }
    if(command==='list_reviews'){
     if(q.has('queue-error')&&window.__submits.length)throw Error('Queue IPC error');
     const summarize=rows=>rows.map(r=>({id:r.id,title:r.title,source:r.source,fileCount:r.files.length,complete:r.id===archived.id||Boolean(results[r.id])}));
     if(q.get('freshness')==='queue'&&window.__submits.length){if(!window.__postQueuePending){const old=summarize([request]);window.__postQueuePending=true;await new Promise(r=>window.__releaseOldQueue=r);window.__oldQueueDelivered=true;return old;}return summarize([request,other]);}
     return summarize(q.has('empty')?[]:[request,...q.has('waiting')?[other]:[],archived]);
    }
    if(command==='open_review'){(window.__openCalls??=[]).push(args.id);return [request,other,archived].find(r=>r.id===args.id);}
    if(command==='review_result')return args.id===archived.id?{version:1,requestId:archived.id,status:'complete',feedback:{head:archived.source.head,comments:[],summary:'Archived'}}:results[args.id]||null;
    if(command==='review_context')return {owner:'caller',reviewerEnabled:false,guide:'Shortcut context',comments:[{path:'src/App.tsx',side:'new',line:2,body:'Source anchor'}]};
    if(command==='file_identities')return Object.fromEntries(request.files.map((f,i)=>[f.path,i.toString(16).padStart(64,'0')]));
    if(command==='list_review_agents')return [];
    if(command==='start_review_agent'||command==='open_github_pr'){window.__unexpectedWork.push(command);throw Error('No automatic work');}
    if(command==='submit_review'){window.__submits.push(args);window.__events.push('submit');if(window.__failSubmit)throw Error('Simulated submit failure');if(window.__delaySubmit)await new Promise(r=>window.__releaseSubmit=r);window.__events.push('published');return results[args.id]={version:1,requestId:args.id,status:'complete',feedback:args.feedback};}
    if(command==='start_quiz'){window.__quizStarts.push(args);if(window.__delayQuiz)await new Promise(r=>window.__releaseQuiz=r);return window.__quiz={id:'quiz',requestId:args.id,head:request.source.head,sequence:0,phase:'question',segments:[],answers:[],question:{question:'Keep this answer?',choices:['Yes','No'],anchors:[]},error:null,sessionPath:'/mock-native'};}
    if(command==='end_quiz'){window.__quizEnds.push(args);return {id:args.id,requestId:window.__quiz.requestId,head:request.source.head,passed:0,failed:0,unassessed:0,endedEarly:true};}
    throw Error('Unexpected native command '+command);
   }};
  },request);
  const summary=page.getByRole('textbox',{name:'Final summary',exact:true});
  const load=async(query='')=>{console.log('Checking',query||'publication');await page.goto(origin+(query?'?'+query:''));await (query.includes('empty')?page.getByRole('heading',{name:'Your review inbox',exact:true}):summary).waitFor();};
  const publish=async()=>{await page.evaluate(()=>window.__failSubmit=false);await page.keyboard.press('Meta+s');};
  for(const freshness of ['queue','source']){
   await load('freshness='+freshness);await summary.fill('A publishes once');await publish();
   if(freshness==='queue'){await page.waitForFunction(()=>window.__postQueuePending);await page.locator('.pr-summary').filter({hasText:'Other editable shortcut fixture'}).waitFor();await page.evaluate(()=>window.__releaseOldQueue());await page.waitForFunction(()=>window.__oldQueueDelivered);}
   else{await page.waitForFunction(()=>window.__postSourcePending);await page.getByRole('button',{name:'Open carpe-lab/repo #43',exact:true}).waitFor();await page.evaluate(()=>window.__releaseOldSource());await page.waitForFunction(()=>window.__oldSourceDelivered);}
   await page.locator('.inbox-notice').waitFor();assert.equal(await page.evaluate(()=>window.__closeCalls.length),0);assert.equal(await page.locator('.pr-accordion-card.is-current').count(),0);assert.equal(await page.evaluate(()=>window.__submits.length),1);assert.deepEqual(await page.evaluate(()=>window.__unexpectedWork),[]);
  }
  await load('empty&unknown');assert.equal(await page.evaluate(()=>window.__shortcut(false)),true);await page.waitForFunction(()=>window.__hideCalls.length===1);await page.keyboard.press('Control+s');await page.waitForFunction(()=>window.__hideCalls.length===2);assert.equal(await page.evaluate(()=>window.__submits.length),0);await page.evaluate(()=>window.__shortcut(true,true));assert.equal(await page.evaluate(()=>window.__closeCalls.length),2);
  await load();await summary.fill('One action');await page.evaluate(()=>{window.__failSubmit=false;window.__delaySubmit=true;window.__delayClose=true;});await page.keyboard.press('Meta+s');await page.waitForFunction(()=>window.__submits.length===1);assert.equal(await page.evaluate(()=>window.__closeCalls.length),0);await page.evaluate(()=>window.__releaseSubmit());await page.waitForFunction(()=>window.__closeCalls.length===1);await page.keyboard.press('Control+s');assert.equal(await page.evaluate(()=>window.__submits.length),1);await page.evaluate(()=>window.__releaseClose());await page.waitForFunction(()=>window.__hideCalls.length===1);assert.deepEqual(await page.evaluate(()=>window.__events),['submit','published','close','hide']);
  await load();await page.evaluate(()=>window.__failSubmit=false);await page.getByRole('button',{name:'Finish review',exact:true}).click();await page.waitForFunction(()=>window.__hideCalls.length===1);assert.equal(await page.evaluate(()=>window.__submits[0].feedback.summary),null);
  await load();await summary.fill('Keep after failure');await page.keyboard.press('Meta+s');await page.locator('.error-banner').filter({hasText:'Simulated submit failure'}).waitFor();assert.equal(await summary.inputValue(),'Keep after failure');assert.equal(await page.evaluate(()=>window.__hideCalls.length),0);
  await page.evaluate(()=>{window.__failSubmit=false;window.__failClose=true;});await page.keyboard.press('Meta+s');await page.locator('.error-banner').filter({hasText:'Feedback submitted, but could not close window'}).waitFor();await page.evaluate(()=>window.__failClose=false);await page.keyboard.press('Meta+s');await page.waitForFunction(()=>window.__hideCalls.length===1);assert.equal(await page.evaluate(()=>window.__submits.length),2,'one failed publication then one success, no replay');
  for(const query of ['waiting','other-remote','unknown','stale','partial','polling','source-error','queue-error','remote-review&same-remote&branch-changed','remote-review&same-remote&branch-unknown','remote-review&same-remote&branch-checking']){
   await load(query);await summary.fill('Target-specific note');const target=await page.locator('#feedback-target').innerText();assert.ok(target.includes(request.source.head.slice(0,7)));await publish();await page.locator('.inbox-notice').waitFor();assert.equal(await page.evaluate(()=>window.__closeCalls.length),0,query);await page.waitForTimeout(1600);assert.equal(await page.locator('.pr-accordion-card.is-current').count(),0,'periodic refresh must not undo selection-only Inbox');assert.deepEqual(await page.evaluate(()=>window.__unexpectedWork),[]);
  }
  await load('remote-review&same-remote');await publish();await page.waitForFunction(()=>window.__hideCalls.length===1);
  await load('waiting');await summary.fill('Cached A');await page.locator('.pr-summary').filter({hasText:'Other editable shortcut fixture'}).click();await page.waitForFunction(()=>document.querySelector('#review-summary')?.value==='');await summary.fill('Publish B');await publish();await page.locator('.inbox-notice').waitFor();await page.keyboard.press('Meta+s');await page.waitForFunction(()=>window.__hideCalls.length===1);assert.equal(await page.evaluate(id=>window.__hideCalls[0].checkpoint.data.drafts[id].summary,request.id),'Cached A');await page.evaluate(()=>window.__quit());await page.locator('.error-banner').filter({hasText:'unsubmitted feedback'}).waitFor();assert.equal(await page.evaluate(()=>window.__quitCalls.at(-1).checkpoint),null);
  await load('waiting');await page.locator('.pr-summary').filter({hasText:'Other editable shortcut fixture'}).click();await page.waitForFunction(()=>document.querySelector('#review-summary')?.value==='');await summary.fill('B notes');await page.locator('.pr-summary').filter({hasText:request.title}).click();await page.waitForFunction(()=>document.querySelector('#review-summary')?.value==='');await summary.fill('A publication');await page.evaluate(()=>{window.__failSubmit=false;window.__delaySubmit=true;});await page.keyboard.press('Meta+s');await page.waitForFunction(()=>window.__submits.length===1);await page.locator('.pr-summary').filter({hasText:'Other editable shortcut fixture'}).click();await page.waitForFunction(()=>document.querySelector('#review-summary')?.value==='B notes');await page.evaluate(()=>window.__releaseSubmit());await page.waitForTimeout(150);assert.equal(await summary.inputValue(),'B notes');assert.equal(await page.evaluate(()=>window.__closeCalls.length),0);
  await load();await page.getByRole('button',{name:'Quiz me',exact:true}).click();const explanation=page.getByRole('textbox',{name:'Quiz explanation',exact:true});await explanation.fill('Unanswered text');await publish();await page.locator('.error-banner').filter({hasText:'End the quiz before closing'}).waitFor();assert.equal(await explanation.inputValue(),'Unanswered text');assert.equal(await page.evaluate(()=>window.__hideCalls.length),0);page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'End quiz',exact:true}).click();assert.equal(await page.evaluate(()=>window.__quizEnds.length),0);
  assert.equal(await page.evaluate(()=>window.__destroyCalls.length),0,'close always checkpoints/hides, never destroys directly');assert.deepEqual(errors,[]);
  console.log('PASS merged tray/source save semantics: fresh work retained, true-empty publish then hide, checkpointed drafts, explicit Quit/quiz guards, no replay or automatic work');
 }finally{await browser?.close();server.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
