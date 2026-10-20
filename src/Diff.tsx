import { createEffect, createMemo, onCleanup, onMount, untrack, type JSX } from "solid-js";
import { render } from "solid-js/web";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, highlightActiveLine, lineNumbers, gutter, GutterMarker, WidgetType } from "@codemirror/view";
import { HighlightStyle, LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { getChunks, MergeView, unifiedMergeView, uncollapseUnchanged } from "@codemirror/merge";
import { tags } from "@lezer/highlight";
import type { CommentAnchor, ReviewFile, ThreadStatus } from "./types";
import type { DiffMode } from "./components/review-ui";
import { revealComment } from "./commentNavigation";

type Side = "old" | "new";
export type InlineThread = { id: string; side: Side; line: number; endLine?:number; content: () => JSX.Element; label?:string; state?:ThreadStatus; draft?:boolean; expanded?:boolean; onOpen?:()=>void };
export type DiffHandle = {
  element: HTMLElement;
  bounds:()=>DOMRect;
  rect: (side: Side, line: number, endLine?:number) => DOMRect | null;
  subscribe: (update: () => void) => () => void;
};
class ThreadWidget extends WidgetType {
  private dispose?: () => void;
  private resize?:ResizeObserver;
  constructor(readonly id: string, readonly content: () => JSX.Element) { super(); }
  eq(other: ThreadWidget) { return other.id === this.id; }
  toDOM(view:EditorView) { const element=document.createElement("div"); element.className="inline-thread-widget"; this.dispose=render(this.content,element);const size=()=>{const gutter=view.scrollDOM.querySelector<HTMLElement>('.cm-gutters')?.clientWidth||0,width=Math.max(0,view.scrollDOM.clientWidth-gutter),value=`${width}px`;if(element.style.width!==value)element.style.width=value;element.style.left=`${gutter}px`;};size();this.resize=new ResizeObserver(()=>{size();view.requestMeasure();});this.resize.observe(element);this.resize.observe(view.scrollDOM);return element; }
  destroy() { this.resize?.disconnect();this.dispose?.(); }
  ignoreEvent() { return true; }
}
class CommentMarker extends GutterMarker {
  constructor(readonly count:number) { super(); }
  eq(other:CommentMarker) { return this.count===other.count; }
  toDOM() { const marker=document.createElement("span");marker.className=this.count?"cm-comment-marked":"cm-comment-add";marker.textContent=this.count?"":"+";marker.title=this.count?`${this.count} comment${this.count===1?"":"s"} on this line` : "Add a line comment";marker.setAttribute("aria-label",marker.title);return marker; }
}
class BlameHint extends WidgetType {
  constructor(readonly thread:InlineThread){super();}
  eq(other:BlameHint){return this.thread.id===other.thread.id&&this.thread.label===other.thread.label&&this.thread.state===other.thread.state&&this.thread.expanded===other.thread.expanded;}
  toDOM(){const button=document.createElement("button");button.type="button";button.className="comment-blame-hint"+(this.thread.state&&this.thread.state!=="open"?" is-closed":"");button.textContent=(this.thread.state&&this.thread.state!=="open"?`${this.thread.state} · `:"")+(this.thread.label||"Comment thread");button.title=button.textContent;button.setAttribute("aria-label",`${this.thread.expanded===undefined?"Go to":"Toggle"} comment thread on ${this.thread.side} line ${this.thread.line}`);if(this.thread.expanded!==undefined)button.setAttribute("aria-expanded",String(this.thread.expanded));button.onclick=event=>{event.preventDefault();event.stopPropagation();this.thread.onOpen?.();};return button;}
  ignoreEvent(){return true;}
}
const colors = syntaxHighlighting(HighlightStyle.define([
  {tag:tags.keyword,color:"var(--syntax-keyword)"}, {tag:[tags.string,tags.special(tags.string)],color:"var(--syntax-string)"},
  {tag:tags.function(tags.variableName),color:"var(--syntax-function)"}, {tag:[tags.number,tags.bool,tags.null],color:"var(--syntax-number)"},
  {tag:[tags.typeName,tags.className],color:"var(--syntax-type)"}, {tag:tags.comment,color:"var(--muted)"},
  {tag:tags.tagName,color:"var(--syntax-tag)"}, {tag:tags.propertyName,color:"var(--text)"},
]));
const theme=EditorView.theme({
  "&":{backgroundColor:"var(--bg)",color:"var(--text)",fontSize:"var(--code-font-size)"},
  ".cm-content":{padding:"8px 0",caretColor:"var(--accent)"}, ".cm-line":{padding:"0 12px"},
  ".cm-scroller":{fontFamily:"var(--mono)",lineHeight:"var(--code-line-height)",overflowX:"auto"},
  ".cm-gutters":{backgroundColor:"var(--bg)",color:"var(--subtle)",border:"none"},
  ".cm-lineNumbers .cm-gutterElement":{minWidth:"38px",paddingRight:"10px"},
  ".cm-lineNumbers .cm-gutterElement:hover":{color:"var(--accent)",backgroundColor:"var(--surface)",cursor:"crosshair"},
  ".cm-activeLine":{backgroundColor:"var(--selection-faint)"}, ".cm-activeLineGutter":{color:"var(--text-secondary)"},
  ".cm-insertedLine":{backgroundColor:"var(--diff-add)"}, ".cm-deletedChunk":{backgroundColor:"var(--diff-remove)"},
  ".cm-insertedText, .cm-deletedText":{backgroundColor:"transparent",textDecoration:"none"},
}, {dark:true});

export default function Diff(props:{file:ReviewFile;mode:DiffMode;visible:boolean;focus?:CommentAnchor;commentable:boolean;annotations:InlineThread[];inlineThreads:InlineThread[];onComment:(side:Side,line:number,endLine?:number)=>void;onReady:(handle:DiffHandle|null)=>void}) {
  let element!:HTMLDivElement;
  onMount(()=>{
    createEffect(()=>{
      const mode=props.mode;
      const listeners=new Set<()=>void>();
      const views:Partial<Record<Side,EditorView>>={};
      const languagesFor: {view:EditorView;language:Compartment;widgets:Compartment;side:Side}[]=[];
      let disposed=false;
      const notify=()=>{for(const listener of listeners)listener();};
      let cancelDrag=()=>{};
      function beginComment(view:EditorView,side:Side,start:number,event:MouseEvent){
        if(!props.commentable||event.button!==0)return;
        cancelDrag();
        const finish=(end:MouseEvent)=>{
          cancelDrag();if(disposed)return;
          const box=view.contentDOM.getBoundingClientRect(),pos=view.posAtCoords({x:Math.max(box.left+2,Math.min(end.clientX,box.right-2)),y:end.clientY},false);
          const text=side==="old"?props.file.before:props.file.after,max=Math.max(1,text.split("\n").length-(text.endsWith("\n")?1:0));
          const origin=Math.min(start,max),last=side==="old"&&!views.old||pos===null?origin:Math.min(max,view.state.doc.lineAt(Math.max(0,Math.min(pos,view.state.doc.length))).number);
          const first=Math.min(origin,last),through=Math.max(origin,last);
          props.onComment(side,first,through>first?through:undefined);
        };
        cancelDrag=()=>{window.removeEventListener("mouseup",finish);window.removeEventListener("blur",cancelDrag);};
        window.addEventListener("mouseup",finish,{once:true});window.addEventListener("blur",cancelDrag,{once:true});
      }
      function extensions(side:Side) {
        const language=new Compartment(),widgets=new Compartment();
        const extensions:Extension[]=[EditorState.readOnly.of(true),EditorView.editable.of(false),theme,colors,highlightActiveLine(),
          lineNumbers({domEventHandlers:{mousedown(view,line,event){beginComment(view,side,view.state.doc.lineAt(line.from).number,event as MouseEvent);return true;}}}),
          EditorView.domEventHandlers({mousedown(event,view){const target=event.target as Element;if(!target.closest('.cm-line')||target.closest('.comment-blame-hint,.inline-thread-widget,button,a,textarea'))return false;const pos=view.posAtCoords({x:event.clientX,y:event.clientY},false);if(pos!==null)beginComment(view,side,view.state.doc.lineAt(pos).number,event);return false;}}),
          language.of([]),widgets.of([]),EditorView.updateListener.of(update=>{if(update.viewportChanged||update.geometryChanged)notify();})];
        return {language,widgets,extensions};
      }
      let destroy:()=>void;
      if(mode==="split") {
        const a=extensions("old"),b=extensions("new");
        const merge=new MergeView({parent:element,a:{doc:props.file.before,extensions:a.extensions},b:{doc:props.file.after,extensions:b.extensions},highlightChanges:true,gutter:true,collapseUnchanged:{margin:4,minSize:12}});
        views.old=merge.a;views.new=merge.b;
        languagesFor.push({view:merge.a,...a,side:"old"},{view:merge.b,...b,side:"new"});
        destroy=()=>merge.destroy();
      } else {
        const config=extensions("new");
        const view=new EditorView({parent:element,doc:props.file.after,extensions:[...config.extensions,unifiedMergeView({original:props.file.before,mergeControls:false,highlightChanges:true,syntaxHighlightDeletions:true,collapseUnchanged:{margin:4,minSize:12}})]});
        views.new=view; languagesFor.push({view,...config,side:"new"}); destroy=()=>view.destroy();
      }
      const before=EditorState.create({doc:props.file.before}).doc;
      function position(side:Side,line:number) {
        const direct=views[side];
        if(direct) return {view:direct,pos:direct.state.doc.line(Math.max(1,Math.min(line,direct.state.doc.lines))).from};
        const view=views.new!;
        // A deleted line in unified mode is anchored to its library-provided change chunk.
        const oldPos=before.line(Math.max(1,Math.min(line,before.lines))).from;
        const chunks=getChunks(view.state)?.chunks||[];
        const chunk=chunks.find(chunk=>oldPos>=chunk.fromA&&oldPos<chunk.toA);
        const previous=chunks.filter(chunk=>chunk.toA<=oldPos).slice(-1)[0];
        return {view,pos:Math.min(view.state.doc.length,chunk?.fromB??oldPos+(previous?previous.toB-previous.toA:0))};
      }
      props.onReady({element,bounds:()=>(element.closest('.diff-layout')||element).getBoundingClientRect(),rect(side,line,endLine){
        if(!props.visible)return null;
        const {view,pos}=position(side,line),rendered=(position:number)=>view.visibleRanges.some(range=>position>=range.from&&position<=range.to);
        const coords=rendered(pos)?view.coordsAtPos(pos):null;
        const block=view.lineBlockAt(pos),documentTop=view.contentDOM.getBoundingClientRect().top,top=coords?.top??documentTop+block.top;
        const end=position(side,Math.max(line,endLine||line)).pos,endCoords=rendered(end)?view.coordsAtPos(end):null,endBlock=view.lineBlockAt(end);
        const bottom=endCoords?.bottom??documentTop+endBlock.top+endBlock.height;
        return new DOMRect(element.getBoundingClientRect().right,top,0,Math.max(1,bottom-top));
      },subscribe(update){listeners.add(update);return()=>listeners.delete(update);}});
      const description=LanguageDescription.matchFilename(languages,props.file.path);
      if(description)void description.load().then(support=>{if(!disposed)for(const {view,language}of languagesFor)view.dispatch({effects:language.reconfigure(support)});}).catch(()=>{});
      createEffect(()=>{
        const focus=props.focus;
        if(focus?.path===props.file.path){
          const {view,pos}=position(focus.side,focus.line);
          const workspace=element.closest<HTMLElement>(".workspace");
          view.dispatch({selection:{anchor:pos},effects:uncollapseUnchanged.of(pos)});
          if(workspace)onCleanup(revealComment(view,pos,workspace,`${focus.path}:${focus.side}:${focus.line}`,()=>!disposed));
        }
      });
      const widgetPositions=createMemo(()=>props.inlineThreads.map(thread=>`${thread.id}:${thread.side}:${thread.line}:${thread.endLine}`).join("|"));
      const markerPositions=createMemo(()=>props.annotations.map(thread=>`${thread.side}:${thread.line}:${thread.endLine}:${thread.state}:${thread.label}:${thread.expanded}`).join("|"));
      createEffect(()=>{
        widgetPositions();markerPositions();
        const threads=untrack(()=>props.inlineThreads),annotations=untrack(()=>props.annotations);
        for(const entry of languagesFor){
          const markers=new Map<number,{count:number;side:Side;line:number}>();
          for(const annotation of annotations.filter(annotation=>mode==="unified"||annotation.side===entry.side)) {
            const target=position(annotation.side,annotation.line),from=entry.view.state.doc.lineAt(target.pos).from;
            const previous=markers.get(from);markers.set(from,{count:(previous?.count||0)+1,side:annotation.side,line:annotation.line});
          }
          const commentGutter=gutter({class:"cm-commentGutter",renderEmptyElements:true,initialSpacer:()=>new CommentMarker(0),lineMarker:(_view,line)=>new CommentMarker(markers.get(line.from)?.count||0),domEventHandlers:{mousedown(view,line,event){const existing=markers.get(line.from);beginComment(view,existing?.side||entry.side,existing?.line||view.state.doc.lineAt(line.from).number,event as MouseEvent);return true;}}});
          const ranges=threads.filter(thread=>mode==="unified"||thread.side===entry.side).map(thread=>{const target=position(thread.side,Math.max(thread.line,thread.endLine||thread.line)),line=entry.view.state.doc.lineAt(target.pos),next=line.to<entry.view.state.doc.length;return Decoration.widget({widget:new ThreadWidget(thread.id,thread.content),block:true,side:next?-1:1}).range(line.to+(next?1:0));});
          const highlights=annotations.filter(thread=>mode==="unified"||thread.side===entry.side).flatMap(thread=>{
            const end=Math.max(thread.line,thread.endLine||thread.line),lines=[];
            for(let number=thread.line;number<=end;number++){const {pos}=position(thread.side,number);lines.push(Decoration.line({class:thread.state&&thread.state!=="open"?"cm-comment-line cm-comment-line-closed":"cm-comment-line"}).range(entry.view.state.doc.lineAt(pos).from));}
            const last=entry.view.state.doc.lineAt(position(thread.side,end).pos);
            return [...lines,Decoration.widget({widget:new BlameHint(thread),side:1}).range(last.to)];
          });
          entry.view.dispatch({effects:entry.widgets.reconfigure([commentGutter,EditorView.decorations.of(Decoration.set([...highlights,...ranges],true))])});
        }
      });
      onCleanup(()=>{disposed=true;cancelDrag();props.onReady(null);listeners.clear();destroy();});
    });
  });
  return <div class="diff-editor" ref={element} aria-label={`Diff for ${props.file.path}`} data-mode={props.mode}/>;
}
