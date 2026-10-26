export type PRDisposition = { url:string; title:string; head:string|null; until:number|null };
export type DismissAction = "snoozeHour"|"snoozeDay"|"ignoreRevision"|"ignorePr";
export function suppressesPR(rule:PRDisposition, head:string|null|undefined, now:number):boolean {
  if(rule.until!==null)return rule.until>now;
  // Failed/unknown head checks never undo a user's explicit ignore.
  return rule.head===null||!head||rule.head.toLowerCase()===head.toLowerCase();
}
