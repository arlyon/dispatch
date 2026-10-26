// Production source cache presentation with own-source review and mocked native IPC.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const request=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
(async()=>{
 const server=spawn('pnpm',['exec','vite','--host','127.0.0.1','--port','14692','--strictPort'],{cwd:path.resolve(__dirname,'..'),stdio:'ignore'});let browser;
 try{
  for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:14692')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1700,height:1100}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(request=>{
   let next=1;window.__work=[];
   window.__source={query:'is:pr is:open -author:arlyon review:required -draft:true org:carpe-lab org:theadspend',items:[],heads:[],total:null,partial:false,polling:true,lastSuccess:null,error:null};
   window.__pr={url:'https://github.com/carpe-lab/repo/pull/42',repo:'carpe-lab/repo',number:42,title:'Discovered change',author:'someone',updatedAt:'2026-10-22T00:00:00Z'};
   window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>next++,invoke:async(command,args)=>{
    if(command==='plugin:event|listen')return next++;if(command==='plugin:event|unlisten')return;
    if(command==='desktop_bootstrap')return {checkpoint:null,review:null};
    if(['desktop_ready','desktop_checkpoint','desktop_checkpoint_failed','desktop_hide','desktop_quit'].includes(command))return;
    if(command==='pr_dispositions')return [];
    if(command==='github_source')return structuredClone(window.__source);
    if(command==='list_reviews')return [{...request,fileCount:request.files.length,complete:false,intakeAt:1}];
    if(command==='open_review')return request;if(command==='review_result')return null;
    if(command==='review_context')return {owner:'caller',reviewerEnabled:false,guide:'Own-source context',comments:[]};
    if(command==='file_identities')return Object.fromEntries(request.files.map((f,i)=>[f.path,i.toString(16).padStart(64,'0')]));
    if(command==='list_review_agents')return [];
    if(['start_review_agent','open_github_pr','submit_review'].includes(command)){window.__work.push({command,args});throw Error('Unexpected automatic work');}
    throw Error('Unexpected command '+command);
   }};
  },request);
  await page.goto('http://127.0.0.1:14692');const summary=page.getByRole('textbox',{name:'Final summary',exact:true});await summary.waitFor();
  const headers=page.locator('.inbox-scroll > .source-divider, .remote-divider, .archive-section > summary');
  assert.equal(await headers.count(),3);
  const styles=await headers.evaluateAll(nodes=>nodes.map(node=>{const css=getComputedStyle(node);return {font:css.fontSize,weight:css.fontWeight,color:css.color,padding:css.padding,left:node.getBoundingClientRect().left};}));
  assert.deepEqual(styles[0],styles[1]);assert.deepEqual(styles[1],styles[2]);
  const archive=page.locator('.archive-section');await archive.locator('summary').click();assert.equal(await archive.getAttribute('open'),'');await archive.locator('summary').click();assert.equal(await archive.getAttribute('open'),null);
  assert.equal(await page.locator('.remote-divider > .count').innerText(),'…');await summary.fill('Typing stays with the selected immutable review');await summary.evaluate(el=>{window.__input=el;el.setSelectionRange(6,6);});
  await page.evaluate(()=>window.__source={...window.__source,items:[window.__pr],total:1,polling:false,lastSuccess:1});await page.getByRole('button',{name:'Open carpe-lab/repo #42',exact:true}).waitFor();
  assert.ok(await summary.evaluate(el=>el===window.__input&&document.activeElement===el&&el.selectionStart===6));assert.equal(await page.locator('.remote-divider > .count').innerText(),'1');
  await page.getByLabel('Remote source details',{exact:true}).click();assert.equal(await page.locator('.source-details code').innerText(),'is:pr is:open -author:arlyon review:required -draft:true org:carpe-lab org:theadspend');await page.getByLabel('Remote source details',{exact:true}).click();
  const remote=page.locator('.inbox-card-stack [data-card-key="https://github.com/carpe-lab/repo/pull/42"]');await remote.evaluate(el=>window.__card=el);
  await page.evaluate(()=>window.__source={...window.__source,error:'network error; previous results retained',items:[{...window.__pr,title:'Updated discovery metadata'}]});await page.locator('.source-details [role=status]').filter({hasText:'Stale'}).waitFor();assert.equal(await page.locator('.remote-divider > .count').innerText(),'1');assert.ok(await remote.evaluate(el=>el===window.__card));assert.equal(await summary.inputValue(),'Typing stays with the selected immutable review');
  await page.evaluate(()=>window.__source={...window.__source,error:null,total:0,items:[],partial:false});await page.waitForFunction(()=>document.querySelector('.remote-divider > .count')?.textContent==='0');assert.equal(await remote.count(),0);assert.equal(await summary.inputValue(),'Typing stays with the selected immutable review');
  await page.evaluate(()=>window.__source={...window.__source,total:0,partial:true});await page.locator('.source-details [role=status]').filter({hasText:'Partial results'}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.__work),[]);assert.deepEqual(errors,[]);console.log('PASS production source unknown/count/query/stale/zero/partial states, stable keyed cards and selected input/caret; no automatic capture/model/publication');
 }finally{await browser?.close();server.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
