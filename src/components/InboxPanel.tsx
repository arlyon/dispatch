import { createMemo, createSignal, For, Show } from "solid-js";
import type { AgentState } from "../AgentReport";
import type { ReviewFile, ReviewRequest, ReviewSummary } from "../types";
import Icon from "./Icon";
import { fileName, fileStats, repositoryName } from "./review-ui";

type Directory = { name: string; path: string; directories: Map<string, Directory>; files: ReviewFile[] };
function tree(files: ReviewFile[]) {
  const root: Directory = {name:"",path:"",directories:new Map(),files:[]};
  for (const file of files) {
    let parent=root;
    for (const part of file.path.split("/").slice(0,-1)) {
      if (!parent.directories.has(part)) parent.directories.set(part,{name:part,path:parent.path?`${parent.path}/${part}`:part,directories:new Map(),files:[]});
      parent=parent.directories.get(part)!;
    }
    parent.files.push(file);
  }
  return root;
}
export default function InboxPanel(props: {
  reviews: ReviewSummary[]; request?: ReviewRequest; selectedId?: string; activePath: string; filter: string;
  agents: Record<string, AgentState>; readReady:boolean; readPaths: ReadonlySet<string>; findingCounts: Record<string,number>;
  busy: boolean; onSelect: (id:string)=>void; onSelectFile:(path:string)=>void; onFilter:(value:string)=>void;
  onRead:(path:string,read:boolean)=>void; onRefresh:()=>void; onNew:()=>void;
}) {
  const [search,setSearch]=createSignal("");
  const [kind,setKind]=createSignal("all");
  const [archiveOpen,setArchiveOpen]=createSignal(false);
  const [collapsed,setCollapsed]=createSignal<Record<string,boolean>>({});
  const active = () => props.reviews.filter(item=>!item.complete);
  const archived = () => props.reviews.filter(item=>item.complete);
  const reviewing = (id:string) => ["starting","reviewing"].includes(props.agents[id]?.phase);
  const matches = (item:ReviewSummary) => `${item.title} ${repositoryName(item.source.repo)}`.toLowerCase().includes(search().toLowerCase());
  const visible = () => active().filter(item=>matches(item) && (kind()==="all" || (kind()==="ready"?props.agents[item.id]?.phase==="complete":reviewing(item.id))));
  const files = createMemo(()=>tree((props.request?.files||[]).filter(file=>file.path.toLowerCase().includes(props.filter.toLowerCase()))));
  const find = (id:string) => props.reviews.find(item=>item.id===id)!;
  function FileTree(propsTree:{directory:Directory;depth:number;readonly:boolean}) {
    return <>
      <For each={[...propsTree.directory.directories.values()]}>{directory=><><button class="tree-folder" style={{"padding-left":`${6+propsTree.depth*12}px`}} aria-expanded={Boolean(props.filter)||!collapsed()[directory.path]} onClick={()=>setCollapsed(all=>({...all,[directory.path]:!all[directory.path]}))}><Icon name="chevron" class={Boolean(props.filter)||!collapsed()[directory.path]?"chevron expanded":"chevron"}/><Icon name="folder"/><span>{directory.name}</span></button><Show when={Boolean(props.filter)||!collapsed()[directory.path]}><FileTree directory={directory} depth={propsTree.depth+1} readonly={propsTree.readonly}/></Show></>}</For>
      <For each={propsTree.directory.files}>{file=><div class="tree-file-row" classList={{"selected-file":props.activePath===file.path,"reviewed-file":props.readPaths.has(file.path)}} style={{"padding-left":`${8+propsTree.depth*12}px`}}><input type="checkbox" aria-label={`Mark ${file.path} reviewed`} checked={props.readPaths.has(file.path)} disabled={propsTree.readonly||!props.readReady} onChange={event=>props.onRead(file.path,event.currentTarget.checked)} title="Marks this exact diff as read, not approved"/><button class="tree-file" title={file.path} onClick={()=>props.onSelectFile(file.path)}><Icon name="file"/><span>{fileName(file.path)}</span><Show when={props.findingCounts[file.path]}><span class="tree-findings" aria-label={`${props.findingCounts[file.path]} comments or findings in ${file.path}`} title={`${props.findingCounts[file.path]} comments or findings`}><Icon name="comment"/>{props.findingCounts[file.path]}</span></Show></button></div>}</For>
    </>;
  }
  function ReviewItem(itemProps:{id:string}) {
    const item=()=>find(itemProps.id);
    const selected=()=>props.selectedId===itemProps.id;
    const [filesOpen,setFilesOpen]=createSignal(true);
    const totals=()=>props.request?.files.reduce((sum,file)=>{const value=fileStats(file);return {added:sum.added+value.added,removed:sum.removed+value.removed};},{added:0,removed:0});
    return <article class="pr-accordion-card" classList={{"is-current":selected(),"is-archived":item().complete}}>
      <div class="pr-card-header"><button class="pr-expand-toggle" aria-label={selected()?"Toggle files":"Open review"} aria-expanded={selected()&&filesOpen()} onClick={()=>selected()?setFilesOpen(!filesOpen()):props.onSelect(itemProps.id)}><Icon name="chevron" class={selected()&&filesOpen()?"chevron expanded":"chevron"}/></button><button class="pr-summary active-pr" onClick={()=>props.onSelect(itemProps.id)}><span class="repo">local / {repositoryName(item().source.repo)}</span><strong class="title">{item().title}</strong><span class="meta"><span class="revision">{item().source.head.slice(0,7)}</span><span classList={{findings:reviewing(itemProps.id)}}>{item().complete?"Submitted":reviewing(itemProps.id)?"Reviewing":props.agents[itemProps.id]?.phase==="complete"?"Review ready":`${item().fileCount} files`}</span></span></button></div>
      <Show when={selected()&&filesOpen()&&props.request}><section class="pr-file-accordion"><div class="files-heading"><strong>Files changed ({props.request!.files.length})</strong><span class="stats"><span class="plus">+{totals()?.added}</span><span class="minus">−{totals()?.removed}</span></span></div><input class="tree-filter file-filter" aria-label="Filter files" placeholder="Filter files…" value={props.filter} onInput={event=>props.onFilter(event.currentTarget.value)}/><div class="compact-tree file-list"><FileTree directory={files()} depth={0} readonly={item().complete}/></div><div class="reviewed-count">{props.readPaths.size}/{props.request!.files.length} read</div></section></Show>
    </article>;
  }
  return <section class="inbox floating-panel">
    <header class="inbox-head"><div class="heading">Inbox <span class="count">{active().length}</span><span class="spacer"/><button class="iconbtn" aria-label="Refresh inbox" onClick={props.onRefresh}><Icon name="refresh"/></button></div><label class="search"><Icon name="search"/><input aria-label="Search reviews" placeholder="Find a change…" value={search()} onInput={event=>setSearch(event.currentTarget.value)}/><span class="mono muted">/</span></label><div class="filters"><button classList={{active:kind()==="all"}} onClick={()=>setKind("all")}>All {active().length}</button><button classList={{active:kind()==="ready"}} onClick={()=>setKind("ready")}>Ready {active().filter(item=>props.agents[item.id]?.phase==="complete").length}</button><button classList={{active:kind()==="reviewing"}} onClick={()=>setKind("reviewing")}>Reviewing {active().filter(item=>reviewing(item.id)).length}</button></div></header>
    <div class="inbox-scroll"><div class="accordion-pr-list"><Show when={visible().length} fallback={<p class="empty-inbox">{active().length?"No matching reviews.":"Inbox clear. Completed reviews are in Archive."}</p>}><For each={visible().map(item=>item.id)}>{id=><ReviewItem id={id}/>}</For></Show></div>
      <details class="archive-section" open={archiveOpen()} onToggle={event=>setArchiveOpen(event.currentTarget.open)}><summary><Icon name="archive"/><span>Archive</span><span class="count">{archived().length}</span><Icon name="chevron" class={archiveOpen()?"chevron expanded":"chevron"}/></summary><div class="archive-list"><For each={archived().filter(matches).map(item=>item.id)}>{id=><ReviewItem id={id}/>}</For><Show when={!archived().length}><p class="empty-inbox">No completed reviews yet.</p></Show></div></details>
    </div><footer class="inbox-footer"><button disabled={props.busy} onClick={props.onNew}><Icon name="plus"/>Review Dispatch</button></footer>
  </section>;
}
