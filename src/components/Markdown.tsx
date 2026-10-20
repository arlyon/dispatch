import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { invoke } from "@tauri-apps/api/core";
const remoteImage=(url:string)=>{try{return new URL(url).protocol==="https:";}catch{return false;}};
const reference=(value:string)=>{try{return decodeURIComponent(value);}catch{return value;}};
const localImage=(url:string)=>url.includes("/attachments/")&&(url.startsWith("/")||/^[a-zA-Z]:[\\/]/.test(url));
DOMPurify.addHook("afterSanitizeAttributes",node=>{
  if(node.tagName!=="IMG")return;
  if(!remoteImage(node.getAttribute("src")||""))node.removeAttribute("src");
  node.setAttribute("referrerpolicy","no-referrer");node.setAttribute("loading","lazy");node.setAttribute("decoding","async");
});
export default function Markdown(props:{text:string}) {
  let element!:HTMLDivElement,revision=0;
  const html=createMemo(()=>DOMPurify.sanitize(marked.parse(props.text,{async:false,gfm:true}),{USE_PROFILES:{html:true},FORBID_TAGS:["style","video","audio","iframe","picture","source","form","input","textarea","button","select","option"],FORBID_ATTR:["style","srcset"],ALLOW_DATA_ATTR:false,ALLOWED_URI_REGEXP:/^(?:(?:https?|mailto):|\/|[a-zA-Z]:[\\/]|#)/}));
  const [preview,setPreview]=createSignal("");
  const [error,setError]=createSignal("");
  function close(){const previous=preview();setPreview("");if(previous.startsWith("blob:"))URL.revokeObjectURL(previous);}
  onCleanup(()=>{revision++;close();});
  createEffect(()=>{if(!preview())return;const key=(event:KeyboardEvent)=>{if(event.key==="Escape"){event.preventDefault();close();}};document.addEventListener("keydown",key);onCleanup(()=>document.removeEventListener("keydown",key));});
  createEffect(()=>{
    html();const current=++revision,urls=new Set<string>();
    queueMicrotask(()=>{
      if(current!==revision)return;
      for(const anchor of element.querySelectorAll<HTMLAnchorElement>("a[href]")){
        const href=anchor.getAttribute("href")||"",local=localImage(href),remote=remoteImage(href)&&/\.(?:png|jpe?g|gif|webp)(?:[?#]|$)/i.test(href);
        if(!local&&!remote)continue;
        const title=anchor.textContent?.trim()||"Image";
        anchor.classList.add("image-chip");anchor.textContent="";
        const label=document.createElement("span");label.textContent=title.toLowerCase()==="image"?"Image preview":title;anchor.append(label);
        const image=document.createElement("img");image.alt=title;image.className="image-chip-thumbnail";image.referrerPolicy="no-referrer";image.loading="lazy";image.decoding="async";
        if(remote){image.src=href;anchor.prepend(image);continue;}
        void invoke<{bytes:number[];mime:string}>("read_attachment",{reference:reference(href)}).then(data=>{
          const url=URL.createObjectURL(new Blob([new Uint8Array(data.bytes)],{type:data.mime}));
          if(current!==revision||!anchor.isConnected){URL.revokeObjectURL(url);return;}
          urls.add(url);image.src=url;anchor.prepend(image);
        }).catch(()=>{if(anchor.isConnected)anchor.title="Image unavailable";});
      }
    });
    onCleanup(()=>{for(const url of urls)URL.revokeObjectURL(url);});
  });
  async function link(event:MouseEvent){
    const target=event.target as Element,image=target.closest("img");
    if(image&&remoteImage(image.getAttribute("src")||"")){event.preventDefault();event.stopPropagation();close();setPreview(image.getAttribute("src")!);return;}
    const anchor=target.closest("a");if(!anchor)return;
    event.preventDefault();event.stopPropagation();const href=anchor.getAttribute("href")||"";
    try{
      if(localImage(href)){
        const data=await invoke<{bytes:number[];mime:string}>("read_attachment",{reference:reference(href)});
        close();setPreview(URL.createObjectURL(new Blob([new Uint8Array(data.bytes)],{type:data.mime})));setError("");
      }else if(remoteImage(href)&&/\.(?:png|jpe?g|gif|webp)(?:[?#]|$)/i.test(href)){close();setPreview(href);}
      else{await navigator.clipboard.writeText(href);setError("Link copied to clipboard.");}
    }catch(error){setError(String(error));}
  }
  return <><div ref={element} class="markdown-body" innerHTML={html()} onClick={event=>void link(event)}/><Show when={error()}><small class="attachment-status" role="status">{error()}</small></Show><Show when={preview()}><Portal><div class="attachment-backdrop" onClick={close}><section role="dialog" aria-label="Pasted image" class="attachment-preview" onClick={event=>event.stopPropagation()}><button onClick={close} aria-label="Close image">×</button><img src={preview()} referrerpolicy="no-referrer" alt="Pasted review attachment"/></section></div></Portal></Show></>;
}
