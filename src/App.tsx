import { batch, createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { parseReport, type AgentState } from "./AgentReport";
import type { CommentPlacement, CommentAnchor, QuizRunSummary, ReviewDraft, ReviewRequest, ReviewResult, ReviewSummary, ReviewContext, ThreadStatus } from "./types";
import WorkspaceShell from "./components/WorkspaceShell";
import TopBar from "./components/TopBar";
import InboxPanel from "./components/InboxPanel";
import ChatPanel from "./components/ChatPanel";
import QuizPanel, { type QuizState } from "./components/QuizPanel";
import ChangeContext from "./components/ChangeContext";
import FileDiffPanel from "./components/FileDiffPanel";
import GutterLayout from "./components/GutterLayout";
import type { DiffHandle } from "./Diff";
import { groupComments, type Thread } from "./components/SourceThread";
import type { DiffMode } from "./components/review-ui";
import Icon from "./components/Icon";
import "./App.css";
import "./components/refinement.css";
import "./components/iteration.css";

const emptyDraft=():ReviewDraft=>({comments:[],summary:"",pending:{},threadStates:{}});
const readStorage="dispatch.reviewed-files.v1";
function loadReadMarkers(){try {const saved=JSON.parse(localStorage.getItem(readStorage)||"[]");return new Set<string>(Array.isArray(saved)?saved.filter(value=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value)):[]);}catch{return new Set<string>();}}
const anchorKey=(anchor:CommentAnchor)=>JSON.stringify([anchor.path,anchor.side,anchor.line]);
type Navigation={path:string;filter:string;scroll:number;mode:DiffMode;anchor?:CommentAnchor};

