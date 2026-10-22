import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { CommentPlacement, ReviewRequest } from "../types";
import Icon from "./Icon";
import Updates from "./Updates";
import { repositoryName } from "./review-ui";
import "./toolbar.css";
export default function TopBar(props:{updatesBlocked:boolean;placement:CommentPlacement;onPlacement:(placement:CommentPlacement)=>void;canBeside:boolean;stackDepth:number;onStackDepth:(depth:number)=>void;wide:boolean;request?:ReviewRequest;inboxVisible:boolean;chatVisible:boolean;complete:boolean;busy:boolean;submitting:boolean;commentCount:number;hasSummary:boolean;onInbox:()=>void;onChat:()=>void;onSubmit:()=>void}) {
  const nativeMac="__TAURI_INTERNALS__" in window&&/Mac/.test(navigator.platform);
  let options!:HTMLDetailsElement;
  const [expanded,setExpanded]=createSignal(false);
  onMount(()=>{
    const outside=(event:PointerEvent)=>{if(options?.open&&event.target instanceof Node&&!options.contains(event.target))options.open=false;};
    const escape=(event:KeyboardEvent)=>{if(event.key==="Escape"&&options?.open){event.preventDefault();event.stopPropagation();options.open=false;options.querySelector<HTMLElement>("summary")?.focus();}};
    document.addEventListener("pointerdown",outside);document.addEventListener("keydown",escape);
    onCleanup(()=>{document.removeEventListener("pointerdown",outside);document.removeEventListener("keydown",escape);});
  });
  return <header class="topbar" classList={{"macos-titlebar":nativeMac}} data-tauri-drag-region>
    <button class="iconbtn" aria-label="Toggle inbox" aria-expanded={props.inboxVisible} onClick={props.onInbox}><Icon name="panel"/></button>
    <span class="brand" data-tauri-drag-region><Icon name="arrow"/>dispatch</span><span class="brand-divider" data-tauri-drag-region/>
    <div class="source-title" data-tauri-drag-region><Show when={props.request} fallback="Your review inbox">{request=><>{repositoryName(request().source.repo)} / {request().title}</>}</Show></div>
    <div class="topbar-actions">
      <Updates blocked={props.updatesBlocked}/>
      <Show when={props.request}><details ref={options} class="view-options" onToggle={event=>setExpanded(event.currentTarget.open)} onFocusOut={event=>{if(event.relatedTarget instanceof Node&&!options.contains(event.relatedTarget))options.open=false;}}>
        <summary role="button" aria-expanded={expanded()} aria-label="View options" aria-controls="review-view-options"><Icon name="panel"/><span>View</span><Icon name="chevron"/></summary>
        <div id="review-view-options" class="view-options-panel" role="region" aria-label="View options">
          <div class="view-option-row"><span>Comments</span><div class="view-segments" role="group" aria-label="Comment placement"><For each={[{value:"auto",label:"Auto"},{value:"inline",label:"Inline"},{value:"beside",label:"Beside"}] as const}>{option=><button type="button" aria-pressed={props.placement===option.value} disabled={option.value==="beside"&&!props.canBeside} onClick={()=>props.onPlacement(option.value)}>{option.label}</button>}</For></div></div>
          <Show when={props.wide}><div class="view-option-row"><span>Stack depth</span><div class="view-segments view-depth" role="group" aria-label="Peek stack"><For each={[1,2,3,4,5]}>{depth=><button type="button" aria-label={`${depth} ${depth===1?"card":"cards"}`} aria-pressed={props.stackDepth===depth} onClick={()=>props.onStackDepth(depth)}>{depth}</button>}</For></div></div></Show>
        </div>
      </details></Show>
      <Show when={props.complete} fallback={<button class="primary-action" disabled={!props.request||props.busy} onClick={props.onSubmit} aria-keyshortcuts="Meta+S Control+S" title="⌘S / Ctrl-S: submit local feedback to the requesting agent; never publishes to GitHub">{props.submitting?"Submitting…":props.commentCount||props.hasSummary?`Submit feedback${props.commentCount?` · ${props.commentCount}`:""}`:"Finish review"}</button>}><span class="completed-pill"><Icon name="check"/>Review complete</span></Show>
      <button class="iconbtn" aria-label="Toggle Chat" aria-expanded={props.chatVisible} onClick={props.onChat}><Icon name="right"/></button>
    </div>
  </header>;
}
