// Production UI, mocked native IPC. No live queue, provider calls, or fabricated native session files.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const request=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));request.files=request.files.slice(0,2);
(async()=>{
 const server=spawn('pnpm',['exec','vite','--host','127.0.0.1','--port','14720','--strictPort'],{cwd:path.resolve(__dirname,'..'),stdio:'ignore'});let browser;
 try{
  for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:14720')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(request=>{
   let next=1;const callbacks=new Map(),listeners=new Map(),other={...request,id:'other-review',title:'Other review'},results={};
   window.__questions=[];window.__submits=[];window.__checkpoints=[];
   window.__state={requestId:request.id,phase:'complete',sequence:0,text:JSON.stringify({summary:'Original review recommendation',findings:[]}),files:request.files.map(f=>f.path),omitted:0,error:null,sessionPath:'/mock/native-agent.jsonl',conversation:[],chatting:false};
   window.__emit=patch=>{window.__state={...window.__state,...patch,sequence:window.__state.sequence+1};callbacks.get(listeners.get('review-agent'))?.({event:'review-agent',payload:window.__state});};
   window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:cb=>{const id=next++;callbacks.set(id,cb);return id;},invoke:async(command,args)=>{
    if(command==='plugin:event|listen'){listeners.set(args.event,args.handler);return next++;}if(command==='plugin:event|unlisten')return;
    if(command==='desktop_bootstrap')return {checkpoint:null,review:request.id};
    if(command==='desktop_checkpoint'){window.__checkpoints.push(args);return;}
    if(['desktop_ready','desktop_checkpoint_failed','desktop_hide','desktop_quit'].includes(command))return;
    if(command==='github_source')return {query:'fixture',items:[],heads:[],total:0,partial:false,polling:false,lastSuccess:1,error:null};
    if(command==='list_reviews')return [request,other].map(r=>({...r,fileCount:r.files.length,complete:Boolean(results[r.id])}));
    if(command==='open_review')return args.id===request.id?request:other;
    if(command==='review_result')return results[args.id]||null;
    if(command==='review_context')return {owner:'caller',reviewerEnabled:false,guide:'Caller context',comments:[]};
    if(command==='file_identities')return Object.fromEntries(request.files.map((f,i)=>[f.path,i.toString(16).padStart(64,'0')]));
    if(command==='list_review_agents')return [window.__state];
    if(command==='ask_review_agent'){window.__questions.push(args);if(window.__reject)throw Error('Pi rejected this question');return await new Promise(resolve=>window.__accept=()=>resolve(window.__state));}
    if(command==='submit_review'){window.__submits.push(args);return results[args.id]={version:1,requestId:args.id,status:'complete',feedback:args.feedback};}
    throw Error('Unexpected native command '+command);
   }};
  },request);
  await page.goto('http://127.0.0.1:14720');const input=page.getByRole('textbox',{name:'Message Pi',exact:true}),summary=page.getByRole('textbox',{name:'Final summary',exact:true});await input.waitFor();
  await summary.fill('Human feedback only');await input.fill('Why keep the checkout isolated?');await page.getByRole('button',{name:'Send',exact:true}).click();await page.waitForFunction(()=>window.__questions.length===1);
  assert.equal(await input.inputValue(),'Why keep the checkout isolated?','retain input until actual acceptance');
  await page.evaluate(()=>{window.__emit({phase:'reviewing',chatting:true,conversation:[{id:'user:1',role:'user',text:'Why keep the checkout isolated?',failed:false},{id:'assistant:2',role:'assistant',text:'{"summary":"It preserves',failed:false}]});window.__accept();});
  await page.waitForFunction(()=>document.querySelector('#agent-question')?.value==='');await page.locator('[data-agent-message-id="assistant:2"]').getByText('It preserves',{exact:true}).waitFor();await page.locator('[data-agent-message-id="assistant:2"]').evaluate(el=>window.__answerNode=el);
  await page.evaluate(()=>window.__emit({phase:'complete',chatting:false,conversation:[{id:'user:1',role:'user',text:'Why keep the checkout isolated?',failed:false},{id:'assistant:2',role:'assistant',text:'{"summary":"It preserves the reviewed code.","findings":[]}',failed:false}]}));
  await page.getByText('It preserves the reviewed code.',{exact:true}).waitFor();assert.ok(await page.locator('[data-agent-message-id="assistant:2"]').evaluate(el=>el===window.__answerNode));assert.equal(await page.locator('.agent-recommendation').innerText(),'Original review recommendation');assert.equal(await summary.inputValue(),'Human feedback only');
  await input.fill('Keep this unsent question');await page.evaluate(()=>window.__reject=true);await page.getByRole('button',{name:'Send',exact:true}).click();await page.getByRole('alert').filter({hasText:'Pi rejected this question'}).waitFor();assert.equal(await input.inputValue(),'Keep this unsent question');
  await page.locator('.pr-summary').filter({hasText:'Other review'}).click();await page.waitForFunction(()=>document.querySelector('.pr-accordion-card.is-current .title')?.textContent==='Other review');assert.equal(await input.count(),0);await page.locator('.pr-summary').filter({hasText:request.title}).click();await input.waitFor();assert.equal(await input.inputValue(),'Keep this unsent question');
  await page.waitForTimeout(350);assert.ok(await page.evaluate(id=>window.__checkpoints.some(c=>c.checkpoint.data.drafts[id]?.agentQuestion==='Keep this unsent question'),request.id));
  await page.getByRole('button',{name:'Submit feedback',exact:true}).click();await page.waitForFunction(()=>window.__submits.length===1);assert.equal(await page.evaluate(()=>window.__submits[0].feedback.summary),'Human feedback only');assert.ok(!JSON.stringify(await page.evaluate(()=>window.__submits[0])).includes('unsent question'));
  await page.locator('.archive-section>summary').click();await page.locator('.archive-list .pr-summary').filter({hasText:request.title}).click();await input.waitFor();assert.equal(await input.inputValue(),'Keep this unsent question','publishing feedback must not erase an unsent agent message');
  assert.deepEqual(errors,[]);console.log('PASS native-agent UI boundary: explicit send/ack, stable streamed answer, preserved findings, isolated review drafts/checkpoint, failed-send retention and no chat in human feedback');
 }finally{await browser?.close();server.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
