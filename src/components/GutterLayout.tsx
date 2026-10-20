import { createEffect, onCleanup, onMount } from "solid-js";
import { computePosition, offset } from "@floating-ui/dom";
import type { DiffHandle } from "../Diff";
import type { CommentThread } from "./SourceThread";
import { attachedBounds, attachedTop, stackCards } from "./stickyGeometry";
type AnchorGeometry={key:string;top:number;bottom:number;right:number;height:number};
const px=(value:number)=>`${Math.round(value*64)/64}px`;
const writtenStyles=new WeakMap<HTMLElement,Record<string,string>>();
function styles(node:HTMLElement,values:Record<string,string>){const previous=writtenStyles.get(node)||{};for(const [key,value] of Object.entries(values))if(previous[key]!==value){node.style.setProperty(key,value);previous[key]=value;}writtenStyles.set(node,previous);}
// Flowing cards keep stable document coordinates; pinned cards use the viewport.
export default function GutterLayout(props:{groups:CommentThread[];handles:ReadonlyMap<string,DiffHandle>;revision:number;workspace:()=>HTMLElement|undefined;wide:boolean;stackDepth:number}) {
  const focused=new WeakSet<HTMLTextAreaElement>();
  onMount(()=>createEffect(()=>{
    props.revision;props.groups;props.wide;props.stackDepth;
    const workspace=props.workspace();if(!workspace)return;
    let frame=0,alive=true,scrolling=false,dirty=true,settle:ReturnType<typeof setTimeout>|undefined;
    const observed=new WeakSet<HTMLElement>(),anchors=new WeakMap<HTMLElement,AnchorGeometry>(),horizontal=new WeakMap<HTMLElement,{key:string;x:number}>();
    function update(measure=false){
      if(!props.wide)return;
      const viewport=workspace!.getBoundingClientRect(),scrollTop=workspace!.scrollTop,scrollLeft=workspace!.scrollLeft;
      const nodes=Array.from(workspace!.querySelectorAll<HTMLElement>('.floating-gutter-thread[data-thread]'));
      const measured=nodes.map((node,index)=>{
        if(!observed.has(node)){observed.add(node);sizes.observe(node);}
        const path=node.dataset.path!,side=node.dataset.side as "old"|"new",line=Number(node.dataset.line),endLine=Number(node.dataset.endLine),key=`${path}:${side}:${line}:${endLine}`;
        const handle=props.handles.get(path);if(!handle)return null;
        let geometry=anchors.get(node);
        if(!geometry||geometry.key!==key||measure){
          const rect=handle.rect(side,line,endLine);if(!rect){styles(node,{visibility:"hidden"});return null;}
          geometry={key,top:rect.top-viewport.top+scrollTop,bottom:rect.bottom-viewport.top+scrollTop,right:rect.right-viewport.left+scrollLeft,height:node.getBoundingClientRect().height};anchors.set(node,geometry);
        }
        // No viewport DOM measurement of source anchors in the scroll path.
        const rect=new DOMRect(geometry.right+viewport.left-scrollLeft,geometry.top+viewport.top-scrollTop,0,geometry.bottom-geometry.top),height=geometry.height;
        return {id:node.dataset.thread!,node,index,path,side,line,handle,rect,height,documentRight:geometry.right,y:attachedTop(rect,height,viewport),draft:node.dataset.draft==="true",...attachedBounds(rect,height)};
      });
      const normal=measured.filter(card=>card!==null).sort((a,b)=>a.rect.top-b.rect.top||a.index-b.index);
      for(let i=1;i<normal.length;i++)normal[i].y=Math.min(normal[i].max,Math.max(normal[i].y,normal[i-1].y+normal[i-1].height+8));
      for(let i=normal.length-2;i>=0;i--)normal[i].y=Math.max(normal[i].min,Math.min(normal[i].y,normal[i+1].y-normal[i].height-8));
      const cards=stackCards(normal,viewport,props.stackDepth);
      for(const [index,card] of cards.entries()){
        const visible=card.y<Math.min(viewport.bottom,card.clipEnd)&&card.y+card.height>viewport.top&&card.clipEnd>viewport.top;
        const pinned=card.peek?card.motion==="viewport":Math.abs(card.y-viewport.top)<.01||Math.abs(card.y+card.height-viewport.bottom)<.01;
        const xKey=String(card.rect.right),cached=horizontal.get(card.node),viewportX=cached?.key===xKey?cached.x:card.rect.right+16;
        const clipTop=pinned?Math.max(0,viewport.top-card.y):0,clipBottom=pinned?Math.min(card.height,Math.max(0,card.y+card.height-Math.min(viewport.bottom,card.clipEnd))):0;
        styles(card.node,{position:pinned?"fixed":"absolute",left:px(pinned?viewportX:card.documentRight+16),top:px(pinned?card.y:card.y-viewport.top+scrollTop),visibility:"visible",opacity:"1",transform:"none","pointer-events":visible?"auto":"none","--peek-cut":px(clipBottom),"clip-path":clipTop||clipBottom?`inset(${px(clipTop)} 0 ${px(clipBottom)} 0${card.peek==="previous"?" round 0px 0px 6px 6px":""})`:"none","z-index":String(card.draft?80:20+Math.min(index,50)),transition:"none"});
        card.node.dataset.plane=pinned?"viewport":"flow";
        if(card.node.inert===visible)card.node.inert=!visible;
        if(card.node.getAttribute("aria-hidden")!==String(!visible))card.node.setAttribute("aria-hidden",String(!visible));
        const article=card.node.querySelector<HTMLElement>(".source-thread");if(article&&article.inert!==Boolean(card.peek))article.inert=Boolean(card.peek);
        if(card.peek){card.node.dataset.peeking=card.peek;card.node.setAttribute("role","button");card.node.tabIndex=0;card.node.setAttribute("aria-label",`${card.peek==="previous"?"Previous":"Next"} comment: ${card.path}:${card.line}`);card.node.title="Click to jump to this comment";}
        else{delete card.node.dataset.peeking;card.node.removeAttribute("role");card.node.removeAttribute("tabindex");card.node.removeAttribute("aria-label");card.node.removeAttribute("title");}
        if(pinned&&cached?.key!==xKey){
          const entry={key:xKey,x:viewportX};horizontal.set(card.node,entry);
          const reference={contextElement:card.handle.element,getBoundingClientRect:()=>card.rect};
          void computePosition(reference,card.node,{strategy:"fixed",placement:"right-start",middleware:[offset(16)]}).then(position=>{if(alive&&horizontal.get(card.node)===entry&&card.node.isConnected){if(card.node.dataset.plane!=="viewport"){horizontal.delete(card.node);return;}entry.x=position.x;styles(card.node,{left:px(entry.x)});}});
        }
        const input=card.node.querySelector<HTMLTextAreaElement>("[data-autofocus]");if(visible&&!card.peek&&input&&!focused.has(input)){focused.add(input);input.focus({preventScroll:true});}
      }
      if(measure)dirty=false;
    }
    const schedule=()=>{dirty=true;if(frame)cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{frame=0;update(!scrolling&&dirty);});};
    const markScrolling=()=>{scrolling=true;if(settle)clearTimeout(settle);settle=setTimeout(()=>{scrolling=false;if(dirty)update(true);},120);};
    const beginScroll=(event:Event)=>{if(event.target instanceof Node&&workspace!.contains(event.target))markScrolling();};
    const followScroll=()=>{markScrolling();if(frame){cancelAnimationFrame(frame);frame=0;}update(false);};
    const sizes=new ResizeObserver(entries=>{for(const entry of entries){const geometry=anchors.get(entry.target as HTMLElement);if(geometry&&entry.contentRect.height>0)geometry.height=entry.contentRect.height;}schedule();}),observer=new MutationObserver(schedule);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["data-draft","data-line","data-end-line","data-side"]});
    const subscriptions=[...props.handles.values()].map(handle=>handle.subscribe(schedule));
    document.addEventListener("wheel",beginScroll,{capture:true,passive:true});document.addEventListener("touchmove",beginScroll,{capture:true,passive:true});
    document.addEventListener("scroll",followScroll,true);document.addEventListener("input",schedule,true);document.addEventListener("load",schedule,true);document.addEventListener("mouseup",schedule,true);window.addEventListener("resize",schedule);schedule();
    onCleanup(()=>{alive=false;if(frame)cancelAnimationFrame(frame);if(settle)clearTimeout(settle);sizes.disconnect();observer.disconnect();subscriptions.forEach(stop=>stop());document.removeEventListener("wheel",beginScroll,true);document.removeEventListener("touchmove",beginScroll,true);document.removeEventListener("scroll",followScroll,true);document.removeEventListener("input",schedule,true);document.removeEventListener("load",schedule,true);document.removeEventListener("mouseup",schedule,true);window.removeEventListener("resize",schedule);});
  }));
  return null;
}
