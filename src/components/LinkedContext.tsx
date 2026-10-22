import { createEffect, createSignal, For, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import type { ReviewRequest } from "../types";

type Source = {provider:string;url:string;sourceId:string;version:string|null;title:string;text:string;truncated:boolean};
type State = {attachment:{requestId:string;head:string;capturedAt:number;sources:Source[]}|null;frozen:boolean};
export default function LinkedContext(props:{request:ReviewRequest;locked:boolean}) {
  const [state,setState]=createSignal<State>();
  const [urls,setUrls]=createSignal("");
  const [error,setError]=createSignal("");
  const [loading,setLoading]=createSignal(false);
  let generation=0;
  createEffect(()=>{
    const id=props.request.id;const locked=props.locked;const current=++generation;
    setState(undefined);setError("");setUrls("");setLoading(false);
    void invoke<State>("linked_context_state",{id}).then(value=>{if(current===generation)setState(value);}).catch(()=>{if(current===generation)setError("Cannot read linked context. Reopen this review to retry.");});
    void locked;
  });
  async function attach(){
    const id=props.request.id,current=generation;
    setLoading(true);setError("");
    try {const value=await invoke<State>("attach_linked_context",{id,urls:urls().split(/\s+/).filter(Boolean)});if(current===generation){setState(value);setUrls("");}}
    catch(error){if(current===generation)setError(String(error));}
    finally{if(current===generation)setLoading(false);}
  }
  return <section class="linked-context" aria-label="Linked issue and page context"><details><summary>Linear / Confluence context</summary>
    <Show when={state()?.attachment} fallback={<><p>Attach one Linear issue and/or one Confluence Cloud page in a single batch before starting reviewer or quiz. Captured once for this head; never added to your feedback.</p><Show when={state()?.frozen||props.locked} fallback={<><label>Source URLs<textarea aria-label="Linked context URLs" placeholder="Paste HTTPS URLs, one per line" value={urls()} disabled={loading()||!state()} onInput={event=>setUrls(event.currentTarget.value)}/></label><button disabled={loading()||!state()||!urls().trim()} onClick={()=>void attach()}>{loading()?"Fetching context…":"Fetch & attach context"}</button></>}><p>Context frozen or archived. To attach different context, capture a new review.</p></Show></>}>
      {attachment=><><p>Captured {new Date(attachment().capturedAt*1000).toISOString()} · head {attachment().head.slice(0,7)} · untrusted reference data · not feedback</p><For each={attachment().sources}>{source=><article><strong>{source.provider}: {source.title}</strong><p>{source.url}</p><small>{source.sourceId} · version {source.version||"not supplied"}{source.truncated?" · TRUNCATED (12,000 body / 512 title bytes)":" · complete captured body"}</small><details><summary>Captured source text</summary><pre>{source.text}</pre></details></article>}</For></>}
    </Show><Show when={error()}><p role="status">{error()}</p></Show>
  </details></section>;
}
