import {test} from 'node:test';
import assert from 'node:assert/strict';
import {suppressesPR} from '../src/pr-dispositions.ts';
const rule={url:'https://github.com/acme/repo/pull/42',title:'PR',head:null,until:null};
test('whole-PR ignore persists across commits until explicitly restored',()=>{
  for(const head of [null,undefined,'a'.repeat(40),'b'.repeat(40)])assert.equal(suppressesPR(rule,head,100),true);
});
test('revision ignore returns only after a verified different head, not a failed check',()=>{
  const revision={...rule,head:'a'.repeat(40)};
  for(const head of [null,undefined,'A'.repeat(40)])assert.equal(suppressesPR(revision,head,100),true);
  assert.equal(suppressesPR(revision,'b'.repeat(40),100),false);
});
test('snooze survives polling and expires at the deadline regardless of head changes',()=>{
  const snoozed={...rule,until:200};
  assert.equal(suppressesPR(snoozed,'a'.repeat(40),199),true);
  assert.equal(suppressesPR(snoozed,'b'.repeat(40),200),false);
  assert.equal(suppressesPR(snoozed,null,201),false);
});
