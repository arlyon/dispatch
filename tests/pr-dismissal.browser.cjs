// Production App/Inbox, own-source file contents, mocked native IPC. No live PR/queue/model mutations.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {spawn,execFileSync}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto'),cwd=path.resolve(__dirname,'..');
const head=execFileSync('git',['rev-parse','HEAD'],{cwd,encoding:'utf8'}).trim(),url='https://github.com/carpe-lab/repo/pull/42';
const request={version:1,id:randomUUID(),title:'Own-source review',source:{repo:cwd,base:head,head,baseRef:'main',headRef:'feat/review-dismissal',prUrl:url},files:[{path:'src/App.tsx',status:'M',before:execFileSync('git',['show','HEAD:src/App.tsx'],{cwd,encoding:'utf8'}),after:fs.readFileSync(path.join(cwd,'src/App.tsx'),'utf8'),unavailable:null}]};
(async()=>{
 const server=spawn('pnpm',['exec','vite','--host','127.0.0.1','--port','14741','--strictPort'],{cwd,stdio:'ignore'});let browser;
 try{
  for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:14741')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1700,height:1100}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(request=>{
   let next=1,result=null,rules=[];const callbacks=new Map();window.__submits=0;window.__archives=0;window.__captures=0;window.__offset=0;
   const realNow=Date.now;Date.now=()=>realNow()+window.__offset;
   window.__source={query:'Own-source fixture',items:[42,43,44].map(number=>({url:`https://github.com/carpe-lab/repo/pull/${number}`,repo:'carpe-lab/repo',number,title:`Remote ${number}`,author:'local-test',updatedAt:'2026-10-26T00:00:00Z'})),heads:[{url:request.source.prUrl,head:request.source.head,error:null}],total:3,partial:false,polling:false,lastSuccess:1,error:null};
   window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:fn=>{const id=next++;callbacks.set(id,fn);return id;},invoke:async(command,args)=>{
    if(command==='plugin:event|listen')return next++;if(command==='plugin:event|unlisten')return;
    if(command==='desktop_bootstrap')return {checkpoint:null,review:request.id};
    if(['desktop_ready','desktop_checkpoint','desktop_checkpoint_failed','desktop_hide','desktop_quit'].includes(command))return;
    if(command==='github_source')return structuredClone(window.__source);
    if(command==='list_reviews')return [{id:request.id,title:request.title,source:request.source,fileCount:request.files.length,complete:Boolean(result),skipped:result?.status==='skipped',intakeAt:1}];
    if(command==='open_review')return request;
    if(command==='review_context')return {owner:'caller',reviewerEnabled:false,guide:'',comments:[]};
    if(command==='linked_context_state')return {attachment:null,frozen:false};
    if(command==='review_result')return result;
    if(command==='file_identities')return Object.fromEntries(request.files.map((file,i)=>[file.path,i.toString(16).padStart(64,'0')]));
    if(command==='list_review_agents')return [];
    if(command==='update_status')return {format:null,phase:'unsupported',version:null,error:null};
    if(command==='pr_dispositions')return structuredClone(rules);
    if(command==='dismiss_pr'){
     const pr=window.__source.items.find(pr=>pr.url===args.url);
     rules=rules.filter(rule=>rule.url!==args.url);
     rules.push({url:args.url,title:pr.title,head:args.action==='ignoreRevision'?(window.__source.heads.find(head=>head.url===args.url)?.head||'a'.repeat(40)):null,until:args.action==='snoozeHour'?Date.now()/1000+3600:args.action==='snoozeDay'?Date.now()/1000+86400:null});return structuredClone(rules);
    }
    if(command==='restore_pr'){rules=rules.filter(rule=>rule.url!==args.url);return structuredClone(rules);}
    if(command==='archive_review'){window.__archives++;return result={version:1,requestId:args.id,status:'skipped'};}
    if(command==='open_github_pr'){window.__captures++;throw Error('Visibility actions must never capture');}
    if(command==='submit_review'){window.__submits++;throw Error('Visibility actions must never submit');}
    throw Error('Unexpected native command '+command);
   }};
  },request);
  const card=n=>page.locator(`.inbox-card-stack [data-card-key="https://github.com/carpe-lab/repo/pull/${n}"]`);
  const action=async(n,label)=>{await card(n).getByLabel('PR actions',{exact:true}).click();await card(n).getByRole('button',{name:label,exact:true}).click();};
  await page.goto('http://127.0.0.1:14741');const summary=page.getByRole('textbox',{name:'Final summary',exact:true});await summary.waitFor();
  await summary.fill('Preserve these unsubmitted notes');
  await action(42,'Snooze for 1 hour');await page.waitForFunction(()=>!document.querySelector('.inbox-card-stack [data-card-key="https://github.com/carpe-lab/repo/pull/42"]'));
  const localSnoozed=page.locator('.hidden-pr-section').filter({hasText:'Snoozed'});await localSnoozed.locator(':scope>summary').click();await localSnoozed.getByRole('button',{name:'Restore Remote 42',exact:true}).click();await card(42).locator('.pr-summary').click();await page.waitForFunction(()=>document.querySelector('#review-summary')?.value==='Preserve these unsubmitted notes');
  assert.equal(await page.evaluate(()=>window.__archives),0,'snoozing a waiting review does not publish a result');
  await localSnoozed.locator(':scope>summary').click();
  await card(42).getByRole('button',{name:'Archive review',exact:true}).click();await page.getByText('Review archived as skipped. Unsubmitted notes are preserved in Archive.',{exact:true}).waitFor();
  assert.equal(await card(42).count(),0);assert.equal(await page.evaluate(()=>window.__archives),1);
  await page.locator('.archive-section').filter({has:page.locator('.archive-list')}).locator(':scope>summary').click();const archived=page.locator('.archive-list .pr-summary').filter({hasText:request.title});await archived.click();
  await page.getByText('Review skipped',{exact:true}).waitFor();await page.getByText('Unsubmitted notes preserved in this window',{exact:true}).click();await page.getByText('Preserve these unsubmitted notes',{exact:true}).waitFor();
  await page.evaluate(()=>window.__source.heads=[{url:'https://github.com/carpe-lab/repo/pull/42',head:'f'.repeat(40),error:null}]);await card(42).waitFor();
  await action(43,'Ignore this PR');await page.waitForFunction(()=>!document.querySelector('.inbox-card-stack [data-card-key="https://github.com/carpe-lab/repo/pull/43"]'));
  await page.evaluate(()=>window.__source.heads.push({url:'https://github.com/carpe-lab/repo/pull/43',head:'b'.repeat(40),error:null}));await page.waitForTimeout(1700);assert.equal(await card(43).count(),0);
  const ignored=page.locator('.hidden-pr-section').filter({hasText:'Ignored'});await ignored.locator(':scope>summary').click();await ignored.getByRole('button',{name:'Restore Remote 43',exact:true}).click();await card(43).waitFor();
  await action(43,'Ignore this revision');await page.waitForFunction(()=>!document.querySelector('.inbox-card-stack [data-card-key="https://github.com/carpe-lab/repo/pull/43"]'));
  await page.evaluate(()=>window.__source.heads=window.__source.heads.map(head=>head.url.endsWith('/43')?{...head,head:null,error:'offline'}:head));await page.waitForTimeout(1700);assert.equal(await card(43).count(),0);
  await page.evaluate(()=>window.__source.heads=window.__source.heads.map(head=>head.url.endsWith('/43')?{...head,head:'c'.repeat(40),error:null}:head));await card(43).waitFor();
  await action(44,'Snooze for 1 hour');await page.waitForFunction(()=>!document.querySelector('.inbox-card-stack [data-card-key="https://github.com/carpe-lab/repo/pull/44"]'));
  const snoozed=page.locator('.hidden-pr-section').filter({hasText:'Snoozed'});await snoozed.locator(':scope>summary').click();await snoozed.getByRole('button',{name:'Restore Remote 44',exact:true}).waitFor();
  await page.evaluate(()=>window.__offset=3601*1000);await card(44).waitFor();
  assert.equal(await page.evaluate(()=>window.__submits),0);assert.equal(await page.evaluate(()=>window.__captures),0);assert.deepEqual(errors,[]);
  console.log('PASS local archive/skipped without submission, preserved notes, archived revision returns only on new head; PR/revision ignores, unknown-head retention, restore list, timed snooze expiry, no capture/GitHub mutation');
 }finally{await browser?.close();server.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
