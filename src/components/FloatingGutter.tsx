import { For, onCleanup, onMount, untrack, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import type { DiffHandle, InlineThread } from "../Diff";
import { scrollCard } from "./cardScrolling";
function FloatingCard(props:{item:()=>InlineThread;path:string;content:()=>JSX.Element;workspace:()=>HTMLElement|null}) {
  let element!:HTMLDivElement;
  // One subtree for this thread throughout normal, stacked and peeking layouts.
  const content=untrack(props.content);
  const jump=(event:Event)=>{if(element.dataset.peeking){event.preventDefault();event.stopPropagation();props.item().onOpen?.();}};
  onMount(()=>{element.addEventListener("click",jump,true);});
  onCleanup(()=>{element.removeEventListener("click",jump,true);});
  return <div ref={element} class="floating-gutter-thread" data-thread={props.item().id} data-path={props.path} data-side={props.item().side} data-line={props.item().line} data-end-line={props.item().endLine||props.item().line} data-draft={props.item().draft?"true":"false"} onWheel={event=>scrollCard(event,props.workspace())} onKeyDown={event=>{if(event.target===element&&(event.key==="Enter"||event.key===" "))jump(event);}}>{content}</div>;
}
export default function FloatingGutter(props:{handle:DiffHandle;items:InlineThread[]}) {
  const path=props.handle.element.closest<HTMLElement>(".diff-layout")!.dataset.filePath!;
  const workspace=props.handle.element.closest<HTMLElement>(".workspace")!;
  return <Portal mount={workspace} ref={container=>{container.style.display="contents";}}><For each={props.items.map(item=>item.id)}>{id=><FloatingCard path={path} item={()=>props.items.find(item=>item.id===id)!} workspace={()=>props.handle.element.closest<HTMLElement>(".workspace")} content={()=>props.items.find(item=>item.id===id)?.content()}/>}</For></Portal>;
}
