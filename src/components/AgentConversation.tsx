import { For, Show } from "solid-js";
import type { AgentState } from "../AgentReport";
import Markdown from "./Markdown";
import "./agent-conversation.css";

// The unchanged read-only reviewer protocol returns JSON. Present its summary,
// including a safe partial string, rather than exposing protocol syntax in Chat.
export function answerText(text:string):string {
  if(!text.trimStart().startsWith("{"))return text;
  try{const value=JSON.parse(text);return typeof value.summary==="string"?value.summary:"";}catch{}
  const raw=/"summary"\s*:\s*"((?:\\.|[^"\\])*)/.exec(text)?.[1];
  if(raw===undefined)return "";
  let decoded="";
  for(let i=0;i<raw.length;i++){
    if(raw[i]!=="\\"){decoded+=raw[i];continue;}
    if(++i>=raw.length)break;
    if(raw[i]==="u"){
      const hex=raw.slice(i+1,i+5);if(!/^[0-9a-f]{4}$/i.test(hex))break;
      decoded+=String.fromCharCode(Number.parseInt(hex,16));i+=4;
    }else{const escapes:Record<string,string>={n:"\n",r:"\r",t:"\t",b:"\b",f:"\f",'"':'"',"\\":"\\","/":"/"};decoded+=escapes[raw[i]]||raw[i];}
  }
  return decoded;
}
export default function AgentConversation(props:{state:AgentState;question:string;sending:boolean;disabled:boolean;onQuestion:(value:string)=>void;onSend:()=>void}){
  const messages=()=>props.state.conversation||[];
  return <section class="agent-conversation" aria-label="Conversation with Pi">
    <For each={messages().map(message=>message.id)}>{id=>{
      const message=()=>messages().find(message=>message.id===id)!;
      return <article class="agent-chat-message" data-agent-message-id={id} classList={{"from-user":message().role==="user"}}>
        <header><strong>{message().role==="user"?"You":"Pi"}</strong><Show when={message().failed}><span>Interrupted</span></Show></header>
        <Markdown text={message().role==="assistant"?answerText(message().text):message().text}/>
      </article>;
    }}</For>
    <Show when={props.state.chatting}><p class="agent-chat-status" role="status">Pi is responding…</p></Show>
    <form class="agent-question" onSubmit={event=>{event.preventDefault();props.onSend();}}>
      <label for="agent-question">Ask Pi about this review</label>
      <textarea id="agent-question" aria-label="Message Pi" rows={2} maxLength={32000} value={props.question} readOnly={props.sending} placeholder="Ask about the change…" onInput={event=>props.onQuestion(event.currentTarget.value)} onKeyDown={event=>{if((event.metaKey||event.ctrlKey)&&event.key==="Enter"){event.preventDefault();event.stopPropagation();if(!props.disabled&&!props.sending&&props.state.phase==="complete"&&props.question.trim())props.onSend();}}}/>
      <div><span>Same native session · separate from your feedback</span><button type="submit" disabled={props.disabled||props.sending||props.state.phase!=="complete"||!props.question.trim()}>{props.sending?"Sending…":"Send"}</button></div>
    </form>
  </section>;
}
