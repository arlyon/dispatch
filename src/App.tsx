import { batch, createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { parseReport, type AgentState } from "./AgentReport";
import { validDesktopData, type Bootstrap, type Checkpoint, type DesktopData, type Navigation } from "./desktop";
import type { CaptureProgress, GitHubSource, CommentPlacement, CommentAnchor, QuizRunSummary, ReviewDraft, ReviewRequest, ReviewResult, ReviewSummary, ReviewContext, ThreadStatus } from "./types";
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
import { feedbackTarget, type DiffMode } from "./components/review-ui";
import Icon from "./components/Icon";
import "./App.css";
import "./components/refinement.css";
import "./components/iteration.css";
import "./components/typography.css";

const emptyDraft=():ReviewDraft=>({comments:[],summary:"",pending:{},threadStates:{}});
const readStorage="dispatch.reviewed-files.v1";
function loadReadMarkers(){try {const saved=JSON.parse(localStorage.getItem(readStorage)||"[]");return new Set<string>(Array.isArray(saved)?saved.filter(value=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value)):[]);}catch{return new Set<string>();}}
const anchorKey=(anchor:CommentAnchor)=>JSON.stringify([anchor.path,anchor.side,anchor.line]);

export default function App(){
  const [queue,setQueue]=createSignal<ReviewSummary[]>([]);
  const [github,setGithub]=createSignal<GitHubSource>();
  const [githubOpening,setGithubOpening]=createSignal<string>();
  const [capture,setCapture]=createSignal<CaptureProgress>();
  let animateInbox:(change:()=>void)=>void=change=>change();
  async function refreshSource(){
    const sequence=++sourceSequence;
    try {const source=await invoke<GitHubSource>("github_source");if(disposed||sequence!==sourceSequence)return;setGithub(source);return source;}
    catch(error){if(!disposed&&sequence===sourceSequence)setGithub(previous=>({...previous,query:previous?.query||"GitHub search",items:previous?.items||[],total:previous?.total??null,partial:previous?.partial||false,polling:false,lastSuccess:previous?.lastSuccess??null,error:String(error)}));}
  }
  const [request,setRequest]=createSignal<ReviewRequest>();
  const [path,setPath]=createSignal("");
  const [filter,setFilter]=createSignal("");
  const [anchor,setAnchor]=createSignal<CommentAnchor>();
  const [drafts,setDrafts]=createSignal<Record<string,ReviewDraft>>({});
  const [operation,setOperation]=createSignal<"snapshot"|"submit">();
  const [uploads,setUploads]=createSignal(0);
  const busy=()=>Boolean(operation())||uploads()>0;
  const [error,setError]=createSignal("");
  const [notice,setNotice]=createSignal("");
  let autoOpen=true;
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
  let opening:string|undefined,openSequence=0,refreshSequence=0,sourceSequence=0;
  const [desktopReady,setDesktopReady]=createSignal(false);
  let desktopVisible=true,restoreFailed=false,checkpointRevision=0,resumeId:string|undefined,liveReviewId:string|undefined;
  let checkpointTimer:ReturnType<typeof setTimeout>|undefined;
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
      const previousReview=request();
      if(previousReview?.source.prUrl&&previousReview.source.prUrl===review.source.prUrl&&previousReview.source.head!==review.source.head&&draftHasFeedback(drafts()[previousReview.id])){
        setError("New branch files are ready. Submit or explicitly discard your notes on this PR before opening them. Your notes remain on their original code.");return;
      }
      remember();elements.clear();editorHandles.clear();setHandleRevision(value=>value+1);const previous=navigation.get(id);
      animateInbox(()=>batch(()=>{setNotice("");setRequest(review);setStored(result);setContext(context);setIdentities(fingerprints.get(id)||{});setPath(previous?.path||review.files[0]?.path||"");setFilter(previous?.filter||"");setMode(previous?.mode||"unified");setAnchor(result?undefined:previous?.anchor);setJump(undefined);setError("");}));
      requestAnimationFrame(()=>{if(!disposed&&request()?.id===id)workspace.scrollTop=previous?.scroll||0;});
    }catch(error){if(sequence===openSequence)setError(String(error));}
    finally{if(sequence===openSequence)opening=undefined;}
  }
  async function refresh(allowAutoOpen=true){
    const sequence=++refreshSequence;
    try{
      const entries=await invoke<ReviewSummary[]>("list_reviews");
      if(disposed||sequence!==refreshSequence)return;
      setQueue(previous=>entries.map(item=>({...item,complete:item.complete||previous.some(old=>old.id===item.id&&old.complete)})));
      const review=request();
      if(review&&entries.some(item=>item.id===review.id&&item.complete)&&stored()?.requestId!==review.id){const result=await invoke<ReviewResult|null>("review_result",{id:review.id});if(request()?.id===review.id)setStored(result);}
      if(autoOpen&&allowAutoOpen&&!request()&&!opening){const next=entries.find(item=>!item.complete);if(next)await open(next.id);}
    }catch(error){if(!disposed)setError(String(error));}
  }
  async function openGithub(url:string){
    if(quiz()||quizStarting()){setError("End the quiz before opening another review.");return;}
    if(githubOpening())return;
    if(queue().some(review=>review.source.prUrl===url&&draftHasFeedback(drafts()[review.id]))){setError("Submit or explicitly discard your notes on this PR before refreshing its branch. Earlier feedback stays with its original code.");return;}
    const sequence=++openSequence,captureId=crypto.randomUUID();opening=url;setGithubOpening(url);setError("");
    animateInbox(()=>setCapture({url,captureId,phase:"metadata"}));
    try {
      const review=await invoke<ReviewRequest>("open_github_pr",{url,captureId});
      snapshots.set(review.id,review);
      if(disposed)return;
      refreshSequence++; // Publication supersedes queue reads started before these files existed.
      animateInbox(()=>batch(()=>{setCapture(undefined);setQueue(all=>[...all.filter(item=>item.id!==review.id),{id:review.id,title:review.title,source:review.source,fileCount:review.files.length,checkoutReady:true,complete:all.find(item=>item.id===review.id)?.complete||false,intakeAt:Date.now()}]);}));
      if(sequence!==openSequence)return;
      await open(review.id);
    } catch(error){if(!disposed&&sequence===openSequence)setError(`Cannot capture PR: ${String(error)}`);}
    finally {if(opening===url)opening=undefined;if(!disposed){animateInbox(()=>setCapture(undefined));setGithubOpening(undefined);}}
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
  function returnToInbox(message:string){
    remember();autoOpen=false;resumeId=undefined;liveReviewId=undefined;openSequence++;opening=undefined;elements.clear();editorHandles.clear();setHandleRevision(value=>value+1);
    batch(()=>{setRequest(undefined);setStored(null);setContext(null);setIdentities({});setPath("");setFilter("");setAnchor(undefined);setJump(undefined);setInboxVisible(true);setNotice(message);});
  }
  async function afterPublication(review:ReviewRequest,sequence:number){
    let remaining=true;
    const queueCheck=++refreshSequence;
    const sourceJob=refreshSource(),sourceCheck=sourceSequence;
    try {
      const [entries,source]=await Promise.all([invoke<ReviewSummary[]>("list_reviews"),sourceJob]);
      if(disposed)return;
      // Share ordering with periodic reads. A superseded check cannot erase newer
      // work or establish emptiness, even if its source response finished earlier.
      if(queueCheck===refreshSequence){
        setQueue(previous=>entries.map(item=>({...item,complete:item.id===review.id||item.complete||previous.some(old=>old.id===item.id&&old.complete)})));
        if(sourceCheck===sourceSequence){
          const authoritative=source&&source.total!==null&&source.lastSuccess!==null&&!source.error&&!source.partial&&!source.polling;
          const head=source?.heads?.find(head=>head.url===review.source.prUrl);
          const branchWork=Boolean(review.source.prUrl&&(!head?.head||head.checking||head.error||head.head.toLowerCase()!==review.source.head.toLowerCase()));
          remaining=entries.some(item=>item.id!==review.id&&!item.complete)||Boolean(source?.items.some(item=>item.url!==review.source.prUrl))||branchWork||!authoritative;
        }
      }
    } catch { /* Publication succeeded; unavailable work state must never imply empty. */ }
    if(disposed)return;
    // A newer navigation or in-flight capture owns its own result. Never replace it.
    if(sequence!==openSequence||request()?.id!==review.id||opening||githubOpening())return;
    if(remaining){
      if(!quiz()&&!quizStarting())returnToInbox(`Feedback submitted for ${feedbackTarget(review)}. Choose another change from Inbox.`);
      return;
    }
    try{await getCurrentWindow().close();}catch(error){setError(`Feedback submitted, but could not close window: ${String(error)}`);}
  }
  async function submit(){
    const review=request();if(!review||complete()||busy())return;
    if(pending().length){setError("Save or discard your unfinished line comments before submitting.");setChatVisible(true);return;}
    const sequence=openSequence;
    setOperation("submit");setError("");
    try{
      const result=await invoke<ReviewResult>("submit_review",{id:review.id,feedback:{head:review.source.head,comments:currentDraft().comments,summary:currentDraft().summary.trim()||null,threadStates:Object.entries(currentDraft().threadStates).map(([key,state])=>{const [path,side,line]=JSON.parse(key);return {path,side,line,state};})}});
      batch(()=>{setDrafts(all=>{const next={...all};delete next[review.id];return next;});if(request()?.id===review.id){setStored(result);setAnchor(undefined);}setQueue(all=>all.map(item=>item.id===review.id?{...item,complete:true}:item));});
      await afterPublication(review,sequence);
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
  function draftHasFeedback(draft:ReviewDraft|undefined){return Boolean(draft&&(draft.comments.length||draft.summary.trim()||Object.keys(draft.threadStates).length||Object.values(draft.pending).some(item=>item.body.trim())));}
  function hasFeedback(){return uploads()>0||Object.values(drafts()).some(draftHasFeedback);}
  function desktopData():DesktopData {
    remember();
    return {drafts:drafts(),navigation:Object.fromEntries(navigation),selectedId:request()?.id||resumeId,
      placement:placement(),stackDepth:stackDepth(),inboxVisible:inboxVisible(),chatVisible:chatVisible(),expanded:expanded(),quizSummaries:quizSummaries()};
  }
  function checkpoint():Checkpoint {
    if(quiz()||quizStarting())throw Error("End the quiz before closing the window.");
    if(restoreFailed)throw Error("Saved desktop state could not be restored. Keep this window open; the resident still holds the original checkpoint.");
    return {version:1,revision:++checkpointRevision,hasFeedback:hasFeedback(),data:desktopData()};
  }
  async function hideDesktop(){
    if(quiz()||quizStarting()){setError("End the quiz before closing the window.");setChatVisible(true);return;}
    // Submission keeps its operation guard until close returns, but publication
    // has already completed. Permit that one close without enabling re-submit.
    if(githubOpening()||busy()&&!(operation()==="submit"&&complete()&&uploads()===0)){setError("Wait for the current operation or image upload before hiding Dispatch.");return;}
    try{await invoke("desktop_hide",{checkpoint:checkpoint()});}
    catch(error){setError(`Cannot safely hide Dispatch: ${String(error)}`);}
  }
  async function quitDesktop(){
    if(restoreFailed||hasFeedback()||busy()||githubOpening()||quiz()||quizStarting()){
      setError(quiz()||quizStarting()?"End the quiz before quitting Dispatch.":"You have unsubmitted feedback or an operation in progress. Submit or explicitly discard feedback before quitting.");setChatVisible(true);
      await invoke("desktop_quit",{checkpoint:null}).catch(error=>setError(String(error)));return;
    }
    await invoke("desktop_quit",{checkpoint:checkpoint()}).catch(error=>setError(String(error)));
  }
  createEffect(()=>{
    // Observe lightweight state only. Source snapshots/editor instances stay out
    // of the checkpoint; the resident can restore those from immutable requests.
    drafts();path();filter();mode();anchor();placement();stackDepth();inboxVisible();chatVisible();expanded();request();quizSummaries();
    clearTimeout(checkpointTimer);
    if(!desktopReady()||restoreFailed||quiz()||quizStarting())return;
    checkpointTimer=setTimeout(()=>{try{void invoke("desktop_checkpoint",{checkpoint:checkpoint(),token:null}).catch(error=>setError(`Draft checkpoint: ${String(error)}`));}catch(error){setError(String(error));}},300);
  });
  onMount(()=>{
    let stopClose:(()=>void)|undefined,stopAgents:(()=>void)|undefined,stopQuiz:(()=>void)|undefined,stopCapture:(()=>void)|undefined;
    const desktopStops:(()=>void)[]=[];
    if("__TAURI_INTERNALS__"in window){
      void listen<CaptureProgress>("github-capture",event=>{
        const update=event.payload,readOrder=update.readOrder;if(disposed||capture()?.captureId!==update.captureId)return;
        if(update.phase==="metadata"&&typeof readOrder==="number"){
          sourceSequence++; // Reject cache replies issued before this actual metadata-read floor.
          setGithub(previous=>previous?{...previous,heads:previous.heads?.map(head=>head.url===update.url&&(head.readOrder??0)<readOrder?{...head,head:null,checking:true,error:null,readOrder}:head)}:previous);
        }
        setCapture(update);
      }).then(stop=>{if(disposed)stop();else stopCapture=stop;}).catch(()=>{});
      const quizEvents=listen<QuizState>("review-quiz",event=>acceptQuiz(event.payload)).then(stop=>{if(disposed)stop();else stopQuiz=stop;});
      const agentEvents=listen<AgentState>("review-agent",event=>acceptAgent(event.payload)).then(async stop=>{if(disposed){stop();return;}stopAgents=stop;for(const state of await invoke<AgentState[]>("list_review_agents"))acceptAgent(state);});
      eventsReady=Promise.all([quizEvents,agentEvents]).then(()=>{if(!disposed)eventsAvailable=true;}).catch(error=>{setError(`Agent event stream: ${String(error)}`);});
      void (async()=>{
        try{
          const subscribe=async<T,>(name:string,callback:(payload:T)=>void)=>{const stop=await listen<T>(name,event=>callback(event.payload));if(disposed)stop();else desktopStops.push(stop);};
          await subscribe<string|null>("desktop-open-review",id=>{if(id){liveReviewId=id;resumeId=id;if(desktopReady())void open(id);}});
          await subscribe<boolean>("desktop-visibility",visible=>{desktopVisible=visible;if(visible&&desktopReady())void refresh();});
          await subscribe("desktop-queue-changed",()=>{if(desktopVisible&&desktopReady())void refresh();});
          await subscribe("desktop-hide",()=>void hideDesktop());
          await subscribe("desktop-quit",()=>void quitDesktop());
          await subscribe<string>("desktop-error",message=>setError(message));
          await subscribe<number>("desktop-checkpoint",token=>{
            try{
              if(busy()||githubOpening())throw Error("A review operation or image upload is still running");
              void invoke("desktop_checkpoint",{token,checkpoint:checkpoint()}).catch(error=>invoke("desktop_checkpoint_failed",{token,error:String(error)}).catch(error=>setError(String(error))));
            }catch(error){void invoke("desktop_checkpoint_failed",{token,error:String(error)}).catch(error=>setError(String(error)));}
          });
          stopClose=await getCurrentWindow().onCloseRequested(event=>{event.preventDefault();void hideDesktop();});
          if(disposed){stopClose();return;}
          const bootstrap=await invoke<Bootstrap>("desktop_bootstrap");
          if(bootstrap.checkpoint){
            const saved=bootstrap.checkpoint;
            if(saved.version!==1||!Number.isSafeInteger(saved.revision)||saved.revision<0||!validDesktopData(saved.data))throw Error("Unsupported saved desktop state");
            checkpointRevision=saved.revision;const data=saved.data;
            for(const [id,entry] of Object.entries(data.navigation))navigation.set(id,entry);
            batch(()=>{setDrafts(data.drafts);setPlacement(data.placement);setStackDepth(data.stackDepth);setInboxVisible(data.inboxVisible);setChatVisible(data.chatVisible);setExpanded(data.expanded);setQuizSummaries(data.quizSummaries||[]);});
            resumeId=data.selectedId;autoOpen=Boolean(data.selectedId);
          }
          resumeId=liveReviewId||bootstrap.review||resumeId;
          await invoke("desktop_ready");setDesktopReady(true);
          await refresh(false);if(resumeId)await open(resumeId);else await refresh();
        }catch(error){
          restoreFailed=true;setError(`Desktop restore failed: ${String(error)}. Keep Dispatch running to preserve its saved drafts.`);
          await invoke("desktop_ready").catch(error=>setError(String(error)));
        }
      })();
    }else{void refresh();}
    void refreshSource();
    const timer=setInterval(()=>{if(desktopVisible&&desktopReady()){void refresh();void refreshSource();}},1500);
    const observer=new ResizeObserver(()=>{const style=getComputedStyle(workspace);const room=workspace.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)>=760;setGutterRoom(room);setHasGutter(window.innerWidth>=1180&&room);});observer.observe(workspace);
    const keyboard=(event:KeyboardEvent)=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="s"){event.preventDefault();event.stopPropagation();if(!event.repeat)void submitOrClose();return;}const target=event.target as HTMLElement;if(event.key==="/"&&!target.matches("input,textarea,[contenteditable=true]")){event.preventDefault();setInboxVisible(true);document.querySelector<HTMLInputElement>(".search input")?.focus();}};
    document.addEventListener("keydown",keyboard,true);
    document.addEventListener("paste",pasteImage);
    onCleanup(()=>{disposed=true;openSequence++;clearInterval(timer);clearTimeout(checkpointTimer);observer.disconnect();document.removeEventListener("keydown",keyboard,true);document.removeEventListener("paste",pasteImage);stopClose?.();stopAgents?.();stopQuiz?.();stopCapture?.();for(const stop of desktopStops)stop();});
  });
  return <WorkspaceShell inboxVisible={inboxVisible()} chatVisible={Boolean(quiz())||chatVisible()} onWorkspace={element=>workspace=element}
    topbar={<TopBar updatesBlocked={Boolean(restoreFailed||hasFeedback()||busy()||githubOpening()||quiz()||quizStarting())} placement={placement()} onPlacement={setPlacement} canBeside={gutterRoom()} stackDepth={stackDepth()} onStackDepth={setStackDepth} wide={useGutter()} request={request()} inboxVisible={inboxVisible()} chatVisible={chatVisible()} complete={complete()} busy={busy()} submitting={operation()==="submit"} commentCount={comments().length} hasSummary={Boolean(summary().trim())} onInbox={()=>setInboxVisible(!inboxVisible())} onChat={()=>{if(!quiz())setChatVisible(!chatVisible());}} onSubmit={()=>void submit()}/>}
    inbox={<InboxPanel github={github()} capture={capture()} onMotion={transition=>animateInbox=transition} cachedRequest={id=>snapshots.get(id)} sourceDisabled={Boolean(quiz())||quizStarting()} onSelectPR={url=>void openGithub(url)} reviews={queue()} request={request()} selectedId={request()?.id} activePath={path()} filter={filter()} agents={agents()} readReady={request()?.files.every(file=>Boolean(identities()[file.path]))||false} readPaths={readPaths()} findingCounts={findingCounts()} busy={busy()} onSelect={(id,file)=>void open(id).then(()=>{if(file&&request()?.id===id)selectFile(file);})} onSelectFile={selectFile} onFilter={setFilter} onRead={markRead} onRefresh={()=>void refresh()} onNew={()=>void selfReview()}/>}
    chat={<div class="quiz-panel-host"><div class="original-chat" classList={{"quiz-underneath":Boolean(quiz())}} inert={Boolean(quiz())}><ChatPanel quizSummaries={quizSummaries().filter(summary=>summary.requestId===request()?.id&&summary.head===request()?.source.head)} onQuiz={()=>void startQuiz()} quizDisabled={busy()||quizStarting()} quizStarting={quizStarting()} attachments={attachmentLinks()} uploading={uploads()>0} groups={reviewGroups().filter(group=>group.messages.some(message=>message.author!=="Pi"))} onReply={reply} onState={setThreadState} stateCount={Object.keys(currentDraft().threadStates).length} context={context()} onStartReview={()=>{const review=request();if(review)void startAgent(review);}} request={request()} agent={activeAgent()} complete={complete()} submitting={operation()==="submit"} error={error()} comments={comments()} pending={complete()?[]:pending()} summary={summary()} dismissed={dismissedForReview()} unsent={complete()?currentDraft():undefined} onSummary={value=>updateDraft(draft=>({...draft,summary:value}))} onJump={jumpTo} onResume={pending=>jumpTo(pending,true)} onRemove={removeComment} onClose={()=>setChatVisible(false)}/></div><Show when={quiz()}>{state=><QuizPanel state={state()} onDone={quizDone} onJump={jumpTo}/>}</Show></div>}
    footer={<footer class="statusbar"><span class="status-dot"/><span>{operation()==="snapshot"?"Creating local snapshot…":request()?`${readPaths().size}/${request()!.files.length} files read`:"Local review inbox"}</span><span class="status-divider"/><span class="status-file">{path()}</span><span class="spacer"/><span>{activeAgent()?"Native Pi · static inspection":"Immutable local snapshots"}</span><span class="status-divider"/><span>No GitHub publishing</span></footer>}
  >
    <Show when={notice()}><p class="inbox-notice" role="status">{notice()}</p></Show>
    <Show when={error()}><div class="error-banner" role="alert"><span>{error()}</span><Show when={hasFeedback()}><button disabled={busy()} onClick={()=>{setDrafts({});setAnchor(undefined);setError("");}}>Discard all unsubmitted feedback</button></Show><button class="iconbtn" aria-label="Dismiss message" onClick={()=>setError("")}><Icon name="close"/></button></div></Show>
    <Show when={request()} fallback={<section class="empty-state"><Icon name="branch"/><h1>Your review inbox</h1><p>Open a change from Inbox, or snapshot Dispatch against main.</p><button class="primary-action" disabled={busy()} onClick={()=>void selfReview()}>Review Dispatch</button><p class="muted">Completed reviews stay readable in Archive.</p></section>}>{review=><>
      <ChangeContext hasGuide={Boolean(context()?.guide)} onGuide={()=>{setChatVisible(true);requestAnimationFrame(()=>document.querySelector(".review-guide-context")?.scrollIntoView({block:"start"}));}} request={review()} complete={complete()} mode={mode()} onMode={setMode} hasGutter={useGutter()}/>
      <GutterLayout groups={reviewGroups()} handles={editorHandles} revision={handleRevision()} workspace={()=>workspace} wide={useGutter()} stackDepth={stackDepth()}/>
      <For each={review().files}>{file=><FileDiffPanel beside={useGutter()} file={file} mode={mode()} readonly={complete()||operation()==="submit"||uploads()>0} readReady={Boolean(identities()[file.path])} reviewed={readPaths().has(file.path)} expanded={fileExpanded(file.path)} focus={jump()?.path===file.path?jump():undefined} groups={reviewGroups().filter(group=>group.path===file.path)} composer={!complete()&&anchor()?.path===file.path?currentDraft().pending[anchorKey(anchor()!)]:undefined} onBody={updateBody} onSave={saveComment} onDiscard={discardPending} onClose={()=>setAnchor(undefined)} onComment={compose} onJump={jumpTo} onState={setThreadState} onRemove={removeComment} onEdit={editComment} onHandle={handle=>{if(handle)editorHandles.set(file.path,handle);else editorHandles.delete(file.path);setHandleRevision(value=>value+1);}} onRead={read=>markRead(file.path,read)} onExpand={()=>setExpanded(all=>({...all,[expandKey(file.path)]:!fileExpanded(file.path)}))} onElement={element=>elements.set(file.path,element)}/>}</For>
    </>}</Show>
  </WorkspaceShell>;
}
