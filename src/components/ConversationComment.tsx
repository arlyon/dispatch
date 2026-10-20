import type { CommentAnchor, ThreadStatus } from "../types";
import type { CommentThread } from "./SourceThread";
import { fileName } from "./review-ui";
import Icon from "./Icon";
export default function ConversationComment(props:{group:CommentThread;readonly:boolean;onJump:(anchor:CommentAnchor)=>void;onReply:(anchor:CommentAnchor)=>void;onState:(anchor:CommentAnchor,state:ThreadStatus)=>void;onRemove:(index:number)=>void}) {
  const message=()=>props.group.messages[0];
  return <button class="chat-thread-link" aria-label={`Go to ${props.group.path}:${props.group.line}`} onClick={()=>props.onJump(props.group)}><span class="chat-thread-location"><Icon name="comment"/><strong>{fileName(props.group.path)}:{props.group.line}{props.group.endLine&&props.group.endLine!==props.group.line?`–${props.group.endLine}`:""}</strong><span class="spacer"/><span class={`thread-outcome ${props.group.state}`}>{props.group.state==="open"?`${props.group.messages.length} comments`:props.group.state}</span></span><span class="chat-thread-preview">{message()?.author} · {message()?.body.split("\n")[0]}</span></button>;
}
