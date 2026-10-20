import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachedTop, stackCards } from '../src/components/stickyGeometry.ts';
const viewport={top:0,bottom:400};
test('real future cards stack by depth with no substitute card records',()=>{
  const cards=[{id:'current',y:140,height:120},{id:'next',y:900,height:200},{id:'later',y:1200,height:200},{id:'last',y:1500,height:200}];
  for(const depth of [1,2,3]){const placed=stackCards(cards,viewport,depth);assert.equal(placed.length,cards.length);assert.deepEqual(placed.map(c=>c.id),cards.map(c=>c.id));assert.equal(placed.filter(c=>c.peek==='next').length,depth);assert.equal(placed[0].y,140);assert.equal(placed[1].y,400-30*depth);}
});
test('previous real cards expose their own headings; active editors never become peeks',()=>{
  const cards=[{id:'old',y:-1000,height:200},{id:'recent',y:-500,height:200},{id:'editing',y:900,height:200,draft:true}];
  const placed=stackCards(cards,viewport,2);assert.equal(placed[0].y,30);assert.equal(placed[0].clipEnd,60);assert.equal(placed[1].y,0);assert.equal(placed[1].clipEnd,30);assert.equal(placed[1].motion,'viewport');assert.equal(placed[2].y,900);assert.equal(placed[2].peek,undefined);
});
test('diagram: greet before line enters bottom, center when possible, then leave with top edge',()=>{
  const y=top=>attachedTop({top,bottom:top+25},200,viewport);
  assert.equal(y(420),245); // only the top of the card is visible before its line arrives
  assert.equal(y(350),200); // viewport bottom constrains the card
  assert.equal(y(180),92.5); // ordinary centered placement
  assert.equal(y(10),0); // viewport top constrains the card
  assert.equal(y(-60),-60); // its top may not move below the attached line block
  assert.equal(y(-240),-240); // scrolls out naturally; no file-wide sticky hold
});
test('never detach from a line; stay inside a range taller than the card',()=>{
  for(const height of [32,100,200,500])for(const span of [1,25,150,700])for(let top=-600;top<=800;top+=7){
    const bottom=top+span,y=attachedTop({top,bottom},height,viewport);
    if(height>=span){assert.ok(y<=top+1e-9);assert.ok(y+height>=bottom-1e-9);}
    else{assert.ok(y>=top-1e-9);assert.ok(y+height<=bottom+1e-9);}
  }
});
test('screenshots: next real card waits for the entire current body/footer',()=>{
  for(const bottom of [420,400,395,380,360,320]){
    const current={id:'current',y:100,height:bottom-100},next={id:'next',y:900,height:200};
    const placed=stackCards([current,next],viewport,1),card=placed[1];
    assert.ok(card.y>=bottom+8,'peek never covers current body/footer');
    assert.equal(Math.max(0,400-card.y),Math.min(30,Math.max(0,400-bottom-8)),'peek slides into only available pixels');
  }
  const near=stackCards([{id:'arriving',y:380,height:200},{id:'future',y:900,height:200}],viewport,2);
  assert.ok(near[1].y>=near[0].y+near[0].height+8,'a greeting header does not let another card cover its body');
});
test('previous peeks clip at occupied space; viewport edges have no inset',()=>{
  const placed=stackCards([{id:'old',y:-500,height:200},{id:'current',y:0,height:200}],viewport,1);
  assert.ok(placed[0].clipEnd<=0,'no previous peek through occupied top edge');
  const free=stackCards([{id:'old',y:-500,height:200},{id:'current',y:50,height:200}],viewport,1);
  assert.equal(free[0].y,0);assert.equal(free[0].clipEnd,30);
});
test('previous reveal shows the actual rounded card top and grows continuously',()=>{
  for(let y=-250;y<0;y++){
    const card=stackCards([{id:'previous',y,height:200},{id:'current',y:350,height:40}],viewport,1)[0];
    assert.equal(card.y,0);assert.equal(card.clipEnd,Math.min(200,Math.max(30,y+200)));assert.equal(card.motion,'viewport');
  }
});
test('movement is continuous and monotonic as the source scrolls',()=>{
  let previous=Infinity;
  for(let top=800;top>=-800;top--){const y=attachedTop({top,bottom:top+25},200,viewport);assert.ok(y<=previous);if(previous!==Infinity)assert.ok(previous-y<=1.01);previous=y;}
});
