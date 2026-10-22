import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validDesktopData } from '../src/desktop.ts';

const saved = () => ({
  drafts: { review: { comments: [{path:'file.rs',side:'new',line:2,body:'Saved comment'}], summary:'Unsubmitted summary',
    pending:{ line:{path:'file.rs',side:'new',line:3,body:'Unfinished edit',editingIndex:0} },threadStates:{anchor:'resolved'} } },
  navigation:{review:{path:'file.rs',filter:'file',scroll:123,mode:'split',anchor:{path:'file.rs',side:'new',line:3}}},
  selectedId:'review',placement:'auto',stackDepth:2,inboxVisible:true,chatVisible:false,expanded:{file:true},
});
test('desktop checkpoint accepts all draft/navigation state without submitting or discarding it',()=>{
  const state=saved();
  const restored=JSON.parse(JSON.stringify(state));
  assert.equal(validDesktopData(restored),true);
  assert.deepEqual(restored,state);
});
test('completed quiz summaries survive resident checkpoints without changing legacy state',()=>{
  const state={...saved(),quizSummaries:[{id:'quiz',requestId:'review',head:'commit',passed:2,failed:1,unassessed:0,endedEarly:false}]};
  const restored=JSON.parse(JSON.stringify(state));
  assert.equal(validDesktopData(restored),true);
  assert.deepEqual(restored.quizSummaries,state.quizSummaries);
  for(const invalid of [null,{},[{...state.quizSummaries[0],passed:-1}],[{...state.quizSummaries[0],endedEarly:'false'}]]){
    assert.equal(validDesktopData({...state,quizSummaries:invalid}),false);
  }
});
test('malformed restored state is rejected rather than silently clearing drafts',()=>{
  for(const mutate of [
    state=>{state.drafts.review.pending.line.line=0;},
    state=>{state.drafts.review.comments[0].body=42;},
    state=>{state.drafts.review.threadStates.anchor='unknown';},
    state=>{state.navigation.review.scroll=-1;},
    state=>{state.stackDepth=99;},
    state=>{state.expanded.file='true';},
    state=>{state.drafts=[];},
  ]){const state=saved();mutate(state);assert.equal(validDesktopData(state),false);}
});
