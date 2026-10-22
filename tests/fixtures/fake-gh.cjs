#!/usr/bin/env node
// Deterministic read-only provider fixture. Each invocation consumes one reply.
const fs=require('node:fs'),path=require('node:path');
// argv[1] preserves the private invocation path when this executable is symlinked.
const root=path.dirname(process.argv[1]),countFile=path.join(root,'count'),lock=path.join(root,'count.lock');
const deadline=Date.now()+10000,wait=new Int32Array(new SharedArrayBuffer(4));
for(;;){
  try{fs.mkdirSync(lock);break;}
  catch(error){if(error.code!=='EEXIST'||Date.now()>=deadline)throw error;Atomics.wait(wait,0,0,1);}
}
let index;
try{
  index=fs.existsSync(countFile)?Number(fs.readFileSync(countFile,'utf8')):0;
  if(!Number.isSafeInteger(index)||index<0)throw Error('invalid fake gh counter');
  fs.appendFileSync(path.join(root,'calls.jsonl'),JSON.stringify(process.argv.slice(2))+'\n');
  fs.writeFileSync(path.join(root,'pid'),String(process.pid));
  const temporary=countFile+'.'+process.pid;
  fs.writeFileSync(temporary,String(index+1),{flag:'wx'});
  fs.renameSync(temporary,countFile);
}finally{fs.rmdirSync(lock);}
const reply=JSON.parse(fs.readFileSync(path.join(root,'plan.json'),'utf8'))[index];
if(!reply){process.stderr.write('unexpected fake gh invocation');process.exitCode=9;}
else{
  // Let Node drain pipe writes; process.exit() can truncate large JSON replies.
  const finish=()=>{process.stdout.write(reply.stdout||'');process.stderr.write(reply.stderr||'');process.exitCode=reply.code||0;};
  if(reply.waitForRelease){const timer=setInterval(()=>{if(fs.existsSync(path.join(root,'release'))){clearInterval(timer);finish();}},10);}else setTimeout(finish,reply.delayMs||0);
}
