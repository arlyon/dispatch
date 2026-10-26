import { Show } from "solid-js";
import type { ReviewRequest } from "../types";
import Icon from "./Icon";
import AnimatedDisclosure from "./AnimatedDisclosure";
import type { DiffMode } from "./review-ui";
export default function ChangeContext(props:{request:ReviewRequest;complete:boolean;mode:DiffMode;onMode:(mode:DiffMode)=>void;hasGutter:boolean;hasGuide:boolean;onGuide:()=>void;onOpenPR:()=>void}) {
  return <section class="review-summary">
    <div class="review-info-strip"><span class={props.complete?"state-pill submitted-state":"state-pill"}><Icon name={props.complete?"archive":"branch"}/>{props.complete?"Archived":"Local change"}</span><span class="muted">{props.request.files.length} files</span><span class="snapshot-sha mono" title={props.request.source.head}>{props.request.source.head.slice(0,7)}</span><span class="spacer"/><Show when={props.request.source.prUrl}>{url=><button class="guide-link" aria-label="Open PR" title={`Open ${url()} in your browser`} onClick={props.onOpenPR}>Open PR ↗</button>}</Show><Show when={props.hasGuide}><button class="guide-link" onClick={props.onGuide}>Review guide &amp; context ↗</button></Show><span class="local-only">Feedback stays local</span></div>
    <AnimatedDisclosure class="pr-content-card" title="Change details" preview={`${props.request.source.repo} · immutable snapshot against ${props.request.source.baseRef}`}>
      <div class="context-body"><h2>Snapshot scope</h2><p>This is a committed local revision, not a live working tree. Later edits do not change these files or comment anchors.</p><dl><dt>Repository</dt><dd>{props.request.source.repo}</dd><dt>Base</dt><dd class="mono">{props.request.source.base}</dd><dt>Head</dt><dd class="mono">{props.request.source.head}</dd></dl></div>
    </AnimatedDisclosure>
    <section class="always-visible-stack" aria-label="Revision range"><span class="stack-caption">Range</span><div class="stack-graph"><div><i class="stack-node"/><span>{props.request.source.baseRef}</span><small>Base · {props.request.source.base.slice(0,7)}</small></div><div class="current"><i class="stack-node"/><span>{props.request.source.headRef}</span><small>Current change · {props.request.source.head.slice(0,7)}</small></div></div></section>
    <div class="diff-toolbar"><div class="segmented" role="group" aria-label="Diff view"><button classList={{active:props.mode==="unified"}} aria-pressed={props.mode==="unified"} onClick={()=>props.onMode("unified")}>Unified</button><button classList={{active:props.mode==="split"}} aria-pressed={props.mode==="split"} onClick={()=>props.onMode("split")}>Split</button></div><span class="spacer"/><span class="comment-placement">Comments: {props.hasGutter?"beside":"inline"}</span></div>
  </section>;
}
