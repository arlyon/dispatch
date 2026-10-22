import { createSignal, For, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import type { CommentAnchor, QuizRunSummary } from "../types";
import Markdown from "./Markdown";
import Icon from "./Icon";
export type QuizAnswer = {questionToolCallId:string;question:string;choice:string|null;explanation:string;assessment:{questionToolCallId:string;verdict:"pass"|"fail";reason:string}|null};
type QuizSegment = {kind:"text";id:string;text:string}|{kind:"answer";id:string;questionToolCallId:string};
export type QuizState = { id:string;requestId:string;head:string;sequence:number;phase:string;segments:QuizSegment[];answers:QuizAnswer[];question:{question:string;choices:string[];anchors:CommentAnchor[]}|null;error:string|null;sessionPath:string|null };
export default function QuizPanel(props:{state:QuizState;onDone:(summary:QuizRunSummary)=>void;onJump:(anchor:CommentAnchor)=>void}){
  const [choice,setChoice]=createSignal<number|null>(null),[explanation,setExplanation]=createSignal(""),[sending,setSending]=createSignal(false),[error,setError]=createSignal(""),[closing,setClosing]=createSignal(false);
  async function answer(){
    if(sending()||(choice()===null&&!explanation().trim()))return;
    setSending(true);setError("");
    try{await invoke("answer_quiz",{id:props.state.id,answer:{choice:choice(),explanation:explanation()}});setChoice(null);setExplanation("");}
    catch(error){setError(`Answer was not confirmed: ${String(error)}`);}
    finally{setSending(false);}
  }
  async function end(){
    if(closing())return;
    if((choice()!==null||explanation().trim())&&!window.confirm(sending()?"End quiz while Pi is accepting this answer? Your review is unchanged.":"Discard the pending quiz answer and end quiz? Your review is unchanged."))return;
    setClosing(true);
    try{props.onDone(await invoke<QuizRunSummary>("end_quiz",{id:props.state.id}));}catch(error){setError(String(error));}finally{setClosing(false);}
  }
  return <section class="right floating-panel quiz-panel" aria-label="Quiz"><header class="right-head"><strong>Quiz</strong><span class="chat-context">Private native fork</span><span class="spacer"/><button class={props.state.phase==="complete"?"primary-action quiz-done":"quiz-end"} aria-label={props.state.phase==="complete"?"Done":"End quiz"} disabled={closing()} onClick={()=>void end()}><Icon name={props.state.phase==="complete"?"check":"close"}/>{props.state.phase==="complete"?"Done":"End quiz"}</button></header><div class="conversation quiz-conversation">
    <p class="agent-safety">Explore the diff while you answer. Quiz answers are not review feedback.</p>
    <For each={props.state.segments.map(segment=>segment.id)}>{id=>{
      const segment=()=>props.state.segments.find(segment=>segment.id===id)!;
      const text=()=>{const entry=segment();return entry.kind==="text"?entry.text:"";};
      const answer=()=>{const entry=segment();return entry.kind==="answer"?props.state.answers.find(answer=>answer.questionToolCallId===entry.questionToolCallId):undefined;};
      return <Show when={segment().kind==="text"} fallback={<Show when={answer()}>{answer=><QuizAnswerCard answer={answer()}/>}</Show>}><div class="quiz-text" data-segment-id={id}><Markdown text={text()}/></div></Show>;
    }}</For>
    <Show when={Boolean(props.state.question)}><section class="quiz-question"><Markdown text={props.state.question?.question||""}/><fieldset disabled={sending()||props.state.phase!=="question"}><legend>Choose an answer · or explain in your own words</legend><For each={props.state.question?.choices||[]}>{(option,index)=><label class="quiz-choice"><input type="radio" name="quiz-choice" checked={choice()===index()} onChange={()=>setChoice(index())}/><span>{option}</span></label>}</For><Show when={choice()!==null}><button onClick={()=>setChoice(null)}>Clear choice</button></Show><label class="quiz-explanation">Explanation · optional<textarea aria-label="Quiz explanation" maxLength={16000} value={explanation()} onInput={event=>setExplanation(event.currentTarget.value)}/></label><button class="primary-action" disabled={choice()===null&&!explanation().trim()} onClick={()=>void answer()}>{sending()?"Sending…":"Answer"}</button></fieldset><For each={props.state.question?.anchors||[]}>{anchor=><button class="comment-anchor" onClick={()=>props.onJump(anchor)}>View {anchor.path}:{anchor.line} ({anchor.side})</button>}</For></section></Show>
    <Show when={props.state.phase==="starting"}><p role="status">Preparing source context and waiting for it to settle…</p></Show><Show when={props.state.phase==="preparing"}><p class="quiz-preparing" role="status">Pi is preparing a question…</p></Show><Show when={props.state.phase==="thinking"||props.state.phase==="answering"}><p role="status">Pi is thinking…</p></Show><Show when={props.state.phase==="complete"}><p role="status">Quiz complete. Takeaways stay here until Done.</p></Show><Show when={props.state.error||error()}><p class="feedback-error" role="alert">{error()||props.state.error}</p></Show>
  </div></section>;
}

function QuizAnswerCard(props:{answer:QuizAnswer}){
  return <article class="quiz-answer" data-question-id={props.answer.questionToolCallId} aria-label="Answer assessment"><header><strong>Agent assessment</strong><Show when={props.answer.assessment} fallback={<span class="quiz-verdict unassessed">Not assessed</span>}>{assessment=><span class={`quiz-verdict ${assessment().verdict}`}><Icon name={assessment().verdict==="pass"?"check":"close"}/>{assessment().verdict==="pass"?"Pass":"Fail"}</span>}</Show></header><p class="quiz-answered-question">{props.answer.question}</p><p class="quiz-human-answer"><strong>Your answer</strong> {props.answer.choice}{props.answer.explanation?`${props.answer.choice?" · ":""}${props.answer.explanation}`:""}</p><Show when={props.answer.assessment}>{assessment=><p class="quiz-assessment-reason">{assessment().reason}</p>}</Show><small>Per answer · reported by Pi, not a test result</small></article>;
}
