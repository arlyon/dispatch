// Portalled cards are outside the workspace's native scroll ancestry.
// Consume real inner scroll space, then chain the remainder back to the source.
export function scrollCard(event:WheelEvent,workspace:HTMLElement|null) {
  if(!workspace||event.ctrlKey||event.defaultPrevented)return;
  const unit=event.deltaMode===1?25:event.deltaMode===2?workspace.clientHeight:1;
  let y=event.deltaY*unit,x=event.deltaX*unit;
  event.preventDefault();
  const card=event.currentTarget as HTMLElement;
  for(let node=event.target instanceof Element?event.target:null;node&&node!==card.parentElement;node=node.parentElement){
    const style=getComputedStyle(node);
    if(/auto|scroll/.test(style.overflowY)&&node.scrollHeight>node.clientHeight){const before=node.scrollTop;node.scrollTop=Math.max(0,Math.min(node.scrollHeight-node.clientHeight,before+y));y-=node.scrollTop-before;}
    if(/auto|scroll/.test(style.overflowX)&&node.scrollWidth>node.clientWidth){const before=node.scrollLeft;node.scrollLeft=Math.max(0,Math.min(node.scrollWidth-node.clientWidth,before+x));x-=node.scrollLeft-before;}
  }
  if(Math.abs(y)>.5||Math.abs(x)>.5){workspace.dispatchEvent(new Event("wheel"));workspace.scrollBy({top:y,left:x,behavior:"instant"});}
}
