import type { EditorView } from "@codemirror/view";
const active=new WeakMap<HTMLElement,()=>void>();
// Measure once, let the browser animate, then bound any virtual-layout correction.
export function revealComment(view:EditorView,pos:number,workspace:HTMLElement,label:string,alive:()=>boolean) {
  active.get(workspace)?.();
  let finished=false,started=false,measuring=false,corrections=0,timer:ReturnType<typeof setTimeout>|undefined;
  // Opening a composer must not race native animation against focus scrolling.
  const instant=window.matchMedia("(prefers-reduced-motion: reduce)").matches||Boolean(workspace.querySelector('textarea[aria-label="Line comment"]'));
  const scrollEnd="onscrollend" in workspace;
  function finish(){
    if(finished)return;finished=true;if(timer)clearTimeout(timer);
    workspace.removeEventListener("scroll",onScroll);workspace.removeEventListener("scrollend",onEnd);
    workspace.removeEventListener("wheel",cancel);workspace.removeEventListener("touchstart",cancel);workspace.removeEventListener("pointerdown",cancel);
    if(active.get(workspace)===cancel){active.delete(workspace);workspace.removeAttribute("data-comment-navigation");}
  }
  function cancel(){const stop=!finished&&started&&active.get(workspace)===cancel;finish();if(stop)workspace.scrollTo({top:workspace.scrollTop,behavior:"instant"});}
  function arm(delay:number){if(timer)clearTimeout(timer);timer=setTimeout(()=>measure(false),delay);}
  function onScroll(event:Event){if(event.target===workspace&&started&&!scrollEnd)arm(200);}
  function onEnd(event:Event){if(event.target===workspace&&started)measure(false);}
  function measure(initial:boolean){
    if(finished||measuring||!alive())return;measuring=true;
    view.requestMeasure({key:measure,read:()=>{
      if(finished||!alive())return null;
      const viewport=workspace.getBoundingClientRect(),actual=view.dom.getBoundingClientRect();
      const rendered=actual.top<viewport.bottom&&actual.bottom>viewport.top&&view.visibleRanges.some(range=>pos>=range.from&&pos<=range.to);
      const coords=rendered?view.coordsAtPos(pos):null,block=view.lineBlockAt(pos);
      const y=coords?(coords.top+coords.bottom)/2:view.contentDOM.getBoundingClientRect().top+block.top+block.height/2;
      return y-viewport.top-viewport.height/2;
    },write:delta=>{
      measuring=false;if(finished||!alive()||delta===null)return;
      if(Math.abs(delta)<=2){finish();return;}
      const target=Math.max(0,Math.min(workspace.scrollHeight-workspace.clientHeight,workspace.scrollTop+delta));
      if(Math.abs(target-workspace.scrollTop)<=2){finish();return;}
      if(initial||corrections++<2){started=true;workspace.scrollTo({top:target,behavior:instant?"instant":"smooth"});if(instant)measure(false);else arm(scrollEnd?5000:200);}
      else finish();
    }});
  }
  active.set(workspace,cancel);workspace.dataset.commentNavigation=label;
  workspace.addEventListener("scroll",onScroll,{passive:true});workspace.addEventListener("scrollend",onEnd);
  workspace.addEventListener("wheel",cancel,{passive:true});workspace.addEventListener("touchstart",cancel,{passive:true});workspace.addEventListener("pointerdown",cancel,{passive:true});
  measure(true);
  return cancel;
}
