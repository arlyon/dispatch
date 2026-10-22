import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { AgentState } from "../AgentReport";
import type { CaptureProgress, GitHubSource, ReviewFile, ReviewRequest, ReviewSummary } from "../types";
import Icon from "./Icon";
import { fileName, fileStats, repositoryName } from "./review-ui";

type Directory = { name:string; path:string; directories:Map<string,Directory>; files:ReviewFile[] };
function tree(files:ReviewFile[]) {
  const root:Directory={name:"",path:"",directories:new Map(),files:[]};
  for(const file of files){let parent=root;for(const part of file.path.split("/").slice(0,-1)){if(!parent.directories.has(part))parent.directories.set(part,{name:part,path:parent.path?`${parent.path}/${part}`:part,directories:new Map(),files:[]});parent=parent.directories.get(part)!;}parent.files.push(file);}
  return root;
}
export default function InboxPanel(props:{
  github?:GitHubSource; capture?:CaptureProgress; sourceDisabled:boolean; onSelectPR:(url:string)=>void;
  reviews:ReviewSummary[]; request?:ReviewRequest; cachedRequest:(id:string)=>ReviewRequest|undefined; selectedId?:string; activePath:string; filter:string;
  agents:Record<string,AgentState>; readReady:boolean; readPaths:ReadonlySet<string>; findingCounts:Record<string,number>;
  busy:boolean; onSelect:(id:string,path?:string)=>void; onSelectFile:(path:string)=>void; onFilter:(value:string)=>void;
  onRead:(path:string,read:boolean)=>void; onRefresh:()=>void; onNew:()=>void; onMotion:(transition:(change:()=>void)=>void)=>void;
}) {
  const [search,setSearch]=createSignal(""),[kind,setKind]=createSignal("all"),[archiveOpen,setArchiveOpen]=createSignal(false);
  const [collapsed,setCollapsed]=createSignal<Record<string,boolean>>({}),[expanded,setExpanded]=createSignal<Record<string,boolean>>({});
  const [driftOpen,setDriftOpen]=createSignal<string>(),[driftAbove,setDriftAbove]=createSignal(false);
  const localOrder=new Map<string,number>(),remoteOrder=new Map<string,number>(),nodes=new Map<string,HTMLElement>();
  let inbox:HTMLElement|undefined;
  function navigateCards(event:KeyboardEvent){
    if(event.defaultPrevented||!(event.metaKey||event.ctrlKey)||event.altKey||event.shiftKey||!['ArrowUp','ArrowDown'].includes(event.key))return;
    const target=event.target;
    if(target instanceof Element&&target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),.cm-editor,.quiz-panel,[role="dialog"],dialog'))return;
    if(!inbox||document.querySelector('dialog[open],[role="dialog"]'))return;
    const cards=[...inbox.querySelectorAll<HTMLElement>('[data-card-key]')].filter(card=>!card.hidden&&card.getClientRects().length>0&&!card.closest('details:not([open])'));
    const current=cards.findIndex(card=>card.contains(document.activeElement));
    const next=current<0?(event.key==='ArrowDown'?0:cards.length-1):Math.max(0,Math.min(cards.length-1,current+(event.key==='ArrowDown'?1:-1)));
    const card=cards[next];
    if(!card)return;
    event.preventDefault();
    card.focus({preventScroll:true});
    const scroll=inbox.querySelector<HTMLElement>('.inbox-scroll')!;
    const bounds=scroll.getBoundingClientRect(),rect=card.getBoundingClientRect();
    const delta=rect.top<bounds.top?rect.top-bounds.top:rect.bottom>bounds.bottom?Math.min(rect.bottom-bounds.bottom,rect.top-bounds.top):0;
    if(delta)scroll.scrollBy({top:delta,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  }
  onMount(()=>window.addEventListener('keydown',navigateCards));
  onCleanup(()=>window.removeEventListener('keydown',navigateCards));
  let nextLocalRank=0,nextRemoteRank=0;
  let reservedCapture:{url:string;captureId?:string}|undefined;
  const knownPrs=new Map<string,NonNullable<GitHubSource["items"][number]>>();
  const animations=new Set<Animation>();
  let motionPending=false;
  const key=(review:ReviewSummary)=>review.source.prUrl||review.id;
  const working=createMemo(()=>{
    const grouped=new Map<string,ReviewSummary[]>();
    for(const review of props.reviews){const id=key(review);grouped.set(id,[...(grouped.get(id)||[]),review]);}
    const result=new Map<string,ReviewSummary>();
    for(const [id,reviews] of grouped){
      const selected=reviews.find(review=>review.id===props.selectedId);
      const latest=[...reviews].sort((a,b)=>(b.intakeAt||0)-(a.intakeAt||0));
      const current=selected||latest.find(review=>!review.complete)||latest[0];
      if(current.source.prUrl||!current.complete||selected)result.set(id,current);
    }
    return result;
  });
  const discovery=(id:string)=>props.github?.items.find(pr=>pr.url===id)||knownPrs.get(id);
  const allKeys=createMemo(()=>{
    const intake=(id:string)=>Math.min(...props.reviews.filter(review=>key(review)===id).map(review=>review.intakeAt||0));
    const materialized=[...working().entries()].sort((a,b)=>intake(a[0])-intake(b[0]));
    for(const [id] of materialized)if(!localOrder.has(id))localOrder.set(id,nextLocalRank++);
    if(reservedCapture&&(reservedCapture.url!==props.capture?.url||reservedCapture.captureId!==props.capture?.captureId)){
      if(!working().has(reservedCapture.url))localOrder.delete(reservedCapture.url);
      reservedCapture=undefined;
    }
    if(props.capture&&!working().has(props.capture.url)&&!reservedCapture){
      localOrder.set(props.capture.url,nextLocalRank++);
      reservedCapture={url:props.capture.url,captureId:props.capture.captureId};
    }
    const arrivals=[...(props.github?.items||[])].sort((a,b)=>(a.createdAt||a.updatedAt).localeCompare(b.createdAt||b.updatedAt)||a.url.localeCompare(b.url));
    for(const pr of arrivals){knownPrs.set(pr.url,pr);if(!remoteOrder.has(pr.url))remoteOrder.set(pr.url,nextRemoteRank++);}
    const local=[...localOrder.keys()].filter(id=>working().has(id)||props.capture?.url===id).sort((a,b)=>localOrder.get(a)!-localOrder.get(b)!);
    const remote=[...remoteOrder.keys()].filter(id=>props.github?.items.some(pr=>pr.url===id)&&!local.includes(id)).sort((a,b)=>remoteOrder.get(a)!-remoteOrder.get(b)!);
    return [...local,"divider:remote",...remote];
  });
  const history=()=>props.reviews.filter(review=>working().get(key(review))?.id!==review.id);
  const reviewing=(id:string)=>["starting","reviewing"].includes(props.agents[id]?.phase);
  const matches=(id:string)=>{
    const review=working().get(id),pr=discovery(id);
    const text=`${review?.title||""} ${pr?.title||""} ${pr?.repo||review?.source.repo||id} ${pr?.author||""}`.toLowerCase();
    return text.includes(search().toLowerCase())&&(kind()==="all"||Boolean(review&&(kind()==="ready"?props.agents[review.id]?.phase==="complete":reviewing(review.id))));
  };
  function transition(change:()=>void){
    if(motionPending){change();return;}
    motionPending=true;
    const elements=[...nodes.values()].filter(node=>node.isConnected&&!node.hidden);
    // Retarget from the visible in-flight position, never snap to an old destination.
    const before=new Map(elements.map(node=>[node,node.getBoundingClientRect()]));
    for(const animation of animations)animation.cancel();animations.clear();
    const focused=document.activeElement instanceof HTMLElement?document.activeElement:undefined;
    change();
    if(focused?.isConnected&&(document.activeElement!==focused||(focused instanceof HTMLButtonElement&&focused.disabled))){
      const target=focused instanceof HTMLButtonElement&&focused.disabled?focused.closest<HTMLElement>("[data-card-key]"):focused;
      target?.focus({preventScroll:true});
    }
    requestAnimationFrame(()=>{
      motionPending=false;
      const after=new Map(elements.filter(node=>node.isConnected&&!node.hidden).map(node=>[node,node.getBoundingClientRect()]));
      const timing={duration:matchMedia("(prefers-reduced-motion: reduce)").matches?0:300,easing:"cubic-bezier(.22,1,.36,1)"};
      const changes=[...after].filter(([node,rect])=>rect.height!==before.get(node)?.height);
      for(const [node,to] of after){
        const from=before.get(node)!;
        const start=(frames:Keyframe[])=>{const animation=node.animate(frames,timing);animations.add(animation);animation.onfinish=()=>{animations.delete(animation);animation.cancel();};};
        if(from.height!==to.height)start([{height:`${from.height}px`,overflow:"hidden"},{height:`${to.height}px`,overflow:"hidden"}]);
        const downstream=changes.reduce((sum,[other,rect])=>sum+(other!==node&&to.y>=rect.bottom?rect.height-before.get(other)!.height:0),0);
        if(from.x!==to.x||from.y!==to.y||downstream!==0)start([{transform:`translate(${from.x-to.x}px, ${from.y-to.y+downstream}px) scale(${from.width/to.width},1)`},{transform:"translate(0,0) scale(1,1)"}]);
      }
    });
  }
  props.onMotion(transition);
  onCleanup(()=>{for(const animation of animations)animation.cancel();nodes.clear();props.onMotion(change=>change());});
  function FileTree(p:{directory:Directory;depth:number;review:ReviewSummary;selected:boolean}){
    return <><For each={[...p.directory.directories.values()]}>{directory=><><button class="tree-folder" style={{"padding-left":`${6+p.depth*12}px`}} aria-expanded={Boolean(props.filter)||!collapsed()[directory.path]} onClick={()=>transition(()=>setCollapsed(all=>({...all,[directory.path]:!all[directory.path]})))}><Icon name="chevron" class={Boolean(props.filter)||!collapsed()[directory.path]?"chevron expanded":"chevron"}/><Icon name="folder"/><span>{directory.name}</span></button><Show when={Boolean(props.filter)||!collapsed()[directory.path]}><FileTree directory={directory} depth={p.depth+1} review={p.review} selected={p.selected}/></Show></>}</For>
    <For each={p.directory.files}>{file=><div class="tree-file-row" classList={{"selected-file":p.selected&&props.activePath===file.path,"reviewed-file":p.selected&&props.readPaths.has(file.path)}} style={{"padding-left":`${8+p.depth*12}px`}}><input type="checkbox" aria-label={`Mark ${file.path} reviewed`} checked={p.selected&&props.readPaths.has(file.path)} disabled={!p.selected||p.review.complete||!props.readReady} onChange={event=>props.onRead(file.path,event.currentTarget.checked)}/><button class="tree-file" title={file.path} onClick={()=>p.selected?props.onSelectFile(file.path):props.onSelect(p.review.id,file.path)}><Icon name="file"/><span>{fileName(file.path)}</span><Show when={p.selected&&props.findingCounts[file.path]}><span class="tree-findings"><Icon name="comment"/>{props.findingCounts[file.path]}</span></Show></button></div>}</For></>;
  }
  function SectionHeading(p:{label:string;count:number|string}){
    return <><span>{p.label}</span><span class="count">{p.count}</span><span class="source-rule"/></>;
  }
  function showDrift(id:string,element:HTMLElement){const bounds=element.closest(".inbox-scroll")!.getBoundingClientRect();setDriftAbove(element.getBoundingClientRect().bottom+90>bounds.bottom);setDriftOpen(id);}
  const preparationSteps=[
    ["metadata","Read PR metadata"], ["comparison","Resolve review base"],
    ["clone","Clone repository"], ["fetch","Fetch PR branch"],
    ["checkout","Check out branch"], ["files","Prepare review files"],
  ] as const;
  function Preparation(){
    const active=()=>preparationSteps.findIndex(([phase])=>phase===props.capture?.phase);
    return <section class="capture-preparation" aria-label="Preparing review" aria-live="polite"><div><Icon name="branch"/><strong>Preparing your review</strong></div><ol><For each={preparationSteps}>{([phase,label],index)=><li data-step={phase} classList={{"is-complete":index()<active(),"is-active":index()===active()}} aria-current={index()===active()?"step":undefined}><span class="capture-step-check" aria-hidden="true"><Show when={index()<active()} fallback={<span classList={{"capture-step-spinner":index()===active(),"capture-step-dot":index()!==active()}}/>}><Icon name="check"/></Show></span><span>{label}</span></li>}</For></ol><Show when={props.capture?.phase==="files"&&props.capture.total!=null}><small>{props.capture?.done||0} / {props.capture?.total} files</small></Show></section>;
  }
  function PRCard(p:{id:string;history?:ReviewSummary}){
    const review=()=>p.history||working().get(p.id),pr=()=>discovery(p.id);
    const selected=()=>Boolean(review()&&review()!.id===props.selectedId);
    const preparing=()=>!p.history&&props.capture?.url===p.id;
    const content=()=>review()&&(selected()?props.request:props.cachedRequest(review()!.id));
    const opened=()=>expanded()[p.id]??(selected()||Boolean(content()));
    const head=()=>props.github?.heads?.find(head=>head.url===p.id);
    const changed=()=>!p.history&&Boolean(review()?.source.prUrl&&head()?.head&&head()!.head!.toLowerCase()!==review()!.source.head.toLowerCase());
    const activate=()=>{if(preparing())return;if(review()?.source.prUrl&&review()?.checkoutReady===false&&!p.history){props.onSelectPR(p.id);}else if(review()){setExpanded(all=>({...all,[p.id]:true}));props.onSelect(review()!.id);}else props.onSelectPR(p.id);};
    const title=()=>review()?.title||pr()?.title||p.id;
    return <article ref={element=>{if(!p.history)nodes.set(p.id,element);}} data-card-key={p.id} role="group" tabindex="-1" aria-label={title()} class="pr-accordion-card capture-single-pr" classList={{"is-current":selected(),"is-preparing":preparing(),"is-archived":Boolean(p.history)}} hidden={!p.history&&!matches(p.id)} onClick={event=>{if(!(event.target as HTMLElement).closest("button,input,summary,details,textarea"))activate();}} onKeyDown={event=>{if(event.target===event.currentTarget&&(event.key==="Enter"||event.key===" ")){event.preventDefault();activate();}}}>
      <div class="pr-card-header"><button class="pr-expand-toggle" aria-label={selected()?"Toggle files":"Open review"} aria-expanded={opened()} disabled={preparing()||(!review()&&(props.busy||props.sourceDisabled||Boolean(props.capture)))} onClick={()=>selected()?transition(()=>setExpanded(all=>({...all,[p.id]:!opened()}))):activate()}><Icon name="chevron" class={opened()?"chevron expanded":"chevron"}/></button><button class="pr-summary active-pr" disabled={preparing()||(!review()&&(props.busy||props.sourceDisabled||Boolean(props.capture)))} onClick={activate} aria-label={review()?undefined:`Open ${pr()?.repo} #${pr()?.number}`}><span class="repo">{review()?.source.prUrl?review()!.source.prUrl!.replace("https://github.com/","").replace("/pull/"," #"):pr()?`${pr()!.repo} #${pr()!.number}`:repositoryName(review()!.source.repo)}</span><strong class="title">{title()}</strong><span class="meta"><span>{review()?review()!.source.head.slice(0,7):pr()?.author}</span><span>{review()?.complete?"Submitted":reviewing(review()?.id||"")?"Reviewing":review()?`${review()!.fileCount} files`:pr()?new Date(pr()!.updatedAt).toLocaleString():""}</span></span></button>
      <Show when={changed()}><div class="capture-drift-control" onMouseEnter={event=>showDrift(p.id,event.currentTarget)} onMouseLeave={event=>{if(!event.currentTarget.contains(document.activeElement))setDriftOpen(undefined);}} onFocusIn={event=>showDrift(p.id,event.currentTarget)} onFocusOut={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setDriftOpen(undefined);}} onKeyDown={event=>{if(event.key==="Escape")setDriftOpen(undefined);}}><button class="capture-drift-icon" aria-label={`Branch has changed for ${p.id.replace("https://github.com/","").replace("/pull/"," #")}`} aria-expanded={driftOpen()===p.id} onClick={event=>showDrift(p.id,event.currentTarget)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 3 22 21H2ZM12 9v5"/><circle cx="12" cy="17" r=".6"/></svg></button><Show when={driftOpen()===p.id}><div class="capture-drift-popover" classList={{above:driftAbove()}} role="group" aria-label="Branch has changed"><p>Branch has changed</p><button disabled={props.busy||props.sourceDisabled||Boolean(props.capture)} onClick={()=>{setDriftOpen(undefined);props.onSelectPR(p.id);}}>Refresh</button></div></Show></div></Show></div>
      <Show when={preparing()} fallback={<Show when={review()&&content()&&opened()}><section class="pr-file-accordion"><div class="files-heading"><strong>Files changed ({content()!.files.length})</strong><Show when={selected()}><span class="stats"><span class="plus">+{content()!.files.reduce((sum,file)=>sum+fileStats(file).added,0)}</span><span class="minus">−{content()!.files.reduce((sum,file)=>sum+fileStats(file).removed,0)}</span></span></Show></div><Show when={selected()}><input class="tree-filter file-filter" aria-label="Filter files" placeholder="Filter files…" value={props.filter} onInput={event=>props.onFilter(event.currentTarget.value)}/></Show><div class="compact-tree file-list"><FileTree directory={tree(content()!.files.filter(file=>!selected()||file.path.toLowerCase().includes(props.filter.toLowerCase())))} depth={0} review={review()!} selected={selected()}/></div><Show when={selected()}><div class="reviewed-count">{props.readPaths.size}/{content()!.files.length} read</div></Show></section></Show>}><Preparation/></Show>
    </article>;
  }
  return <section ref={inbox} class="inbox floating-panel"><header class="inbox-head"><div class="heading">Inbox <span class="count">{allKeys().length-1}</span><span class="spacer"/><button class="iconbtn" aria-label="Refresh inbox" onClick={props.onRefresh}><Icon name="refresh"/></button></div><label class="search"><Icon name="search"/><input aria-label="Search reviews" placeholder="Find a change…" value={search()} onInput={event=>setSearch(event.currentTarget.value)}/></label><div class="filters"><button classList={{active:kind()==="all"}} onClick={()=>setKind("all")}>All</button><button classList={{active:kind()==="ready"}} onClick={()=>setKind("ready")}>Ready</button><button classList={{active:kind()==="reviewing"}} onClick={()=>setKind("reviewing")}>Reviewing</button></div></header>
    <div class="inbox-scroll"><div class="source-divider"><SectionHeading label="Local" count={allKeys().indexOf("divider:remote")}/></div><div class="inbox-card-stack"><For each={allKeys()}>{id=>id==="divider:remote"?<div ref={element=>nodes.set(id,element)} class="source-divider remote-divider"><SectionHeading label="Remote" count={props.github?.total==null?"…":allKeys().length-allKeys().indexOf("divider:remote")-1}/><details class="source-details"><summary aria-label="Remote source details"><span aria-hidden="true">…</span><span role="status">{!props.github?"Connecting":props.github.error?props.github.lastSuccess?"Stale":"Unavailable":props.github.polling?"Checking":props.github.partial?"Partial results":""}</span></summary><div class="source-details-body"><p>{props.github?.total??"Unknown"} matching PRs</p><code>{props.github?.query}</code><p>{props.github?.error||(props.github?.partial?"Search incomplete or capped":"Updated-desc · polls every 120 seconds")}</p><Show when={props.github?.lastSuccess}><small>Last success {new Date(props.github!.lastSuccess!*1000).toLocaleString()}</small></Show></div></details></div>:<PRCard id={id}/>}</For></div>
    <details class="archive-section" open={archiveOpen()} onToggle={event=>setArchiveOpen(event.currentTarget.open)}><summary class="source-divider"><SectionHeading label="Archive" count={history().length}/><Icon name="chevron" class={archiveOpen()?"chevron expanded":"chevron"}/></summary><div class="archive-list"><For each={history().map(review=>review.id)}>{id=><PRCard id={id} history={props.reviews.find(review=>review.id===id)!}/>}</For><Show when={!history().length}><p class="empty-inbox">No archived reviews.</p></Show></div></details></div><footer class="inbox-footer"><button disabled={props.busy} onClick={props.onNew}><Icon name="plus"/>Review Dispatch</button></footer></section>;
}
