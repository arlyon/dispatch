import { createEffect, createMemo, createSignal, For, Show, untrack } from "solid-js";
import type { CommentAnchor, PendingComment, ThreadStatus } from "../types";
import CommentComposer from "./CommentComposer";
import Markdown from "./Markdown";
import ThreadHeading from "./ThreadHeading";
import Icon from "./Icon";
export type Thread = CommentAnchor & { id:string; author:"Pi"|"You"|"Agent"; title?:string; severity?:string; body:string; index:number };
export type CommentThread = CommentAnchor & { id:string; messages:Thread[]; state:ThreadStatus };
export const threadKey=(anchor:CommentAnchor)=>JSON.stringify([anchor.path,anchor.side,anchor.line]);
export function groupComments(messages:Thread[], states:Record<string,ThreadStatus>):CommentThread[] {
  const groups=new Map<string,CommentThread>();
  for(const message of messages){const id=threadKey(message);let group=groups.get(id);if(!group){group={id,path:message.path,side:message.side,line:message.line,endLine:message.endLine,messages:[],state:states[id]||"open"};groups.set(id,group);}group.endLine=Math.max(group.endLine||group.line,message.endLine||message.line);group.messages.push(message);}
  return [...groups.values()];
}
export default function SourceThread(props:{
  group:CommentThread;readonly:boolean;focus?:CommentAnchor;composer?:PendingComment;variant?:"chat"|"source";
  onReply:(anchor:CommentAnchor)=>void;onState:(anchor:CommentAnchor,state:ThreadStatus)=>void;onRemove:(index:number)=>void;onEdit:(index:number)=>void;onJump:(anchor:CommentAnchor)=>void;
  onBody?:(value:string)=>void;onSave?:()=>void;onDiscard?:()=>void;onClose?:()=>void;
}) {
  const [expanded,setExpanded]=createSignal(true);
  const state=createMemo(()=>props.group.state);
  createEffect(()=>setExpanded(state()==="open"));
  const focused=createMemo(()=>props.focus);
  createEffect(()=>{const focus=focused(),group=untrack(()=>props.group);if(focus?.path===group.path&&focus.side===group.side&&focus.line===group.line)setExpanded(true);});
  const open=()=>expanded()||Boolean(props.composer);
  return <article class="source-thread comment-thread" classList={{"chat-thread":props.variant==="chat","closed-thread":state()!=="open"}} data-thread-line={props.group.line} data-thread-side={props.group.side}>
    <ThreadHeading group={props.group} open={open()} onToggle={()=>setExpanded(!open())} onJump={props.onJump}/>
    <div class="thread-content" classList={{"is-open":open()}}><div class="thread-content-inner" inert={!open()}>
      <For each={props.group.messages.map(message=>message.id)}>{(id,index)=>{const message=()=>props.group.messages.find(message=>message.id===id)!;return <section class="thread-message" classList={{"thread-reply":index()>0}} data-author={message().author}>
        <div class="message-jump" role="button" tabIndex={0} onClick={event=>{if(!(event.target as Element).closest("a,button")&&!window.getSelection()?.toString())props.onJump(props.group);}} onKeyDown={event=>{if(event.target===event.currentTarget&&(event.key==="Enter"||event.key===" ")){event.preventDefault();props.onJump(props.group);}}}><span class="comment-byline"><span class="comment-avatar">{message().author==="Pi"?"π":message().author==="Agent"?"A":"Y"}</span><strong>{message().author}</strong><Show when={message().severity}><span class="comment-priority">{message().severity}</span></Show><Show when={message().author==="You"&&!props.readonly}><span class="message-tools"><button class="iconbtn" aria-label="Edit comment" title="Edit comment" onClick={()=>props.onEdit(message().index)}><Icon name="edit"/></button><button class="iconbtn" aria-label="Remove comment" title="Remove comment" onClick={()=>props.onRemove(message().index)}><Icon name="trash"/></button></span></Show></span><div class="thread-body"><Markdown text={message().body}/></div></div>
      </section>;}}</For>
      <Show when={props.composer}>{composer=><CommentComposer anchor={composer()} body={composer().body} disabled={props.readonly} reply={props.group.messages.length>0} editing={composer().editingIndex!==undefined} onBody={value=>props.onBody?.(value)} onSave={()=>props.onSave?.()} onDiscard={()=>props.onDiscard?.()} onClose={()=>props.onClose?.()}/>}</Show>
    </div></div>
    <Show when={!props.readonly&&!props.composer}><div class="thread-actions"><Show when={state()==="open"} fallback={<button onClick={()=>props.onState(props.group,"open")}>Reopen thread</button>}><button onClick={()=>props.onState(props.group,"resolved")}>Resolve</button><button onClick={()=>props.onState(props.group,"dismissed")}>Dismiss</button></Show><button class="reply-action" onClick={()=>props.onReply(props.group)}>Reply</button></div></Show>
  </article>;
}
