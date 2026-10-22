// Own-source request; all native IPC is mocked. No live queue writes/model calls.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const cwd=path.resolve(__dirname,'..'),request=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const port=process.env.DISPATCH_TEST_PORT||'14693',origin=`http://127.0.0.1:${port}`;
(async()=>{
 const server=spawn('pnpm',['exec','vite','--host','127.0.0.1','--port',port,'--strictPort'],{cwd,stdio:'ignore'});let browser;
 try{
  for(let i=0;i<100;i++){try{if((await fetch(origin)).ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1700,height:1100}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(request=>{
   const callbacks=new Map(),listeners=new Map();let next=1;
   const archived={...request,id:crypto.randomUUID(),title:'Archived shortcut fixture'},other={...request,id:crypto.randomUUID(),title:'Other editable shortcut fixture'},results={};
   window.__events=[];window.__closeCalls=[];window.__destroyCalls=[];window.__hideCalls=[];window.__quitCalls=[];window.__submits=[];window.__quizStarts=[];window.__quizEnds=[];window.__failSubmit=true;
   window.__shortcut=(control,repeat=false)=>{const event=new KeyboardEvent('keydown',{key:'s',metaKey:!control,ctrlKey:control,repeat,bubbles:true,cancelable:true});document.dispatchEvent(event);return event.defaultPrevented;};
   window.__quit=()=>{const id=listeners.get('desktop-quit');callbacks.get(id)?.({event:'desktop-quit',id:1,payload:null});};
   window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:callback=>{const id=next++;callbacks.set(id,callback);return id;},invoke:async(command,args)=>{
    if(command==='plugin:event|listen'){listeners.set(args.event,args.handler);return next++;}
    if(command==='plugin:event|unlisten')return;
    if(command==='desktop_bootstrap')return {checkpoint:null,review:null};
    if(['desktop_ready','desktop_checkpoint','desktop_checkpoint_failed'].includes(command))return;
    if(command==='desktop_hide'){window.__hideCalls.push(args);window.__events.push('hide');return;}
    if(command==='desktop_quit'){window.__quitCalls.push(args);return;}
    if(command==='plugin:window|close'){
     window.__closeCalls.push(args);window.__events.push('close');if(window.__delayClose)await new Promise(resolve=>window.__releaseClose=()=>{window.__delayClose=false;resolve();});if(window.__failClose)throw Error('Simulated native close failure');
     const handler=callbacks.get(listeners.get('tauri://close-requested'));if(!handler)throw Error('Normal close handler is missing');
     await handler({event:'tauri://close-requested',id:1,payload:{}});return;
    }
    if(command==='plugin:window|destroy'){window.__destroyCalls.push(args);return;}
    if(command==='list_reviews')return location.search.includes('empty')?[]:[request,other,archived].map(review=>({id:review.id,title:review.title,source:review.source,fileCount:review.files.length,complete:review.id===archived.id||Boolean(results[review.id])}));
    if(command==='open_review')return [request,other,archived].find(review=>review.id===args.id);
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
  const permissions=JSON.parse(fs.readFileSync(path.join(cwd,'src-tauri/capabilities/default.json'),'utf8'));assert.deepEqual(permissions.windows,['main']);assert.ok(permissions.permissions.includes('core:window:allow-close'));
  await page.goto(origin+'?empty');await page.getByRole('heading',{name:'Your review inbox',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__shortcut(false)),true);await page.waitForFunction(()=>window.__hideCalls.length===1);
  await page.keyboard.press('Control+s');await page.waitForFunction(()=>window.__hideCalls.length===2);
  assert.deepEqual(await page.evaluate(()=>window.__closeCalls),[{label:'main'},{label:'main'}]);assert.equal(await page.evaluate(()=>window.__submits.length),0);
  assert.equal(await page.evaluate(()=>window.__shortcut(true,true)),true);assert.equal(await page.evaluate(()=>window.__closeCalls.length),2,'repeat cannot close again');
  await page.evaluate(()=>window.__failClose=true);await page.keyboard.press('Meta+s');await page.locator('.error-banner').filter({hasText:'Cannot close window: Error: Simulated native close failure'}).waitFor();assert.equal(await page.evaluate(()=>window.__hideCalls.length),2);
  await page.goto(origin);const summary=page.getByRole('textbox',{name:'Final summary',exact:true});await summary.waitFor();await page.emulateMedia({reducedMotion:'reduce'});await page.getByLabel('Comment placement',{exact:true}).selectOption('inline');
  await summary.fill('Cached unsubmitted feedback for review A');await page.locator('.original-chat .conversation').getByRole('button',{name:'Go to src/App.tsx:2',exact:true}).click();await page.waitForTimeout(350);
  await page.locator('.diff-layout[data-file-path="src/App.tsx"] .cm-lineNumbers .cm-gutterElement').filter({hasText:/^2$/}).last().click();
  const draft=page.getByRole('textbox',{name:'Line comment',exact:true});await draft.fill('Unfinished source draft');await page.keyboard.press('Meta+s');await page.locator('.error-banner').filter({hasText:'Save or discard your unfinished line comments'}).waitFor();assert.equal(await page.evaluate(()=>window.__submits.length),0);assert.equal(await page.evaluate(()=>window.__closeCalls.length),0);
  await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('button',{name:'Discard',exact:true}).click();await page.keyboard.press('Control+s');await page.locator('.error-banner').filter({hasText:'Simulated submit failure'}).waitFor();assert.equal(await summary.inputValue(),'Cached unsubmitted feedback for review A');assert.equal(await page.evaluate(()=>window.__hideCalls.length),0);
  await page.getByRole('button',{name:'Quiz me',exact:true}).click();const explanation=page.getByRole('textbox',{name:'Quiz explanation',exact:true});await explanation.fill('Keep editable-review quiz text');await page.keyboard.press('Meta+s');await page.waitForFunction(()=>window.__submits.length===2);assert.equal(await explanation.inputValue(),'Keep editable-review quiz text');assert.equal(await page.evaluate(()=>window.__closeCalls.length),0);
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'End quiz',exact:true}).click();await summary.waitFor({state:'visible'});
  await page.locator('.archive-section>summary').click();await page.locator('.archive-list .pr-summary').filter({hasText:'Archived shortcut fixture'}).click();await page.waitForFunction(()=>document.querySelector('#review-summary')?.readOnly);
  await page.keyboard.press('Meta+s');await page.waitForFunction(()=>window.__hideCalls.length===1);
  assert.equal(await page.evaluate(id=>window.__hideCalls[0].checkpoint.data.drafts[id].summary,request.id),'Cached unsubmitted feedback for review A','hiding checkpoints cached feedback instead of dropping it');
  assert.equal(await page.evaluate(()=>window.__submits.length),2,'archive close never publishes');
  await page.evaluate(()=>window.__delayQuiz=true);await page.getByRole('button',{name:'Quiz me',exact:true}).click();await page.waitForFunction(()=>window.__quizStarts.length===2);await page.keyboard.press('Control+s');assert.equal(await page.evaluate(()=>window.__closeCalls.length),1,'quiz startup blocks closing');await page.evaluate(()=>window.__releaseQuiz());await explanation.fill('Keep archived-review quiz text');await page.keyboard.press('Meta+s');assert.equal(await explanation.inputValue(),'Keep archived-review quiz text');assert.equal(await page.evaluate(()=>window.__hideCalls.length),1);
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'End quiz',exact:true}).click();await summary.waitFor({state:'visible'});
  await page.evaluate(()=>window.__quit());await page.locator('.error-banner').filter({hasText:'unsubmitted feedback'}).waitFor();assert.equal(await page.evaluate(()=>window.__quitCalls.at(-1).checkpoint),null,'explicit Quit still rejects cached drafts');
  await page.getByRole('button',{name:'Discard all unsubmitted feedback',exact:true}).click();await page.keyboard.press('Control+s');await page.waitForFunction(()=>window.__hideCalls.length===2);
  // Publication happens before normal close/hide, once, even with delayed operations.
  await page.goto(origin);await summary.waitFor();await summary.fill('One-action keyboard publication');await page.evaluate(()=>{window.__failSubmit=false;window.__delaySubmit=true;window.__delayClose=true;});await page.keyboard.press('Meta+s');await page.waitForFunction(()=>window.__submits.length===1);assert.equal(await page.evaluate(()=>window.__closeCalls.length),0);
  await page.evaluate(()=>window.__releaseSubmit());await page.waitForFunction(()=>window.__closeCalls.length===1);await page.keyboard.press('Control+s');assert.equal(await page.evaluate(()=>window.__submits.length),1);assert.equal(await page.evaluate(()=>window.__closeCalls.length),1);await page.evaluate(()=>window.__releaseClose());await page.waitForFunction(()=>window.__hideCalls.length===1);assert.deepEqual(await page.evaluate(()=>window.__events),['submit','published','close','hide']);
  await page.goto(origin);await summary.waitFor();await page.evaluate(()=>window.__failSubmit=false);await page.getByRole('button',{name:'Finish review',exact:true}).click();await page.waitForFunction(()=>window.__hideCalls.length===1);assert.deepEqual(await page.evaluate(()=>window.__events),['submit','published','close','hide']);assert.equal(await page.evaluate(()=>window.__submits[0].feedback.summary),null);
  await page.goto(origin);await summary.waitFor();await summary.fill('Published despite close failure');await page.evaluate(()=>{window.__failSubmit=false;window.__failClose=true;});await page.keyboard.press('Control+s');await page.locator('.error-banner').filter({hasText:'Feedback submitted, but could not close window: Error: Simulated native close failure'}).waitFor();assert.ok(await summary.evaluate(el=>el.readOnly));await page.evaluate(()=>window.__failClose=false);await page.keyboard.press('Meta+s');await page.waitForFunction(()=>window.__hideCalls.length===1);assert.equal(await page.evaluate(()=>window.__submits.length),1,'retry close never republishes');
  await page.goto(origin);await summary.waitFor();await summary.fill('Cached A must survive saving another review');await page.locator('.pr-summary').filter({hasText:'Other editable shortcut fixture'}).click();await page.waitForFunction(()=>document.querySelector('#review-summary')?.value==='');await summary.fill('Publish the other review');await page.evaluate(()=>window.__failSubmit=false);await page.getByRole('button',{name:'Submit feedback',exact:true}).click();await page.waitForFunction(()=>window.__hideCalls.length===1);assert.equal(await page.evaluate(id=>window.__hideCalls[0].checkpoint.data.drafts[id].summary,request.id),'Cached A must survive saving another review');await page.locator('.pr-summary').filter({hasText:request.title}).click();await page.waitForFunction(()=>document.querySelector('#review-summary')?.value==='Cached A must survive saving another review');
  await page.goto(origin);await summary.waitFor();await summary.fill('Publish without losing quiz text');await page.getByRole('button',{name:'Quiz me',exact:true}).click();await explanation.fill('Pending quiz answer survives save');await page.evaluate(()=>window.__failSubmit=false);await page.keyboard.press('Control+s');await page.locator('.error-banner').filter({hasText:'End the quiz before closing the window.'}).waitFor();assert.equal(await explanation.inputValue(),'Pending quiz answer survives save');assert.equal(await page.evaluate(()=>window.__submits.length),1);assert.equal(await page.evaluate(()=>window.__hideCalls.length),0);page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'End quiz',exact:true}).click();assert.equal(await explanation.inputValue(),'Pending quiz answer survives save');assert.equal(await page.evaluate(()=>window.__quizEnds.length),0);await page.keyboard.press('Meta+s');assert.equal(await page.evaluate(()=>window.__closeCalls.length),1);
  assert.equal(await page.evaluate(()=>window.__destroyCalls.length),0,'normal closes never destroy a checkpointed or active quiz GUI');assert.deepEqual(errors,[]);
  console.log('PASS publication then native close/hide once, no replay after close failure, cached feedback checkpointed, explicit Quit guarded, unfinished replies preserved, active/starting quiz protected, Cmd/Ctrl-S empty/archive and repeat/default prevention');
 }finally{await browser?.close();server.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
