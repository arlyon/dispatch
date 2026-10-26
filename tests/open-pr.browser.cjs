// Production App with own-source contents and mocked IPC; never opens a real browser URL.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {spawn,execFileSync}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const cwd=path.resolve(__dirname,'..');
const head=execFileSync('git',['rev-parse','HEAD'],{cwd,encoding:'utf8'}).trim();
const request={version:1,id:randomUUID(),title:'Own-source GitHub review',source:{repo:cwd,base:head,head,baseRef:'main',headRef:'feat/open-pr-button',prUrl:'https://github.com/arlyon/dispatch/pull/42'},files:[{path:'src/components/ChangeContext.tsx',status:'M',before:execFileSync('git',['show','HEAD:src/components/ChangeContext.tsx'],{cwd,encoding:'utf8'}),after:fs.readFileSync(path.join(cwd,'src/components/ChangeContext.tsx'),'utf8'),unavailable:null}]};
(async()=>{
 const server=spawn('pnpm',['exec','vite','--host','127.0.0.1','--port','14740','--strictPort'],{cwd,stdio:'ignore'});let browser;
 try{
  for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:14740')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1700,height:1100}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(request=>{
   let next=1;const local={...request,id:'local-review',title:'Own-source local review',source:{...request.source,prUrl:undefined}};
   window.__opens=[];window.__submits=0;window.__failOpen=false;
   window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>next++,invoke:async(command,args)=>{
    if(command==='plugin:event|listen')return next++;if(command==='plugin:event|unlisten')return;
    if(command==='desktop_bootstrap')return {checkpoint:null,review:request.id};
    if(['desktop_ready','desktop_checkpoint','desktop_checkpoint_failed','desktop_hide','desktop_quit'].includes(command))return;
    if(command==='pr_dispositions')return [];
    if(command==='github_source')return {query:'fixture',items:[],heads:[],total:0,partial:false,polling:false,lastSuccess:1,error:null};
    if(command==='list_reviews')return [request,local].map(r=>({id:r.id,title:r.title,source:r.source,fileCount:r.files.length,complete:false}));
    if(command==='open_review')return args.id===request.id?request:local;
    if(command==='review_context')return {owner:'caller',reviewerEnabled:false,guide:'',comments:[]};
    if(command==='linked_context_state')return {attachment:null,frozen:false};
    if(command==='review_result')return null;
    if(command==='file_identities')return Object.fromEntries(request.files.map((file,i)=>[file.path,i.toString(16).padStart(64,'0')]));
    if(command==='list_review_agents')return [];
    if(command==='update_status')return {format:null,phase:'unsupported',version:null,error:null};
    if(command==='open_pr_in_browser'){window.__opens.push(args);if(window.__failOpen)throw Error('Browser unavailable');return;}
    if(command==='submit_review'){window.__submits++;throw Error('Opening a PR must never submit');}
    throw Error('Unexpected native command '+command);
   }};
  },request);
  await page.goto('http://127.0.0.1:14740');const button=page.getByRole('button',{name:'Open PR',exact:true}),summary=page.getByRole('textbox',{name:'Final summary',exact:true});await button.waitFor();
  assert.ok((await button.getAttribute('title')).includes(request.source.prUrl));
  await summary.fill('Keep my unfinished feedback');await button.focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>window.__opens.length===1);
  assert.deepEqual(await page.evaluate(()=>window.__opens[0]),{id:request.id});assert.equal(await summary.inputValue(),'Keep my unfinished feedback');
  await page.evaluate(()=>window.__failOpen=true);await button.click();await page.getByRole('alert').filter({hasText:/Cannot open PR: .*Browser unavailable/}).first().waitFor();assert.equal(await summary.inputValue(),'Keep my unfinished feedback');
  await page.locator('.pr-summary').filter({hasText:'Own-source local review'}).click();await page.waitForFunction(()=>document.querySelector('.pr-accordion-card.is-current .title')?.textContent==='Own-source local review');assert.equal(await button.count(),0);
  await page.locator('.pr-summary').filter({hasText:request.title}).click();await button.waitFor();assert.equal(await summary.inputValue(),'Keep my unfinished feedback');
  assert.equal(await page.evaluate(()=>window.__submits),0);assert.deepEqual(errors,[]);
  console.log('PASS Open PR: GitHub-only header control, keyboard activation, review identity IPC, visible opener failures, local-only hiding, preserved drafts, no feedback submission');
 }finally{await browser?.close();server.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
