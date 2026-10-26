// Production UI, private own-source snapshot and mocked IPC. No live queue/model/API.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const request=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const cwd=path.resolve(__dirname,'..'),port=process.env.DISPATCH_TEST_PORT||'14728',origin=`http://127.0.0.1:${port}`;
(async()=>{
 const server=spawn('pnpm',['exec','vite','--host','127.0.0.1','--port',port,'--strictPort'],{cwd,stdio:'ignore'});let browser;
 try {
  for(let i=0;i<100;i++){try{if((await fetch(origin)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1700,height:1100}}),errors=[],remote=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://**',route=>{remote.push(route.request().url());return route.abort();});
  await page.addInitScript(request=>{
   const callbacks=new Map(),listeners=new Map();let next=1;
   const other={...request,id:crypto.randomUUID(),title:'Other own-source snapshot'};
   window.__attach=[];window.__submitted=[];window.__failAttach=true;window.__frozen=false;
   const state=()=>({attachment:window.__attachment||null,frozen:window.__frozen});
   window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:cb=>{const id=next++;callbacks.set(id,cb);return id;},invoke:async(command,args)=>{
    if(command==='plugin:event|listen'){listeners.set(args.event,args.handler);return next++;}
    if(command==='plugin:event|unlisten')return;
    if(command==='pr_dispositions')return [];
    if(command==='github_source')return {query:'Private fixture',items:[],heads:[],total:0,partial:false,polling:false,lastSuccess:1,error:null};
    if(command==='desktop_bootstrap')return {checkpoint:null,review:null};
    if(['desktop_ready','desktop_checkpoint','desktop_hide','desktop_quit'].includes(command))return;
    if(command==='list_reviews')return [request,other].map(r=>({id:r.id,title:r.title,source:r.source,fileCount:r.files.length,complete:false}));
    if(command==='open_review')return args.id===other.id?other:request;
    if(command==='review_result')return null;
    if(command==='review_context')return {owner:'caller',reviewerEnabled:false,guide:'',comments:[]};
    if(command==='file_identities')return Object.fromEntries(request.files.map((f,i)=>[f.path,i.toString(16).padStart(64,'0')]));
    if(command==='list_review_agents')return [];
    if(command==='linked_context_state')return args.id===other.id?{attachment:null,frozen:true}:state();
    if(command==='attach_linked_context'){
     window.__attach.push(args);if(window.__failAttach){window.__failAttach=false;throw Error('Missing DISPATCH_LINEAR_API_KEY in desktop launch environment');}
     window.__attachment={requestId:args.id,head:request.source.head,capturedAt:123,sources:[{provider:'Linear',url:args.urls[0],sourceId:'DSP-8',version:'2026-07-17',title:'Issue requirements',text:'<script>window.__injected=true</script>\n![remote](https://evil.example/image.png)',truncated:true},{provider:'Confluence',url:args.urls[1],sourceId:'12',version:'7',title:'Page context',text:'<ac:structured-macro>reference DATA</ac:structured-macro>',truncated:false}]};return state();
    }
    if(command==='submit_review'){window.__submitted.push(args);return {version:1,requestId:args.id,status:'complete',feedback:args.feedback};}
    throw Error('Unexpected native command: '+command);
   }};
  },request);
  await page.goto(origin);await page.getByRole('button',{name:'Quiz me',exact:true}).waitFor();
  const panel=page.getByRole('region',{name:'Linked issue and page context'});
  await panel.locator('summary').first().click();
  const input=panel.getByRole('textbox',{name:'Linked context URLs'}),urls='https://linear.app/dispatch/issue/DSP-8/context\nhttps://docs.example/wiki/spaces/D/pages/12/X';
  await input.fill(urls);
  const summary=page.getByRole('textbox',{name:'Final summary'});await summary.fill('My unsent human summary');
  await panel.getByRole('button',{name:'Fetch & attach context'}).click();
  await panel.getByRole('status').filter({hasText:'Missing DISPATCH_LINEAR_API_KEY'}).waitFor();
  assert.equal(await input.inputValue(),urls);assert.equal(await summary.inputValue(),'My unsent human summary');
  await panel.getByRole('button',{name:'Fetch & attach context'}).click();
  await panel.getByText('Linear: Issue requirements',{exact:true}).waitFor();await panel.getByText('Confluence: Page context',{exact:true}).waitFor();
  assert.match(await panel.innerText(),/TRUNCATED/);assert.match(await panel.innerText(),new RegExp(request.source.head.slice(0,7)));
  await panel.getByText('Captured source text',{exact:true}).first().click();
  assert.match(await panel.locator('pre').first().innerText(),/<script>/);
  assert.equal(await panel.locator('script,img,iframe').count(),0);assert.equal(await page.evaluate(()=>Boolean(window.__injected)),false);
  assert.equal(await summary.inputValue(),'My unsent human summary');assert.deepEqual(remote,[]);
  assert.deepEqual(await page.evaluate(()=>window.__attach.map(a=>a.urls)),[urls.split('\n'),urls.split('\n')]);
  assert.deepEqual(await page.evaluate(()=>window.__submitted),[]);
  // Captured sources remain readable, but the batch cannot be replaced.
  assert.equal(await panel.getByRole('button',{name:'Fetch & attach context'}).count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: production UI batch attach, missing-auth retry, provenance/truncation, literal untrusted content, no remote loads and human-draft/result isolation');
 } finally {await browser?.close();server.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
