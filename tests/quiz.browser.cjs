// Own-source snapshot; native IPC is mocked. No live queue writes or model calls.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const cwd=path.resolve(__dirname,'..'),port=process.env.DISPATCH_TEST_PORT||'14693',origin=`http://127.0.0.1:${port}`;
const request=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
(async()=>{
 const server=spawn('pnpm',['exec','vite','--host','127.0.0.1','--port',port,'--strictPort'],{cwd,stdio:'ignore'});let browser;
 try{
  for(let i=0;i<100;i++){try{if((await fetch(origin)).ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1700,height:1100}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(request=>{
   const callbacks=new Map(),listeners=new Map();let next=1,quizCount=0,textCount=0;
   const otherReview={...request,id:crypto.randomUUID(),title:'Other own-source snapshot',files:request.files.filter(file=>file.path!=='src/App.tsx')};window.__otherReviewId=otherReview.id;
   window.__answers=[];window.__starts=[];window.__ends=[];window.__submitted=[];window.__closeCalls=[];window.__destroyCalls=[];window.__hideCalls=[];window.__checkpointFailures=[];
   window.__desktopCheckpoint=token=>{const id=listeners.get('desktop-checkpoint');callbacks.get(id)?.({event:'desktop-checkpoint',id:1,payload:token});};
   window.__emitAgent=payload=>{const id=listeners.get('review-agent');callbacks.get(id)?.({event:'review-agent',id:1,payload});};
   window.__emitQuiz=patch=>{
    if('text' in patch){const segments=[...window.__quiz.segments],last=segments.at(-1);if(last?.kind==='text')segments[segments.length-1]={...last,text:patch.text};else segments.push({kind:'text',id:'text-'+(++textCount),text:patch.text});patch={...patch,segments};delete patch.text;}
    window.__quiz={...window.__quiz,...patch,sequence:window.__quiz.sequence+1};const id=listeners.get('review-quiz');callbacks.get(id)?.({event:'review-quiz',id:1,payload:window.__quiz});
   };
   window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:callback=>{const id=next++;callbacks.set(id,callback);return id;},invoke:async(command,args)=>{
    if(command==='plugin:event|listen'){listeners.set(args.event,args.handler);return next++;}
    if(command==='plugin:event|unlisten')return;
    if(command==='github_source')return {query:'Mock source',items:[],heads:[],total:0,partial:false,polling:false,lastSuccess:1,error:null};
    if(command==='desktop_bootstrap')return {checkpoint:JSON.parse(sessionStorage.getItem('desktop-checkpoint')||'null'),review:null};
    if(command==='desktop_hide'){window.__hideCalls.push(args);return;}
    if(command==='desktop_checkpoint_failed'){window.__checkpointFailures.push(args);return;}
    if(['desktop_ready','desktop_checkpoint','desktop_quit'].includes(command))return;
    if(command==='plugin:window|close'){window.__closeCalls.push(args);await callbacks.get(listeners.get('tauri://close-requested'))({event:'tauri://close-requested',id:1,payload:{}});return;}
    if(command==='plugin:window|destroy'){window.__destroyCalls.push(args);return;}
    if(command==='list_reviews')return [request,otherReview].map(review=>({id:review.id,title:review.title,source:review.source,fileCount:review.files.length,complete:window.__submitted.some(submitted=>submitted.id===review.id)}));
    if(command==='open_review'){
     if(args.id===otherReview.id&&window.__delayOther){window.__otherOpenPending=true;await new Promise(resolve=>window.__releaseOther=()=>{window.__delayOther=false;resolve();});window.__otherOpenFinished=true;}
     return args.id===otherReview.id?otherReview:request;
    }
    if(command==='review_result'){const submitted=window.__submitted.find(submitted=>submitted.id===args.id);return submitted?{version:1,requestId:args.id,status:'complete',feedback:submitted.feedback}:null;}
    if(command==='submit_review'){window.__submitted.push(args);return {version:1,requestId:args.id,status:'complete',feedback:args.feedback};}
    if(command==='review_context')return args.id===otherReview.id?{owner:'caller',reviewerEnabled:false,guide:'Other review guide.',comments:[{path:'src/Diff.tsx',side:'new',line:2,body:'Other opening context.'}]}:{owner:'caller',reviewerEnabled:false,guide:Array(70).fill('Saved opening guide.').join('\n\n'),comments:[{path:'src/App.tsx',side:'new',line:2,body:'Opening context.'}]};
    if(command==='file_identities')return Object.fromEntries((args.id===otherReview.id?otherReview:request).files.map((f,i)=>[f.path,i.toString(16).padStart(64,'0')]));
    if(command==='list_review_agents')return [];
    if(command==='start_quiz'){
     window.__starts.push(args);if(window.__failStart)throw Error('Simulated bootstrap failure');
     if(window.__delayQuiz){window.__quizStartPending=true;await new Promise(resolve=>window.__releaseQuizStart=()=>{window.__delayQuiz=false;resolve();});}
     const preparing=quizCount===0;
     return window.__quiz={id:'quiz-'+(++quizCount),requestId:args.id,head:request.source.head,sequence:0,phase:preparing?'preparing':'question',segments:preparing?[]:[{kind:'text',id:'text-'+(++textCount),text:'Look at the pinned change.'}],answers:[],error:null,sessionPath:'/native/quiz.jsonl',question:preparing?null:{question:'Why pin the source?',choices:['Stable review anchors','Change live files'],anchors:[{path:'src/App.tsx',side:'new',line:2}]}};
    }
    if(command==='answer_quiz'){
     window.__answers.push(args);if(window.__failAnswer)throw Error('Simulated answer failure');
     const question=window.__quiz.question,answer={questionToolCallId:`${window.__quiz.id}-question-${window.__quiz.answers.length+1}`,question:question.question,choice:args.answer.choice===null?null:question.choices[args.answer.choice],explanation:args.answer.explanation,assessment:null};
     window.__emitQuiz({phase:'thinking',question:null,segments:[...window.__quiz.segments,{kind:'answer',id:'answer-'+answer.questionToolCallId,questionToolCallId:answer.questionToolCallId}],answers:[...window.__quiz.answers,answer]});return;
    }
    if(command==='end_quiz'){
     window.__ends.push(args.id);if(window.__delayEnd){await new Promise(resolve=>window.__releaseEnd=()=>{window.__delayEnd=false;resolve();});}
     if(window.__endPatch){window.__quiz={...window.__quiz,...window.__endPatch};window.__endPatch=null;}
     const answers=window.__quiz.answers;return window.__lastEndedSummary={id:args.id,requestId:window.__quiz.requestId,head:window.__quiz.head,passed:answers.filter(answer=>answer.assessment?.verdict==='pass').length,failed:answers.filter(answer=>answer.assessment?.verdict==='fail').length,unassessed:answers.filter(answer=>!answer.assessment).length,endedEarly:window.__quiz.phase!=='complete'};
    }
    throw Error('Unexpected native command: '+command);
   }};
  },request);
  await page.goto(origin);await page.getByRole('button',{name:'Quiz me',exact:true}).waitFor();
  assert.ok(await page.locator('.original-chat .reviewer-offer').evaluate(el=>el===el.parentElement.lastElementChild),'reviewer offer is the last conversation item');
  await page.emulateMedia({reducedMotion:'reduce'});await page.getByLabel('Comment placement',{exact:true}).selectOption('inline');
  await page.locator('.original-chat .conversation').getByRole('button',{name:'Go to src/App.tsx:2',exact:true}).click();await page.waitForTimeout(500);
  const file=page.locator('.diff-layout[data-file-path="src/App.tsx"]');const line=file.locator('.cm-lineNumbers .cm-gutterElement').filter({hasText:/^2$/}).last();
  await line.click();const draft=page.getByRole('textbox',{name:'Line comment',exact:true});await draft.fill('Saved human note');await page.getByRole('button',{name:'Save reply',exact:true}).click();
  await line.click();await draft.fill('Unfinished source draft');const summary=page.getByRole('textbox',{name:'Final summary',exact:true});await summary.fill('Unfinished summary must not enter quiz');
  assert.ok(await page.locator('.original-chat .reviewer-offer').evaluate(el=>el===el.parentElement.lastElementChild),'pending drafts remain above the bottom reviewer offer');
  await page.locator('.original-chat .conversation').evaluate(el=>{el.scrollTop=123;window.__conversation=el;window.__conversationScroll=el.scrollTop;window.__summary=document.querySelector('#review-summary');window.__reviewOffer=document.querySelector('.reviewer-offer');window.__draft=document.querySelector('[aria-label="Line comment"]');});
  // Start A's quiz while B's immutable snapshot is still loading, then let B finish first.
  await page.evaluate(()=>{window.__delayOther=true;window.__delayQuiz=true;});
  await page.locator('.pr-summary').filter({hasText:'Other own-source snapshot'}).click();await page.waitForFunction(()=>window.__otherOpenPending);
  await page.getByRole('button',{name:'Quiz me',exact:true}).click();await page.waitForFunction(()=>window.__quizStartPending);
  await page.evaluate(()=>window.__releaseOther());await page.waitForFunction(()=>window.__otherOpenFinished);await page.evaluate(()=>new Promise(requestAnimationFrame));
  assert.equal(await page.locator('.pr-accordion-card.is-current .title').innerText(),request.title,'late B load cannot replace quiz A source during startup');
  assert.ok(await draft.evaluate(el=>el===window.__draft),'late B load leaves A diff/draft nodes intact');
  assert.equal(await page.locator('.original-chat .conversation').getByText('Agent · Opening context.',{exact:true}).count(),1,'A opening context remains attached');
  assert.equal(await summary.inputValue(),'Unfinished summary must not enter quiz');
  assert.equal(await page.evaluate(()=>window.__starts[0].id),request.id,'quiz ownership stays on A');
  await page.evaluate(()=>window.__releaseQuizStart());await page.getByRole('region',{name:'Quiz',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__quiz.requestId),request.id);
  await page.getByText('Pi is preparing a question…',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Answer',exact:true}).count(),0,'partial tool arguments do not expose an answer form');
  await page.evaluate(()=>window.__desktopCheckpoint(42));await page.waitForFunction(()=>window.__checkpointFailures.some(call=>call.token===42));assert.equal(await page.evaluate(()=>window.__hideCalls.length),0,'active quiz prevents GUI retirement');
  await draft.focus();await draft.evaluate(el=>el.setSelectionRange(5,5));
  for(const text of ['Look at','Look at the pinned','Look at the pinned change.']){await page.evaluate(text=>window.__emitQuiz({text}),text);await page.waitForTimeout(60);}
  assert.ok(await draft.evaluate(el=>document.activeElement===el&&el.selectionStart===5&&el===window.__draft),'progressive preparation never steals source caret');
  assert.equal(await page.locator('.quiz-conversation .markdown-body').innerText(),'Look at the pinned change.');
  await page.evaluate(()=>window.__emitQuiz({phase:'question',question:{question:'Why pin the source?',choices:['Stable review anchors','Change live files'],anchors:[{path:'src/App.tsx',side:'new',line:2}]}}));
  assert.equal(await page.locator('[role="dialog"]').count(),0,'no overlay');assert.equal(await summary.isVisible(),false,'quiz replaces right bar');
  const saved=await page.evaluate(()=>window.__starts[0].saved);assert.equal(saved.summary,null);assert.equal(saved.comments.length,1);assert.equal(saved.comments[0].body,'Saved human note');assert.ok(!JSON.stringify(saved).includes('Unfinished'));
  assert.equal(await page.getByRole('button',{name:'Answer',exact:true}).isEnabled(),false,'empty answer blocked');
  await page.getByRole('textbox',{name:'Quiz explanation',exact:true}).fill('   ');assert.equal(await page.getByRole('button',{name:'Answer',exact:true}).isEnabled(),false);
  await page.getByRole('button',{name:'View src/App.tsx:2 (new)',exact:true}).click();await page.waitForTimeout(400);await line.click();await draft.evaluate(el=>window.__draft=el);
  assert.equal(await draft.inputValue(),'Unfinished source draft');await draft.focus();await page.keyboard.press('End');await page.keyboard.type(' edited during quiz');
  await page.evaluate(()=>window.__emitQuiz({text:window.__quiz.segments.at(-1).text+' Streaming update.'}));await page.waitForTimeout(1750);
  assert.ok(await draft.evaluate(el=>document.activeElement===el&&el===window.__draft),'stream/poll leaves source caret and DOM unchanged');
  const explanation=page.getByRole('textbox',{name:'Quiz explanation',exact:true});await explanation.fill('Because stable anchors');await explanation.evaluate(el=>{window.__quizInput=el;el.setSelectionRange(7,7);});
  await page.evaluate(()=>window.__emitQuiz({text:window.__quiz.segments.at(-1).text+' More streaming.'}));await page.waitForTimeout(1600);
  assert.ok(await explanation.evaluate(el=>el===window.__quizInput&&document.activeElement===el&&el.selectionStart===7),'quiz typing survives stream/poll');
  await page.evaluate(()=>window.__failAnswer=true);await page.getByRole('button',{name:'Answer',exact:true}).click();await page.getByRole('alert').filter({hasText:'Answer was not confirmed'}).waitFor();assert.equal(await explanation.inputValue(),'Because stable anchors','failed send preserves answer');
  await page.evaluate(()=>window.__failAnswer=false);await page.getByRole('radio',{name:'Stable review anchors',exact:true}).check();await page.getByRole('button',{name:'Answer',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.__answers.at(-1).id),'quiz-1');assert.deepEqual(await page.evaluate(()=>window.__answers.at(-1).answer),{choice:0,explanation:'Because stable anchors'});
  await page.locator('.quiz-answer').evaluate(el=>window.__assessmentCard=el);
  assert.equal(await page.getByText('Correct: immutable source keeps anchors stable.',{exact:true}).count(),0,'answer card is anchored before follow-up arrives');
  for(const text of ['Correct:','Correct: immutable source','Correct: immutable source keeps anchors stable.']){
   await page.evaluate(text=>window.__emitQuiz({text}),text);await page.waitForTimeout(60);
   assert.ok(await page.locator('.quiz-answer').first().evaluate(el=>el===window.__assessmentCard&&el.nextElementSibling?.classList.contains('quiz-text')&&Boolean(el.compareDocumentPosition(el.nextElementSibling)&Node.DOCUMENT_POSITION_FOLLOWING)),'every follow-up stream update stays after its answer card');
  }
  await page.getByText('Correct: immutable source keeps anchors stable.',{exact:true}).waitFor();
  assert.equal(await page.locator('.quiz-verdict.pass,.quiz-verdict.fail').count(),0,'correctness prose never infers pass/fail');assert.equal(await page.locator('.quiz-verdict.unassessed').innerText(),'Not assessed');
  await page.evaluate(()=>window.__emitQuiz({answers:window.__quiz.answers.map(answer=>({...answer,assessment:{questionToolCallId:answer.questionToolCallId,verdict:'pass',reason:'Agent explicitly confirms stable anchors.'}}))}));
  assert.equal(await page.locator('.quiz-verdict.pass').innerText(),'Pass');await page.getByText('Agent explicitly confirms stable anchors.',{exact:true}).waitFor();
  assert.ok(await page.locator('.quiz-answer').evaluate(el=>el===window.__assessmentCard),'assessment patches the same existing answer card');
  assert.equal(await page.locator('.quiz-text').last().innerText(),'Correct: immutable source keeps anchors stable.','authoritative text is not duplicated');
  await page.locator('.quiz-answer').evaluate(el=>window.__assessmentCard=el);

  await page.evaluate(()=>window.__emitQuiz({phase:'question',question:{question:'Next question?',choices:['First','Second'],anchors:[]}}));await page.getByRole('radio',{name:'Second',exact:true}).check();
  await explanation.fill('Keep this caret while feedback streams');await explanation.evaluate(el=>{window.__secondInput=el;el.setSelectionRange(4,4);});
  for(const text of ['Feedback is','Feedback is streaming','Feedback is streaming progressively.']){await page.evaluate(text=>window.__emitQuiz({text}),text);await page.waitForTimeout(60);}
  assert.ok(await explanation.evaluate(el=>document.activeElement===el&&el.selectionStart===4&&el===window.__secondInput),'answer textarea remains stable during progressive feedback');
  assert.ok(await page.evaluate(()=>document.querySelector('.quiz-answer')===window.__assessmentCard),'assessment card uses a stable question identity');
  assert.ok(await page.getByRole('radio',{name:'Second',exact:true}).isChecked());await explanation.fill('');

  page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'End quiz',exact:true}).click();assert.equal(await page.evaluate(()=>window.__ends.length),0,'pending choice cancellation requires confirmation');
  await page.getByRole('button',{name:'Answer',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.__answers.at(-1).answer),{choice:1,explanation:''},'choice alone accepted');
  await page.locator('.quiz-answer').last().evaluate(el=>window.__secondCard=el);
  for(const text of ['Second','Second follow-up','Second follow-up explanation.']){await page.evaluate(text=>window.__emitQuiz({text}),text);await page.waitForTimeout(60);assert.ok(await page.locator('.quiz-answer').last().evaluate(el=>el===window.__secondCard&&el.nextElementSibling?.classList.contains('quiz-text')),'second feedback follows the second answer');}
  await page.evaluate(()=>window.__emitQuiz({answers:window.__quiz.answers.map((answer,index)=>index===1?{...answer,assessment:{questionToolCallId:answer.questionToolCallId,verdict:'fail',reason:'Agent explicitly reports this answer missed the distinction.'}}:answer)}));
  assert.ok(await page.locator('.quiz-answer').last().evaluate(el=>el===window.__secondCard),'second verdict patches its existing card');
  const order=await page.locator('.quiz-conversation').evaluate(el=>[...el.children].filter(node=>node.matches('.quiz-answer,.quiz-text')).map(node=>node.matches('.quiz-answer')?'answer':'text'));assert.deepEqual(order,['text','answer','text','answer','text'],'introduction and both answer/feedback turns retain chronological order');
  assert.equal(await page.locator('.quiz-verdict.fail').innerText(),'Fail');assert.equal(await page.locator('.quiz-verdict.pass').count(),1,'each answer retains its own verdict');
  assert.equal(await page.locator('.original-chat .quiz-answer,.original-chat .quiz-verdict').count(),0,'verdict cards never enter the main review conversation');

  await page.evaluate(()=>window.__emitQuiz({phase:'complete',question:null,text:'Final explanation stays visible.'}));await page.getByText('Final explanation stays visible.',{exact:true}).waitFor();await page.waitForTimeout(1700);assert.equal(await summary.isVisible(),false,'final feedback stays until Done');
  assert.ok(await page.getByRole('button',{name:'Done',exact:true}).evaluate(el=>el.classList.contains('primary-action')),'Done is the primary completion control');
  await page.evaluate(()=>window.__delayEnd=true);await page.getByRole('button',{name:'Done',exact:true}).click();assert.ok(await page.getByRole('button',{name:'Done',exact:true}).isDisabled());await page.getByRole('button',{name:'Done',exact:true}).evaluate(el=>el.click());assert.equal(await page.evaluate(()=>window.__ends.length),1,'double Done cannot finish twice');await page.evaluate(()=>window.__releaseEnd());await summary.waitFor({state:'visible'});assert.equal(await summary.inputValue(),'Unfinished summary must not enter quiz');assert.equal(await draft.inputValue(),'Unfinished source draft edited during quiz');
  assert.ok(await page.evaluate(()=>window.__conversation===document.querySelector('.original-chat .conversation')&&window.__conversation.scrollTop===window.__conversationScroll&&window.__summary===document.querySelector('#review-summary')),'original conversation DOM, scroll and summary DOM restored');
  const runSummaries=page.locator('.original-chat .quiz-run-summary');assert.equal(await runSummaries.count(),1);assert.equal(await runSummaries.first().getAttribute('data-quiz-run-id'),'quiz-1');
  assert.equal(await runSummaries.first().locator('.quiz-summary-pass').innerText(),'1 Pass');assert.equal(await runSummaries.first().locator('.quiz-summary-fail').innerText(),'1 Fail');assert.ok((await runSummaries.first().innerText()).includes('Complete'));assert.ok(!(await runSummaries.first().innerText()).includes('Not assessed'));
  assert.ok(await runSummaries.first().evaluate(el=>el.nextElementSibling===window.__reviewOffer&&window.__reviewOffer===el.parentElement.lastElementChild&&window.__reviewOffer===document.querySelector('.reviewer-offer')),'run summary follows regular content immediately before the unchanged bottom reviewer offer');
  await page.evaluate(()=>window.__emitQuiz({phase:'complete'}));assert.equal(await runSummaries.count(),1,'late final events cannot duplicate the returned run summary');
  // Explicit End also releases the navigation restriction; the cancelled B load can be opened normally.
  await page.locator('.original-chat .conversation').evaluate(el=>el.scrollTop=el.scrollHeight);
  await page.getByRole('button',{name:'Quiz me',exact:true}).click();await page.getByRole('region',{name:'Quiz',exact:true}).waitFor();await explanation.fill('An answer with no assessment');await page.getByRole('button',{name:'Answer',exact:true}).click();await page.getByRole('button',{name:'End quiz',exact:true}).click();await summary.waitFor({state:'visible'});await page.waitForTimeout(100);
  assert.ok(await runSummaries.last().evaluate(el=>el.nextElementSibling===window.__reviewOffer&&window.__reviewOffer===el.parentElement.lastElementChild),'chronological summaries remain immediately before the bottom offer');
  assert.equal(await runSummaries.count(),2);assert.ok((await runSummaries.last().innerText()).includes('1 Not assessed')&&(await runSummaries.last().innerText()).includes('Ended early'));assert.equal(await runSummaries.last().locator('.quiz-summary-pass').innerText(),'0 Pass');
  assert.ok(await page.locator('.original-chat .conversation').evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop<2),'return follows the appended summary only when already at the chat end');

  await page.locator('.pr-summary').filter({hasText:'Other own-source snapshot'}).click();await page.waitForFunction(()=>document.querySelector('.pr-accordion-card.is-current .title')?.textContent==='Other own-source snapshot');
  assert.equal(await file.count(),0,'B diff replaces A only after End');assert.equal(await summary.inputValue(),'','B does not inherit A notes');
  await page.locator('.original-chat .conversation').getByText('Agent · Other opening context.',{exact:true}).waitFor();
  assert.equal(await runSummaries.count(),0,'A run summaries are absent from B');
  await page.getByRole('button',{name:'Quiz me',exact:true}).click();await explanation.fill('B answer');await page.getByRole('button',{name:'Answer',exact:true}).click();await page.evaluate(()=>window.__emitQuiz({phase:'complete',answers:window.__quiz.answers.map(answer=>({...answer,assessment:{questionToolCallId:answer.questionToolCallId,verdict:'fail',reason:'B-only verdict'}}))}));await page.getByRole('button',{name:'Done',exact:true}).click();await summary.waitFor({state:'visible'});assert.equal(await runSummaries.count(),1);assert.equal(await runSummaries.first().locator('.quiz-summary-fail').innerText(),'1 Fail');

  await page.locator('.pr-summary').filter({hasText:request.title}).click();await file.waitFor();
  assert.equal(await summary.inputValue(),'Unfinished summary must not enter quiz');assert.equal(await draft.inputValue(),'Unfinished source draft edited during quiz');
  assert.deepEqual(await runSummaries.evaluateAll(elements=>elements.map(el=>el.dataset.quizRunId)),['quiz-1','quiz-2'],'multiple A runs retain chronological order and exclude B');
  await page.getByRole('button',{name:'Quiz me',exact:true}).click();await explanation.fill('Text-only explanation');await page.getByRole('button',{name:'Answer',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.__answers.at(-1).answer),{choice:null,explanation:'Text-only explanation'},'free text alone accepted');await page.evaluate(()=>window.__emitQuiz({phase:'error',question:null,error:'Simulated child failure'}));await page.getByRole('alert').filter({hasText:'Simulated child failure'}).waitFor();
  await page.evaluate(()=>window.__endPatch={answers:window.__quiz.answers.map(answer=>({...answer,assessment:{questionToolCallId:answer.questionToolCallId,verdict:'pass',reason:'Confirmed backend verdict not yet delivered as a UI event'}}))});await page.getByRole('button',{name:'End quiz',exact:true}).click();await summary.waitFor({state:'visible'});assert.equal(await runSummaries.last().locator('.quiz-summary-pass').innerText(),'1 Pass','End uses the confirmed backend snapshot rather than stale frontend verdicts');assert.ok(!(await runSummaries.last().innerText()).includes('Not assessed'));

  await page.getByRole('button',{name:'Quiz me',exact:true}).click();await explanation.fill('Pending discarded answer');page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'End quiz',exact:true}).click();assert.ok(await summary.isVisible(),'confirmed pending-text cancellation restores review');
  await page.getByRole('button',{name:'Quiz me',exact:true}).click();await page.evaluate(()=>window.__emitQuiz({phase:'starting',question:null}));await page.getByRole('button',{name:'End quiz',exact:true}).click();await page.evaluate(()=>window.__emitQuiz({phase:'question',question:{question:'Late question must not return',choices:['A','B'],anchors:[]}}));assert.equal(await page.getByRole('region',{name:'Quiz',exact:true}).count(),0,'ended bootstrap cannot resurrect quiz UI');
  const summariesBeforeFailedStart=await runSummaries.count();await page.evaluate(()=>window.__failStart=true);await page.getByRole('button',{name:'Quiz me',exact:true}).click();await page.getByRole('alert').filter({hasText:'Cannot start quiz'}).waitFor();assert.equal(await summary.inputValue(),'Unfinished summary must not enter quiz');
  assert.equal(await runSummaries.count(),summariesBeforeFailedStart,'failed startup does not fabricate a run summary');
  // Existing agent/retry and archive availability remain independent of the bottom-offer order.
  await page.locator('.pr-summary').filter({hasText:'Other own-source snapshot'}).click();await page.waitForFunction(()=>document.querySelector('.pr-accordion-card.is-current .title')?.textContent==='Other own-source snapshot');
  await page.evaluate(()=>window.__emitAgent({requestId:window.__otherReviewId,phase:'error',sequence:1,text:'',error:'Browser-only existing reviewer error',files:[],omitted:0,sessionPath:'/browser-only'}));
  await page.getByText('Browser-only existing reviewer error',{exact:true}).waitFor();await page.getByRole('button',{name:'Retry Pi review · same session',exact:true}).waitFor();assert.equal(await page.locator('.original-chat .reviewer-offer').count(),0,'existing agent hides the offer');
  assert.ok(await page.locator('.original-chat .reviewer-start').evaluate(el=>Boolean(el.compareDocumentPosition(document.querySelector('.original-chat .quiz-run-summary'))&Node.DOCUMENT_POSITION_FOLLOWING)),'retry stays with the agent report before conversation summaries');
  await page.evaluate(()=>window.__emitAgent({requestId:window.__otherReviewId,phase:'complete',sequence:2,text:JSON.stringify({summary:'Browser-only completed report',findings:[]}),error:null,files:[],omitted:0,sessionPath:'/browser-only'}));await page.getByText('Browser-only completed report',{exact:true}).waitFor();assert.equal(await page.locator('.original-chat .reviewer-offer,.original-chat .reviewer-start').count(),0,'completed agent keeps offer and retry hidden');
  await page.locator('.pr-summary').filter({hasText:request.title}).click();await file.waitFor();assert.ok(await page.locator('.original-chat .reviewer-offer').evaluate(el=>el===el.parentElement.lastElementChild),'unreviewed request restores its bottom offer');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('button',{name:'Discard',exact:true}).click();await page.keyboard.press('Meta+s');await page.waitForFunction(()=>window.__submitted.length===1);
  assert.ok(await page.evaluate(()=>window.__starts.every(start=>!JSON.stringify(start.saved).includes('Quiz summary')&&!JSON.stringify(start.saved).includes('An answer with no assessment'))),'main run summaries do not become source-agent quiz context');
  const submitted=await page.evaluate(()=>window.__submitted[0].feedback);assert.equal(submitted.comments.length,1);assert.equal(submitted.comments[0].body,'Saved human note');assert.ok(!JSON.stringify(submitted).includes('assessment')&&!JSON.stringify(submitted).includes('Agent explicitly')&&!JSON.stringify(submitted).includes('Quiz summary')&&!JSON.stringify(submitted).includes('An answer with no assessment'),'quiz verdicts/answers never become submitted review feedback');
  await page.locator('.inbox-notice').waitFor();await page.locator('.archive-section>summary').click();await page.locator('.archive-list .pr-summary').filter({hasText:request.title}).click();
  await page.getByText('Archived feedback · read-only',{exact:true}).waitFor();assert.equal(await page.locator('.original-chat .reviewer-offer').count(),0,'archived request without an agent never shows the offer');
  assert.equal(await page.evaluate(()=>window.__closeCalls.length),0,'publication keeps other queued work open');
  await page.keyboard.press('Meta+s');await page.waitForFunction(()=>window.__hideCalls.length===1);assert.equal(await page.evaluate(()=>window.__closeCalls.length),1,'explicit archived-view close checkpoints once');
  assert.equal(await page.evaluate(()=>window.__destroyCalls.length),0,'normal close preserves the resident-owned checkpoint instead of destroying the GUI');
  const returnedQuizIds=await runSummaries.evaluateAll(elements=>elements.map(el=>el.dataset.quizRunId));
  await page.evaluate(()=>sessionStorage.setItem('desktop-checkpoint',JSON.stringify(window.__hideCalls[0].checkpoint)));
  await page.reload();await page.getByRole('textbox',{name:'Final summary',exact:true}).waitFor();
  assert.deepEqual(await runSummaries.evaluateAll(elements=>elements.map(el=>el.dataset.quizRunId)),returnedQuizIds,'resident bootstrap restores the completed quiz summaries');
  assert.deepEqual(errors,[]);console.log('PASS reviewer offer always last after quiz summaries, unchanged agent/retry/archive availability, chronological answer/text segments, stable assessment patches, once-only snapshot-scoped run summaries at main chat end, confirmed End counts and review-feedback isolation, progressive feedback/preparation with stable typing, explicit per-answer pass/fail/missing widgets isolated from review submission, delayed review-navigation ownership race, End then navigation, quiz right-bar lifecycle, source/quiz caret, saved-only context, real answer routing shape, failure/cancel, retained final feedback, preserved review DOM/drafts/scroll');
 }finally{await browser?.close();server.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
