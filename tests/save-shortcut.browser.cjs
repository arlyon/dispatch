// Own-source request JSON fixture; all native IPC/close events are mocked, no queue writes.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const cwd=path.resolve(__dirname,'..'),request=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
(async()=>{
 const server=spawn('pnpm',['exec','vite','--host','127.0.0.1','--port','14691','--strictPort'],{cwd,stdio:'ignore'});let browser;
 try{
  for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:14691')).ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1700,height:1100}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(request=>{
   const callbacks=new Map(),listeners=new Map();let next=1;
   const query=new URLSearchParams(location.search);
   const pr={url:'https://github.com/carpe-lab/repo/pull/42',repo:'carpe-lab/repo',number:42,title:'Remote candidate',author:'someone',updatedAt:'2026-10-22T00:00:00Z'};
   if(query.has('remote-review'))request.source={...request.source,prUrl:pr.url};
   window.__source={query:'Mock source',items:query.has('other-remote')?[pr,{...pr,url:pr.url.replace('/42','/43'),number:43}]:query.has('same-remote')?[pr]:[],total:query.has('unknown')?null:query.has('other-remote')?2:query.has('same-remote')?1:0,partial:query.has('partial'),polling:query.has('polling'),lastSuccess:query.has('unknown')?null:1,error:query.has('stale')?'network error; previous results retained':null};
   window.__source.heads=query.has('remote-review')?[{url:pr.url,checking:query.has('branch-checking'),head:query.has('branch-unknown')?null:query.has('branch-changed')?'c'.repeat(40):request.source.head,error:query.has('branch-unknown')?'network':null}]:[];
   const archived={...request,id:crypto.randomUUID(),title:'Archived shortcut fixture'},other={...request,id:crypto.randomUUID(),title:'Other editable shortcut fixture'},results={};
   window.__requestId=request.id;window.__unexpectedWork=[];window.__events=[];window.__closeCalls=[];window.__destroyCalls=[];window.__submits=[];window.__quizStarts=[];window.__quizEnds=[];window.__failSubmit=true;
   window.__shortcut=(control,repeat=false)=>{const event=new KeyboardEvent('keydown',{key:'s',metaKey:!control,ctrlKey:control,repeat,bubbles:true,cancelable:true});document.dispatchEvent(event);return event.defaultPrevented;};
   window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:callback=>{const id=next++;callbacks.set(id,callback);return id;},invoke:async(command,args)=>{
    if(command==='plugin:event|listen'){listeners.set(args.event,args.handler);return next++;}
    if(command==='plugin:event|unlisten')return;
    if(command==='start_review_agent'||command==='open_github_pr'){window.__unexpectedWork.push(command);throw Error('No automatic work permitted');}
    if(command==='github_source'){
     if(query.has('source-error'))throw Error('Simulated source IPC error');
     if(query.get('freshness')==='source'&&window.__submits.length){
      if(!window.__postSourcePending){const old=structuredClone(window.__source);window.__postSourcePending=true;await new Promise(resolve=>window.__releaseOldSource=resolve);window.__oldSourceDelivered=true;return old;}
      window.__source={...window.__source,items:[{...pr,url:pr.url.replace('/42','/43'),number:43}],total:1};
     }
     return structuredClone(window.__source);
    }
    if(command==='plugin:window|close'){
     window.__closeCalls.push(args);window.__events.push('close');if(window.__delayClose)await new Promise(resolve=>window.__releaseClose=()=>{window.__delayClose=false;resolve();});if(window.__failClose)throw Error('Simulated native close failure');
     const handler=callbacks.get(listeners.get('tauri://close-requested'));if(!handler)throw Error('Normal close handler is missing');
     await handler({event:'tauri://close-requested',id:1,payload:{}});return;
    }
    // Only the real Tauri onCloseRequested wrapper may reach destroy, after our guard permits it.
    if(command==='plugin:window|destroy'){window.__destroyCalls.push(args);window.__events.push('destroy');return;}
    if(command==='list_reviews'&&query.has('queue-error')&&window.__submits.length)throw Error('Simulated queue read error');
    if(command==='list_reviews'){
     const summarize=reviews=>reviews.map(review=>({id:review.id,title:review.title,source:review.source,fileCount:review.files.length,complete:review.id===archived.id||Boolean(results[review.id])}));
     if(query.get('freshness')==='queue'&&window.__submits.length){
      if(!window.__postQueuePending){const old=summarize([request]);window.__postQueuePending=true;await new Promise(resolve=>window.__releaseOldQueue=resolve);window.__oldQueueDelivered=true;return old;}
      return summarize([request,other]);
     }
     return summarize(query.has('empty')?[]:[request,...(query.has('waiting')?[other]:[]),archived]);
    }
    if(command==='open_review'){(window.__openCalls??=[]).push(args.id);return [request,other,archived].find(review=>review.id===args.id);}
    if(command==='review_result')return args.id===archived.id?{version:1,requestId:archived.id,status:'complete',feedback:{head:archived.source.head,comments:[],summary:'Published archived summary'}}:results[args.id]||null;
    if(command==='review_context')return {owner:'caller',reviewerEnabled:false,guide:'Shortcut test context.',comments:[{path:'src/App.tsx',side:'new',line:2,body:'A source anchor for the unfinished-comment guard.'}]};
    if(command==='file_identities')return Object.fromEntries(request.files.map((file,index)=>[file.path,index.toString(16).padStart(64,'0')]));
    if(command==='list_review_agents')return [];
    if(command==='submit_review'){window.__submits.push(args);window.__events.push('submit');if(window.__failSubmit)throw Error('Simulated submit failure');if(window.__delaySubmit)await new Promise(resolve=>window.__releaseSubmit=()=>{window.__delaySubmit=false;resolve();});const result=results[args.id]={version:1,requestId:args.id,status:'complete',feedback:args.feedback};window.__events.push('published');return result;}
    if(command==='start_quiz'){
     window.__quizStarts.push(args);if(window.__delayQuiz)await new Promise(resolve=>window.__releaseQuiz=()=>{window.__delayQuiz=false;resolve();});
     return window.__quiz={id:'shortcut-quiz-'+window.__quizStarts.length,requestId:args.id,head:request.source.head,sequence:0,phase:'question',segments:[],answers:[],question:{question:'Keep the quiz answer?',choices:['Yes','No'],anchors:[]},error:null,sessionPath:'/mock-native'};
    }
    if(command==='end_quiz'){window.__quizEnds.push(args);return {id:args.id,requestId:window.__quiz.requestId,head:request.source.head,passed:0,failed:0,unassessed:0,endedEarly:true};}
    throw Error('Unexpected native command: '+command);
   }};
  },request);
  const permissions=JSON.parse(fs.readFileSync(path.join(cwd,'src-tauri/capabilities/default.json'),'utf8'));assert.deepEqual(permissions.windows,['main']);assert.ok(permissions.permissions.includes('core:window:allow-close'),'own main window can request normal close');
  // Reviewer P1: a later periodic read must win over a delayed post-save empty result.
  for(const freshness of ['queue','source']){
   await page.goto(`http://127.0.0.1:14691?freshness=${freshness}`);const summary=page.getByRole('textbox',{name:'Final summary',exact:true});await summary.waitFor();await summary.fill('A publishes exactly once');await page.evaluate(()=>window.__failSubmit=false);await page.keyboard.press('Meta+s');
   if(freshness==='queue'){
    await page.waitForFunction(()=>window.__postQueuePending);await page.locator('.pr-summary').filter({hasText:'Other editable shortcut fixture'}).waitFor();
    await page.evaluate(()=>window.__releaseOldQueue());await page.waitForFunction(()=>window.__oldQueueDelivered);
   }else{
    await page.waitForFunction(()=>window.__postSourcePending);await page.getByRole('button',{name:'Open carpe-lab/repo #43',exact:true}).waitFor();
    await page.evaluate(()=>window.__releaseOldSource());await page.waitForFunction(()=>window.__oldSourceDelivered);
   }
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   assert.equal(freshness==='queue'?await page.locator('.pr-summary').filter({hasText:'Other editable shortcut fixture'}).count():await page.getByRole('button',{name:'Open carpe-lab/repo #43',exact:true}).count(),1,`${freshness}: superseded empty response must not erase newer observed work`);
   assert.equal(await page.evaluate(()=>window.__closeCalls.length),0,`${freshness}: stale empty conclusion must never close over new work`);await page.locator('.inbox-notice').waitFor();
   assert.equal(await page.locator('.pr-accordion-card.is-current').count(),0,'remain in Inbox without auto-opening');assert.deepEqual(await page.evaluate(()=>window.__unexpectedWork),[]);assert.equal(await page.evaluate(()=>window.__openCalls.length),1);assert.equal(await page.evaluate(()=>window.__submits.length),1);assert.ok(await page.evaluate(()=>window.__submits[0].id===window.__requestId));assert.equal(await page.evaluate(()=>window.__submits[0].feedback.summary),'A publishes exactly once');
  }
  console.log('PASS freshness: newer periodic queue/source work survives delayed post-save empty responses; no close/auto-open/capture/model; A published once');
  await page.goto('http://127.0.0.1:14691?empty');await page.getByRole('heading',{name:'Your review inbox',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__shortcut(false)),true,'Cmd-S default browser save is prevented');await page.waitForFunction(()=>window.__destroyCalls.length===1);
  await page.keyboard.press('Control+s');await page.waitForFunction(()=>window.__destroyCalls.length===2);
  assert.deepEqual(await page.evaluate(()=>window.__closeCalls),[{label:'main'},{label:'main'}],'both shortcuts call the real SDK close method for this window');assert.equal(await page.evaluate(()=>window.__submits.length),0);
  assert.equal(await page.evaluate(()=>window.__shortcut(true,true)),true,'repeat still prevents default');assert.equal(await page.evaluate(()=>window.__closeCalls.length),2,'repeat does not issue another close');
  await page.evaluate(()=>window.__failClose=true);await page.keyboard.press('Meta+s');await page.locator('.error-banner').filter({hasText:'Cannot close window: Error: Simulated native close failure'}).waitFor();assert.equal(await page.evaluate(()=>window.__destroyCalls.length),2,'close errors never bypass the normal close path');
  await page.goto('http://127.0.0.1:14691');await page.getByRole('textbox',{name:'Final summary',exact:true}).waitFor();await page.emulateMedia({reducedMotion:'reduce'});await page.getByLabel('Comment placement',{exact:true}).selectOption('inline');
  const summary=page.getByRole('textbox',{name:'Final summary',exact:true});await summary.fill('Cached unsubmitted feedback for review A');
  await page.locator('.original-chat .conversation').getByRole('button',{name:'Go to src/App.tsx:2',exact:true}).click();await page.waitForTimeout(350);
  await page.locator('.diff-layout[data-file-path="src/App.tsx"] .cm-lineNumbers .cm-gutterElement').filter({hasText:/^2$/}).last().click();
  const draft=page.getByRole('textbox',{name:'Line comment',exact:true});await draft.fill('Unfinished source draft');await page.keyboard.press('Meta+s');await page.locator('.error-banner').filter({hasText:'Save or discard your unfinished line comments'}).waitFor();assert.equal(await page.evaluate(()=>window.__submits.length),0);assert.equal(await page.evaluate(()=>window.__closeCalls.length),0);
  await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('button',{name:'Discard',exact:true}).click();await page.keyboard.press('Control+s');await page.locator('.error-banner').filter({hasText:'Simulated submit failure'}).waitFor();assert.equal(await page.evaluate(()=>window.__submits.length),1);assert.equal(await summary.inputValue(),'Cached unsubmitted feedback for review A');assert.equal(await page.evaluate(()=>window.__closeCalls.length),0,'active review submits instead of closing');
  await page.getByRole('button',{name:'Quiz me',exact:true}).click();const explanation=page.getByRole('textbox',{name:'Quiz explanation',exact:true});await explanation.fill('Keep editable-review quiz text');await page.keyboard.press('Meta+s');await page.waitForFunction(()=>window.__submits.length===2);assert.equal(await explanation.inputValue(),'Keep editable-review quiz text');assert.equal(await page.evaluate(()=>window.__closeCalls.length),0,'active editable review keeps submit behavior even in Quiz');
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'End quiz',exact:true}).click();await summary.waitFor({state:'visible'});
  await page.locator('.archive-section>summary').click();await page.locator('.archive-list .pr-summary').filter({hasText:'Archived shortcut fixture'}).click();await page.waitForFunction(()=>document.querySelector('#review-summary')?.readOnly);assert.equal(await summary.inputValue(),'Published archived summary');
  await page.keyboard.press('Meta+s');await page.locator('.error-banner').filter({hasText:'You have unsubmitted feedback.'}).waitFor();assert.equal(await page.evaluate(()=>window.__closeCalls.length),1,'archived view requests normal close');assert.equal(await page.evaluate(()=>window.__destroyCalls.length),0,'cached feedback in another review blocks destruction through the existing close handler');assert.equal(await page.evaluate(()=>window.__submits.length),2,'archive close never submits');
  await page.evaluate(()=>window.__delayQuiz=true);await page.getByRole('button',{name:'Quiz me',exact:true}).click();await page.waitForFunction(()=>window.__quizStarts.length===2);await page.keyboard.press('Control+s');assert.equal(await page.evaluate(()=>window.__closeCalls.length),1,'archived quiz startup cannot be silently closed');await page.evaluate(()=>window.__releaseQuiz());await explanation.fill('Keep archived-review quiz text');await page.keyboard.press('Meta+s');assert.equal(await explanation.inputValue(),'Keep archived-review quiz text');assert.equal(await page.evaluate(()=>window.__closeCalls.length),1,'archived active Quiz cannot be silently closed');assert.equal(await page.evaluate(()=>window.__submits.length),2);
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'End quiz',exact:true}).click();await summary.waitFor({state:'visible'});
  await page.keyboard.press('Control+s');await page.locator('.error-banner').filter({hasText:'You have unsubmitted feedback.'}).waitFor();
  await page.getByRole('button',{name:'Discard all unsubmitted feedback',exact:true}).click();await page.keyboard.press('Control+s');await page.waitForFunction(()=>window.__destroyCalls.length===1);assert.equal(await page.evaluate(()=>window.__closeCalls.length),3,'clean archived view closes through the normal request path');assert.equal(await page.evaluate(()=>window.__submits.length),2);assert.deepEqual(await page.evaluate(()=>window.__destroyCalls),[{label:'main'}]);
  // One action must publish first, then request normal close exactly once, including busy/repeat keys.
  await page.goto('http://127.0.0.1:14691');await summary.waitFor();await summary.fill('One-action keyboard publication');await page.evaluate(()=>{window.__failSubmit=false;window.__delaySubmit=true;window.__delayClose=true;});await page.keyboard.press('Meta+s');await page.waitForFunction(()=>window.__submits.length===1);assert.equal(await page.evaluate(()=>window.__closeCalls.length),0,'never close before publication succeeds');
  await page.evaluate(()=>window.__releaseSubmit());await page.waitForFunction(()=>window.__closeCalls.length===1);await page.keyboard.press('Control+s');assert.equal(await page.evaluate(()=>window.__shortcut(false,true)),true);assert.equal(await page.evaluate(()=>window.__submits.length),1);assert.equal(await page.evaluate(()=>window.__closeCalls.length),1,'in-flight successful save does not issue duplicate close');await page.evaluate(()=>window.__releaseClose());await page.waitForFunction(()=>window.__destroyCalls.length===1);assert.deepEqual(await page.evaluate(()=>window.__events),['submit','published','close','destroy']);
  // The existing explicit Finish review action also publishes an empty review and closes in one click.
  await page.goto('http://127.0.0.1:14691');await summary.waitFor();await page.evaluate(()=>window.__failSubmit=false);await page.getByRole('button',{name:'Finish review',exact:true}).click();await page.waitForFunction(()=>window.__destroyCalls.length===1);assert.deepEqual(await page.evaluate(()=>window.__events),['submit','published','close','destroy']);assert.equal(await page.evaluate(()=>window.__submits[0].feedback.summary),null);
  // Close failure after publication is not reported as save failure and never replays the result.
  await page.goto('http://127.0.0.1:14691');await summary.waitFor();await summary.fill('Published despite close failure');await page.evaluate(()=>{window.__failSubmit=false;window.__failClose=true;});await page.keyboard.press('Control+s');await page.locator('.error-banner').filter({hasText:'Feedback submitted, but could not close window: Error: Simulated native close failure'}).waitFor();assert.equal(await summary.inputValue(),'Published despite close failure');assert.ok(await summary.evaluate(el=>el.readOnly));assert.deepEqual(await page.evaluate(()=>window.__events),['submit','published','close']);await page.evaluate(()=>window.__failClose=false);await page.keyboard.press('Meta+s');await page.waitForFunction(()=>window.__destroyCalls.length===1);assert.equal(await page.evaluate(()=>window.__submits.length),1,'retry close never republishes feedback');
  // A successful publication keeps other pending work and cached notes available.
  await page.goto('http://127.0.0.1:14691?waiting');await summary.waitFor();await summary.fill('Cached A must survive saving another review');await page.locator('.pr-summary').filter({hasText:'Other editable shortcut fixture'}).click();await page.waitForFunction(()=>document.querySelector('#review-summary')?.value==='');await summary.fill('Publish the other review');await page.evaluate(()=>window.__failSubmit=false);await page.getByRole('button',{name:'Submit feedback',exact:true}).click();await page.locator('.inbox-notice').waitFor();assert.deepEqual(await page.evaluate(()=>window.__events),['submit','published']);assert.equal(await page.evaluate(()=>window.__destroyCalls.length),0);await page.keyboard.press('Meta+s');await page.locator('.error-banner').filter({hasText:'You have unsubmitted feedback.'}).waitFor();assert.equal(await page.evaluate(()=>window.__destroyCalls.length),0,'explicit Inbox close still guards cached notes');await page.locator('.pr-summary').filter({hasText:request.title}).click();await page.waitForFunction(()=>document.querySelector('#review-summary')?.value==='Cached A must survive saving another review');
  // Remaining local/remote work or non-authoritative source state keeps Inbox open.
  for(const query of ['waiting&other-remote','remote-review&other-remote','other-remote','unknown','stale','partial','polling','source-error','queue-error','remote-review&same-remote&branch-changed','remote-review&same-remote&branch-unknown','remote-review&same-remote&branch-checking']){
   await page.goto(`http://127.0.0.1:14691?${query}`);await summary.waitFor();await summary.fill('Target-specific saved note');
   const target=await page.locator('#feedback-target').innerText();assert.ok(target.includes(query.includes('remote-review')?'carpe-lab/repo #42':request.source.base.slice(0,7)));
   assert.ok(target.includes(request.source.head.slice(0,7)),'feedback target includes pinned head');
   await page.evaluate(()=>window.__failSubmit=false);await page.keyboard.press('Meta+s');await page.locator('.inbox-notice').waitFor();
   assert.deepEqual(await page.evaluate(()=>window.__events),['submit','published'],query+' does not close');
   assert.equal(await page.locator('.pr-accordion-card.is-current').count(),0,'return to Inbox without automatic next capture/reviewer');
   assert.equal(await page.evaluate(()=>window.__submits[0].feedback.summary),'Target-specific saved note');assert.equal(await page.evaluate(()=>window.__submits.length),1);assert.ok(await page.evaluate(()=>window.__submits[0].id===window.__requestId),'feedback stays with its explicit selected target');assert.deepEqual(await page.evaluate(()=>window.__unexpectedWork),[],'post-save Inbox never captures or starts reviewers');
   await page.waitForTimeout(1600);assert.equal(await page.locator('.pr-accordion-card.is-current').count(),0,'queue polling cannot silently open another request after save');
  }
  // Newer manual navigation owns its own notes while the previous publication settles.
  await page.goto('http://127.0.0.1:14691?waiting');await summary.waitFor();await page.locator('.pr-summary').filter({hasText:'Other editable shortcut fixture'}).click();await page.waitForFunction(()=>document.querySelector('.pr-accordion-card.is-current .title')?.textContent==='Other editable shortcut fixture');await summary.fill('B notes must remain');await page.locator('.pr-summary').filter({hasText:request.title}).click();await page.waitForFunction(()=>document.querySelector('#review-summary')?.value==='');await summary.fill('A publication');await page.evaluate(()=>{window.__failSubmit=false;window.__delaySubmit=true;});await page.keyboard.press('Meta+s');await page.waitForFunction(()=>window.__submits.length===1);await page.locator('.pr-summary').filter({hasText:'Other editable shortcut fixture'}).click();await page.waitForFunction(()=>document.querySelector('.pr-accordion-card.is-current .title')?.textContent==='Other editable shortcut fixture');await page.evaluate(()=>window.__releaseSubmit());await page.waitForTimeout(300);assert.equal(await summary.inputValue(),'B notes must remain');assert.equal(await page.evaluate(()=>window.__closeCalls.length),0);assert.equal(await page.evaluate(()=>window.__submits[0].feedback.summary),'A publication');
  // The just-saved PR itself is not another remote candidate; true empty closes once.
  await page.goto('http://127.0.0.1:14691?remote-review&same-remote');await summary.waitFor();await page.evaluate(()=>window.__failSubmit=false);await page.keyboard.press('Meta+s');await page.waitForFunction(()=>window.__destroyCalls.length===1);assert.deepEqual(await page.evaluate(()=>window.__events),['submit','published','close','destroy']);
  // Explicit Cmd-S with no active review still closes even when the source is unknown.
  await page.goto('http://127.0.0.1:14691?empty&unknown');await page.getByRole('heading',{name:'Your review inbox',exact:true}).waitFor();await page.keyboard.press('Meta+s');await page.waitForFunction(()=>window.__destroyCalls.length===1);assert.equal(await page.evaluate(()=>window.__submits.length),0);
  // Publication must not discard a pending quiz answer; existing End confirmation remains cancellable.
  await page.goto('http://127.0.0.1:14691');await summary.waitFor();await summary.fill('Publish without losing quiz text');await page.getByRole('button',{name:'Quiz me',exact:true}).click();await explanation.fill('Pending quiz answer survives save');await page.evaluate(()=>window.__failSubmit=false);await page.keyboard.press('Control+s');await page.locator('.error-banner').filter({hasText:'End the quiz before closing the window.'}).waitFor();assert.equal(await explanation.inputValue(),'Pending quiz answer survives save');assert.equal(await page.evaluate(()=>window.__submits.length),1);assert.equal(await page.evaluate(()=>window.__closeCalls.length),1);assert.equal(await page.evaluate(()=>window.__destroyCalls.length),0);page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'End quiz',exact:true}).click();assert.equal(await explanation.inputValue(),'Pending quiz answer survives save');assert.equal(await page.evaluate(()=>window.__quizEnds.length),0,'cancelled quiz End cannot trigger close');await page.keyboard.press('Meta+s');assert.equal(await page.evaluate(()=>window.__closeCalls.length),1,'completed-review quiz shortcut is a no-op, not another close');
  assert.deepEqual(errors,[]);console.log('PASS remaining local/remote work and unknown/stale/partial/error source safely return to Inbox without automatic work; exact feedback target preserved; true empty one-action publication then normal close, same topbar path, post-publication close-error distinction/no replay, cached and quiz guard safety; Cmd/Ctrl-S empty/archive close via real SDK method and normal close handler, cached-feedback guard, errors/repeat/default prevention, active submit/unfinished guards, archived quiz/startup protection');
 }finally{await browser?.close();server.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