export default function App(){
  const [queue,setQueue]=createSignal<ReviewSummary[]>([]);
  const [request,setRequest]=createSignal<ReviewRequest>();
  const [path,setPath]=createSignal("");
  const [filter,setFilter]=createSignal("");
  const [anchor,setAnchor]=createSignal<CommentAnchor>();
  const [drafts,setDrafts]=createSignal<Record<string,ReviewDraft>>({});
  const [operation,setOperation]=createSignal<"snapshot"|"submit">();
  const [uploads,setUploads]=createSignal(0);
  const busy=()=>Boolean(operation())||uploads()>0;
  const [error,setError]=createSignal("");
  const [quiz,setQuiz]=createSignal<QuizState>();
  const [quizSummaries,setQuizSummaries]=createSignal<QuizRunSummary[]>([]);
  const [quizStarting,setQuizStarting]=createSignal(false);
  let previousChatVisible=true,previousChatAtEnd=false;
  let startingQuizEvents:QuizState[]=[];
  const [agents,setAgents]=createSignal<Record<string,AgentState>>({});
  const [jump,setJump]=createSignal<CommentAnchor>();
  const [stored,setStored]=createSignal<ReviewResult|null>(null);
  const [context,setContext]=createSignal<ReviewContext|null>(null);
  const [identities,setIdentities]=createSignal<Record<string,string>>({});
  const [reviewed,setReviewed]=createSignal(loadReadMarkers());
  const [expanded,setExpanded]=createSignal<Record<string,boolean>>({});
  const [mode,setMode]=createSignal<DiffMode>("unified");
  const [inboxVisible,setInboxVisible]=createSignal(true);
  const [chatVisible,setChatVisible]=createSignal(true);
  const [hasGutter,setHasGutter]=createSignal(false);
  const [gutterRoom,setGutterRoom]=createSignal(false);
  const [placement,setPlacement]=createSignal<CommentPlacement>("auto");
  const useGutter=()=>gutterRoom()&&placement()!=="inline"&&(placement()==="beside"||hasGutter());
  const [stackDepth,setStackDepth]=createSignal(1);
  const snapshots=new Map<string,ReviewRequest>();
  const fingerprints=new Map<string,Record<string,string>>();
  const fingerprintJobs=new Map<string,Promise<Record<string,string>>>();
  function loadFingerprints(id:string){
    const cached=fingerprints.get(id);if(cached)return Promise.resolve(cached);
    let job=fingerprintJobs.get(id);
    if(!job){job=invoke<Record<string,string>>("file_identities",{id}).then(hashes=>{fingerprints.set(id,hashes);return hashes;}).finally(()=>fingerprintJobs.delete(id));fingerprintJobs.set(id,job);}
    return job;
  }
  const navigation=new Map<string,Navigation>();
  const elements=new Map<string,HTMLElement>();
  const editorHandles=new Map<string,DiffHandle>();
  const [handleRevision,setHandleRevision]=createSignal(0);
  let workspace!:HTMLElement;
  let eventsReady:Promise<void>=Promise.resolve(),eventsAvailable=false,disposed=false;
  let opening:string|undefined,openSequence=0,refreshSequence=0;
  const currentDraft=()=>drafts()[request()?.id||""]||emptyDraft();
  const complete=createMemo(()=>Boolean(stored()?.requestId===request()?.id&&stored()||queue().find(item=>item.id===request()?.id)?.complete));
  const activeAgent=()=>agents()[request()?.id||""];
  const report=createMemo(()=>{const review=request(),state=activeAgent();return review&&state?parseReport(state.text,review):undefined;});
  const threadStates=createMemo(()=>({...Object.fromEntries((stored()?.feedback.threadStates||[]).map(update=>[anchorKey(update),update.state])),...currentDraft().threadStates}));
  const dismissedForReview=()=>new Set((report()?.findings||[]).flatMap((finding,index)=>threadStates()[anchorKey(finding)]&&threadStates()[anchorKey(finding)]!=="open"?[index]:[]));
  const comments=createMemo(()=>complete()?stored()?.feedback.comments||[]:currentDraft().comments);
  const summary=createMemo(()=>complete()?stored()?.feedback.summary||"":currentDraft().summary);
  const pending=()=>Object.values(currentDraft().pending).filter(item=>item.body.trim()||item.editingIndex!==undefined);
  const readPaths=createMemo(()=>new Set(request()?.files.filter(file=>reviewed().has(identities()[file.path])).map(file=>file.path)||[]));
  const reviewThreads=createMemo<Thread[]>(()=>[
    ...(context()?.comments||[]).map((comment,index)=>({...comment,id:`context-${index}`,author:"Agent" as const,index})),
    ...(report()?.findings||[]).map((finding,index)=>({...finding,id:`agent-${index}`,author:"Pi" as const,index})),
    ...comments().map((comment,index)=>({...comment,id:`human-${index}`,author:"You" as const,index})),
  ]);
  const reviewGroups=createMemo(()=>groupComments(reviewThreads(),threadStates()));
  const attachmentLinks=createMemo(()=>[...new Set([summary(),...reviewThreads().map(thread=>thread.body),...pending().map(draft=>draft.body)].flatMap(text=>[...text.matchAll(/\[[^\]]*\]\(<([^>]+\/attachments\/[^>]+)>\)/g)].map(match=>match[1]))) ]);
  const findingCounts=createMemo(()=>{const counts:Record<string,number>={};const seen=new Set<string>();for(const thread of [...reviewGroups(),...pending()]){const key=anchorKey(thread);if(!seen.has(key)){seen.add(key);counts[thread.path]=(counts[thread.path]||0)+1;}}return counts;});
  const expandKey=(file:string)=>`${request()?.id}:${file}`;
  const fileExpanded=(file:string)=>expanded()[expandKey(file)]??!readPaths().has(file);
  const updateDraft=(update:(draft:ReviewDraft)=>ReviewDraft)=>{const id=request()?.id;if(id&&!complete()&&operation()!=="submit")setDrafts(all=>({...all,[id]:update(all[id]||emptyDraft())}));};
  function acceptAgent(state:AgentState){if(!disposed)setAgents(all=>(all[state.requestId]?.sequence??-2)>state.sequence?all:{...all,[state.requestId]:state});}
  async function startAgent(review:ReviewRequest){
    acceptAgent({requestId:review.id,phase:"starting",sequence:(agents()[review.id]?.sequence??-2)+1,text:"",error:null,files:[],omitted:review.files.length,sessionPath:""});
    try{await eventsReady;if(disposed)return;if(!eventsAvailable)throw new Error("Native event stream is not available");acceptAgent(await invoke<AgentState>("start_review_agent",{id:review.id}));}
    catch(error){acceptAgent({requestId:review.id,phase:"error",sequence:(agents()[review.id]?.sequence??-1)+1,text:"",error:String(error),files:[],omitted:review.files.length,sessionPath:""});}
  }
  createEffect(()=>{const review=request();if(review&&!complete()&&(context()?.owner==="app"||context()?.reviewerEnabled)&&!quizStarting()&&!quiz()&&!agents()[review.id])void startAgent(review);});
  function acceptQuiz(state:QuizState){if(disposed)return;if(quiz()?.id===state.id){if((quiz()?.sequence??-1)<state.sequence)setQuiz(state);}else if(quizStarting())startingQuizEvents.push(state);}
  async function startQuiz(){
    const review=request();if(!review||quiz()||quizStarting()||busy())return;
    // Invalidate navigation already awaiting IPC before locking the quiz to this review.
    openSequence++;opening=undefined;
    const saved={head:review.source.head,comments:comments().map(comment=>({...comment})),summary:complete()?(summary().trim()||null):null,threadStates:Object.entries(currentDraft().threadStates).map(([key,state])=>{const [path,side,line]=JSON.parse(key);return {path,side,line,state};})};
    const conversation=document.querySelector<HTMLElement>(".original-chat .conversation");
    previousChatAtEnd=Boolean(conversation&&conversation.scrollHeight-conversation.clientHeight-conversation.scrollTop<24);
    startingQuizEvents=[];setQuizStarting(true);setError("");previousChatVisible=chatVisible();setChatVisible(true);
    try{await eventsReady;if(!eventsAvailable)throw new Error("Native event stream is not available");const initial=await invoke<QuizState>("start_quiz",{id:review.id,saved});setQuiz(initial);for(const state of startingQuizEvents)if(state.id===initial.id)acceptQuiz(state);}
    catch(error){setError(`Cannot start quiz: ${String(error)}`);}finally{startingQuizEvents=[];setQuizStarting(false);}
  }
  function quizDone(summary:QuizRunSummary){
    if(quizSummaries().some(previous=>previous.id===summary.id))return;
    const active=quiz();if(!active||summary.id!==active.id||summary.requestId!==active.requestId||summary.head!==active.head){setError("Quiz summary does not match its source snapshot");return;}
    const followEnd=previousChatAtEnd;
    batch(()=>{setQuizSummaries(all=>all.some(previous=>previous.id===summary.id)?all:[...all,summary]);setQuiz(undefined);setChatVisible(previousChatVisible);});
    if(followEnd)requestAnimationFrame(()=>{if(!quiz()&&request()?.id===summary.requestId&&request()?.source.head===summary.head){const conversation=document.querySelector<HTMLElement>(".original-chat .conversation");if(conversation)conversation.scrollTop=conversation.scrollHeight;}});
  }
  function remember(){const review=request();if(review)navigation.set(review.id,{path:path(),filter:filter(),scroll:workspace?.scrollTop||0,mode:mode(),anchor:anchor()});}
  async function open(id:string){
    if((quiz()||quizStarting())&&id!==request()?.id){setError("End the quiz before opening another review.");return;}
    const sequence=++openSequence;
    if(id===request()?.id){opening=undefined;return;}
    opening=id;
    try{
      const hashJob=loadFingerprints(id);
      // Read-marker failures must not become unhandled while the snapshot loads.
      void hashJob.catch(()=>{});
      const [review,result,context]=await Promise.all([snapshots.get(id)||invoke<ReviewRequest>("open_review",{id}),invoke<ReviewResult|null>("review_result",{id}),invoke<ReviewContext|null>("review_context",{id})]);
      snapshots.set(id,review);
      void hashJob.then(hashes=>{if(!disposed&&request()?.id===id)setIdentities(hashes);}).catch(error=>{if(!disposed&&request()?.id===id)setError(`Cannot load read markers: ${String(error)}`);});
      if(disposed||sequence!==openSequence)return;
      remember();elements.clear();editorHandles.clear();setHandleRevision(value=>value+1);const previous=navigation.get(id);
      batch(()=>{setRequest(review);setStored(result);setContext(context);setIdentities(fingerprints.get(id)||{});setPath(previous?.path||review.files[0]?.path||"");setFilter(previous?.filter||"");setMode(previous?.mode||"unified");setAnchor(result?undefined:previous?.anchor);setJump(undefined);setError("");});
      requestAnimationFrame(()=>{if(!disposed&&request()?.id===id)workspace.scrollTop=previous?.scroll||0;});
    }catch(error){if(sequence===openSequence)setError(String(error));}
    finally{if(sequence===openSequence)opening=undefined;}
  }
  async function refresh(){
    const sequence=++refreshSequence;
    try{
      const entries=await invoke<ReviewSummary[]>("list_reviews");
      if(disposed||sequence!==refreshSequence)return;
      setQueue(previous=>entries.map(item=>({...item,complete:item.complete||previous.some(old=>old.id===item.id&&old.complete)})));
      const review=request();
      if(review&&entries.some(item=>item.id===review.id&&item.complete)&&stored()?.requestId!==review.id){const result=await invoke<ReviewResult|null>("review_result",{id:review.id});if(request()?.id===review.id)setStored(result);}
      if(!request()&&!opening){const next=entries.find(item=>!item.complete);if(next)await open(next.id);}
    }catch(error){if(!disposed)setError(String(error));}
  }
  async function selfReview(){
    if(busy())return;setOperation("snapshot");setError("");
    try{const review=await invoke<ReviewRequest>("enqueue_self");await refresh();await open(review.id);}catch(error){setError(String(error));}finally{setOperation(undefined);}
  }
  function selectFile(file:string){jumpTo({path:file,side:request()?.files.find(item=>item.path===file)?.status==="D"?"old":"new",line:1});}
  function jumpTo(target:CommentAnchor,compose=false){
    const clean:CommentAnchor={path:target.path,side:target.side,line:target.line,...(target.endLine&&target.endLine>target.line?{endLine:target.endLine}:{})};
    batch(()=>{setPath(clean.path);setExpanded(all=>({...all,[expandKey(clean.path)]:true}));setJump(undefined);setAnchor(compose?clean:undefined);if(clean.side==="old")setMode("split");});
    requestAnimationFrame(()=>setJump(clean));
  }
  function compose(target:CommentAnchor){
    if(complete()||operation()==="submit")return;
    const clean:CommentAnchor={path:target.path,side:target.side,line:target.line,...(target.endLine&&target.endLine>target.line?{endLine:target.endLine}:{})};
    if(anchor()&&anchorKey(anchor()!)===anchorKey(clean)&&(anchor()!.endLine||anchor()!.line)===(clean.endLine||clean.line)){
      if(!currentDraft().pending[anchorKey(clean)]?.body.trim()&&currentDraft().pending[anchorKey(clean)]?.editingIndex===undefined)updateDraft(draft=>{const pending={...draft.pending};delete pending[anchorKey(clean)];return {...draft,pending};});
      setAnchor(undefined);setJump(undefined);return;
    }
    batch(()=>{setPath(clean.path);setAnchor(clean);setExpanded(all=>({...all,[expandKey(clean.path)]:true}));updateDraft(draft=>({...draft,pending:{...draft.pending,[anchorKey(clean)]:draft.pending[anchorKey(clean)]||{...clean,body:""}}}));});
  }
  function updateBody(body:string){const target=anchor();if(target)updateDraft(draft=>({...draft,pending:{...draft.pending,[anchorKey(target)]:{...draft.pending[anchorKey(target)],path:target.path,side:target.side,line:target.line,endLine:target.endLine,body}}}));}
  function saveComment(){
    if(busy())return;
    const target=anchor();if(!target)return;const draft=currentDraft().pending[anchorKey(target)];if(!draft?.body.trim())return;
    if(draft.editingIndex===undefined)setThreadState(target,"open");
    updateDraft(state=>{const pending={...state.pending};delete pending[anchorKey(target)];const comment={path:draft.path,side:draft.side,line:draft.line,endLine:draft.endLine,body:draft.body.trim()};return {...state,pending,comments:draft.editingIndex===undefined?[...state.comments,comment]:state.comments.map((previous,index)=>index===draft.editingIndex?comment:previous)};});setAnchor(undefined);setError("");
  }
  function discardPending(){const target=anchor();if(target)updateDraft(state=>{const pending={...state.pending};delete pending[anchorKey(target)];return {...state,pending};});setAnchor(undefined);setError("");}
  function markRead(file:string,read:boolean){
    const hash=identities()[file];if(!hash)return;
    setReviewed(previous=>{const next=new Set(previous);if(read)next.add(hash);else next.delete(hash);return next;});
    setExpanded(all=>({...all,[expandKey(file)]:!read}));

    try{localStorage.setItem(readStorage,JSON.stringify([...reviewed()]));}catch{setError("Read markers are kept in memory only: local storage is unavailable.");}
  }
  function setThreadState(target:CommentAnchor,state:ThreadStatus){if((threadStates()[anchorKey(target)]||"open")===state)return;updateDraft(draft=>({...draft,threadStates:{...draft.threadStates,[anchorKey(target)]:state}}));}
  function reply(target:CommentAnchor){compose(target);jumpTo(target,true);}
  function editComment(index:number){
    if(busy()||complete())return;const comment=comments()[index];if(!comment)return;
    const key=anchorKey(comment),previous=currentDraft().pending[key];
    if(previous?.body.trim()&&previous.editingIndex!==index&&!window.confirm("Replace this unfinished reply with a comment edit?"))return;
    updateDraft(draft=>({...draft,pending:{...draft.pending,[key]:previous?.editingIndex===index?previous:{...comment,editingIndex:index}}}));jumpTo(comment,true);
  }
  function removeComment(index:number){
    if(busy()||complete())return;
    if(Object.values(currentDraft().pending).some(item=>item.editingIndex===index)&&!window.confirm("Remove this comment and its unfinished edit?"))return;
    updateDraft(draft=>({...draft,comments:draft.comments.filter((_,position)=>position!==index),pending:Object.fromEntries(Object.entries(draft.pending).filter(([,item])=>item.editingIndex!==index).map(([key,item])=>[key,item.editingIndex!==undefined&&item.editingIndex>index?{...item,editingIndex:item.editingIndex-1}:item]))}));
  }
  async function submit(){
    const review=request();if(!review||complete()||busy())return;
    if(pending().length){setError("Save or discard your unfinished line comments before submitting.");setChatVisible(true);return;}
    setOperation("submit");setError("");
    try{
      const result=await invoke<ReviewResult>("submit_review",{id:review.id,feedback:{head:review.source.head,comments:currentDraft().comments,summary:currentDraft().summary.trim()||null,threadStates:Object.entries(currentDraft().threadStates).map(([key,state])=>{const [path,side,line]=JSON.parse(key);return {path,side,line,state};})}});
      batch(()=>{setDrafts(all=>{const next={...all};delete next[review.id];return next;});if(request()?.id===review.id){setStored(result);setAnchor(undefined);}setQueue(all=>all.map(item=>item.id===review.id?{...item,complete:true}:item));});
      try{await getCurrentWindow().close();}catch(error){setError(`Feedback submitted, but could not close window: ${String(error)}`);}
    }catch(error){setError(String(error));}finally{setOperation(undefined);}
  }
  async function submitOrClose(){
    if(operation()==="submit")return;
    if((request()&&!complete())||quiz()||quizStarting()){await submit();return;}
    try{await getCurrentWindow().close();}catch(error){setError(`Cannot close window: ${String(error)}`);}
  }
  async function pasteImage(event:ClipboardEvent){
    const target=event.target;
    if(!(target instanceof HTMLTextAreaElement)||!request()||complete()||operation()==="submit")return;
    const isSummary=target.id==="review-summary",position=anchor();
    if(!isSummary&&(target.getAttribute("aria-label")!=="Line comment"||!position))return;
    const images=Array.from(event.clipboardData?.files||[]).filter(file=>file.type.startsWith("image/"));
    if(!images.length)return;
    event.preventDefault();const id=request()!.id;setUploads(count=>count+1);setError("");
    try{for(const image of images){
      if(image.size>8*1024*1024)throw Error("Image exceeds 8 MiB");
      const saved=await invoke<{path:string;name:string}>("save_attachment",{id,bytes:Array.from(new Uint8Array(await image.arrayBuffer()))});
      const link=`[image](<${saved.path.split(String.fromCharCode(92)).join("/").split(">").join("%3E")}>)`;
      setDrafts(all=>{const draft=all[id]||emptyDraft();if(isSummary)return {...all,[id]:{...draft,summary:`${draft.summary}${draft.summary?"\n\n":""}${link}`}};
        if(!position)return all;const key=anchorKey(position),previous=draft.pending[key]||{...position,body:""};return {...all,[id]:{...draft,pending:{...draft.pending,[key]:{...previous,body:`${previous.body}${previous.body?"\n\n":""}${link}`}}}};});
      queueMicrotask(()=>{if(request()?.id===id&&target.isConnected&&document.activeElement===target){const end=target.value.length;target.setSelectionRange(end,end);target.scrollTop=target.scrollHeight;}});
    }}catch(error){setError(`Image paste: ${String(error)}`);}finally{setUploads(count=>count-1);}
  }
  function hasFeedback(){return uploads()>0||Object.values(drafts()).some(draft=>draft.comments.length||draft.summary.trim()||Object.keys(draft.threadStates).length||Object.values(draft.pending).some(item=>item.body.trim()));}
  onMount(()=>{
    let stopClose:(()=>void)|undefined,stopAgents:(()=>void)|undefined,stopQuiz:(()=>void)|undefined;
    if("__TAURI_INTERNALS__"in window){
      const quizEvents=listen<QuizState>("review-quiz",event=>acceptQuiz(event.payload)).then(stop=>{if(disposed)stop();else stopQuiz=stop;});
      const agentEvents=listen<AgentState>("review-agent",event=>acceptAgent(event.payload)).then(async stop=>{if(disposed){stop();return;}stopAgents=stop;for(const state of await invoke<AgentState[]>("list_review_agents"))acceptAgent(state);});
      eventsReady=Promise.all([quizEvents,agentEvents]).then(()=>{if(!disposed)eventsAvailable=true;}).catch(error=>{setError(`Agent event stream: ${String(error)}`);});
      void getCurrentWindow().onCloseRequested(event=>{if(hasFeedback()){event.preventDefault();setError("You have unsubmitted feedback. Submit it, or explicitly discard it, before closing.");setChatVisible(true);}else if(quiz()||quizStarting()){event.preventDefault();setError("End the quiz before closing the window.");setChatVisible(true);}}).then(stop=>{if(disposed)stop();else stopClose=stop;});
    }
    void refresh();const timer=setInterval(()=>void refresh(),1500);
    const observer=new ResizeObserver(()=>{const style=getComputedStyle(workspace);const room=workspace.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)>=760;setGutterRoom(room);setHasGutter(window.innerWidth>=1180&&room);});observer.observe(workspace);
    const keyboard=(event:KeyboardEvent)=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="s"){event.preventDefault();event.stopPropagation();if(!event.repeat)void submitOrClose();return;}const target=event.target as HTMLElement;if(event.key==="/"&&!target.matches("input,textarea,[contenteditable=true]")){event.preventDefault();setInboxVisible(true);document.querySelector<HTMLInputElement>(".search input")?.focus();}};
    document.addEventListener("keydown",keyboard,true);
    document.addEventListener("paste",pasteImage);
    onCleanup(()=>{disposed=true;openSequence++;clearInterval(timer);observer.disconnect();document.removeEventListener("keydown",keyboard,true);document.removeEventListener("paste",pasteImage);stopClose?.();stopAgents?.();stopQuiz?.();});
  });
  return <WorkspaceShell inboxVisible={inboxVisible()} chatVisible={Boolean(quiz())||chatVisible()} onWorkspace={element=>workspace=element}
    topbar={<TopBar placement={placement()} onPlacement={setPlacement} canBeside={gutterRoom()} stackDepth={stackDepth()} onStackDepth={setStackDepth} wide={useGutter()} request={request()} inboxVisible={inboxVisible()} chatVisible={chatVisible()} complete={complete()} busy={busy()} submitting={operation()==="submit"} commentCount={comments().length} hasSummary={Boolean(summary().trim())} onInbox={()=>setInboxVisible(!inboxVisible())} onChat={()=>{if(!quiz())setChatVisible(!chatVisible());}} onSubmit={()=>void submit()}/>}
    inbox={<InboxPanel reviews={queue()} request={request()} selectedId={request()?.id} activePath={path()} filter={filter()} agents={agents()} readReady={request()?.files.every(file=>Boolean(identities()[file.path]))||false} readPaths={readPaths()} findingCounts={findingCounts()} busy={busy()} onSelect={id=>void open(id)} onSelectFile={selectFile} onFilter={setFilter} onRead={markRead} onRefresh={()=>void refresh()} onNew={()=>void selfReview()}/>}
    chat={<div class="quiz-panel-host"><div class="original-chat" classList={{"quiz-underneath":Boolean(quiz())}} inert={Boolean(quiz())}><ChatPanel quizSummaries={quizSummaries().filter(summary=>summary.requestId===request()?.id&&summary.head===request()?.source.head)} onQuiz={()=>void startQuiz()} quizDisabled={busy()||quizStarting()} quizStarting={quizStarting()} attachments={attachmentLinks()} uploading={uploads()>0} groups={reviewGroups().filter(group=>group.messages.some(message=>message.author!=="Pi"))} onReply={reply} onState={setThreadState} stateCount={Object.keys(currentDraft().threadStates).length} context={context()} onStartReview={()=>{const review=request();if(review)void startAgent(review);}} request={request()} agent={activeAgent()} complete={complete()} submitting={operation()==="submit"} error={error()} comments={comments()} pending={complete()?[]:pending()} summary={summary()} dismissed={dismissedForReview()} unsent={complete()?currentDraft():undefined} onSummary={value=>updateDraft(draft=>({...draft,summary:value}))} onJump={jumpTo} onResume={pending=>jumpTo(pending,true)} onRemove={removeComment} onClose={()=>setChatVisible(false)}/></div><Show when={quiz()}>{state=><QuizPanel state={state()} onDone={quizDone} onJump={jumpTo}/>}</Show></div>}
    footer={<footer class="statusbar"><span class="status-dot"/><span>{operation()==="snapshot"?"Creating local snapshot…":request()?`${readPaths().size}/${request()!.files.length} files read`:"Local review inbox"}</span><span class="status-divider"/><span class="status-file">{path()}</span><span class="spacer"/><span>{activeAgent()?"Native Pi · static inspection":"Immutable local snapshots"}</span><span class="status-divider"/><span>No GitHub publishing</span></footer>}
  >
    <Show when={error()}><div class="error-banner" role="alert"><span>{error()}</span><Show when={hasFeedback()}><button disabled={busy()} onClick={()=>{setDrafts({});setAnchor(undefined);setError("");}}>Discard all unsubmitted feedback</button></Show><button class="iconbtn" aria-label="Dismiss message" onClick={()=>setError("")}><Icon name="close"/></button></div></Show>
    <Show when={request()} fallback={<section class="empty-state"><Icon name="branch"/><h1>Your review inbox</h1><p>Open a change from Inbox, or snapshot Dispatch against main.</p><button class="primary-action" disabled={busy()} onClick={()=>void selfReview()}>Review Dispatch</button><p class="muted">Completed reviews stay readable in Archive.</p></section>}>{review=><>
      <ChangeContext hasGuide={Boolean(context()?.guide)} onGuide={()=>{setChatVisible(true);requestAnimationFrame(()=>document.querySelector(".review-guide-context")?.scrollIntoView({block:"start"}));}} request={review()} complete={complete()} mode={mode()} onMode={setMode} hasGutter={useGutter()}/>
      <GutterLayout groups={reviewGroups()} handles={editorHandles} revision={handleRevision()} workspace={()=>workspace} wide={useGutter()} stackDepth={stackDepth()}/>
      <For each={review().files}>{file=><FileDiffPanel beside={useGutter()} file={file} mode={mode()} readonly={complete()||operation()==="submit"||uploads()>0} readReady={Boolean(identities()[file.path])} reviewed={readPaths().has(file.path)} expanded={fileExpanded(file.path)} focus={jump()?.path===file.path?jump():undefined} groups={reviewGroups().filter(group=>group.path===file.path)} composer={!complete()&&anchor()?.path===file.path?currentDraft().pending[anchorKey(anchor()!)]:undefined} onBody={updateBody} onSave={saveComment} onDiscard={discardPending} onClose={()=>setAnchor(undefined)} onComment={compose} onJump={jumpTo} onState={setThreadState} onRemove={removeComment} onEdit={editComment} onHandle={handle=>{if(handle)editorHandles.set(file.path,handle);else editorHandles.delete(file.path);setHandleRevision(value=>value+1);}} onRead={read=>markRead(file.path,read)} onExpand={()=>setExpanded(all=>({...all,[expandKey(file.path)]:!fileExpanded(file.path)}))} onElement={element=>elements.set(file.path,element)}/>}</For>
    </>}</Show>
  </WorkspaceShell>;
}
