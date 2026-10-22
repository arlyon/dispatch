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
   const archived={...request,id:crypto.randomUUID(),title:'Archived shortcut fixture'};
   window.__closeCalls=[];window.__destroyCalls=[];window.__submits=[];window.__quizStarts=[];window.__quizEnds=[];window.__failSubmit=true;
   window.__shortcut=(control,repeat=false)=>{const event=new KeyboardEvent('keydown',{key:'s',metaKey:!control,ctrlKey:control,repeat,bubbles:true,cancelable:true});document.dispatchEvent(event);return event.defaultPrevented;};
   window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:callback=>{const id=next++;callbacks.set(id,callback);return id;},invoke:async(command,args)=>{
    if(command==='plugin:event|listen'){listeners.set(args.event,args.handler);return next++;}
    if(command==='plugin:event|unlisten')return;
    if(command==='plugin:window|close'){
     window.__closeCalls.push(args);if(window.__failClose)throw Error('Simulated native close failure');
     const handler=callbacks.get(listeners.get('tauri://close-requested'));if(!handler)throw Error('Normal close handler is missing');
     await handler({event:'tauri://close-requested',id:1,payload:{}});return;
    }
    // Only the real Tauri onCloseRequested wrapper may reach destroy, after our guard permits it.
    if(command==='plugin:window|destroy'){window.__destroyCalls.push(args);return;}
    if(command==='list_reviews')return location.search.includes('empty')?[]:[request,archived].map(review=>({id:review.id,title:review.title,source:review.source,fileCount:review.files.length,complete:review.id===archived.id}));
    if(command==='open_review')return args.id===archived.id?archived:request;
    if(command==='review_result')return args.id===archived.id?{version:1,requestId:archived.id,status:'complete',feedback:{head:archived.source.head,comments:[],summary:'Published archived summary'}}:null;
    if(command==='review_context')return {owner:'caller',reviewerEnabled:false,guide:'Shortcut test context.',comments:[{path:'src/App.tsx',side:'new',line:2,body:'A source anchor for the unfinished-comment guard.'}]};
    if(command==='file_identities')return Object.fromEntries(request.files.map((file,index)=>[file.path,index.toString(16).padStart(64,'0')]));
    if(command==='list_review_agents')return [];
    if(command==='submit_review'){window.__submits.push(args);if(window.__failSubmit)throw Error('Simulated submit failure');return {version:1,requestId:args.id,status:'complete',feedback:args.feedback};}
    if(command==='start_quiz'){
     window.__quizStarts.push(args);if(window.__delayQuiz)await new Promise(resolve=>window.__releaseQuiz=()=>{window.__delayQuiz=false;resolve();});
     return window.__quiz={id:'shortcut-quiz-'+window.__quizStarts.length,requestId:args.id,head:request.source.head,sequence:0,phase:'question',segments:[],answers:[],question:{question:'Keep the quiz answer?',choices:['Yes','No'],anchors:[]},error:null,sessionPath:'/mock-native'};
    }
    if(command==='end_quiz'){window.__quizEnds.push(args);return {id:args.id,requestId:window.__quiz.requestId,head:request.source.head,passed:0,failed:0,unassessed:0,endedEarly:true};}
    throw Error('Unexpected native command: '+command);
   }};
  },request);
  const permissions=JSON.parse(fs.readFileSync(path.join(cwd,'src-tauri/capabilities/default.json'),'utf8'));assert.deepEqual(permissions.windows,['main']);assert.ok(permissions.permissions.includes('core:window:allow-close'),'own main window can request normal close');
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
  assert.deepEqual(errors,[]);console.log('PASS Cmd/Ctrl-S empty/archive close via real SDK method and normal close handler, cached-feedback guard, errors/repeat/default prevention, active submit/unfinished guards, archived quiz/startup protection');
 }finally{await browser?.close();server.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
