export type VerticalBlock = { top:number; bottom:number };
export type CardPosition={id:string;y:number;height:number;draft?:boolean};
export function stackCards<T extends CardPosition>(cards:T[],viewport:VerticalBlock,depth:number,strip=30){
  const count=Math.max(1,Math.min(5,Math.round(depth))),top=viewport.top,bottom=viewport.bottom,gap=8;
  const previous=cards.filter(card=>!card.draft&&card.y<top).reverse().slice(0,count);
  const next=cards.filter(card=>!card.draft&&card.y>=bottom-strip).slice(0,count);
  const normal=cards.filter(card=>!previous.includes(card)&&!next.includes(card)&&card.y<bottom&&card.y+card.height>top);
  let occupiedBottom=Math.max(-Infinity,...normal.map(card=>card.y+card.height));
  let freeTopEnd=Math.min(bottom,...normal.map(card=>card.y-gap));
  const positions=new Map<string,{y:number;peek?:"previous"|"next";motion:"flow"|"viewport";clipEnd:number}>();
  for(const [index,card] of next.entries()){
    const base=next[0].y<bottom?bottom-strip:bottom-strip*next.length;
    const slot=base+index*strip,floor=occupiedBottom+gap,y=Math.min(card.y,Math.max(slot,floor));
    positions.set(card.id,{y,peek:Math.abs(y-card.y)>.5?"next":undefined,motion:floor>slot?"flow":"viewport",clipEnd:bottom});
    // A naturally arriving card owns its FULL body/footer, not just its header.
    if(card.y<bottom)occupiedBottom=Math.max(occupiedBottom,y+card.height);
  }
  for(const [index,card] of previous.entries()){
    const y=top+index*strip,reveal=Math.min(card.height,Math.max(strip,card.y+card.height-top));
    // Reveal this actual card from its own rounded top, not a translated header.
    const clipEnd=Math.min(freeTopEnd,y+reveal);
    positions.set(card.id,{y,peek:"previous",motion:"viewport",clipEnd});
    if(card.y+card.height>top)freeTopEnd=Math.min(freeTopEnd,clipEnd-gap);
  }
  return cards.map(card=>({...card,...(positions.get(card.id)||{y:card.y,peek:undefined,motion:"flow" as const,clipEnd:bottom})}));
}
export function attachedBounds(block:VerticalBlock,height:number) {
  return {min:Math.min(block.top,block.bottom-height),max:Math.max(block.top,block.bottom-height)};
}
export function attachedTop(block:VerticalBlock,height:number,viewport:VerticalBlock,padding=0) {
  const bounds=attachedBounds(block,height);
  const centered=(block.top+block.bottom-height)/2;
  const viewportTop=viewport.top+padding,viewportBottom=Math.max(viewportTop,viewport.bottom-padding-height);
  const shifted=Math.min(viewportBottom,Math.max(viewportTop,centered));
  return Math.min(bounds.max,Math.max(bounds.min,shifted));
}
