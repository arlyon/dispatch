import { createSignal, onMount, Show } from "solid-js";
import type { CommentAnchor } from "../types";
export default function CommentComposer(props:{anchor:CommentAnchor;body:string;disabled:boolean;reply?:boolean;editing?:boolean;onBody:(value:string)=>void;onSave:()=>void;onDiscard:()=>void;onClose:()=>void}) {
  let input!:HTMLTextAreaElement;
  const [confirm,setConfirm]=createSignal(false);
  const cancel=()=>{if(props.disabled)return;if(props.body.trim())setConfirm(true);else props.onDiscard();};
  onMount(()=>requestAnimationFrame(()=>{if(input.isConnected)input.focus({preventScroll:true});}));
  function key(event:KeyboardEvent){
    if((event.metaKey||event.ctrlKey)&&event.key==="Enter"){event.preventDefault();event.stopPropagation();if(!props.disabled&&props.body.trim())props.onSave();}
    if(event.key==="Escape"){event.preventDefault();cancel();}
  }
  return <form class="inline-compose" onSubmit={event=>{event.preventDefault();if(!props.disabled)props.onSave();}}><div class="compose-heading"><strong>{props.editing?"Edit comment":props.reply?"Reply":"Comment"}</strong><span class="comment-source">{props.anchor.side}:{props.anchor.line}{props.anchor.endLine?`–${props.anchor.endLine}`:""}</span><span class="spacer"/><small>⌘↵ to save</small></div><textarea ref={input} aria-label="Line comment" placeholder={props.reply?"Reply to this thread…":"What should change here?"} value={props.body} readOnly={props.disabled} data-autofocus onInput={event=>{setConfirm(false);props.onBody(event.currentTarget.value);}} onKeyDown={key}/><div class="review-actions"><Show when={confirm()} fallback={<><button type="button" class="text-action" disabled={props.disabled} onClick={cancel}>Cancel</button><span class="spacer"/><button class="small-primary" type="submit" disabled={props.disabled||!props.body.trim()}>{props.editing?"Save changes":props.reply?"Save reply":"Save comment"}</button></>}><span class="cancel-question">Discard this draft?</span><span class="spacer"/><button type="button" class="text-action" onClick={()=>{setConfirm(false);input.focus();}}>Keep editing</button><button type="button" class="text-action" disabled={props.disabled} onClick={props.onDiscard}>Discard</button></Show></div></form>;
}
