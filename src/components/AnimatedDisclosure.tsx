import { createSignal, type JSX } from "solid-js";
import Icon from "./Icon";
export default function AnimatedDisclosure(props:{title:string;preview?:string;open?:boolean;children:JSX.Element;class?:string}) {
  const [open,setOpen]=createSignal(props.open||false);
  return <section class={`animated-disclosure ${props.class||""}`}><button class="disclosure-toggle" aria-expanded={open()} onClick={()=>setOpen(!open())}><Icon name="chevron" class={open()?"chevron expanded":"chevron"}/><strong>{props.title}</strong><span class="disclosure-preview">{props.preview}</span></button><div class="disclosure-body" classList={{"is-open":open()}}><div class="disclosure-inner" inert={!open()}>{props.children}</div></div></section>;
}
