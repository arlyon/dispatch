import { Show } from "solid-js";
import type { CommentAnchor } from "../types";
import type { CommentThread } from "./SourceThread";
import Icon from "./Icon";
import { fileName } from "./review-ui";
export default function ThreadHeading(props:{group:CommentThread;open?:boolean;onToggle?:()=>void;onJump:(anchor:CommentAnchor)=>void}) {
  const label=()=>`${fileName(props.group.path)}:${props.group.line}${props.group.endLine&&props.group.endLine!==props.group.line?`–${props.group.endLine}`:""}${props.group.side==="old"?" · old":""}`;
  return <header class="comment-byline thread-heading"><button class="thread-peek" aria-label="Toggle comment thread" aria-expanded={props.open} onClick={props.onToggle}><Icon name="chevron"/></button><button class="comment-source" aria-label={`Go to ${props.group.path}:${props.group.line}`} onClick={()=>props.onJump(props.group)}>{label()}</button><span class="spacer"/><Show when={props.group.state!=="open"}><span class="thread-state">{props.group.state==="resolved"?"Resolved":"Dismissed"}</span></Show><Show when={props.group.messages.length>1}><span class="muted thread-reply-count">{props.group.messages.length-1} {props.group.messages.length===2?"reply":"replies"}</span></Show></header>;
}
