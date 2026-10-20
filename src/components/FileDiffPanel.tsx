import { createEffect, createMemo, createSignal, onCleanup, onMount, Show, untrack } from "solid-js";
import Diff, { type DiffHandle, type InlineThread } from "../Diff";
import type { CommentAnchor, PendingComment, ReviewFile, ThreadStatus } from "../types";
import "./comments.css";
import FloatingGutter from "./FloatingGutter";
import Icon from "./Icon";
import SourceThread, { threadKey, type CommentThread } from "./SourceThread";
import { fileStats, type DiffMode } from "./review-ui";

export default function FileDiffPanel(props:{
  beside:boolean;file:ReviewFile;mode:DiffMode;readonly:boolean;readReady:boolean;reviewed:boolean;expanded:boolean;focus?:CommentAnchor;
  groups:CommentThread[];composer?:PendingComment;onBody:(value:string)=>void;onSave:()=>void;onDiscard:()=>void;onClose:()=>void;
  onComment:(anchor:CommentAnchor)=>void;onJump:(anchor:CommentAnchor)=>void;onState:(anchor:CommentAnchor,state:ThreadStatus)=>void;onRemove:(index:number)=>void;onEdit:(index:number)=>void;
  onHandle:(handle:DiffHandle|null)=>void;onRead:(read:boolean)=>void;onExpand:()=>void;onElement:(element:HTMLElement)=>void;
}) {
  let element!:HTMLDivElement;
  const [handle,setHandle]=createSignal<DiffHandle|null>(null);
  const [inlineOpen,setInlineOpen]=createSignal<Set<string>>(new Set());
  function openInline(id:string){setInlineOpen(previous=>new Set(previous).add(id));}
  const stats=()=>fileStats(props.file);
  const composerKey=createMemo(()=>props.composer?threadKey(props.composer):undefined);
  const groups=createMemo<CommentThread[]>(()=>{
    const id=composerKey(),existing=props.groups;
    if(!id||existing.some(group=>group.id===id))return existing;
    const composer=untrack(()=>props.composer)!;
    return [...existing,{id,path:composer.path,side:composer.side,line:composer.line,endLine:composer.endLine,state:"open",messages:[]}];
  });
  createEffect(()=>{const key=composerKey();if(key)openInline(key);});
  createEffect(()=>{const focus=props.focus;if(!props.beside&&focus?.path===props.file.path)openInline(threadKey(focus));});
  function content(id:string) {
    const [entered,setEntered]=createSignal(false);
    onMount(()=>{const frame=requestAnimationFrame(()=>setEntered(true));onCleanup(()=>cancelAnimationFrame(frame));});
    const open=createMemo(()=>props.beside||entered()&&(inlineOpen().has(id)||composerKey()===id));
    const editing=createMemo(()=>composerKey()===id);let inner!:HTMLDivElement;
    createEffect(()=>{if(!props.beside&&open()&&editing())queueMicrotask(()=>{if(inner.isConnected&&open()&&editing())inner.querySelector<HTMLTextAreaElement>('[data-autofocus]')?.focus({preventScroll:true});});});
    return <div data-inline-thread={id} classList={{"inline-reveal":!props.beside,"is-open":open()}}><div ref={inner} class="inline-reveal-inner" inert={!open()} aria-hidden={!open()}><Show when={groups().find(group=>group.id===id)}>{group=><SourceThread group={group()} readonly={props.readonly} focus={props.focus} composer={composerKey()===id?props.composer:undefined} onReply={props.onComment} onJump={props.onJump} onState={props.onState} onRemove={props.onRemove} onEdit={props.onEdit} onBody={props.onBody} onSave={props.onSave} onDiscard={props.onDiscard} onClose={props.onClose}/>}</Show></div></div>;
  }
  const items=createMemo<InlineThread[]>(()=>groups().map(group=>{
    const message=group.messages[0],replyCount=Math.max(0,group.messages.length-1),draft=composerKey()===group.id;
    const label=message?`${message.author} · ${message.body.split("\n")[0]}${replyCount?` · ${replyCount} replies`:""}`:"Your new comment";
    return {id:group.id,side:group.side,line:group.line,endLine:group.endLine,state:group.state,draft,expanded:props.beside?undefined:inlineOpen().has(group.id)||draft,label,content:()=>content(group.id),onOpen:()=>{if(props.beside)props.onJump(group);else setInlineOpen(previous=>{const next=new Set(previous);if(next.has(group.id))next.delete(group.id);else next.add(group.id);return next;});}};
  }));
  onMount(()=>props.onElement(element));
  return <section class="diff-layout" classList={{"has-gutter":props.beside,"reviewed-diff":props.reviewed}} ref={element} data-file-path={props.file.path}>
    <article class="file diff-card"><header class="file-header file-heading"><Icon name="file"/><button class="file-name" title={props.file.path} aria-expanded={props.expanded} onClick={props.onExpand}>{props.file.path}</button><Show when={!props.file.unavailable}><span class="stats"><span class="plus">+{stats().added}</span><span class="minus">−{stats().removed}</span></span></Show><span class="spacer"/><button class="file-reviewed" type="button" role="checkbox" aria-label={`Reviewed ${props.file.path}`} aria-checked={props.reviewed} disabled={props.readonly||!props.readReady} title={props.reviewed?"Mark unread and expand":"Mark reviewed and collapse"} onClick={()=>props.onRead(!props.reviewed)}><span class="review-check"><Show when={props.reviewed}><Icon name="check"/></Show></span>Reviewed</button></header>
      <div class="file-body" classList={{"is-open":props.expanded}}><div class="file-body-inner" inert={!props.expanded}><Show when={!props.file.unavailable} fallback={<p class="binary-note">{props.file.unavailable}</p>}><Diff file={props.file} mode={props.mode} visible={props.expanded} focus={props.focus} commentable={!props.readonly} annotations={items()} onComment={(side,line,endLine)=>props.onComment({path:props.file.path,side,line,endLine})} onReady={current=>{setHandle(current);props.onHandle(current);}} inlineThreads={props.beside?[]:items()}/></Show></div></div>
    </article>
    <Show when={props.beside&&props.expanded&&items().length>0&&handle()}>{current=><FloatingGutter handle={current()} items={items()}/>}</Show>
  </section>;
}
