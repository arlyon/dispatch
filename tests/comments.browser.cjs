// Real own-source snapshot; browser/native IPC is mocked. No live review or Pi session is created.
// Run through mise; PLAYWRIGHT_MODULE may point at an existing Playwright install.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const assert = require("node:assert/strict");
const cwd = path.resolve(__dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-comments-"));
fs.chmodSync(temporary, 0o700);
const binary = path.join(process.env.CARGO_TARGET_DIR || path.join(cwd, "target"), "debug/dispatch-review");
const request = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2],"utf8")) : JSON.parse(execFileSync(binary, [cwd, "main", "HEAD"], {
  env: { ...process.env, DISPATCH_REVIEW_DIR: temporary, DISPATCH_BIN: path.join(temporary, "no-native-gui") }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
}));
const requests = [request, { ...request, id: randomUUID(), title: "Other own-source snapshot" }];

(async () => {
  const server = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", "14689", "--strictPort"], { cwd, stdio: "ignore" });
  let browser;
  try {
    for (let n = 0; n < 100; n++) {
      try { if ((await fetch("http://127.0.0.1:14689")).ok) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
    const waitForJump=async()=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.waitForFunction(()=>!document.querySelector('.workspace')?.hasAttribute('data-comment-navigation'),{},{timeout:6500});await page.waitForTimeout(150);};
    const errors = [],remoteReferrers=[];
    await page.route('https://invalid.test/**',route=>{remoteReferrers.push(route.request().headers().referer||'');return route.fulfill({status:200,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jKFkAAAAASUVORK5CYII=','base64')});});
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(requests => {
      const results = {}, starts = {};
      window.__submitted = []; window.__calls = []; window.__attempts = 0;window.__images=[];
      window.__scrollWrites=[];const scrollTo=Element.prototype.scrollTo;Element.prototype.scrollTo=function(...args){if(this.classList?.contains('workspace'))window.__scrollWrites.push({time:performance.now(),behavior:args[0]?.behavior||'auto',from:this.scrollTop,top:args[0]?.top});return scrollTo.apply(this,args);};
      window.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
        transformCallback: () => 1,
        invoke: async (command, args) => {
          window.__calls.push({ command, id: args?.id });
          if (command === "list_reviews") return requests.map(r => ({ id: r.id, title: r.title, source: r.source, fileCount: r.files.length, complete: !!results[r.id] }));
          if (command === "open_review") return requests.find(r => r.id === args.id);
          if (command === "review_result") return results[args.id] || null;
          if (command === "review_context") return {
            owner: args.id === requests[0].id ? "caller" : "app", reviewerEnabled: false,
            guide: "# Review guide\n\n**What works:** immutable snapshots.\n\n- Test comments\n- Test Archive\n\n![Remote preview](https://invalid.test/image.png)\n\n<img src='https://invalid.test/tracker' onerror='alert(1)'><script>alert(1)</script>",
            comments: args.id === requests[0].id ? [...[2,12].map(line=>({ path: "src/App.tsx", side: "new", line, body: "Opening agent comment; never submitted as human feedback."+(line===12?'\n\n'+Array(40).fill('Scrollable thread detail.').join('\n'):'') })),...[2,10,20].map(line=>({path:'src/Diff.tsx',side:'new',line,body:'Upcoming comment for navigation peek.'}))] : [],
          };
          if (command === "file_identities") {
            await new Promise(resolve => setTimeout(resolve, 1800));
            return Object.fromEntries(requests.find(r => r.id === args.id).files.map((file, index) => [file.path, index.toString(16).padStart(64, "0")]));
          }
          if(command==='save_attachment'){window.__images.push(args);await new Promise(resolve=>setTimeout(resolve,80));return {path:`/browser/Application Support/reviews/${args.id}/attachments/00000000-0000-4000-8000-000000000001.png`,name:'00000000-0000-4000-8000-000000000001.png'};}
          if(command==='read_attachment'){return {mime:'image/png',bytes:Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jKFkAAAAASUVORK5CYII='),char=>char.charCodeAt(0))};}
          if (command === "desktop_bootstrap") return { checkpoint: null, review: null };
          if (["desktop_ready", "desktop_checkpoint", "desktop_hide", "desktop_quit", "desktop_checkpoint_failed"].includes(command)) return;
          if (command === "list_review_agents") return [];
          if (command === "start_review_agent") {
            starts[args.id] = (starts[args.id] || 0) + 1;
            return { requestId: args.id, phase: "complete", sequence: starts[args.id], text: JSON.stringify({ summary: "Browser-only report", findings: [] }), error: null, files: [], omitted: 0, sessionPath: "/browser-only" };
          }
          if (command === "submit_review") {
            window.__attempts++;
            if (window.__attempts === 1) throw Error("Simulated disk failure; feedback retained");
            await new Promise(resolve => setTimeout(resolve, 900));
            window.__submitted.push(args);
            return results[args.id] = { version: 1, requestId: args.id, status: "complete", feedback: args.feedback };
          }
          if (command === "plugin:window|close") return;
          if (command === "plugin:event|listen") return 1;
          if (command === "plugin:event|unlisten") return;
          throw Error(`Unexpected native call: ${command}`);
        },
      };
    }, requests);
    await page.goto("http://127.0.0.1:14689");
    await page.getByLabel("Filter files", { exact: true }).waitFor();
    const windowConfig=JSON.parse(fs.readFileSync(path.join(cwd,'src-tauri/tauri.conf.json'),'utf8')).app.windows[0];assert.equal(windowConfig.titleBarStyle,'Overlay');assert.equal(windowConfig.hiddenTitle,true);assert.deepEqual(windowConfig.trafficLightPosition,{x:12,y:24});
    assert.ok(JSON.parse(fs.readFileSync(path.join(cwd,'src-tauri/capabilities/default.json'),'utf8')).permissions.includes('core:window:allow-start-dragging'));
    assert.equal(await page.locator('.topbar[data-tauri-drag-region]').count(),1);assert.equal(await page.getByLabel('Comment placement',{exact:true}).inputValue(),'auto');
    if(await page.locator('.topbar.macos-titlebar').count())assert.ok((await page.getByRole('button',{name:'Toggle inbox',exact:true}).boundingBox()).x>=84,'native traffic-light area is reserved');
    assert.equal(await page.locator('.review-guide-context .markdown-body h1').innerText(),'Review guide');
    assert.equal(await page.locator('.review-guide-context .markdown-body script').count(),0,'active HTML blocked');
    assert.equal(await page.locator('.review-guide-context .markdown-body img').count(),2,'HTTPS images render inline');
    await page.waitForFunction(()=>[...document.querySelectorAll('.review-guide-context img')].every(img=>img.complete&&img.naturalWidth>0));
    assert.ok(await page.locator('.review-guide-context img').evaluateAll(images=>images.every(img=>img.getAttribute('referrerpolicy')==='no-referrer'&&!img.hasAttribute('onerror'))));
    assert.ok(remoteReferrers.every(value=>!value),'remote image requests do not leak the review URL');
    const disclosure=page.locator('.review-guide-context .disclosure-toggle');await disclosure.click();assert.equal(await disclosure.getAttribute('aria-expanded'),'false');await disclosure.click();
    assert.equal(await page.evaluate(() => window.__calls.filter(c => c.command === "start_review_agent").length), 0, "caller-owned does not auto-start Pi");
    await page.evaluate(()=>{window.__scrollWrites=[];window.__jumpFrames=[];window.__profilingJump=true;let last=performance.now();function frame(now){window.__jumpFrames.push(now-last);last=now;if(window.__profilingJump)requestAnimationFrame(frame);}requestAnimationFrame(frame);});
    const startScroll=await page.locator('.workspace').evaluate(el=>el.scrollTop);
    await page.locator('.conversation').getByRole("button", { name: "Go to src/App.tsx:2", exact: true }).click();
    await page.waitForTimeout(100);
    const midScroll=await page.locator('.workspace').evaluate(el=>el.scrollTop);
    await waitForJump();
    const endScroll=await page.locator('.workspace').evaluate(el=>el.scrollTop);
    assert.ok(midScroll!==startScroll&&midScroll!==endScroll,'jump has intermediate smooth motion, not an instant flash');
    const jumpWrites=await page.evaluate(()=>{window.__profilingJump=false;return window.__scrollWrites;});const jumpFrames=await page.evaluate(()=>window.__jumpFrames.slice(1).sort((a,b)=>a-b));console.log('Comment jump profile',{commands:jumpWrites.map(write=>({behavior:write.behavior,delta:Math.round(write.top-write.from)})),frames:jumpFrames.length,p95:jumpFrames[Math.floor(jumpFrames.length*.95)],max:jumpFrames.at(-1)});assert.ok(jumpWrites.filter(write=>write.behavior==='smooth').length>=1&&jumpWrites.length<=3,'one native animation plus at most two alignment passes, not a per-frame JS loop');assert.equal(jumpWrites.filter(write=>write.behavior==='instant').length,0,'even virtual-layout corrections animate, with no final instant jump');
    const file = page.locator('.diff-layout[data-file-path="src/App.tsx"]');
    const bounds = await file.locator(".cm-activeLine").evaluate(element => {
      const row = element.getBoundingClientRect(), viewport = element.closest(".workspace").getBoundingClientRect();
      return { row: row.top, bottom: row.bottom, top: viewport.top, end: viewport.bottom };
    });
    console.log('Source jump bounds',bounds);
    assert.ok(bounds.row >= bounds.top && bounds.bottom <= bounds.end, "actual target row is on screen, not just sidebar selection");
    assert.ok(await file.locator(".cm-comment-line").count(), "opening-agent comment has a line marker");
    await page.locator('.tree-file[title="src/App.tsx"] .tree-findings').waitFor();
    assert.ok(await page.locator('.diff-layout.has-gutter').count() > 1, "wide gutter reserved even without comments");

    await page.locator('.conversation').getByRole('button',{name:'Go to src/Diff.tsx:20',exact:true}).click();await page.waitForTimeout(80);
    assert.ok(await page.locator('.workspace').getAttribute('data-comment-navigation'),'native jump is active before interruption');
    await page.locator('.workspace').dispatchEvent('wheel',{deltaY:0});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const interrupted=await page.locator('.workspace').evaluate(el=>el.scrollTop);await page.waitForTimeout(300);assert.equal(await page.locator('.workspace').getAttribute('data-comment-navigation'),null);const afterInterrupt=await page.locator('.workspace').evaluate(el=>el.scrollTop);assert.ok(Math.abs(afterInterrupt-interrupted)<2,'manual wheel stops native animation and prevents late corrections');
    await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>window.__scrollWrites=[]);await page.locator('.conversation').getByRole('button',{name:'Go to src/App.tsx:2',exact:true}).click();await waitForJump();assert.equal(await page.evaluate(()=>window.__scrollWrites.filter(write=>write.behavior==='smooth').length),0,'reduced motion uses no animated scroll');await page.emulateMedia({reducedMotion:'no-preference'});

    // A real modified diff may fold this unchanged line. Jumping to its
    // existing comment must unfold it before composing at the same anchor.
    await page.locator('.conversation').getByRole("button", { name: "Go to src/App.tsx:12", exact: true }).click();
    await waitForJump();
    await page.getByLabel('Comment placement',{exact:true}).selectOption('inline');await page.waitForTimeout(250);
    assert.equal(await page.locator('.floating-gutter-thread').count(),0,'wide inline override removes gutter cards');
    const inlineThread=file.locator('.inline-reveal[data-inline-thread=\'["src/App.tsx","new",12]\']');
    const inlineHint=file.getByRole('button',{name:'Toggle comment thread on new line 12',exact:true});
    assert.equal(await inlineHint.getAttribute('aria-expanded'),'true','sidebar jump opens the same inline thread');
    await inlineHint.click();await page.waitForTimeout(250);assert.ok((await inlineThread.boundingBox()).height<1,'hint collapses thread without code spacing');
    const beforeInlineScroll=await page.locator('.workspace').evaluate(el=>el.scrollTop),belowBefore=await file.locator('.cm-lineNumbers .cm-gutterElement').filter({hasText:/^13$/}).last().boundingBox();
    const anchorBefore=await file.locator('.cm-lineNumbers .cm-gutterElement').filter({hasText:/^12$/}).last().boundingBox();assert.ok(Math.abs(belowBefore.y-anchorBefore.y-anchorBefore.height)<1,'closed inline thread reserves no blank source row');
    await inlineHint.click();await page.waitForTimeout(60);const growing=(await inlineThread.boundingBox()).height;await page.waitForTimeout(220);const expanded=(await inlineThread.boundingBox()).height;assert.ok(growing>0&&growing<expanded,'inline thread slides open, pushing code down');
    const belowAfter=await file.locator('.cm-lineNumbers .cm-gutterElement').filter({hasText:/^13$/}).last().boundingBox();const afterInlineScroll=await page.locator('.workspace').evaluate(el=>el.scrollTop);assert.ok(belowAfter.y+afterInlineScroll-belowBefore.y-beforeInlineScroll>=expanded-2,'inline content pushes following source rows down rather than covering them');
    await file.locator('.cm-lineNumbers .cm-gutterElement').filter({hasText:/^12$/}).last().click();await page.waitForTimeout(250);
    const inlineInput=page.getByRole('textbox',{name:'Line comment',exact:true});assert.ok(await inlineInput.evaluate(el=>document.activeElement===el&&Boolean(el.closest('.inline-thread-widget'))),'clicking source automatically focuses sliding inline composer');
    await page.keyboard.type('Temporary inline draft.');await page.waitForTimeout(1500);assert.equal(await inlineInput.inputValue(),'Temporary inline draft.');
    const inlineSave=await page.getByRole('button',{name:'Save reply',exact:true}).boundingBox(),inlineViewport=await page.locator('.workspace').boundingBox();assert.ok(inlineSave.x+inlineSave.width<=inlineViewport.x+inlineViewport.width,'inline actions stay in visible code width, not the longest source line width');
    await page.screenshot({path:path.join(os.tmpdir(),'dispatch-inline-wide.png')});
    await page.getByLabel('Comment placement',{exact:true}).selectOption('auto');await page.waitForTimeout(250);assert.equal(await inlineInput.inputValue(),'Temporary inline draft.','override/layout change preserves draft');
    await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('button',{name:'Discard',exact:true}).click();
    await page.locator('.conversation').getByRole('button',{name:'Go to src/App.tsx:12',exact:true}).click();await waitForJump();
    const peek=page.getByRole('button',{name:'Next comment: src/Diff.tsx:2',exact:true});await peek.waitFor({state:'visible'});
    const pinnedMotion=await peek.evaluate(el=>{const workspace=document.querySelector('.workspace'),top=el.getBoundingClientRect().top;workspace.scrollTop+=16;return el.getBoundingClientRect().top-top;});
    assert.equal(pinnedMotion,0,'viewport-pinned peek must not counter-scroll before JS catches up');
    await page.waitForTimeout(100);
    assert.deepEqual(await peek.locator('.source-thread').evaluate(el=>{const s=getComputedStyle(el);return [s.borderTopLeftRadius,s.borderTopRightRadius,s.borderBottomRightRadius,s.borderBottomLeftRadius];}),['6px','6px','0px','0px'],'bottom peek rounds only its upper edge');
    await peek.evaluate(el=>window.__nextCard=el);
    await peek.click({position:{x:24,y:12}});await waitForJump();
    assert.equal(await page.evaluate(()=>window.__nextCard===document.querySelector('.floating-gutter-thread[data-thread=\'["src/Diff.tsx","new",2]\']')),true,'peek and full view are the same real card node');
    const nextBounds=await page.locator('.diff-layout[data-file-path="src/Diff.tsx"] .cm-activeLine').boundingBox();assert.ok(nextBounds.y>=48&&nextBounds.y<1072,'peek jumps to upcoming source comment');
    await page.locator('.conversation').getByRole('button',{name:'Go to src/App.tsx:12',exact:true}).click();await waitForJump();
    const previousPeek=page.getByRole('button',{name:'Previous comment: src/App.tsx:2',exact:true});await previousPeek.waitFor({state:'visible'});
    const headingStyle=el=>{const s=getComputedStyle(el);return {padding:s.padding,font:s.font,minHeight:s.minHeight};};
    assert.deepEqual(await previousPeek.locator('.thread-heading').evaluate(headingStyle),await page.locator('.floating-gutter-thread .comment-thread[data-thread-line="12"]>.thread-heading').evaluate(headingStyle),'peek uses the actual card heading');
    const previousShape=await previousPeek.evaluate(el=>{const heading=el.querySelector('.thread-heading'),root=el.getBoundingClientRect(),h=heading.getBoundingClientRect();return {offset:h.top-root.top,transform:getComputedStyle(heading).transform,clip:el.style.clipPath};});
    const peekEdge=await previousPeek.evaluate(el=>{const s=getComputedStyle(el,'::after');return {bottom:s.bottom,cut:getComputedStyle(el).getPropertyValue('--peek-cut'),border:s.borderBottomWidth,style:s.borderBottomStyle,radius:s.borderBottomLeftRadius,pointer:s.pointerEvents};});assert.equal(peekEdge.border,'1px','upper peek has a visible bottom border at its clipped edge');assert.equal(peekEdge.style,'solid');assert.ok(Math.abs(parseFloat(peekEdge.bottom)-parseFloat(peekEdge.cut))<.01,'bottom border follows the actual clip edge, not the hidden full-card bottom');assert.equal(peekEdge.radius,'6px');assert.equal(peekEdge.pointer,'none');
    assert.ok(Math.abs(previousShape.offset-1)<1,'previous peek shows its genuine rounded card top');assert.equal(previousShape.transform,'none');assert.match(previousShape.clip,/round 0px 0px 6px 6px/);
    assert.deepEqual(await previousPeek.locator('.source-thread').evaluate(el=>{const s=getComputedStyle(el);return [s.borderTopLeftRadius,s.borderTopRightRadius,s.borderBottomRightRadius,s.borderBottomLeftRadius];}),['0px','0px','6px','6px'],'upper peek mirrors bottom: square viewport edge, rounded below');
    await page.screenshot({path:path.join(os.tmpdir(),'dispatch-upper-real-card.png')});
    const previousMotion=await previousPeek.evaluate(el=>{const workspace=document.querySelector('.workspace'),top=el.getBoundingClientRect().top;workspace.scrollTop+=8;return el.getBoundingClientRect().top-top;});assert.equal(previousMotion,0,'previous peek remains pinned before JS runs');await page.waitForTimeout(150);
    await previousPeek.click({position:{x:24,y:12}});await waitForJump();
    await page.locator('.conversation').getByRole('button',{name:'Go to src/App.tsx:12',exact:true}).click();await waitForJump();
    const scrollBody=page.locator('.floating-gutter-thread .comment-thread[data-thread-line="12"] .thread-body').first();
    assert.equal(await page.getByLabel('Peek stack',{exact:true}).inputValue(),'1','one actual peek per edge by default');
    assert.equal(await page.locator('.edge-comment-peek').count(),0,'no fake preview card DOM');
    assert.equal(await page.locator('.floating-gutter-thread[data-peeking="next"]').count(),1);
    await page.getByLabel('Peek stack',{exact:true}).selectOption('2');await page.waitForTimeout(250);
    const realStack=page.locator('.floating-gutter-thread[data-peeking="next"]');assert.equal(await realStack.count(),2,'stack control reveals more real cards');
    const stackRects=await realStack.evaluateAll(nodes=>nodes.map(node=>({top:node.getBoundingClientRect().top,z:Number(node.style.zIndex)})));
    assert.ok(Math.abs(stackRects[1].top-stackRects[0].top-30)<2&&stackRects[1].z>stackRects[0].z,'later real card overlaps below the preceding header');
    const viewportBottom=await page.locator('.workspace').evaluate(el=>el.getBoundingClientRect().bottom);assert.ok(Math.abs(stackRects[1].top+30-viewportBottom)<1,'last peek is flush with the viewport edge, no padding gap');
    assert.equal(await page.locator('.floating-gutter-thread').count(),5,'stack setting creates no duplicate cards');
    await page.screenshot({path:path.join(os.tmpdir(),'dispatch-real-card-stack.png')});
    await page.getByLabel('Peek stack',{exact:true}).selectOption('1');await page.waitForTimeout(250);
    const nativeMotion=await page.evaluate(()=>{const workspace=document.querySelector('.workspace'),card=[...document.querySelectorAll('.floating-gutter-thread')].find(n=>n.dataset.thread==='["src/App.tsx","new",12]'),row=[...document.querySelectorAll('.diff-layout[data-file-path="src/App.tsx"] .cm-lineNumbers .cm-gutterElement')].filter(n=>n.textContent==='12').at(-1);const a=card.getBoundingClientRect().top,r=row.getBoundingClientRect().top;workspace.scrollTop+=16;return {card:card.getBoundingClientRect().top-a,row:row.getBoundingClientRect().top-r,position:getComputedStyle(card).position,transition:getComputedStyle(card).transitionDuration};});
    assert.equal(nativeMotion.card,nativeMotion.row,'card follows source synchronously before any JS scroll callback');assert.equal(nativeMotion.card,-16);assert.equal(nativeMotion.position,'absolute');assert.equal(nativeMotion.transition,'0s');
    await page.waitForTimeout(150);
    await peek.evaluate(el=>{window.__pinnedStyleWrites=0;window.__pinnedStyleObserver=new MutationObserver(records=>window.__pinnedStyleWrites+=records.length);window.__pinnedStyleObserver.observe(el,{attributes:true,attributeFilter:['style']});});
    const documentTops=[];
    for(let n=0;n<12;n++){await page.locator('.workspace').evaluate(el=>el.scrollTop+=1.25);await page.waitForTimeout(20);documentTops.push(await page.locator('.floating-gutter-thread[data-thread=\'["src/App.tsx","new",12]\']').evaluate(el=>el.style.top));}
    assert.equal(new Set(documentTops).size,1,'flowing card keeps one document coordinate across JS scroll updates');
    const pinnedStyleWrites=await page.evaluate(()=>{window.__pinnedStyleObserver.disconnect();return window.__pinnedStyleWrites;});assert.equal(pinnedStyleWrites,0,'stationary pinned peek receives no per-scroll style rewrites');
    const roomScroll=await page.locator('.workspace').evaluate(el=>el.scrollTop);
    await page.locator('.workspace').evaluate((el,top)=>el.scrollTo({top,behavior:'instant'}),roomScroll-400);await page.waitForTimeout(150);
    assert.equal(await page.getByRole('button',{name:'Next comment: src/Diff.tsx:2',exact:true}).count(),0,'no next card until full current card/footer releases space');
    await page.screenshot({path:path.join(os.tmpdir(),'dispatch-room-blocked.png')});
    await page.locator('.conversation').getByRole('button',{name:'Go to src/App.tsx:12',exact:true}).click();await waitForJump();
    await page.screenshot({path:path.join(os.tmpdir(),'dispatch-room-open.png')});
    const beforeWheel=await page.locator('.workspace').evaluate(el=>el.scrollTop);await scrollBody.hover();await page.mouse.wheel(0,100);await page.waitForTimeout(100);
    assert.ok(await scrollBody.evaluate(el=>el.scrollTop)>0,'long body consumes its own available scroll');
    assert.equal(await page.locator('.workspace').evaluate(el=>el.scrollTop),beforeWheel,'inner scrolling does not also move source');
    await scrollBody.evaluate(el=>el.scrollTop=el.scrollHeight);await page.mouse.wheel(0,120);await page.waitForTimeout(150);
    assert.ok((await page.locator('.workspace').evaluate(el=>el.scrollTop))>beforeWheel+100,'wheel chains to workspace at card boundary');
    await page.locator('.conversation').getByRole('button',{name:'Go to src/App.tsx:12',exact:true}).click();await waitForJump();
    await file.locator(".cm-lineNumbers .cm-gutterElement").filter({ hasText: /^12$/ }).last().click();
    const comment = page.getByRole("textbox", { name: "Line comment", exact: true });
    await comment.focus();
    await page.evaluate(() => window.__commentNode = document.activeElement);
    await page.keyboard.type("Keep this explicit human feedback.", { delay: 25 });
    await page.waitForTimeout(1700);
    assert.equal(await page.evaluate(() => document.activeElement === window.__commentNode), true, "same textarea stays focused across keystrokes and poll");
    assert.equal(await comment.inputValue(), "Keep this explicit human feedback.");
    await comment.evaluate(element => element.setSelectionRange(5, 5));
    await page.keyboard.type("X"); await page.keyboard.press("Backspace");
    assert.equal(await comment.inputValue(), "Keep this explicit human feedback.", "middle-of-text caret survives controlled updates");
    await file.locator('.cm-lineNumbers .cm-gutterElement').filter({hasText:/^12$/}).last().click();
    assert.equal(await comment.count(),0,'clicking same line deselects editor');
    await file.locator('.cm-lineNumbers .cm-gutterElement').filter({hasText:/^12$/}).last().click();
    assert.equal(await comment.inputValue(),'Keep this explicit human feedback.','deselection preserves the draft');

    await page.waitForTimeout(250);
    const rowBox=await file.locator(".cm-lineNumbers .cm-gutterElement").filter({hasText:/^12$/}).last().boundingBox();
    const composeBox=await page.locator('.floating-gutter-thread').filter({has:page.getByRole('textbox',{name:'Line comment',exact:true})}).boundingBox();
    assert.ok(Math.abs((rowBox.y+rowBox.height/2)-(composeBox.y+composeBox.height/2))<4,"draft card vertically centered on the actual line");
    await page.setViewportSize({width:1100,height:1000});
    await page.waitForTimeout(250);
    await comment.focus();
    await page.evaluate(()=>window.__inlineCommentNode=document.activeElement);
    await page.keyboard.type(" narrow",{delay:25});
    await page.waitForTimeout(1700);
    assert.equal(await page.evaluate(()=>document.activeElement===window.__inlineCommentNode),true,"inline widget keeps focus across typing and poll");
    for(let n=0;n<7;n++)await page.keyboard.press("Backspace");
    assert.equal(await comment.inputValue(),"Keep this explicit human feedback.");
    await page.setViewportSize({width:1700,height:1100});
    await page.waitForTimeout(250);

    assert.equal(await page.locator('.inline-compose .iconbtn').count(),0,'no independent X next to Cancel');
    await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('button',{name:'Keep editing',exact:true}).click();
    assert.equal(await comment.inputValue(),'Keep this explicit human feedback.');
    const summary = page.getByLabel("Final summary", { exact: true });
    await summary.focus();
    await page.evaluate(() => window.__summaryNode = document.activeElement);
    await page.keyboard.type("Own-code final summary.", { delay: 25 });
    await page.waitForTimeout(1700);
    assert.equal(await page.evaluate(() => document.activeElement === window.__summaryNode), true, "main box keeps focus; composer does not steal it");
    await summary.evaluate(element=>{const data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jKFkAAAAASUVORK5CYII='),char=>char.charCodeAt(0))],'paste.png',{type:'image/png'}));element.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});
    await page.locator('.chat-attachments a').waitFor();
    const finalSummary=`Own-code final summary.\n\n[image](</browser/Application Support/reviews/${request.id}/attachments/00000000-0000-4000-8000-000000000001.png>)`;
    assert.equal(await summary.inputValue(),finalSummary,'pasted image link appended without losing text');
    assert.equal(await summary.evaluate(el=>el.selectionStart),finalSummary.length,'paste advances cursor beyond the inserted link');
    await page.keyboard.type('X');assert.equal(await summary.inputValue(),finalSummary+'X','typing continues after image, not before it');await page.keyboard.press('Backspace');
    assert.equal(await page.evaluate(()=>window.__images.length),1);
    await page.locator('.chat-attachments .image-chip-thumbnail').waitFor({state:'visible'});
    await page.locator('.chat-attachments a').click();await page.getByRole('dialog',{name:'Pasted image'}).waitFor();await page.getByRole('button',{name:'Close image',exact:true}).click();
    await comment.focus();await page.keyboard.press('Meta+s');
    await page.locator(".feedback-error").filter({ hasText: "Save or discard" }).waitFor({ state: "visible" });
    assert.equal(await page.evaluate(() => window.__attempts), 0, "unfinished draft is not silently sent");
    await comment.focus();await page.keyboard.press('Meta+Enter');
    assert.equal(await page.locator('.conversation .chat-thread-link').count(),5,'Chat shows compact thread links, not full thread copies');
    assert.match(await page.locator('.conversation').getByRole('button',{name:'Go to src/App.tsx:12',exact:true}).innerText(),/2 comments/i);
    const sourceThread=page.locator('.floating-gutter-thread .comment-thread[data-thread-line="12"]');
    assert.equal(await sourceThread.count(),1,"one source card per line, including reply composer");
    assert.equal(await sourceThread.locator('.thread-reply').count(),1,"reply is underneath original message");
    assert.equal(await sourceThread.locator('.thread-peek svg').count(),1,'thread uses a properly aligned SVG chevron');
    const paragraph=await sourceThread.locator('[data-author="You"] .markdown-body').first().evaluate(el=>({body:el.getBoundingClientRect().height,p:el.querySelector('p').getBoundingClientRect().height,whiteSpace:getComputedStyle(el).whiteSpace}));assert.equal(paragraph.whiteSpace,'normal');assert.ok(Math.abs(paragraph.body-paragraph.p)<1,'Markdown serializer newline creates no empty bottom line');
    await page.evaluate(()=>window.__scrollWrites=[]);await sourceThread.getByRole('button',{name:'Reply',exact:true}).click();await waitForJump();assert.equal(await page.evaluate(()=>window.__scrollWrites.filter(write=>write.behavior==='smooth').length),0,'opening an editor does not animate against textarea focus scrolling');
    await page.getByRole('textbox',{name:'Line comment',exact:true}).fill('A second reply in the same thread.');
    await page.getByRole('button',{name:'Save reply',exact:true}).click();
    assert.equal(await sourceThread.count(),1);
    assert.equal(await sourceThread.locator('.thread-reply').count(),2,'both replies stay underneath the original, not separate cards');
    await sourceThread.getByRole('button',{name:'Edit comment',exact:true}).first().click();await waitForJump();await comment.fill('Updated explicit human feedback.');await page.getByRole('button',{name:'Save changes',exact:true}).click();
    assert.equal(await sourceThread.locator('.thread-reply').count(),2,'edit replaces the message rather than adding a reply');
    assert.match(await sourceThread.innerText(),/Updated explicit human feedback\./);
    await waitForJump();
    await page.locator('.conversation').getByRole('button',{name:'Go to src/App.tsx:12',exact:true}).click();await waitForJump();
    await sourceThread.getByRole('button',{name:'Edit comment',exact:true}).first().click();await waitForJump();await comment.fill('');await page.keyboard.press('Meta+s');assert.equal(await page.evaluate(()=>window.__attempts),0,'even an emptied edit blocks publishing the old comment');await comment.fill('This edit is cancelled.');await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('button',{name:'Discard',exact:true}).click();
    assert.match(await sourceThread.innerText(),/Updated explicit human feedback\./,'discarded edit keeps original saved comment');
    await sourceThread.getByRole('button',{name:'Reply',exact:true}).click();await comment.fill('Temporary removable reply.');await page.getByRole('button',{name:'Save reply',exact:true}).click();
    await page.waitForTimeout(250);
    await sourceThread.getByRole('button',{name:'Remove comment',exact:true}).last().click();assert.equal(await sourceThread.locator('.thread-reply').count(),2,'trash removes only chosen human message');
    assert.ok(await file.locator('.comment-blame-hint').count(),'blame-style text is on the source line');
    assert.equal(await file.locator('.cm-comment-indicator').count(),0,'old dot indicator removed');
    await page.screenshot({path:path.join(os.tmpdir(),'dispatch-threaded-comments.png')});
    const readControl=file.getByRole('checkbox',{name:'Reviewed src/App.tsx',exact:true}),readBox=await readControl.boundingBox();
    await readControl.click({position:{x:readBox.width-8,y:readBox.height/2}});await page.waitForTimeout(300);
    assert.equal(await readControl.getAttribute('aria-checked'),'true','whole Reviewed label responds to click');
    assert.equal(await file.locator('.file-header').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(20, 39, 29)','Reviewed header is green');
    assert.equal(await file.locator('.file-name').evaluate(el=>getComputedStyle(el).color),'rgb(63, 185, 80)','Reviewed filename is green');
    await file.locator('.file-header').screenshot({path:path.join(os.tmpdir(),'dispatch-reviewed-green.png')});
    assert.equal(await file.locator('.file-body.is-open').count(),0,'Reviewed collapses source');
    assert.equal(await sourceThread.count(),0,'collapsed file unmounts floating card');
    await file.locator('.file-name').click();await page.waitForTimeout(300);
    assert.equal(await readControl.getAttribute('aria-checked'),'true','reopening does not clear Reviewed');
    assert.equal(await sourceThread.count(),1);
    await page.locator('.conversation').getByRole('button',{name:'Go to src/App.tsx:12',exact:true}).click();
    await page.waitForTimeout(600);
    await sourceThread.getByRole('button',{name:'Resolve',exact:true}).click();
    await page.waitForTimeout(250);
    assert.ok(await sourceThread.evaluate(el=>el.classList.contains('closed-thread')));
    await sourceThread.getByRole('button',{name:'Reopen thread',exact:true}).click();await page.waitForTimeout(250);
    await sourceThread.getByRole('button',{name:'Dismiss',exact:true}).click();
    await page.waitForTimeout(250);
    assert.match(await sourceThread.innerText(),/Dismissed/);
    await sourceThread.getByRole('button',{name:'Reopen thread',exact:true}).click();await page.waitForTimeout(250);
    await sourceThread.getByRole('button',{name:'Resolve',exact:true}).click();

    const headerBox=await file.locator('.file-header').boundingBox(),workspaceBox=await page.locator('.workspace').boundingBox();
    console.log('Sticky header bounds',headerBox.y,workspaceBox.y);
    assert.ok(headerBox.y>=workspaceBox.y&&headerBox.y-workspaceBox.y<=20,'current file header is sticky');
    const statBox=await file.locator('.file-header .stats').boundingBox(),reviewedBox=await file.locator('.file-reviewed').boundingBox();assert.ok(statBox.x<reviewedBox.x,'stats and Reviewed swapped');
    const twenty=file.locator('.cm-lineNumbers .cm-gutterElement').filter({hasText:/^20$/}).last(),twentyTwo=file.locator('.cm-lineNumbers .cm-gutterElement').filter({hasText:/^22$/}).last();
    const first=await twenty.boundingBox(),last=await twentyTwo.boundingBox(),content=await file.locator('.cm-content').boundingBox();
    await page.mouse.click(content.x+100,first.y+first.height/2);await page.waitForTimeout(250);await comment.waitFor();
    assert.match(await page.locator('.compose-heading .comment-source').innerText(),/new:20/,'source text click starts comment');
    await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.waitForTimeout(200);
    await page.mouse.move(first.x+first.width/2,first.y+first.height/2);await page.mouse.down();await page.mouse.move(last.x+last.width/2,last.y+last.height/2,{steps:8});await page.mouse.up();
    await comment.waitFor();assert.match(await page.locator('.compose-heading .comment-source').innerText(),/20–22/,'drag captures line range');
    await comment.fill('Range feedback.');await page.keyboard.press('Meta+Enter');
    const startLine=await file.locator('.cm-lineNumbers .cm-gutterElement').filter({hasText:/^12$/}).last().boundingBox();
    const initialScroll=await page.locator('.workspace').evaluate(el=>el.scrollTop);
    for(const movement of [100,250,600]){
      await page.locator('.workspace').evaluate((el,top)=>el.scrollTo({top,behavior:'instant'}),initialScroll+movement);await page.waitForTimeout(80);
      const geometry=await sourceThread.evaluate(el=>{const card=el.closest('.floating-gutter-thread'),rect=card.getBoundingClientRect();return {top:rect.top,bottom:rect.bottom,opacity:getComputedStyle(card).opacity,peek:card.dataset.peeking};});
      const delta=(await page.locator('.workspace').evaluate(el=>el.scrollTop))-initialScroll;
      if(!geometry.peek)assert.ok(geometry.top<=startLine.y-delta+5&&geometry.bottom>=startLine.y+startLine.height-delta-5,'card never detaches from attached line block');
      assert.equal(geometry.opacity,'1','scrolling has no opacity fade');
    }
    await page.locator(".active-pr").filter({ hasText: "Other own-source snapshot" }).click();
    await page.locator(".active-pr").filter({ hasText: request.title }).click();
    assert.equal(await summary.inputValue(), finalSummary);
    assert.equal(await page.evaluate(id => window.__calls.filter(c => c.command === "open_review" && c.id === id).length, request.id), 1, "immutable snapshot cached on return");
    assert.equal(await page.evaluate(id => window.__calls.filter(c => c.command === "file_identities" && c.id === id).length, request.id), 1, "no repeated per-file Git fingerprint work");

    await summary.focus();await page.keyboard.press('Meta+s');
    await page.locator(".feedback-error").filter({ hasText: "Simulated disk failure" }).waitFor({ state: "visible" });
    assert.equal(await summary.inputValue(), finalSummary, "failed submit preserves main-box text");
    await page.getByRole("button", { name: /Submit feedback/ }).click();
    assert.equal(await summary.evaluate(element => element.readOnly), true, "freeze editing while payload is being flushed");
    await summary.focus(); await page.keyboard.type("MUST NOT BE LOST OR SENT");
    await page.getByText("Review complete", { exact: true }).waitFor();
    const submitted = await page.evaluate(() => window.__submitted);
    assert.equal(submitted.length, 1);
    assert.equal(submitted[0].feedback.summary, finalSummary);
    assert.equal(submitted[0].feedback.comments.length, 3, "opening-agent comments not attributed to the human");
    assert.equal(submitted[0].feedback.comments[0].line, 12);
    assert.equal(submitted[0].feedback.comments[0].body, "Updated explicit human feedback.");
    assert.ok(submitted[0].feedback.comments.every(comment=>!('editingIndex' in comment)),'editor bookkeeping never enters result');
    assert.equal(submitted[0].feedback.comments[1].body,'A second reply in the same thread.');
    assert.equal(submitted[0].feedback.comments[2].line,20);assert.equal(submitted[0].feedback.comments[2].endLine,22);
    assert.deepEqual(submitted[0].feedback.threadStates,[{path:'src/App.tsx',side:'new',line:12,state:'resolved'}]);
    await page.locator(".archive-section>summary").click();
    await page.locator(".archive-list .active-pr").click();
    assert.equal(await summary.inputValue(), finalSummary);
    assert.equal(await page.evaluate(()=>window.__calls.filter(call=>call.command==="plugin:window|close").length),1,"successful topbar submit requests normal close once");
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(os.tmpdir(), "dispatch-comments-regression.png") });
    console.log("PASS: native comment-jump command/frame profile, bounded animated alignment/manual interruption/reduced motion, overlay titlebar config/drag region, automatic/override animated inline threads, SVG chevron/no Markdown gap, focus/caret, same-line toggle, constrained cards/no scroll fade, same-node space-gated stacks/flush edges/native flow/pinned stability/no corrective writes/rounded upper reveal, paste caret, nested wheel chaining, edit/cancel/trash, Reviewed label/collapse/reopen, image chips/HTTPS safety, global Cmd-S submission, ranges, safe retry, cache and Archive. IPC mocked; live reviews untouched.");
  } finally {
    await browser?.close(); server.kill(); fs.rmSync(temporary, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
