// Real Pi + Ferropi + shipped extension. Deterministic loopback provider, no external model.
const {spawn,execFileSync}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'dispatch-quiz-native-'));
fs.chmodSync(root,0o700);
const cwd=path.resolve(__dirname,'..'),pi=process.env.PI_BINARY;
if(!pi)throw Error('Set PI_BINARY to installed Pi 1.3 executable');
const clients=[],requests=[];
function mount(session,args,forkArgs){
  const child=spawn(path.join(cwd,'target/debug/ferropi'),['--state-dir',path.join(root,'daemon'),'--pi',pi,...args.map(arg=>'--pi-arg='+arg),forkArgs?'fork':'mount','--session',session,'--cwd',cwd,...(forkArgs||[]).map(arg=>'--fork-pi-arg='+arg)],{env:{...process.env,PI_CODING_AGENT_DIR:path.join(root,'agent')},stdio:['pipe','pipe','pipe']});
  clients.push(child);const events=[];let buffer='',records=[],waiters=[],stderr='';
  child.stderr.on('data',data=>stderr+=data);
  child.stdout.on('data',data=>{buffer+=data;let end;while((end=buffer.indexOf('\n'))>=0){const wire=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);const record=wire.type==='event'?wire.record:wire;records.push(record);events.push(record);}for(const wake of waiters.splice(0))wake();});
  async function next(predicate){const deadline=Date.now()+25000;for(;;){const index=records.findIndex(predicate);if(index>=0)return records.splice(index,1)[0];if(child.exitCode!==null)throw Error(`Ferropi exit ${child.exitCode}: ${stderr}`);if(Date.now()>deadline)throw Error(`Native deadline: ${JSON.stringify(records)} ${stderr}`);await Promise.race([new Promise(resolve=>waiters.push(resolve)),new Promise(resolve=>setTimeout(resolve,50))]);}}
  return {send:value=>child.stdin.write(JSON.stringify(value)+'\n'),next,child,events};
}

