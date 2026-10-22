// Real App/Updates UI, private own-source snapshot, mocked native IPC. No installer runs.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const request=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
request.files=request.files.filter(file=>['src/App.tsx','src/types.ts'].includes(file.path));
(async()=>{
 const server=spawn('pnpm',['exec','vite','--host','127.0.0.1','--port','14739','--strictPort'],{cwd:path.resolve(__dirname,'..'),stdio:'ignore'});let browser;
 try{
  for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:14739')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1700,height:1100}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(request=>{
   let next=1;const callbacks=new Map(),listeners=new Map();window.__installs=0;window.__checks=0;window.__submits=0;
   window.__updates={format:'rpm',phase:'available',version:'0.1.2',error:null};
   window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:fn=>{const id=next++;callbacks.set(id,fn);return id;},invoke:async(command,args)=>{
    if(command==='plugin:event|listen'){listeners.set(args.event,args.handler);return next++;}if(command==='plugin:event|unlisten')return;
    if(command==='desktop_bootstrap')return {checkpoint:null,review:request.id};
    if(['desktop_ready','desktop_checkpoint','desktop_checkpoint_failed','desktop_hide','desktop_quit'].includes(command))return;
    if(command==='github_source')return {query:'fixture',items:[],heads:[],total:0,partial:false,polling:false,lastSuccess:1,error:null};
    if(command==='list_reviews')return [{id:request.id,title:request.title,source:request.source,fileCount:request.files.length,complete:false,intakeAt:1}];
    if(command==='open_review')return request;
    if(command==='review_context')return {owner:'caller',reviewerEnabled:false,guide:'',comments:[]};
    if(command==='linked_context_state')return {attachment:null,frozen:false};
    if(command==='review_result')return null;
    if(command==='file_identities')return Object.fromEntries(request.files.map((file,i)=>[file.path,i.toString(16).padStart(64,'0')]));
    if(command==='list_review_agents')return [];
    if(command==='update_status')return structuredClone(window.__updates);
    if(command==='check_updates'){window.__checks++;return structuredClone(window.__updates);}
    if(command==='install_update'){window.__installs++;window.__updates.phase='downloading';return;}
    if(command==='submit_review'){window.__submits++;throw Error('Must never submit from updater');}
    throw Error('Unexpected native command '+command);
   }};
  },request);
  await page.goto('http://127.0.0.1:14739');const summary=page.getByRole('textbox',{name:'Final summary',exact:true});await summary.waitFor();
  await page.locator('.update-control > summary').click();await page.getByRole('region',{name:'Application updates'}).waitFor();
  const install=page.getByRole('button',{name:'Install & restart',exact:true});await install.waitFor();assert.ok(await install.isEnabled());
  await summary.fill('An unfinished human review');assert.ok(await install.isDisabled());assert.equal(await page.evaluate(()=>window.__installs),0);
  await summary.fill('');await page.getByRole('button',{name:'Check now',exact:true}).click();assert.equal(await page.evaluate(()=>window.__checks),1);
  await install.click();await page.getByText('Downloading and verifying the update…',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.__installs),1);assert.equal(await page.evaluate(()=>window.__submits),0);
  await page.keyboard.press('Escape');assert.equal(await page.locator('.update-control').evaluate(element=>element.open),false);
  assert.deepEqual(errors,[]);console.log('PASS production updater UI: RPM format, explicit install, human-draft guard, check, download state, Escape focus; no submit or real installer');
 }finally{await browser?.close();server.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