const question={question:'Why does Dispatch pin immutable source snapshots?',choices:['To keep review anchors stable','To modify the working tree'],anchors:[{path:'src/App.tsx',side:'new',line:1}]};
const secondQuestion={...question,question:'Does editing the working tree rewrite the pinned snapshot?',choices:['No, pinned commits stay fixed','Yes, it follows live edits']};
const assessment=(questionToolCallId,verdict)=>({questionToolCallId,verdict,reason:verdict==='pass'?'You identified stable snapshot anchors.':'Working-tree edits do not rewrite an immutable snapshot.'});
const tool=(id,name,args,index=0)=>({index,id,type:'function',function:{name,arguments:JSON.stringify(args)}});
const server=http.createServer(async(req,res)=>{
 let body='';for await(const chunk of req)body+=chunk;
 const request=JSON.parse(body);requests.push(request);
 const tools=(request.tools||[]).map(tool=>tool.function.name),results=request.messages.filter(message=>message.role==='tool'),last=results.at(-1);
 const cancelled=request.messages.some(message=>message.role==='user'&&JSON.stringify(message.content).includes('cancellation fixture'));
 let content='',calls=[];
 if(!tools.length)content='{"initialized":true}';
 else {
  assert.deepEqual(tools,['present_question','report_assessment']);
  let data;try{data=JSON.parse(last?.content);}catch{}
  if(!last)calls=cancelled?[tool('quiz-q1','present_question',question),tool('assessment-pending','report_assessment',assessment('quiz-q1','pass'),1)]:[tool('assessment-before-answer','report_assessment',assessment('unknown-question','pass'))];
  else if(last.tool_call_id==='assessment-before-answer')calls=[tool('quiz-q1','present_question',question)];
  else if(last.tool_call_id==='quiz-q1'){assert.equal(data.questionToolCallId,'quiz-q1');assert.match(data.explanation,/because anchors/);content='Your reasoning identifies the pinned anchors. ';calls=[tool('assessment-pass','report_assessment',assessment('quiz-q1','pass'))];}
  else if(last.tool_call_id==='assessment-pass')calls=[tool('assessment-duplicate','report_assessment',assessment('quiz-q1','fail'))];
  else if(last.tool_call_id==='assessment-duplicate'){content='First answer explained. Here is another question.';calls=[tool('quiz-q2','present_question',secondQuestion)];}
  else if(last.tool_call_id==='quiz-q2')calls=[tool('assessment-stale','report_assessment',assessment('quiz-q1','pass'))];
  else if(last.tool_call_id==='assessment-stale')calls=[tool('assessment-fail','report_assessment',assessment('quiz-q2','fail'))];
  else if(last.tool_call_id==='assessment-fail')content='Exactly: immutable snapshots keep review anchors stable. Quiz complete.';
  else throw Error('Unexpected fixture result '+JSON.stringify(last));
 }
 res.writeHead(200,{'Content-Type':'text/event-stream'});
 const send=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'quiz',choices:[{index:0,delta,finish_reason}]})+'\n\n');
 send({role:'assistant'});
 if(content){const at=Math.floor(content.length/2);send({content:content.slice(0,at)});await new Promise(resolve=>setTimeout(resolve,65));send({content:content.slice(at)});}
 if(calls.length){send({tool_calls:calls.map(call=>({...call,function:{...call.function,arguments:call.function.arguments.slice(0,Math.floor(call.function.arguments.length/2))}}))});await new Promise(resolve=>setTimeout(resolve,25));send({tool_calls:calls.map(call=>({index:call.index,function:{arguments:call.function.arguments.slice(Math.floor(call.function.arguments.length/2))}}))});}
 send({},calls.length?'tool_calls':'stop');res.end('data: [DONE]\n\n');
});
(async()=>{
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const provider=path.join(root,'fixture-provider.ts');
  fs.writeFileSync(provider,`export default function(pi){pi.registerProvider('dispatch-fixture',{api:'openai-completions',apiKey:'fixture-only',baseUrl:'http://127.0.0.1:${server.address().port}/v1',models:[{id:'quiz',name:'Quiz fixture',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:64000,maxTokens:2048,compat:{supportsDeveloperRole:false,supportsStore:false}}]});}`);
  const shared=['--offline','--no-approve','--no-mcp','--no-extensions','--no-skills','--no-prompt-templates','--no-themes','--no-context-files','-e',provider,'--model','dispatch-fixture/quiz'];
  const sourcePath=path.join(root,'source.jsonl'),parent=mount(sourcePath,[...shared,'--no-tools']);
  await parent.next(r=>r.type==='mounted');parent.send({type:'prompt',id:'initialize',message:'Context initialization ONLY for Dispatch repository snapshot: src/App.tsx:1. Do not review yet.'});
  await parent.next(r=>r.type==='agent_settled');const source=fs.readFileSync(sourcePath);
  const childArgs=[...shared,'--tools','present_question,report_assessment','-e',path.join(cwd,'src-tauri/extensions/quiz.mjs')],quiz=mount(sourcePath,[...shared,'--no-tools'],childArgs);
  const mounted=await quiz.next(r=>r.type==='mounted');assert.notEqual(mounted.session,sourcePath);
  quiz.send({type:'prompt',id:'quiz',message:'Quiz me about the immutable Dispatch snapshot. Call present_question now.'});
  const rejected=await quiz.next(r=>r.type==='tool_execution_end'&&r.toolCallId==='assessment-before-answer');assert.equal(rejected.isError,true,'unknown/unanswered assessment rejected');
  for(const [id,args,choice,verdict,assessmentId] of [['quiz-q1',question,0,'pass','assessment-pass'],['quiz-q2',secondQuestion,1,'fail','assessment-fail']]){
   const call=await quiz.next(r=>r.type==='tool_execution_start'&&r.toolCallId===id);assert.deepEqual(call.args,args);
   const dialog=await quiz.next(r=>r.type==='extension_ui_request');assert.equal(dialog.method,'input');assert.equal(dialog.title,'dispatch.quiz.answer');
   quiz.send({type:'extension_ui_response',id:dialog.id,value:JSON.stringify({choice,explanation:'because anchors must be stable'})});
   const result=await quiz.next(r=>r.type==='tool_execution_end'&&r.toolCallId===id);assert.equal(result.isError,false);assert.equal(result.result.details.questionToolCallId,id);
   const report=await quiz.next(r=>r.type==='tool_execution_end'&&r.toolCallId===assessmentId);assert.equal(report.isError,false);assert.deepEqual(report.result.details,assessment(id,verdict));
  }
  for(const id of ['assessment-duplicate','assessment-stale'])assert.equal((await quiz.next(r=>r.type==='tool_execution_end'&&r.toolCallId===id)).isError,true,id+' must be rejected');
  const feedback=await quiz.next(r=>r.type==='message_end'&&r.message.role==='assistant'&&r.message.stopReason==='stop');assert.match(JSON.stringify(feedback),/immutable snapshots keep review anchors stable/);
  await quiz.next(r=>r.type==='agent_settled');assert.deepEqual(fs.readFileSync(sourcePath),source);
  const updates=quiz.events.filter(r=>r.type==='message_update');assert.ok(updates.filter(r=>r.assistantMessageEvent.type==='text_delta').length>=4,'genuine progressive text deltas');
  assert.ok(updates.some(r=>r.assistantMessageEvent.type==='text_end'&&typeof r.assistantMessageEvent.content==='string'));
  assert.ok(updates.some(r=>r.assistantMessageEvent.type==='toolcall_start'&&r.assistantMessageEvent.toolName==='present_question'));
  assert.ok(updates.some(r=>r.assistantMessageEvent.type==='toolcall_delta'&&r.assistantMessageEvent.delta));
  assert.ok(updates.every(r=>!('message' in r)&&!('partial' in r.assistantMessageEvent)),'Pi 1.3 delta-only wire, no cumulative snapshots');
  const history=fs.readFileSync(mounted.session,'utf8').trim().split('\n').map(JSON.parse);assert.equal(history[0].parentSession,sourcePath);
  assert.ok(history.some(entry=>entry.message?.role==='toolResult'&&entry.message.toolName==='report_assessment'&&!entry.message.isError));
  const cancelled=mount(sourcePath,[...shared,'--no-tools'],childArgs);await cancelled.next(r=>r.type==='mounted');cancelled.send({type:'prompt',id:'cancelled-quiz',message:'Ask one question; cancellation fixture.'});
  await cancelled.next(r=>r.type==='extension_ui_request');assert.equal((await cancelled.next(r=>r.type==='tool_execution_end'&&r.toolName==='report_assessment')).isError,true,'pending question assessment rejected');
  cancelled.child.stdin.end();await new Promise(resolve=>cancelled.child.once('exit',resolve));
  parent.send({type:'get_state',id:'parent-after-cancel'});assert.equal((await parent.next(r=>r.type==='response'&&r.id==='parent-after-cancel')).success,true);assert.deepEqual(fs.readFileSync(sourcePath),source);
  assert.equal(requests.length,10,'bounded loopback fixture sequence');
  const eventPath=path.join(root,'quiz-events.json');fs.writeFileSync(eventPath,JSON.stringify(quiz.events));
  console.log(execFileSync('cargo',['test','-p','dispatch','quiz_stream::tests::actual_native_events_keep_answer_markers_before_feedback','--','--ignored'],{cwd,env:{...process.env,DISPATCH_QUIZ_NATIVE_EVENTS:eventPath},encoding:'utf8'}));
  console.log(JSON.stringify({proof:'actual Pi event stream replayed through production Rust ordered transcript: answer markers precede feedback; native pass/fail and correlation rejection',pi,source:sourcePath,fork:mounted.session,parentUnchanged:true,childCancellationPreservesParent:true,tools:['present_question','report_assessment'],providerRequests:requests.length,fixtureDirectory:root},null,2));
 }finally{
  for(const child of clients)child.stdin.end();await new Promise(resolve=>setTimeout(resolve,1200));for(const child of clients)if(child.exitCode===null)child.kill();server.close();
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
